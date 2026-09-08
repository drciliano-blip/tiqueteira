/**
 * Consulta de pedidos para o painel do produtor.
 *
 * Esta tela existe para uma situação concreta: são 23h, a fila anda, e alguém
 * diz que comprou e não recebeu o ingresso. Sem busca por nome, CPF ou código,
 * a resposta é "não sei" — e é aí que a plataforma perde a confiança do
 * produtor.
 *
 * Por isso a busca aceita as quatro coisas que a pessoa pode dizer na porta:
 * o nome, o CPF, o código do ingresso e o número do pedido.
 */
import 'server-only';

import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import { events, orderItems, orders, tickets, ticketTypes } from '@/db/schema';
import { normalizarCpf } from '@/domain/cpf';

export type FiltroVendas = {
  termo?: string | undefined;
  eventId?: string | undefined;
  status?: string | undefined;
  pagina?: number | undefined;
};

export type LinhaVenda = {
  id: string;
  numero: number;
  status: string;
  compradorNome: string | null;
  compradorEmail: string | null;
  compradorCpf: string | null;
  totalCentavos: number;
  metodo: string | null;
  canal: string;
  criadoEm: Date;
  pagoEm: Date | null;
  eventoTitulo: string;
  ingressos: number;
};

export const POR_PAGINA = 25;

function condicaoDeBusca(termo: string): SQL | undefined {
  const limpo = termo.trim();
  if (limpo.length < 2) return undefined;

  const like = `%${limpo}%`;
  const cpf = normalizarCpf(limpo);
  const numero = Number.parseInt(limpo.replace(/\D/g, ''), 10);

  const partes: (SQL | undefined)[] = [
    ilike(orders.compradorNome, like),
    ilike(orders.compradorEmail, like),
  ];

  if (cpf.length >= 3) partes.push(ilike(orders.compradorCpf, `%${cpf}%`));
  if (Number.isFinite(numero) && numero > 0) partes.push(eq(orders.numero, numero));

  // Código do ingresso: `7KQ2-4M9X`. Quem está na porta lê isso do celular.
  if (/^[A-Za-z0-9-]{4,9}$/.test(limpo)) {
    partes.push(
      sql`exists (
        select 1 from ${tickets} t
         where t.order_id = ${orders.id}
           and t.codigo ilike ${`%${limpo.toUpperCase()}%`}
      )`,
    );
  }

  return or(...partes);
}

export async function buscarVendas(
  tenantId: string,
  filtro: FiltroVendas,
): Promise<{ linhas: LinhaVenda[]; total: number; pagina: number }> {
  const pagina = Math.max(1, filtro.pagina ?? 1);

  return withTenant(tenantId, async (tx) => {
    const condicoes: SQL[] = [];

    if (filtro.eventId) condicoes.push(eq(orders.eventId, filtro.eventId));

    if (filtro.status === 'pagos') {
      condicoes.push(inArray(orders.status, ['paid', 'partially_refunded']));
    } else if (filtro.status === 'pendentes') {
      condicoes.push(inArray(orders.status, ['draft', 'awaiting_payment']));
    } else if (filtro.status === 'problemas') {
      condicoes.push(inArray(orders.status, ['refunded', 'chargeback', 'canceled']));
    } else {
      // Rascunho abandonado é ruído: só aparece quando pedido explicitamente.
      condicoes.push(sql`${orders.status} <> 'draft'`);
    }

    if (filtro.termo) {
      const busca = condicaoDeBusca(filtro.termo);
      if (busca) condicoes.push(busca);
    }

    const onde = condicoes.length > 0 ? and(...condicoes) : undefined;

    const [contagem] = await tx.select({ n: count() }).from(orders).where(onde);

    const linhas = await tx
      .select({
        id: orders.id,
        numero: orders.numero,
        status: orders.status,
        compradorNome: orders.compradorNome,
        compradorEmail: orders.compradorEmail,
        compradorCpf: orders.compradorCpf,
        totalCentavos: orders.totalCentavos,
        metodo: orders.metodo,
        canal: orders.canal,
        criadoEm: orders.criadoEm,
        pagoEm: orders.pagoEm,
        eventoTitulo: events.titulo,
        ingressos: sql<number>`(
          select count(*) from ${tickets} t
           where t.order_id = ${orders.id} and t.status in ('valido','usado')
        )`,
      })
      .from(orders)
      .innerJoin(events, eq(events.id, orders.eventId))
      .where(onde)
      .orderBy(desc(orders.criadoEm))
      .limit(POR_PAGINA)
      .offset((pagina - 1) * POR_PAGINA);

    return {
      linhas: linhas.map((l) => ({ ...l, ingressos: Number(l.ingressos) })),
      total: Number(contagem?.n ?? 0),
      pagina,
    };
  });
}

export type DetalheVenda = {
  id: string;
  numero: number;
  status: string;
  compradorNome: string | null;
  compradorEmail: string | null;
  compradorCpf: string | null;
  compradorTelefone: string | null;
  subtotalCentavos: number;
  convenienciaCentavos: number;
  descontoCentavos: number;
  totalCentavos: number;
  valorProdutorCentavos: number;
  valorOperadorCentavos: number;
  metodo: string | null;
  canal: string;
  criadoEm: Date;
  pagoEm: Date | null;
  eventoTitulo: string;
  eventoId: string;
  itens: { loteNome: string; quantidade: number; precoCentavos: number }[];
  ingressos: {
    id: string;
    codigo: string;
    titular: string;
    status: string;
    checkedInEm: Date | null;
  }[];
};

export async function detalharVenda(
  tenantId: string,
  orderId: string,
): Promise<DetalheVenda | null> {
  return withTenant(tenantId, async (tx) => {
    const [pedido] = await tx
      .select({
        id: orders.id,
        numero: orders.numero,
        status: orders.status,
        compradorNome: orders.compradorNome,
        compradorEmail: orders.compradorEmail,
        compradorCpf: orders.compradorCpf,
        compradorTelefone: orders.compradorTelefone,
        subtotalCentavos: orders.subtotalCentavos,
        convenienciaCentavos: orders.convenienciaCentavos,
        descontoCentavos: orders.descontoCentavos,
        totalCentavos: orders.totalCentavos,
        valorProdutorCentavos: orders.valorProdutorCentavos,
        valorOperadorCentavos: orders.valorOperadorCentavos,
        metodo: orders.metodo,
        canal: orders.canal,
        criadoEm: orders.criadoEm,
        pagoEm: orders.pagoEm,
        eventoTitulo: events.titulo,
        eventoId: events.id,
      })
      .from(orders)
      .innerJoin(events, eq(events.id, orders.eventId))
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!pedido) return null;

    const itens = await tx
      .select({
        loteNome: ticketTypes.nome,
        quantidade: orderItems.quantidade,
        precoCentavos: orderItems.precoUnitarioCentavosSnapshot,
      })
      .from(orderItems)
      .innerJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
      .where(eq(orderItems.orderId, orderId));

    const ingressos = await tx
      .select({
        id: tickets.id,
        codigo: tickets.codigo,
        titular: tickets.titularNome,
        status: tickets.status,
        checkedInEm: tickets.checkedInEm,
      })
      .from(tickets)
      .where(eq(tickets.orderId, orderId))
      .orderBy(tickets.codigo);

    return { ...pedido, itens, ingressos };
  });
}

/** Eventos do produtor, para o filtro. */
export async function eventosParaFiltro(
  tenantId: string,
): Promise<{ id: string; titulo: string }[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: events.id, titulo: events.titulo })
      .from(events)
      .orderBy(desc(events.dataInicio))
      .limit(50),
  );
}
