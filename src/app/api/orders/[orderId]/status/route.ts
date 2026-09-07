import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { orders } from '@/db/schema';

/**
 * Polling do status do pedido — plano, seção 13.
 *
 * A tela do Pix pergunta aqui de tempos em tempos e reconhece o pagamento
 * sozinha, sem pedir ao comprador que clique em "já paguei". Quem muda o
 * status é sempre o webhook; este endpoint só lê.
 *
 * Devolve o mínimo: status e se expirou. Nada de valor, nome ou CPF — o id do
 * pedido circula em URL, e URL vaza por histórico, print e link compartilhado.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  const { orderId } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ erro: 'inválido' }, { status: 400 });
  }

  const [pedido] = await serviceDb()
    .select({ status: orders.status, expiresEm: orders.expiresEm })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!pedido) return NextResponse.json({ erro: 'não encontrado' }, { status: 404 });

  const expirado =
    pedido.expiresEm !== null && pedido.expiresEm.getTime() <= Date.now();

  return NextResponse.json(
    { status: pedido.status, expirado },
    { headers: { 'cache-control': 'no-store' } },
  );
}
