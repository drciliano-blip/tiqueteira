'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { auditLog, tenants } from '@/db/schema';
import { cnpjValido, cpfValido } from '@/domain/cpf';
import { requireRole } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments/provider';
import { PaymentProviderError, type RecipientStatus } from '@/lib/payments/types';
import { getAuth } from '@/lib/session-cookie';

export type EstadoRecebimento = { ok?: boolean; erro?: string };

const digitos = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : v);

const Cadastro = z
  .object({
    documentType: z.enum(['cnpj', 'cpf']),
    document: z.preprocess(digitos, z.string()),
    legalName: z.string().trim().min(3, 'Informe o nome ou a razão social.').max(160),
    tradeName: z.string().trim().max(80).optional(),
    email: z.email('E-mail inválido.'),
    phone: z.preprocess(digitos, z.string().min(10, 'Telefone inválido.').max(11)),
    street: z.string().trim().min(2, 'Informe a rua.').max(160),
    number: z.string().trim().min(1, 'Informe o número.').max(20),
    complement: z.string().trim().max(80).optional(),
    neighborhood: z.string().trim().min(2, 'Informe o bairro.').max(80),
    city: z.string().trim().min(2, 'Informe a cidade.').max(80),
    state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF inválida.'),
    zipCode: z.preprocess(digitos, z.string().length(8, 'CEP inválido.')),
    bankCode: z.preprocess(digitos, z.string().length(3, 'Código do banco tem 3 dígitos.')),
    branch: z.preprocess(digitos, z.string().min(1, 'Informe a agência.').max(5)),
    branchDigit: z.string().trim().max(1).optional(),
    account: z.preprocess(digitos, z.string().min(1, 'Informe a conta.').max(13)),
    accountDigit: z.string().trim().min(1, 'Informe o dígito da conta.').max(2),
    accountType: z.enum(['checking', 'savings']),
  })
  .refine(
    (d) => (d.documentType === 'cnpj' ? cnpjValido(d.document) : cpfValido(d.document)),
    { message: 'Documento inválido. Confira os números.' },
  );

const KYC: Record<RecipientStatus, 'em_analise' | 'aprovado' | 'reprovado' | 'suspenso'> = {
  pending: 'em_analise',
  active: 'aprovado',
  rejected: 'reprovado',
  suspended: 'suspenso',
};

/**
 * Cadastro de recebedor na PSP — ADR-024.
 *
 * A conta bancária vai para a operadora e não fica no nosso banco: o que a
 * plataforma guarda é o identificador do recebedor e a situação do cadastro.
 * Dado bancário que não guardamos não vaza.
 *
 * A conta precisa estar no nome do documento informado — é a regra das PSPs
 * para split, e o que impede o repasse de cair na conta de outra pessoa.
 */
export async function salvarRecebimento(
  tenantId: string,
  _anterior: EstadoRecebimento,
  formData: FormData,
): Promise<EstadoRecebimento> {
  const auth = await getAuth();
  try {
    requireRole(auth, tenantId, 'owner');
  } catch {
    return { erro: 'Só o dono da conta cadastra os dados de recebimento.' };
  }

  const d = Cadastro.safeParse(Object.fromEntries(formData));
  if (!d.success) return { erro: d.error.issues[0]?.message ?? 'Confira os dados.' };
  const v = d.data;

  const db = serviceDb();
  const [t] = await db
    .select({ recebedor: tenants.providerRecipientId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) return { erro: 'Conta não encontrada.' };

  const bankAccount = {
    bankCode: v.bankCode,
    branch: v.branch,
    ...(v.branchDigit ? { branchDigit: v.branchDigit } : {}),
    account: v.account,
    accountDigit: v.accountDigit,
    accountType: v.accountType,
    holderName: v.legalName,
    holderDocument: v.document,
  };

  const provider = getPaymentProvider();
  try {
    let recebedorId = t.recebedor;
    let status: RecipientStatus;

    if (recebedorId) {
      const r = await provider.updateRecipientBankAccount(recebedorId, bankAccount);
      status = r.status;
    } else {
      const r = await provider.createRecipient({
        tenantId,
        legalName: v.legalName,
        ...(v.tradeName ? { tradeName: v.tradeName } : {}),
        document: v.document,
        documentType: v.documentType,
        email: v.email,
        phone: v.phone,
        address: {
          street: v.street,
          number: v.number,
          ...(v.complement ? { complement: v.complement } : {}),
          neighborhood: v.neighborhood,
          city: v.city,
          state: v.state,
          zipCode: v.zipCode,
        },
        bankAccount,
      });
      recebedorId = r.providerRecipientId;
      status = r.status;
    }

    await db
      .update(tenants)
      .set({ providerRecipientId: recebedorId, kycStatus: KYC[status], atualizadoEm: new Date() })
      .where(eq(tenants.id, tenantId));

    await db.insert(auditLog).values({
      tenantId,
      userId: auth?.userId ?? null,
      acao: t.recebedor ? 'conta_bancaria_alterada' : 'recebedor_cadastrado',
      entidade: 'tenants',
      entidadeId: tenantId,
      // Só o final da conta: o registro serve para saber o que mudou, não
      // para reconstruir o dado bancário.
      depois: {
        banco: v.bankCode,
        contaFinal: v.account.slice(-3),
        kycStatus: KYC[status],
        recebedor: recebedorId,
      },
    });
  } catch (e) {
    console.error('[recebimento] falha na PSP', e);
    return {
      erro:
        e instanceof PaymentProviderError && !e.retryable
          ? `A operadora recusou os dados: ${e.message}`
          : 'A operadora de pagamento não respondeu. Tente de novo em instantes.',
    };
  }

  revalidatePath('/painel/recebimento');
  revalidatePath('/painel');
  return { ok: true };
}
