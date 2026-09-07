'use server';

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { AuthError, requireGateAccess } from '@/lib/auth';
import {
  buscarIngressos,
  confirmarDocumento,
  contarPresentes,
  liberarPorId,
  validarIngresso,
  type ContadorPortaria,
  type LinhaBusca,
  type ResultadoCheckin,
} from '@/lib/checkin';
import { env } from '@/lib/env';
import { getAuth } from '@/lib/session-cookie';

/**
 * Ações da portaria.
 *
 * Toda ação confere o escopo da sessão: sessão de portaria vale para UM
 * evento. O celular fica na mão de terceiro, na rua, e costuma ser emprestado
 * entre turnos — o escopo é o que impede o aparelho de virar acesso a outro
 * evento da casa.
 */

async function contexto(eventId: string) {
  const auth = await getAuth();

  const [evento] = await serviceDb()
    .select({ tenantId: events.tenantId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento) throw new AuthError('Evento não encontrado', 'sem_permissao');

  requireGateAccess(auth, evento.tenantId, eventId);

  const cabecalhos = await headers();
  return {
    tenantId: evento.tenantId,
    eventId,
    userId: auth.userId,
    deviceId: cabecalhos.get('user-agent')?.slice(0, 120) ?? undefined,
  };
}

export type RespostaCheckin = { ok: true; resultado: ResultadoCheckin } | { ok: false; erro: string };

export async function lerQr(eventId: string, token: string): Promise<RespostaCheckin> {
  try {
    const ctx = await contexto(eventId);
    const resultado = await validarIngresso(token, ctx, {
      atual: env().TICKET_HMAC_SECRET,
      anterior: env().TICKET_HMAC_SECRET_PREVIOUS,
    });
    return { ok: true, resultado };
  } catch (e) {
    return { ok: false, erro: e instanceof AuthError ? e.message : 'Falha ao validar.' };
  }
}

export async function liberarManualmente(
  eventId: string,
  ticketId: string,
): Promise<RespostaCheckin> {
  try {
    const ctx = await contexto(eventId);
    return { ok: true, resultado: await liberarPorId(ticketId, ctx) };
  } catch (e) {
    return { ok: false, erro: e instanceof AuthError ? e.message : 'Falha ao liberar.' };
  }
}

export async function marcarDocumento(eventId: string, ticketId: string): Promise<void> {
  const ctx = await contexto(eventId);
  await confirmarDocumento(ticketId, ctx);
}

export async function buscar(eventId: string, termo: string): Promise<LinhaBusca[]> {
  const ctx = await contexto(eventId);
  return buscarIngressos(termo, ctx);
}

export async function contador(eventId: string): Promise<ContadorPortaria> {
  const ctx = await contexto(eventId);
  return contarPresentes(ctx.tenantId, ctx.eventId);
}
