/**
 * Expiração de reservas — plano, seção 10.
 *
 * Roda a cada minuto. Devolve o estoque das reservas vencidas e move os
 * pedidos correspondentes para `expired`.
 *
 * A ordem importa: primeiro o estoque volta para a venda, depois o pedido é
 * marcado. Se o processo morrer no meio, o pior caso é um pedido `draft`
 * vencido sem reserva — inofensivo. O contrário deixaria estoque preso.
 *
 * O uso do cupom volta junto. Sem isso, um cupom de cem usos se esgotaria com
 * carrinhos abandonados, e o produtor descobriria na noite do evento — quando
 * o desconto que ele prometeu parou de funcionar.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { orders } from '@/db/schema';
import { devolverCupom } from '@/lib/cupons';
import { expirarReservasVencidas } from '@/lib/inventory';

export async function devolverPedidosExpirados(): Promise<{
  devolvidos: number;
  pedidos: number;
}> {
  const db = serviceDb();
  const { orderIds, devolvidos } = await expirarReservasVencidas(db, { limite: 500 });

  if (orderIds.length === 0) return { devolvidos: 0, pedidos: 0 };

  const atualizados = await db
    .update(orders)
    .set({ status: 'expired', canceladoEm: new Date(), atualizadoEm: new Date() })
    .where(
      sql`${orders.id} in ${orderIds} and ${orders.status} in ('draft', 'awaiting_payment')`,
    )
    .returning({ id: orders.id, cupomId: orders.cupomId });

  /**
   * Só os pedidos que realmente expiraram devolvem cupom — a lista vem do
   * `returning` do UPDATE, não da lista de reservas. Um pedido que foi pago
   * entre uma coisa e outra não entra aqui, e o uso dele fica de pé.
   */
  for (const pedido of atualizados) {
    if (pedido.cupomId) await devolverCupom(db, pedido.cupomId);
  }

  return { devolvidos, pedidos: atualizados.length };
}

/** Usado pelo painel de saúde. */
export async function pedidosOrfaos(): Promise<number> {
  const [linha] = await serviceDb()
    .select({ n: sql<number>`count(*)` })
    .from(orders)
    .where(
      sql`${orders.status} = 'awaiting_payment' and ${orders.criadoEm} < now() - interval '24 hours'`,
    );
  return Number(linha?.n ?? 0);
}
