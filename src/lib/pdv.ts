/**
 * Bilheteria física — plano, seção 7 (canal `pdv`).
 *
 * O dinheiro **não passa pela plataforma**: quem cobra é a maquininha do
 * produtor, ou a mão dele. O que o sistema faz é registrar a venda, consumir
 * o estoque e emitir o ingresso — para que o número da porta feche com o
 * número do painel no fim da noite.
 *
 * Por isso a bilheteria funciona **sem PSP**. É o único canal de venda que
 * funciona hoje de ponta a ponta, e num festival ele é responsável por uma
 * fatia grande: muita gente decide na porta.
 *
 * A operação inteira acontece numa transação: consome estoque, cria o pedido,
 * emite os ingressos e, se a pessoa já está entrando, registra a entrada. Se
 * qualquer passo falhar, nada aconteceu — bilheteria com ingresso emitido e
 * estoque não consumido é o começo de um evento com mais gente que lugar.
 */
import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import { ticketTypes } from '@/db/schema';
import { env } from '@/lib/env';
import { emitirTicket } from '@/lib/tickets';

export type MetodoBilheteria = 'dinheiro' | 'debito' | 'credito' | 'cortesia' | 'outro';

export type IngressoEmitido = {
  id: string;
  codigo: string;
  /** Token do QR. Só existe aqui: o banco guarda o hash. */
  token: string;
};

export type ResultadoVenda =
  | {
      ok: true;
      orderId: string;
      numero: number;
      totalCentavos: number;
      ingressos: IngressoEmitido[];
    }
  | { ok: false; erro: string };

export async function venderNaBilheteria(params: {
  tenantId: string;
  eventId: string;
  ticketTypeId: string;
  quantidade: number;
  metodo: MetodoBilheteria;
  compradorNome: string;
  compradorCpf: string | null;
  /** A pessoa está atravessando a porta agora. */
  jaEntrou: boolean;
  userId: string;
  deviceId?: string | undefined;
}): Promise<ResultadoVenda> {
  if (params.quantidade < 1 || params.quantidade > 20) {
    return { ok: false, erro: 'Quantidade fora do permitido.' };
  }

  const segredo = env().TICKET_HMAC_SECRET;

  return withTenant(params.tenantId, async (tx) => {
    /**
     * Estoque primeiro, e com a condição no `WHERE`: se não houver lugar para
     * a quantidade inteira, nada acontece. Vender três quando só há dois
     * deixaria a bilheteria explicando na porta o que o sistema deveria ter
     * impedido no balcão.
     */
    const lotes = (await tx.execute(sql`
      update ticket_types
         set quantidade_vendida = quantidade_vendida + ${params.quantidade},
             atualizado_em = now()
       where id = ${params.ticketTypeId}
         and event_id = ${params.eventId}
         and ativo = true
         and quantidade_vendida + quantidade_reservada + ${params.quantidade}
             <= quantidade_total
      returning nome, preco_centavos
    `)) as unknown as { nome: string; preco_centavos: number }[];

    const lote = lotes[0];
    if (!lote) {
      return { ok: false as const, erro: 'Este lote esgotou ou não está mais à venda.' };
    }

    /**
     * Cortesia é sempre zero, qualquer que seja o preço do lote — é o sentido
     * da palavra. Nos demais métodos vale o preço de tabela: a bilheteria não
     * negocia preço no balcão, senão o fechamento de caixa nunca bate.
     */
    const unitario = params.metodo === 'cortesia' ? 0 : lote.preco_centavos;
    const total = unitario * params.quantidade;

    const numeros = (await tx.execute(sql`
      select coalesce(max(numero), 0) + 1 as proximo
        from orders where tenant_id = ${params.tenantId}
    `)) as unknown as { proximo: number }[];

    const numero = Number(numeros[0]!.proximo);

    /**
     * O valor inteiro vai para o produtor. A plataforma não tocou neste
     * dinheiro e não tem o que reter dele — a comissão de bilheteria, se
     * houver, é cobrança à parte, fora do split.
     */
    const pedidos = (await tx.execute(sql`
      insert into orders
        (tenant_id, event_id, numero, comprador_nome, comprador_cpf,
         subtotal_centavos, conveniencia_centavos, total_centavos,
         valor_produtor_centavos, valor_operador_centavos,
         taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
         canal, metodo_externo, status, pago_em, idempotency_key, vendido_por)
      values (${params.tenantId}, ${params.eventId}, ${numero},
              ${params.compradorNome}, ${params.compradorCpf},
              ${total}, 0, ${total}, ${total}, 0, 0, 0,
              'pdv', ${params.metodo}, 'paid', now(),
              ${'pdv_' + params.eventId + '_' + numero}, ${params.userId})
      returning id
    `)) as unknown as { id: string }[];

    const orderId = pedidos[0]!.id;

    await tx.execute(sql`
      insert into order_items
        (tenant_id, order_id, ticket_type_id, quantidade, preco_unitario_centavos_snapshot)
      values (${params.tenantId}, ${orderId}, ${params.ticketTypeId},
              ${params.quantidade}, ${unitario})
    `);

    const ingressos: IngressoEmitido[] = [];

    for (let i = 0; i < params.quantidade; i++) {
      const emitido = emitirTicket(segredo);

      const linhas = (await tx.execute(sql`
        insert into tickets
          (tenant_id, order_id, ticket_type_id, event_id, codigo, token_hash,
           titular_nome, titular_cpf, status, dentro, entradas_count,
           checked_in_em, ultima_entrada_em, checked_in_by, checked_in_device_id)
        values (${params.tenantId}, ${orderId}, ${params.ticketTypeId}, ${params.eventId},
                ${emitido.codigo}, ${emitido.tokenHash},
                ${params.compradorNome}, ${params.compradorCpf},
                ${params.jaEntrou ? 'usado' : 'valido'},
                ${params.jaEntrou}, ${params.jaEntrou ? 1 : 0},
                ${params.jaEntrou ? sql`now()` : null},
                ${params.jaEntrou ? sql`now()` : null},
                ${params.jaEntrou ? params.userId : null},
                ${params.jaEntrou ? (params.deviceId ?? null) : null})
        returning id, ultima_entrada_em
      `)) as unknown as { id: string; ultima_entrada_em: string | null }[];

      const ticket = linhas[0]!;

      if (params.jaEntrou && ticket.ultima_entrada_em) {
        await tx.execute(sql`
          insert into ticket_movimentos
            (tenant_id, event_id, ticket_id, tipo, em, operador_id, device_id, origem)
          values (${params.tenantId}, ${params.eventId}, ${ticket.id}, 'entrada',
                  ${ticket.ultima_entrada_em}::timestamptz, ${params.userId},
                  ${params.deviceId ?? null}, 'online')
          on conflict do nothing
        `);
      }

      ingressos.push({ id: ticket.id, codigo: emitido.codigo, token: emitido.token });
    }

    return { ok: true as const, orderId, numero, totalCentavos: total, ingressos };
  });
}

export type LoteDeBalcao = {
  id: string;
  nome: string;
  precoCentavos: number;
  disponivel: number;
};

/** O que dá para vender agora, com o que sobrou de cada lote. */
export async function lotesDeBalcao(
  tenantId: string,
  eventId: string,
): Promise<LoteDeBalcao[]> {
  const linhas = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: ticketTypes.id,
        nome: ticketTypes.nome,
        precoCentavos: ticketTypes.precoCentavos,
        disponivel: sql<number>`
          ${ticketTypes.quantidadeTotal}
          - ${ticketTypes.quantidadeVendida}
          - ${ticketTypes.quantidadeReservada}
        `,
        ativo: ticketTypes.ativo,
      })
      .from(ticketTypes)
      .where(and(eq(ticketTypes.eventId, eventId), eq(ticketTypes.ativo, true)))
      .orderBy(asc(ticketTypes.ordem)),
  );

  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    precoCentavos: l.precoCentavos,
    disponivel: Math.max(0, Number(l.disponivel)),
  }));
}

export type FechamentoDeCaixa = {
  metodo: string;
  pedidos: number;
  ingressos: number;
  totalCentavos: number;
};

/**
 * O fechamento de caixa da noite, por forma de pagamento.
 *
 * É a tela que o produtor abre às quatro da manhã para conferir a maquininha
 * contra o sistema. Sem ela, a venda de bilheteria vira um número solto que
 * ninguém consegue auditar.
 */
export async function fechamentoDeCaixa(
  tenantId: string,
  eventId: string,
): Promise<FechamentoDeCaixa[]> {
  const linhas = (await withTenant(tenantId, (tx) =>
    tx.execute(sql`
      select o.metodo_externo as metodo,
             count(*)::int as pedidos,
             coalesce(sum(oi.quantidade), 0)::int as ingressos,
             coalesce(sum(o.total_centavos), 0)::bigint as total
        from orders o
        left join order_items oi on oi.order_id = o.id
       where o.tenant_id = ${tenantId}
         and o.event_id = ${eventId}
         and o.canal = 'pdv'
         and o.status = 'paid'
       group by o.metodo_externo
       order by o.metodo_externo
    `),
  )) as unknown as {
    metodo: string;
    pedidos: number;
    ingressos: number;
    total: string | number;
  }[];

  return linhas.map((l) => ({
    metodo: l.metodo,
    pedidos: Number(l.pedidos),
    ingressos: Number(l.ingressos),
    totalCentavos: Number(l.total),
  }));
}
