/**
 * Cancelamento de evento com reembolso em massa — plano, seção 12.
 *
 * Processa em lotes pela fila, e não de uma vez: um evento de mil pedidos
 * levaria minutos, e função serverless morre antes disso. Cada lote se
 * reagenda até acabar.
 *
 * Cada reembolso é idempotente por conta própria, então reprocessar um lote
 * não devolve dinheiro duas vezes.
 */
import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { orders, payouts } from '@/db/schema';
import { enfileirar } from '@/lib/jobs';
import { executarReembolso } from '@/lib/refunds';

export type PayloadCancelamento = { tenantId: string; eventId: string; solicitadoPor?: string };

const LOTE = 15;

export async function reembolsarPedidosDoEvento(
  payload: PayloadCancelamento,
): Promise<string> {
  const db = serviceDb();

  const pendentes = await db
    .select({
      id: orders.id,
      ingressos: sql<number>`(
        select count(*) from tickets t
         where t.order_id = ${orders.id} and t.status = 'valido'
      )`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.eventId, payload.eventId),
        inArray(orders.status, ['paid', 'partially_refunded']),
      ),
    )
    .limit(LOTE);

  if (pendentes.length === 0) {
    // Repasses agendados que ainda não saíram morrem junto com o evento.
    await db
      .update(payouts)
      .set({ status: 'canceled', atualizadoEm: new Date() })
      .where(and(eq(payouts.eventId, payload.eventId), eq(payouts.status, 'scheduled')));

    return `evento ${payload.eventId}: reembolsos concluídos`;
  }

  let devolvidos = 0;
  const falhas: string[] = [];

  for (const pedido of pendentes) {
    const quantidade = Number(pedido.ingressos);
    if (quantidade === 0) continue;

    const r = await executarReembolso({
      tenantId: payload.tenantId,
      orderId: pedido.id,
      quantidade,
      motivo: 'event_canceled',
      ...(payload.solicitadoPor ? { solicitadoPor: payload.solicitadoPor } : {}),
    });

    if (r.ok) devolvidos += 1;
    else falhas.push(`${pedido.id}: ${r.erro}`);
  }

  // Reagenda para o próximo lote. A chave de deduplicação muda a cada rodada,
  // senão a segunda passagem seria descartada como repetida.
  await enfileirar(db, {
    nome: 'reembolso-automatico',
    tenantId: payload.tenantId,
    payload: { ...payload },
    dedupeKey: `cancelamento:${payload.eventId}:${Date.now()}`,
    atrasoSegundos: 5,
  });

  const resumo = `evento ${payload.eventId}: ${devolvidos} pedidos reembolsados neste lote`;
  return falhas.length > 0 ? `${resumo}; falhas: ${falhas.join(' | ')}` : resumo;
}
