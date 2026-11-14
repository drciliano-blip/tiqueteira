'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { auditLog, tenants } from '@/db/schema';
import { cnpjValido, normalizarCnpj } from '@/domain/cpf';
import { AuthError, requireRole } from '@/lib/auth';
import { invalidarCachePublico } from '@/lib/cache-publico';
import { getAuth } from '@/lib/session-cookie';

export type EstadoConfiguracao = { ok?: boolean; erro?: string };

const vazioParaNulo = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const Dados = z.object({
  nome: z.string().trim().min(2, 'Informe o nome que o público vê.').max(80),
  razaoSocial: z.preprocess(vazioParaNulo, z.string().trim().max(160).nullable()),
  cnpj: z.preprocess(
    vazioParaNulo,
    z
      .string()
      .transform(normalizarCnpj)
      .refine(cnpjValido, 'CNPJ inválido. Confira os números.')
      .nullable(),
  ),
  email: z.email('Informe um e-mail válido.').max(160),
  telefone: z.preprocess(
    vazioParaNulo,
    z
      .string()
      .transform((t) => t.replace(/\D/g, ''))
      .refine((t) => t.length >= 10 && t.length <= 11, 'Telefone inválido.')
      .nullable(),
  ),
  corAcento: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.'),
  logoUrl: z.preprocess(vazioParaNulo, z.url('Endereço da logo inválido.').max(500).nullable()),
  pixelMetaId: z.preprocess(
    vazioParaNulo,
    z.string().regex(/^\d{5,20}$/, 'O ID do pixel da Meta tem só números.').nullable(),
  ),
  googleAnalyticsId: z.preprocess(
    vazioParaNulo,
    z.string().regex(/^G-[A-Z0-9]{4,16}$/, 'O ID do Google Analytics começa com G-.').nullable(),
  ),
});

/**
 * Dados do produtor — ADR-024.
 *
 * Taxas, reserva e prazos de repasse NÃO estão aqui: são contrato com a
 * plataforma e mudam pela área administrativa, com auditoria.
 */
export async function salvarConfiguracoes(
  tenantId: string,
  _anterior: EstadoConfiguracao,
  formData: FormData,
): Promise<EstadoConfiguracao> {
  const auth = await getAuth();
  try {
    requireRole(auth, tenantId, 'admin');
  } catch (e) {
    return { erro: e instanceof AuthError ? 'Só dono ou administrador altera os dados.' : 'Sem permissão.' };
  }

  const dados = Dados.safeParse(Object.fromEntries(formData));
  if (!dados.success) return { erro: dados.error.issues[0]?.message ?? 'Confira os dados.' };

  const db = serviceDb();
  const [antes] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!antes) return { erro: 'Conta não encontrada.' };

  try {
    await db
      .update(tenants)
      .set({ ...dados.data, atualizadoEm: new Date() })
      .where(eq(tenants.id, tenantId));
  } catch (e) {
    if (String(e).includes('tenants_cnpj_key')) {
      return { erro: 'Este CNPJ já está cadastrado em outra conta.' };
    }
    throw e;
  }

  const mudou = Object.fromEntries(
    Object.entries(dados.data).filter(
      ([k, v]) => (antes as Record<string, unknown>)[k] !== v,
    ),
  );
  if (Object.keys(mudou).length > 0) {
    await db.insert(auditLog).values({
      tenantId,
      userId: auth?.userId ?? null,
      acao: 'configuracoes_alteradas',
      entidade: 'tenants',
      entidadeId: tenantId,
      antes: Object.fromEntries(
        Object.keys(mudou).map((k) => [k, (antes as Record<string, unknown>)[k] ?? null]),
      ),
      depois: mudou,
    });
  }

  invalidarCachePublico(tenantId);
  revalidatePath('/painel/configuracoes');
  return { ok: true };
}
