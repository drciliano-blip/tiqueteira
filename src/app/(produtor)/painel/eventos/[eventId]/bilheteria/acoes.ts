'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { AuthError, requireRole } from '@/lib/auth';
import { normalizarCpf } from '@/domain/cpf';
import { venderNaBilheteria, type IngressoEmitido } from '@/lib/pdv';
import { getAuth } from '@/lib/session-cookie';

/**
 * Venda de balcão.
 *
 * Exige `operador`: quem vende recebe dinheiro em nome do produtor, e o
 * fechamento de caixa aponta para o nome de quem vendeu.
 */

export type EstadoVenda = {
  erro?: string;
  venda?: {
    numero: number;
    totalCentavos: number;
    ingressos: IngressoEmitido[];
    jaEntrou: boolean;
  };
};

const Venda = z.object({
  ticketTypeId: z.uuid('Escolha o lote.'),
  quantidade: z.coerce.number().int().min(1).max(20),
  metodo: z.enum(['dinheiro', 'debito', 'credito', 'cortesia', 'outro']),
  compradorNome: z.string().trim().min(2, 'Informe o nome de quem está comprando.').max(120),
  compradorCpf: z.string().trim().optional(),
  jaEntrou: z.coerce.boolean().optional(),
});

export async function venderNoBalcao(
  eventId: string,
  _estado: EstadoVenda,
  formData: FormData,
): Promise<EstadoVenda> {
  try {
    const auth = await getAuth();

    const [evento] = await serviceDb()
      .select({ tenantId: events.tenantId, status: events.status })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!evento) throw new AuthError('Evento não encontrado', 'sem_permissao');
    requireRole(auth, evento.tenantId, 'operador');

    if (evento.status === 'cancelado') {
      return { erro: 'Este evento foi cancelado.' };
    }

    const dados = Venda.safeParse({
      ticketTypeId: formData.get('ticketTypeId'),
      quantidade: formData.get('quantidade') ?? 1,
      metodo: formData.get('metodo') ?? 'dinheiro',
      compradorNome: formData.get('compradorNome'),
      compradorCpf: formData.get('compradorCpf') ?? undefined,
      jaEntrou: formData.get('jaEntrou') === 'on',
    });

    if (!dados.success) {
      return { erro: dados.error.issues[0]?.message ?? 'Confira os campos.' };
    }

    const cpf = dados.data.compradorCpf ? normalizarCpf(dados.data.compradorCpf) : '';

    const cabecalhos = await headers();

    const r = await venderNaBilheteria({
      tenantId: evento.tenantId,
      eventId,
      ticketTypeId: dados.data.ticketTypeId,
      quantidade: dados.data.quantidade,
      metodo: dados.data.metodo,
      compradorNome: dados.data.compradorNome,
      compradorCpf: cpf.length === 11 ? cpf : null,
      jaEntrou: dados.data.jaEntrou ?? false,
      userId: auth.userId,
      deviceId: cabecalhos.get('user-agent')?.slice(0, 120) ?? undefined,
    });

    if (!r.ok) return { erro: r.erro };

    revalidatePath(`/painel/eventos/${eventId}/bilheteria`);

    return {
      venda: {
        numero: r.numero,
        totalCentavos: r.totalCentavos,
        ingressos: r.ingressos,
        jaEntrou: dados.data.jaEntrou ?? false,
      },
    };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui registrar a venda.' };
  }
}
