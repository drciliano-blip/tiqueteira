'use server';

import { headers } from 'next/headers';

import { AuthError, requireGateAccess } from '@/lib/auth';
import {
  buscarIngressos,
  confirmarDocumento,
  contarPresentes,
  liberarPorId,
  politicaDoEvento,
  validarIngresso,
  type ContadorPortaria,
  type ContextoPortaria,
  type LinhaBusca,
  type Movimento,
  type ResultadoCheckin,
} from '@/lib/checkin';
import { env } from '@/lib/env';
import {
  admitirConvidado,
  buscarConvidados,
  type ConvidadoNaPorta,
  type ResultadoAdmissao,
} from '@/lib/listas';
import { getAuth } from '@/lib/session-cookie';

/**
 * Ações da portaria.
 *
 * Toda ação confere o escopo da sessão: sessão de portaria vale para UM
 * evento. O celular fica na mão de terceiro, na rua, e costuma ser emprestado
 * entre turnos — o escopo é o que impede o aparelho de virar acesso a outro
 * evento da casa.
 */

async function contexto(eventId: string): Promise<ContextoPortaria> {
  const auth = await getAuth();

  const evento = await politicaDoEvento(eventId);
  if (!evento) throw new AuthError('Evento não encontrado', 'sem_permissao');

  requireGateAccess(auth, evento.tenantId, eventId);

  const cabecalhos = await headers();
  return {
    tenantId: evento.tenantId,
    eventId,
    userId: auth.userId,
    deviceId: cabecalhos.get('user-agent')?.slice(0, 120) ?? undefined,
    politica: evento.politica,
    nominal: evento.nominal,
  };
}

export type RespostaCheckin = { ok: true; resultado: ResultadoCheckin } | { ok: false; erro: string };

export async function lerQr(
  eventId: string,
  token: string,
  movimento: Movimento = 'entrada',
): Promise<RespostaCheckin> {
  try {
    const ctx = await contexto(eventId);
    const resultado = await validarIngresso(
      token,
      ctx,
      {
        atual: env().TICKET_HMAC_SECRET,
        anterior: env().TICKET_HMAC_SECRET_PREVIOUS,
      },
      movimento,
    );
    return { ok: true, resultado };
  } catch (e) {
    return { ok: false, erro: e instanceof AuthError ? e.message : 'Falha ao validar.' };
  }
}

export async function liberarManualmente(
  eventId: string,
  ticketId: string,
  movimento: Movimento = 'entrada',
): Promise<RespostaCheckin> {
  try {
    const ctx = await contexto(eventId);
    return { ok: true, resultado: await liberarPorId(ticketId, ctx, movimento) };
  } catch (e) {
    return { ok: false, erro: e instanceof AuthError ? e.message : 'Falha ao registrar.' };
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

/**
 * Lista de convidados na porta — ADR-012.
 *
 * Diferente da leitura de QR, a lista **precisa de rede**: admitir alguém
 * emite um ingresso novo, e emitir ingresso exige o segredo do servidor. O
 * aparelho não tem esse segredo de propósito — se tivesse, um celular perdido
 * viraria máquina de fabricar cortesia.
 */
export async function buscarNaLista(
  eventId: string,
  termo: string,
): Promise<ConvidadoNaPorta[]> {
  const ctx = await contexto(eventId);
  return buscarConvidados(termo, ctx);
}

export async function admitirDaLista(
  eventId: string,
  entradaId: string,
): Promise<ResultadoAdmissao> {
  try {
    const ctx = await contexto(eventId);
    return await admitirConvidado(entradaId, ctx);
  } catch (e) {
    return {
      admitido: false,
      motivo: 'nao_encontrado',
      explicacao: e instanceof AuthError ? e.message : 'Falha ao admitir.',
      nome: null,
    };
  }
}

export async function contador(eventId: string): Promise<ContadorPortaria> {
  const ctx = await contexto(eventId);
  return contarPresentes(ctx.tenantId, ctx.eventId);
}
