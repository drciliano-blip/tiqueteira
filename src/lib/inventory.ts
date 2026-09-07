/**
 * Controle de estoque — plano, seção 10, e ADR-003.
 *
 * O ponto mais difícil do sistema: dois compradores disputando o último
 * ingresso não podem ambos vender.
 *
 * A estratégia inteira cabe em duas frases:
 *
 * 1. **Reservar é um único `UPDATE` condicional, sem `SELECT` antes.** Quem
 *    lê para depois decidir cria janela para a corrida. Aqui o próprio banco
 *    decide, na mesma instrução: se a linha não voltar, não havia estoque.
 *
 * 2. **A linha de `reservations` é o token de uso único da operação.** Tanto
 *    confirmar quanto devolver começam virando `liberada` de false para true;
 *    só quem consegue essa virada mexe no contador. É o que impede o Pix pago
 *    depois da expiração de decrementar o estoque uma segunda vez e deixar o
 *    contador negativo — caso de borda 1.
 */
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/db/client';

/** Aceita a conexão ou uma transação em curso. */
export type Executor = Pick<Database, 'execute'>;

export type ItemReserva = { ticketTypeId: string; quantidade: number };

export type ResultadoReserva =
  | { ok: true; expiresEm: Date }
  | { ok: false; motivo: 'sem_estoque' | 'fora_da_janela_ou_inativo'; ticketTypeId: string };

async function linhas<T>(exec: Executor, query: SQL): Promise<T[]> {
  const resultado = await exec.execute(query);
  return resultado as unknown as T[];
}

/**
 * Reserva estoque para um pedido já criado.
 *
 * Precisa rodar dentro da MESMA transação que cria o pedido: se a chamada à
 * PSP falhar depois, o `ROLLBACK` desfaz a reserva junto. Reserva órfã é
 * ingresso que ninguém vende e ninguém compra.
 */
export async function reservarEstoque(
  exec: Executor,
  params: {
    tenantId: string;
    orderId: string;
    itens: readonly ItemReserva[];
    ttlSegundos: number;
    agora?: Date;
  },
): Promise<ResultadoReserva> {
  const expiresEm = new Date((params.agora?.getTime() ?? Date.now()) + params.ttlSegundos * 1000);

  for (const item of params.itens) {
    if (!Number.isInteger(item.quantidade) || item.quantidade <= 0) {
      throw new Error(`Quantidade inválida para ${item.ticketTypeId}: ${item.quantidade}`);
    }

    /**
     * O coração de tudo. Sem leitura prévia, sem race condition.
     *
     * Se a linha não voltar, uma de duas: acabou o estoque, ou o tipo está
     * inativo/fora da janela. A segunda consulta distingue os dois casos
     * apenas para dar mensagem decente ao comprador — ela não participa da
     * decisão, que já foi tomada de forma atômica acima.
     */
    const reservadas = await linhas<{ id: string }>(
      exec,
      sql`
        update ticket_types
           set quantidade_reservada = quantidade_reservada + ${item.quantidade},
               atualizado_em = now()
         where id = ${item.ticketTypeId}
           and tenant_id = ${params.tenantId}
           and ativo = true
           and now() between vendas_inicio and vendas_fim
           and quantidade_vendida + quantidade_reservada + ${item.quantidade}
               <= quantidade_total
        returning id
      `,
    );

    if (reservadas.length === 0) {
      const [tipo] = await linhas<{ vendavel: boolean }>(
        exec,
        sql`
          select (ativo and now() between vendas_inicio and vendas_fim) as vendavel
            from ticket_types
           where id = ${item.ticketTypeId} and tenant_id = ${params.tenantId}
        `,
      );

      return {
        ok: false,
        motivo: tipo?.vendavel === false ? 'fora_da_janela_ou_inativo' : 'sem_estoque',
        ticketTypeId: item.ticketTypeId,
      };
    }

    // ISO string, não Date: neste caminho de execução o driver não serializa
    // objeto Date e falha com ERR_INVALID_ARG_TYPE.
    await exec.execute(sql`
      insert into reservations (tenant_id, ticket_type_id, order_id, quantidade, expires_em)
      values (${params.tenantId}, ${item.ticketTypeId}, ${params.orderId},
              ${item.quantidade}, ${expiresEm.toISOString()}::timestamptz)
    `);
  }

  return { ok: true, expiresEm };
}

type LinhaLiberada = { ticket_type_id: string; quantidade: number };

/**
 * Confirma a venda: reservado → vendido.
 *
 * Chamado no processamento do webhook de pagamento. Idempotente por
 * construção: a segunda chamada não encontra reserva com `liberada = false` e
 * devolve zero, sem tocar em contador. Dois webhooks `paid` para a mesma
 * transação (caso de borda 2) não vendem o ingresso duas vezes.
 */
export async function confirmarEstoque(
  exec: Executor,
  orderId: string,
): Promise<{ confirmados: number }> {
  const liberadas = await linhas<LinhaLiberada>(
    exec,
    sql`
      update reservations
         set liberada = true, liberada_em = now(), liberada_motivo = 'paga',
             atualizado_em = now()
       where order_id = ${orderId} and liberada = false
      returning ticket_type_id, quantidade
    `,
  );

  for (const linha of liberadas) {
    await exec.execute(sql`
      update ticket_types
         set quantidade_reservada = quantidade_reservada - ${linha.quantidade},
             quantidade_vendida   = quantidade_vendida   + ${linha.quantidade},
             atualizado_em = now()
       where id = ${linha.ticket_type_id}
    `);
  }

  return { confirmados: liberadas.reduce((a, l) => a + l.quantidade, 0) };
}

/**
 * Devolve estoque de um pedido que não vai se pagar.
 * Mesma mecânica idempotente da confirmação.
 */
export async function devolverEstoque(
  exec: Executor,
  orderId: string,
  motivo: 'expirada' | 'cancelada',
): Promise<{ devolvidos: number }> {
  const liberadas = await linhas<LinhaLiberada>(
    exec,
    sql`
      update reservations
         set liberada = true, liberada_em = now(), liberada_motivo = ${motivo},
             atualizado_em = now()
       where order_id = ${orderId} and liberada = false
      returning ticket_type_id, quantidade
    `,
  );

  for (const linha of liberadas) {
    await exec.execute(sql`
      update ticket_types
         set quantidade_reservada = quantidade_reservada - ${linha.quantidade},
             atualizado_em = now()
       where id = ${linha.ticket_type_id}
    `);
  }

  return { devolvidos: liberadas.reduce((a, l) => a + l.quantidade, 0) };
}

/**
 * Varredura de reservas vencidas. Roda a cada minuto.
 *
 * Devolve os pedidos afetados para que o chamador os mova para `expired` pela
 * máquina de estado — este módulo cuida de estoque, não de status de pedido.
 */
export async function expirarReservasVencidas(
  exec: Executor,
  opcoes: { limite?: number; tenantId?: string } = {},
): Promise<{ orderIds: string[]; devolvidos: number }> {
  const limite = opcoes.limite ?? 500;
  // O filtro por tenant existe para processar um produtor de cada vez quando
  // preciso, e para que teste não varra reserva de outro cenário.
  const filtroTenant = opcoes.tenantId ? sql`and tenant_id = ${opcoes.tenantId}` : sql``;

  const liberadas = await linhas<LinhaLiberada & { order_id: string }>(
    exec,
    sql`
      with vencidas as (
        select id from reservations
         where liberada = false and expires_em < now()
           ${filtroTenant}
         order by expires_em
         limit ${limite}
         for update skip locked
      )
      update reservations r
         set liberada = true, liberada_em = now(), liberada_motivo = 'expirada',
             atualizado_em = now()
        from vencidas v
       where r.id = v.id
      returning r.order_id, r.ticket_type_id, r.quantidade
    `,
  );

  for (const linha of liberadas) {
    await exec.execute(sql`
      update ticket_types
         set quantidade_reservada = quantidade_reservada - ${linha.quantidade},
             atualizado_em = now()
       where id = ${linha.ticket_type_id}
    `);
  }

  return {
    orderIds: [...new Set(liberadas.map((l) => l.order_id))],
    devolvidos: liberadas.reduce((a, l) => a + l.quantidade, 0),
  };
}

/**
 * Quantos ingressos este CPF já tem neste tipo, contando pedido pago e pedido
 * aguardando pagamento.
 *
 * Contar o aguardando é o que fecha o furo do caso de borda 16: sem isso, o
 * comprador abre dez abas ao mesmo tempo e cada uma passa pelo limite.
 * A chamada precisa estar na MESMA transação da reserva.
 */
export async function ingressosDoCpf(
  exec: Executor,
  params: { ticketTypeId: string; cpf: string },
): Promise<number> {
  const [linha] = await linhas<{ total: string | number }>(
    exec,
    sql`
      select coalesce(sum(oi.quantidade), 0) as total
        from order_items oi
        join orders o on o.id = oi.order_id
       where oi.ticket_type_id = ${params.ticketTypeId}
         and o.comprador_cpf = ${params.cpf}
         and o.status in ('awaiting_payment', 'paid', 'partially_refunded')
    `,
  );
  return Number(linha?.total ?? 0);
}
