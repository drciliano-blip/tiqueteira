/**
 * Consultas do painel do produtor.
 *
 * Aqui a lógica se inverte em relação à loja: densidade acima de estética.
 * Produtor quer número na tela — e o que ele mais procura, e mais gera
 * contato com suporte, é o status do repasse.
 */
import 'server-only';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import { events, orders, payouts, tickets, venues } from '@/db/schema';

/** Status em que o dinheiro entrou. */
const PAGOS = ['paid', 'partially_refunded'] as const;

export type ResumoPainel = {
  ingressosVendidos: number;
  ingressosUsados: number;
  brutoCentavos: number;
  liquidoCentavos: number;
  pedidosAguardando: number;
  proximoRepasse: { dataPrevista: Date; liberadoCentavos: number; status: string } | null;
};

export async function resumoDoTenant(tenantId: string): Promise<ResumoPainel> {
  return withTenant(tenantId, async (tx) => {
    const [venda] = await tx
      .select({
        bruto: sql<number>`coalesce(sum(${orders.totalCentavos}), 0)`,
        liquido: sql<number>`coalesce(sum(${orders.valorProdutorCentavos}), 0)`,
        pedidos: sql<number>`count(*)`,
      })
      .from(orders)
      .where(inArray(orders.status, [...PAGOS]));

    const [aguardando] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, 'awaiting_payment'));

    const [ingressos] = await tx
      .select({
        validos: sql<number>`count(*) filter (where ${tickets.status} in ('valido','usado'))`,
        usados: sql<number>`count(*) filter (where ${tickets.status} = 'usado')`,
      })
      .from(tickets);

    const [repasse] = await tx
      .select({
        dataPrevista: payouts.dataPrevista,
        liberadoCentavos: payouts.liberadoCentavos,
        status: payouts.status,
      })
      .from(payouts)
      .where(inArray(payouts.status, ['scheduled', 'processing']))
      .orderBy(asc(payouts.dataPrevista))
      .limit(1);

    return {
      ingressosVendidos: Number(ingressos?.validos ?? 0),
      ingressosUsados: Number(ingressos?.usados ?? 0),
      brutoCentavos: Number(venda?.bruto ?? 0),
      liquidoCentavos: Number(venda?.liquido ?? 0),
      pedidosAguardando: Number(aguardando?.n ?? 0),
      proximoRepasse: repasse ?? null,
    };
  });
}

export type EventoPainel = {
  id: string;
  slug: string;
  titulo: string;
  status: string;
  dataInicio: Date;
  capacidade: number;
  venueNome: string;
  vendidos: number;
  brutoCentavos: number;
};

export async function eventosDoTenant(tenantId: string): Promise<EventoPainel[]> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({
        id: events.id,
        slug: events.slug,
        titulo: events.titulo,
        status: events.status,
        dataInicio: events.dataInicio,
        capacidade: events.capacidade,
        venueNome: venues.nome,
      })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .orderBy(desc(events.dataInicio));

    if (linhas.length === 0) return [];

    const vendas = await tx
      .select({
        eventId: orders.eventId,
        bruto: sql<number>`coalesce(sum(${orders.totalCentavos}), 0)`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...PAGOS]),
          inArray(
            orders.eventId,
            linhas.map((l) => l.id),
          ),
        ),
      )
      .groupBy(orders.eventId);

    const emitidos = await tx
      .select({
        eventId: tickets.eventId,
        n: sql<number>`count(*)`,
      })
      .from(tickets)
      .where(
        and(
          inArray(tickets.status, ['valido', 'usado']),
          inArray(
            tickets.eventId,
            linhas.map((l) => l.id),
          ),
        ),
      )
      .groupBy(tickets.eventId);

    const brutoPorEvento = new Map(vendas.map((v) => [v.eventId, Number(v.bruto)]));
    const vendidosPorEvento = new Map(emitidos.map((e) => [e.eventId, Number(e.n)]));

    return linhas.map((l) => ({
      ...l,
      vendidos: vendidosPorEvento.get(l.id) ?? 0,
      brutoCentavos: brutoPorEvento.get(l.id) ?? 0,
    }));
  });
}
