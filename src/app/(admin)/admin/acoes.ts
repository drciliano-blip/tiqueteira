'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  alterarKyc,
  alterarTaxas,
  cancelarRepasse,
  exigirAdmin,
  reabrirRepasse,
} from '@/lib/admin';
import { reaisParaCentavos } from '@/lib/money';
import { executarReembolso } from '@/lib/refunds';

export type EstadoAdmin = { ok?: boolean; erro?: string };

const Id = z.uuid();
const Justificativa = z
  .string()
  .trim()
  .min(10, 'Escreva o motivo (pelo menos 10 caracteres). Fica na auditoria.')
  .max(1000);

/** "10,5" → 1050 bps. Percentual digitado com vírgula, guardado em inteiro. */
const Percentual = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(v);
    const bps = m ? Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0')) : NaN;
    if (!m || bps > 10_000) {
      ctx.addIssue({ code: 'custom', message: `Percentual inválido: ${v}` });
      return z.NEVER;
    }
    return bps;
  });

const Reais = z
  .string()
  .trim()
  .transform((v, ctx) => {
    try {
      const c = reaisParaCentavos(v || '0');
      if (c < 0) throw new Error();
      return c;
    } catch {
      ctx.addIssue({ code: 'custom', message: `Valor inválido: ${v}` });
      return z.NEVER;
    }
  });

const Dias = z.coerce.number().int().min(0).max(180);

export async function salvarTaxas(
  tenantId: string,
  _a: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  const auth = await exigirAdmin();
  if (!Id.safeParse(tenantId).success) return { erro: 'Produtor inválido.' };

  const d = z
    .object({
      taxaConvenienciaBps: Percentual,
      comissaoBps: Percentual,
      taxaFixaCentavos: Reais,
      taxaMinimaCentavos: Reais,
      taxaAbsorvidaPeloProdutor: z.preprocess((v) => v === 'on', z.boolean()),
      reservaPixBps: Percentual,
      reservaCartaoBps: Percentual,
      diasLiberacaoEvento: Dias,
      diasLiberacaoReserva: Dias,
      justificativa: Justificativa,
    })
    .safeParse(Object.fromEntries(formData));
  if (!d.success) return { erro: d.error.issues[0]?.message ?? 'Confira os campos.' };

  const { justificativa, ...novas } = d.data;
  if (novas.diasLiberacaoReserva < 30) {
    return { erro: 'A reserva não pode sair antes de 30 dias: a janela de contestação de cartão ainda está aberta.' };
  }
  await alterarTaxas(auth, tenantId, novas, justificativa);
  revalidatePath(`/admin/produtores/${tenantId}`);
  return { ok: true };
}

export async function salvarKyc(
  tenantId: string,
  _a: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  const auth = await exigirAdmin();
  const d = z
    .object({
      kyc: z.enum(['pendente', 'em_analise', 'aprovado', 'reprovado', 'suspenso']),
      justificativa: Justificativa,
    })
    .safeParse(Object.fromEntries(formData));
  if (!d.success || !Id.safeParse(tenantId).success) {
    return { erro: d.error?.issues[0]?.message ?? 'Dados inválidos.' };
  }
  await alterarKyc(auth, tenantId, d.data.kyc, d.data.justificativa);
  revalidatePath(`/admin/produtores/${tenantId}`);
  return { ok: true };
}

export async function acaoRepasse(
  payoutId: string,
  acao: 'reabrir' | 'cancelar',
  _a: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  const auth = await exigirAdmin();
  const motivo = Justificativa.safeParse(formData.get('motivo') ?? '');
  if (!motivo.success) return { erro: motivo.error.issues[0]?.message ?? 'Informe o motivo.' };
  if (!Id.safeParse(payoutId).success) return { erro: 'Repasse inválido.' };
  try {
    if (acao === 'reabrir') await reabrirRepasse(auth, payoutId, motivo.data);
    else await cancelarRepasse(auth, payoutId, motivo.data);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não foi possível.' };
  }
  revalidatePath('/admin/repasses');
  return { ok: true };
}

/** Reembolso manual pelo suporte da plataforma — plano, seção 13. */
export async function reembolsoAdmin(
  orderId: string,
  tenantId: string,
  _a: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  const auth = await exigirAdmin();
  const d = z
    .object({ quantidade: z.coerce.number().int().min(1), justificativa: Justificativa })
    .safeParse(Object.fromEntries(formData));
  if (!d.success) return { erro: d.error.issues[0]?.message ?? 'Confira os campos.' };

  const r = await executarReembolso({
    tenantId,
    orderId,
    quantidade: d.data.quantidade,
    motivo: 'other',
    manual: true,
    solicitadoPor: auth.userId,
    observacao: `Suporte da plataforma: ${d.data.justificativa}`,
  });
  if (!r.ok) return { erro: r.erro };
  revalidatePath(`/admin/pedidos/${orderId}`);
  return { ok: true };
}
