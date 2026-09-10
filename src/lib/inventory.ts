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
import { excedeLimitePorCpf } from '@/domain/inventory';

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
     * O `INSERT` da reserva vive DENTRO do mesmo comando, num CTE, e a razão é
     * de capacidade, não de elegância. O `UPDATE` tranca a linha do lote, e o
     * Postgres só solta a tranca no `COMMIT`. Enquanto ela está presa, todo
     * mundo que quer o mesmo lote espera — então cada ida ao banco entre o
     * `UPDATE` e o `COMMIT` é somada à espera de TODA a fila.
     *
     * Com o `INSERT` separado eram duas idas seguradas; com o CTE é uma. Numa
     * abertura de venda de festival isso é a diferença entre a fila andar e a
     * fila estourar o tempo limite. Medido em `src/db/bench.ts`.
     *
     * Se nada voltar, uma de duas: acabou o estoque, ou o tipo está
     * inativo/fora da janela. A segunda consulta distingue os dois casos
     * apenas para dar mensagem decente ao comprador — ela não participa da
     * decisão, que já foi tomada de forma atômica acima. E ela só acontece no
     * caminho da RECUSA, onde não há tranca alguma para segurar.
     */
    const reservadas = await linhas<{ id: string }>(
      exec,
      sql`
        with reservado as (
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
        )
        insert into reservations
          (tenant_id, ticket_type_id, order_id, quantidade, expires_em)
        select ${params.tenantId}, id, ${params.orderId}, ${item.quantidade},
               ${expiresEm.toISOString()}::timestamptz
          from reservado
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
  params: { ticketTypeId: string; cpf: string; ignorarOrderId?: string | undefined },
): Promise<number> {
  const [linha] = await linhas<{ total: string | number }>(
    exec,
    sql`
      select coalesce(sum(oi.quantidade), 0) as total
        from order_items oi
        join orders o on o.id = oi.order_id
       where oi.ticket_type_id = ${params.ticketTypeId}
         and o.comprador_cpf = ${params.cpf}
         and o.id is distinct from ${params.ignorarOrderId ?? null}
         and (
           o.status in ('awaiting_payment', 'paid', 'partially_refunded')
           or (
             -- Rascunho que já sabe de quem é e ainda segura estoque. É o que
             -- fecha o furo das dez abas: a primeira a chegar no checkout
             -- carimba o CPF, e as outras já a enxergam.
             o.status = 'draft'
             and o.comprador_cpf is not null
             and (o.expires_em is null or o.expires_em > now())
           )
         )
    `,
  );
  return Number(linha?.total ?? 0);
}

export type ViolacaoLimiteCpf = {
  ticketTypeId: string;
  lote: string;
  jaTem: number;
  limite: number;
};

/**
 * Confere o limite por CPF de todos os itens do pedido e, se passar, **carimba
 * o CPF no rascunho**.
 *
 * O carimbo é a parte que faz a defesa funcionar. Sem ele, duas abas do mesmo
 * comprador chegariam ao checkout ao mesmo tempo, as duas contariam zero e as
 * duas passariam. Com ele, a primeira a comitar já aparece para a segunda.
 *
 * A trava consultiva por CPF fecha o resto da janela: duas transações que
 * contam ao mesmo tempo veriam o mesmo número. Ela é por CPF, então não cria
 * fila entre compradores diferentes — e vive só até o fim da transação, que
 * aqui é curta de propósito: a chamada à PSP acontece DEPOIS, fora dela.
 * Segurar tranca durante chamada de rede externa é como se perde um banco.
 */
export async function reservarLimitePorCpf(
  exec: Executor,
  params: { orderId: string; cpf: string },
): Promise<ViolacaoLimiteCpf | null> {
  await exec.execute(sql`select pg_advisory_xact_lock(hashtext(${'cpf:' + params.cpf}))`);

  const itens = await linhas<{
    ticket_type_id: string;
    lote: string;
    quantidade: number;
    limite: number | null;
  }>(
    exec,
    sql`
      select oi.ticket_type_id, tt.nome as lote, oi.quantidade, tt.limite_por_cpf as limite
        from order_items oi
        join ticket_types tt on tt.id = oi.ticket_type_id
       where oi.order_id = ${params.orderId}
    `,
  );

  for (const item of itens) {
    if (item.limite === null) continue;

    const jaTem = await ingressosDoCpf(exec, {
      ticketTypeId: item.ticket_type_id,
      cpf: params.cpf,
      ignorarOrderId: params.orderId,
    });

    if (excedeLimitePorCpf({ jaTem, pedindo: Number(item.quantidade), limite: item.limite })) {
      return {
        ticketTypeId: item.ticket_type_id,
        lote: item.lote,
        jaTem,
        limite: item.limite,
      };
    }
  }

  await exec.execute(sql`
    update orders set comprador_cpf = ${params.cpf}, atualizado_em = now()
     where id = ${params.orderId} and status = 'draft'
  `);

  return null;
}
