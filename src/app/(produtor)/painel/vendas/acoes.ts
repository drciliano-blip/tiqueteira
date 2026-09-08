'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { orders } from '@/db/schema';
import { AuthError, requireRole } from '@/lib/auth';
import { enfileirar } from '@/lib/jobs';
import { getAuth } from '@/lib/session-cookie';

/**
 * Reenviar o ingresso por e-mail.
 *
 * É o pedido de suporte número um em qualquer bilheteria: "não recebi".
 * Quase sempre é caixa de spam ou e-mail digitado errado — e sem este botão a
 * resposta vira um chamado que atravessa a noite.
 *
 * Enfileira em vez de enviar na hora: se o provedor de e-mail estiver lento,
 * quem está atendendo não pode ficar esperando a tela responder.
 */
export async function reenviarIngressos(
  tenantId: string,
  orderId: string,
): Promise<{ ok?: boolean; erro?: string }> {
  try {
    requireRole(await getAuth(), tenantId, 'operador');
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Sem permissão.' };
  }

  const db = serviceDb();
  const [pedido] = await db
    .select({ status: orders.status, tenantId: orders.tenantId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!pedido || pedido.tenantId !== tenantId) return { erro: 'Pedido não encontrado.' };
  if (pedido.status !== 'paid') return { erro: 'Só pedido pago tem ingresso para enviar.' };

  await enfileirar(db, {
    nome: 'enviar-ingressos',
    tenantId,
    payload: { orderId },
    // Chave com o instante: um reenvio pedido de propósito não pode esbarrar
    // na deduplicação do envio original.
    dedupeKey: `reenvio:${orderId}:${Date.now()}`,
  });

  revalidatePath(`/painel/vendas/${orderId}`);
  return { ok: true };
}
