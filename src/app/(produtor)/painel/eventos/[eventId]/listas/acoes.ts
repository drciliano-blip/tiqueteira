'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { AuthError, requireRole } from '@/lib/auth';
import {
  adicionarNomes,
  alternarLista,
  criarLista,
  removerConvidado,
  type ResultadoAdicao,
} from '@/lib/listas';
import { getAuth } from '@/lib/session-cookie';

/**
 * Listas de convidados do produtor — ADR-012.
 *
 * O acesso é conferido pelo EVENTO, não pelo tenant do formulário: quem
 * manipula lista de convidado tem, na prática, o poder de emitir cortesia, e
 * cortesia é ingresso que deixou de ser vendido.
 */

export type EstadoLista = { erro?: string; ok?: boolean; resultado?: ResultadoAdicao };

async function contextoDoEvento(eventId: string): Promise<string> {
  const auth = await getAuth();

  const [evento] = await serviceDb()
    .select({ tenantId: events.tenantId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento) throw new AuthError('Evento não encontrado', 'sem_permissao');

  requireRole(auth, evento.tenantId, 'operador');
  return evento.tenantId;
}

const NovaLista = z.object({
  nome: z.string().trim().min(2, 'Dê um nome à lista.').max(80),
  promoterNome: z.string().trim().max(120).optional(),
  cota: z.coerce.number().int().min(1, 'A cota precisa ser de pelo menos 1.').max(5000),
  ticketTypeId: z.uuid('Escolha o lote que a cortesia vai consumir.'),
  validoAte: z.string().optional(),
});

export async function novaLista(
  eventId: string,
  _estado: EstadoLista,
  formData: FormData,
): Promise<EstadoLista> {
  try {
    const tenantId = await contextoDoEvento(eventId);

    const dados = NovaLista.safeParse({
      nome: formData.get('nome'),
      promoterNome: formData.get('promoterNome') ?? undefined,
      cota: formData.get('cota'),
      ticketTypeId: formData.get('ticketTypeId'),
      validoAte: formData.get('validoAte') ?? undefined,
    });

    if (!dados.success) {
      return { erro: dados.error.issues[0]?.message ?? 'Confira os campos.' };
    }

    await criarLista(tenantId, {
      eventId,
      nome: dados.data.nome,
      promoterNome: dados.data.promoterNome?.trim() || null,
      cota: dados.data.cota,
      ticketTypeId: dados.data.ticketTypeId,
      // O campo vem como horário local de São Paulo; o banco guarda UTC.
      validoAte: dados.data.validoAte ? new Date(`${dados.data.validoAte}:00-03:00`) : null,
    });

    revalidatePath(`/painel/eventos/${eventId}/listas`);
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui criar a lista.' };
  }
}

const Nomes = z.object({
  listaId: z.uuid(),
  texto: z.string().trim().min(2, 'Cole ao menos um nome.').max(20000),
  tipo: z.enum(['cortesia', 'desconto']),
});

export async function incluirNomes(
  eventId: string,
  _estado: EstadoLista,
  formData: FormData,
): Promise<EstadoLista> {
  try {
    const tenantId = await contextoDoEvento(eventId);

    const dados = Nomes.safeParse({
      listaId: formData.get('listaId'),
      texto: formData.get('texto'),
      tipo: formData.get('tipo') ?? 'cortesia',
    });

    if (!dados.success) {
      return { erro: dados.error.issues[0]?.message ?? 'Confira os campos.' };
    }

    const resultado = await adicionarNomes(
      tenantId,
      dados.data.listaId,
      dados.data.texto,
      dados.data.tipo,
    );

    revalidatePath(`/painel/eventos/${eventId}/listas`);
    return { ok: true, resultado };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui incluir os nomes.' };
  }
}

export async function ligarDesligarLista(
  eventId: string,
  listaId: string,
  ativo: boolean,
): Promise<void> {
  const tenantId = await contextoDoEvento(eventId);
  await alternarLista(tenantId, listaId, ativo);
  revalidatePath(`/painel/eventos/${eventId}/listas`);
}

export async function tirarDaLista(eventId: string, entradaId: string): Promise<void> {
  const tenantId = await contextoDoEvento(eventId);
  await removerConvidado(tenantId, entradaId);
  revalidatePath(`/painel/eventos/${eventId}/listas`);
}
