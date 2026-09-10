'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { AuthError, requireRole } from '@/lib/auth';
import {
  adicionarNaEquipe,
  derrubarSessoes,
  removerDaEquipe,
  trocarSenha,
} from '@/lib/equipe';
import { getAuth } from '@/lib/session-cookie';

/**
 * Gestão de equipe — só quem manda na casa mexe.
 *
 * O mínimo é `admin`, não `operador`. Quem cria acesso de portaria está
 * criando quem pode liberar entrada, e quem libera entrada mexe em dinheiro
 * por outro caminho: cada pessoa que entra sem pagar é um ingresso a menos
 * vendido.
 */

export type EstadoEquipe = {
  erro?: string;
  ok?: boolean;
  /** Mostrada uma vez só: não guardamos senha em texto em lugar nenhum. */
  senha?: string;
  mensagem?: string;
};

async function contexto(tenantId: string) {
  const auth = await getAuth();
  requireRole(auth, tenantId, 'admin');
  return auth;
}

const Convite = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da pessoa.').max(120),
  email: z.email('E-mail inválido.').max(180),
  role: z.enum(['admin', 'operador', 'portaria']),
  eventoId: z.uuid().nullable(),
});

export async function convidar(
  tenantId: string,
  _estado: EstadoEquipe,
  formData: FormData,
): Promise<EstadoEquipe> {
  try {
    await contexto(tenantId);

    const bruto = {
      nome: formData.get('nome'),
      email: formData.get('email'),
      role: formData.get('role') ?? 'portaria',
      eventoId: formData.get('eventoId') || null,
    };

    const dados = Convite.safeParse(bruto);
    if (!dados.success) {
      return { erro: dados.error.issues[0]?.message ?? 'Confira os campos.' };
    }

    /**
     * Escopo de evento só faz sentido para portaria. Um operador preso a um
     * evento não conseguiria fazer o trabalho dele, que é cuidar da casa.
     */
    const eventoId = dados.data.role === 'portaria' ? dados.data.eventoId : null;

    const r = await adicionarNaEquipe({
      tenantId,
      nome: dados.data.nome,
      email: dados.data.email,
      role: dados.data.role,
      eventoId,
    });

    if (!r.ok) return { erro: r.erro };

    revalidatePath('/painel/equipe');

    return {
      ok: true,
      senha: r.senha ?? undefined,
      mensagem: r.jaExistia
        ? 'Esta pessoa já tinha conta na plataforma. O acesso foi liberado com a senha que ela já usa.'
        : undefined,
    };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui adicionar.' };
  }
}

export async function remover(tenantId: string, membershipId: string): Promise<void> {
  await contexto(tenantId);
  await removerDaEquipe(tenantId, membershipId);
  revalidatePath('/painel/equipe');
}

export async function novaSenha(
  tenantId: string,
  membershipId: string,
): Promise<EstadoEquipe> {
  try {
    await contexto(tenantId);
    const senha = await trocarSenha(tenantId, membershipId);
    revalidatePath('/painel/equipe');

    return senha ? { ok: true, senha } : { erro: 'Pessoa não encontrada.' };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui trocar a senha.' };
  }
}

export async function desconectar(
  tenantId: string,
  membershipId: string,
): Promise<EstadoEquipe> {
  try {
    await contexto(tenantId);
    const quantas = await derrubarSessoes(tenantId, membershipId);
    revalidatePath('/painel/equipe');

    return quantas === null
      ? { erro: 'Pessoa não encontrada.' }
      : {
          ok: true,
          mensagem:
            quantas === 0
              ? 'Não havia aparelho conectado.'
              : `${quantas} aparelho${quantas === 1 ? '' : 's'} desconectado${quantas === 1 ? '' : 's'}.`,
        };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui desconectar.' };
  }
}
