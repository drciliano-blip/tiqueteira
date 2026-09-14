'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { AuthError, requireRole } from '@/lib/auth';
import {
  definirDominio,
  removerDominio,
  verificarDominio,
  type Verificacao,
} from '@/lib/dominios';
import { getAuth } from '@/lib/session-cookie';

/**
 * Domínio próprio do produtor — ADR-018.
 *
 * Exige `owner`, não `admin`. O domínio é a identidade pública da casa: quem
 * o troca redireciona todo o público da vitrine, e isso é decisão de dono.
 */

export type EstadoForm = {
  erro?: string;
  ok?: boolean;
  verificacao?: Verificacao;
};

async function contexto(tenantId: string) {
  const auth = await getAuth();
  requireRole(auth, tenantId, 'owner');
  return auth;
}

const Dominio = z.object({
  dominio: z.string().trim().min(1, 'Informe o domínio.').max(253),
});

export async function salvarDominio(
  tenantId: string,
  _estado: EstadoForm,
  formData: FormData,
): Promise<EstadoForm> {
  try {
    await contexto(tenantId);

    const dados = Dominio.safeParse({ dominio: formData.get('dominio') });
    if (!dados.success) {
      return { erro: dados.error.issues[0]?.message ?? 'Confira o campo.' };
    }

    const r = await definirDominio(tenantId, dados.data.dominio);
    if (!r.ok) return { erro: r.erro };

    revalidatePath('/painel/dominio');
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui salvar.' };
  }
}

export async function conferir(tenantId: string): Promise<EstadoForm> {
  try {
    await contexto(tenantId);

    const verificacao = await verificarDominio(tenantId);
    revalidatePath('/painel/dominio');

    return { ok: verificacao.verificado, verificacao };
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Não consegui verificar.' };
  }
}

export async function desvincular(tenantId: string): Promise<void> {
  await contexto(tenantId);
  await removerDominio(tenantId);
  revalidatePath('/painel/dominio');
}
