'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { tickets } from '@/db/schema';
import { COOKIE_COMPRADOR, lerSessaoComprador } from '@/lib/buyer-session';
import { env } from '@/lib/env';
import { enfileirar } from '@/lib/jobs';
import { mensagemDeEspera, registrarTentativa } from '@/lib/rate-limit';
import { executarReembolso } from '@/lib/refunds';
import { abrirSolicitacao, pedidoDoComprador } from '@/lib/solicitacoes';

/**
 * Autoatendimento do comprador — ADR-023.
 *
 * Toda ação começa pelo mesmo ponto: a sessão do link mágico diz qual é o
 * e-mail, e o pedido tem de ser daquele e-mail. Nada mais identifica o
 * comprador — e nada mais é preciso.
 */

export type EstadoComprador = { ok?: boolean; erro?: string; mensagem?: string };

const Id = z.uuid();

async function emailDaSessao(): Promise<string | null> {
  const store = await cookies();
  return lerSessaoComprador(store.get(COOKIE_COMPRADOR)?.value, env().AUTH_SECRET);
}

/** Cancelamento pela regra automática: prazo de arrependimento ou política do evento. */
export async function cancelarCompra(
  orderId: string,
  _anterior: EstadoComprador,
  formData: FormData,
): Promise<EstadoComprador> {
  if (!Id.safeParse(orderId).success) return { erro: 'Pedido inválido.' };
  const email = await emailDaSessao();
  if (!email) return { erro: 'Sua sessão expirou. Entre de novo em Meus ingressos.' };

  const pedido = await pedidoDoComprador(email, orderId);
  if (!pedido) return { erro: 'Pedido não encontrado.' };

  const quantidade = Number.parseInt(String(formData.get('quantidade') ?? '0'), 10);
  if (!Number.isInteger(quantidade) || quantidade < 1) return { erro: 'Escolha quantos ingressos.' };

  const r = await executarReembolso({
    tenantId: pedido.tenantId,
    orderId,
    quantidade,
    motivo: 'buyer_request',
    observacao: 'Cancelamento pedido pelo comprador na área Meus ingressos.',
  });
  if (!r.ok) return { erro: r.erro };

  revalidatePath(`/meus-ingressos/pedido/${orderId}`);
  return { ok: true, mensagem: 'Cancelamento confirmado.' };
}

/** Reenvia os ingressos válidos para o e-mail da compra. */
export async function reenviarMeusIngressos(orderId: string): Promise<EstadoComprador> {
  if (!Id.safeParse(orderId).success) return { erro: 'Pedido inválido.' };
  const email = await emailDaSessao();
  if (!email) return { erro: 'Sua sessão expirou. Entre de novo em Meus ingressos.' };

  const pedido = await pedidoDoComprador(email, orderId);
  if (!pedido) return { erro: 'Pedido não encontrado.' };
  if (pedido.status !== 'paid' && pedido.status !== 'partially_refunded') {
    return { erro: 'Este pedido não tem ingresso ativo.' };
  }

  const limite = await registrarTentativa('reenvio', orderId);
  if (!limite.permitido) return { erro: mensagemDeEspera(limite.esperarSegundos) };

  const db = serviceDb();
  const validos = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.orderId, orderId), inArray(tickets.status, ['valido'])))
    .limit(1);
  if (validos.length === 0) return { erro: 'Nenhum ingresso válido para reenviar.' };

  await enfileirar(db, {
    nome: 'enviar-ingressos',
    tenantId: pedido.tenantId,
    payload: { orderId },
    dedupeKey: `reenvio-comprador:${orderId}:${Date.now()}`,
  });

  return { ok: true, mensagem: `Reenviamos para ${email}. Confira também o spam.` };
}

export async function relatarProblema(
  orderId: string,
  _anterior: EstadoComprador,
  formData: FormData,
): Promise<EstadoComprador> {
  if (!Id.safeParse(orderId).success) return { erro: 'Pedido inválido.' };
  const email = await emailDaSessao();
  if (!email) return { erro: 'Sua sessão expirou. Entre de novo em Meus ingressos.' };

  const r = await abrirSolicitacao({
    email,
    orderId,
    tipo: String(formData.get('tipo') ?? ''),
    relato: String(formData.get('relato') ?? ''),
  });
  if (!r.ok) return { erro: r.erro };

  revalidatePath(`/meus-ingressos/pedido/${orderId}`);
  return { ok: true, mensagem: 'Recebemos o seu relato. O organizador vai responder por e-mail.' };
}
