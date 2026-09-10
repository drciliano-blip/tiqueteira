'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { AuthError, requireRole } from '@/lib/auth';
import { alternarCupom, criarCupom } from '@/lib/cupons';
import { reaisParaCentavos } from '@/lib/money';
import { getAuth } from '@/lib/session-cookie';

/**
 * Cupons do produtor.
 *
 * Exige `admin`, não `operador`: cupom é desconto sobre a receita, e quem
 * pode dar desconto está mexendo em dinheiro tanto quanto quem mexe no preço.
 */

export type EstadoCupom = { erro?: string; ok?: boolean };

async function contextoDoEvento(eventId: string): Promise<string> {
  const auth = await getAuth();

  const [evento] = await serviceDb()
    .select({ tenantId: events.tenantId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento) throw new AuthError('Evento não encontrado', 'sem_permissao');

  requireRole(auth, evento.tenantId, 'admin');
  return evento.tenantId;
}

const NovoCupom = z.object({
  codigo: z.string().trim().min(3, 'O código precisa de ao menos 3 caracteres.').max(40),
  tipo: z.enum(['pct', 'valor']),
  /** Percentual em pontos (10 = 10%) ou reais, conforme o tipo. */
  valor: z.coerce.number().positive('Informe um valor maior que zero.'),
  usosMaximos: z.coerce.number().int().min(1).max(1_000_000).nullable(),
  validoAte: z.string().optional(),
  /** Vazio = vale para todos os eventos da casa. */
  soNesteEvento: z.coerce.boolean().optional(),
});

export async function novoCupom(
  eventId: string,
  _estado: EstadoCupom,
  formData: FormData,
): Promise<EstadoCupom> {
  try {
    const tenantId = await contextoDoEvento(eventId);

    const dados = NovoCupom.safeParse({
      codigo: formData.get('codigo'),
      tipo: formData.get('tipo') ?? 'pct',
      valor: formData.get('valor'),
      usosMaximos: formData.get('usosMaximos') || null,
      validoAte: formData.get('validoAte') ?? undefined,
      soNesteEvento: formData.get('soNesteEvento') === 'on',
    });

    if (!dados.success) {
      return { erro: dados.error.issues[0]?.message ?? 'Confira os campos.' };
    }

    /**
     * Percentual vira basis points; valor vira centavos. O banco guarda
     * inteiro nos dois casos, e a coluna é a mesma — o `tipo` diz como ler.
     */
    if (dados.data.tipo === 'pct' && dados.data.valor > 100) {
      return { erro: 'O desconto percentual não pode passar de 100%.' };
    }

    const valor =
      dados.data.tipo === 'pct'
        ? Math.round(dados.data.valor * 100)
        : reaisParaCentavos(String(dados.data.valor));

    const r = await criarCupom({
      tenantId,
      eventId: dados.data.soNesteEvento ? eventId : null,
      codigo: dados.data.codigo,
      tipo: dados.data.tipo,
      valor,
      usosMaximos: dados.data.usosMaximos,
      validoAte: dados.data.validoAte ? new Date(`${dados.data.validoAte}:00-03:00`) : null,
    });

    if (!r.ok) return { erro: r.erro };

    revalidatePath(`/painel/eventos/${eventId}/cupons`);
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui criar o cupom.' };
  }
}

export async function ligarDesligarCupom(
  eventId: string,
  cupomId: string,
  ativo: boolean,
): Promise<void> {
  const tenantId = await contextoDoEvento(eventId);
  await alternarCupom(tenantId, cupomId, ativo);
  revalidatePath(`/painel/eventos/${eventId}/cupons`);
}
