'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { orderItems, orders, tenants } from '@/db/schema';
import { cpfValido, normalizarCpf } from '@/domain/cpf';
import { montarSplits, type FeeBreakdown } from '@/lib/fees';
import { getPaymentProvider } from '@/lib/payments/provider';
import type { SplitRule } from '@/lib/payments/types';

/**
 * Identificação do comprador e criação da cobrança Pix.
 *
 * É aqui que o pedido sai de `draft` e vira `awaiting_payment` — a máquina de
 * estado só permite essa transição quando a transação existe na PSP.
 *
 * Nada de criar conta: nome, e-mail e CPF, e pronto. Quem compra ingresso não
 * quer cadastro (benchmark, seção 3).
 */

const Comprador = z.object({
  nome: z
    .string()
    .trim()
    .min(3, 'Informe o nome completo.')
    .max(120)
    .refine((n) => n.includes(' '), 'Informe nome e sobrenome.'),
  email: z.email('Informe um e-mail válido.').max(160),
  cpf: z
    .string()
    .transform(normalizarCpf)
    .refine(cpfValido, 'CPF inválido. Confira os números.'),
  telefone: z
    .string()
    .transform((t) => t.replace(/\D/g, ''))
    .refine((t) => t.length === 0 || (t.length >= 10 && t.length <= 11), 'Telefone inválido.'),
});

export type EstadoPagamento = { erro?: string };

export async function pagarComPix(
  orderId: string,
  _anterior: EstadoPagamento,
  formData: FormData,
): Promise<EstadoPagamento> {
  const dados = Comprador.safeParse({
    nome: formData.get('nome'),
    email: formData.get('email'),
    cpf: formData.get('cpf'),
    telefone: formData.get('telefone') ?? '',
  });

  if (!dados.success) {
    return { erro: dados.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const db = serviceDb();

  const [pedido] = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      status: orders.status,
      totalCentavos: orders.totalCentavos,
      convenienciaCentavos: orders.convenienciaCentavos,
      valorOperadorCentavos: orders.valorOperadorCentavos,
      valorProdutorCentavos: orders.valorProdutorCentavos,
      subtotalCentavos: orders.subtotalCentavos,
      descontoCentavos: orders.descontoCentavos,
      idempotencyKey: orders.idempotencyKey,
      vencido: sql<boolean>`${orders.expiresEm} is not null and ${orders.expiresEm} <= now()`,
      recebedorProdutor: tenants.providerRecipientId,
    })
    .from(orders)
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!pedido) return { erro: 'Pedido não encontrado.' };
  if (pedido.vencido) return { erro: 'A reserva expirou. Escolha os ingressos de novo.' };
  if (pedido.status !== 'draft') {
    return { erro: 'Este pedido já foi enviado para pagamento.' };
  }

  const recebedorOperador = process.env.PAYMENT_OPERATOR_RECIPIENT_ID;
  if (!recebedorOperador || !pedido.recebedorProdutor) {
    return {
      erro: 'Este produtor ainda não pode receber pagamentos. Fale com a organização do evento.',
    };
  }

  const [itens] = await db
    .select({ unidades: sql<number>`coalesce(sum(${orderItems.quantidade}), 0)` })
    .from(orderItems)
    .where(eq(orderItems.orderId, pedido.id));

  /**
   * O split é remontado a partir do que está GRAVADO no pedido, não
   * recalculado: entre a reserva e o pagamento a taxa do produtor pode ter
   * mudado, e vale o snapshot (caso de borda 17).
   */
  const composicao: FeeBreakdown = {
    subtotalCentavos: pedido.subtotalCentavos,
    descontoCentavos: pedido.descontoCentavos,
    baseCentavos: pedido.subtotalCentavos - pedido.descontoCentavos,
    convenienciaCentavos: pedido.convenienciaCentavos,
    totalCentavos: pedido.totalCentavos,
    comissaoCentavos: 0,
    taxaFixaTotalCentavos: 0,
    valorOperadorCentavos: pedido.valorOperadorCentavos,
    valorProdutorCentavos: pedido.valorProdutorCentavos,
  };

  let splits: SplitRule[];
  try {
    splits = montarSplits(composicao, {
      operadorRecipientId: recebedorOperador,
      produtorRecipientId: pedido.recebedorProdutor,
    });
  } catch {
    return { erro: 'Não foi possível montar a cobrança. Tente de novo em instantes.' };
  }

  const provider = getPaymentProvider();

  try {
    const transacao = await provider.createTransaction({
      // A chave do pedido: reenviar o formulário não cria duas cobranças.
      idempotencyKey: pedido.idempotencyKey,
      orderId: pedido.id,
      method: 'pix',
      amount: pedido.totalCentavos,
      customer: {
        name: dados.data.nome,
        email: dados.data.email,
        document: dados.data.cpf,
        documentType: 'cpf',
      },
      splits,
      pixExpiresInSeconds: 600,
      statementDescriptor: 'INGRESSOS',
      metadata: { unidades: String(itens?.unidades ?? 0) },
    });

    await db
      .update(orders)
      .set({
        compradorNome: dados.data.nome,
        compradorEmail: dados.data.email,
        compradorCpf: dados.data.cpf,
        compradorTelefone: dados.data.telefone || null,
        metodo: 'pix',
        status: 'awaiting_payment',
        providerTransactionId: transacao.providerTransactionId,
        pixQrCode: transacao.pix?.qrCode ?? null,
        pixExpiraEm: transacao.pix?.expiresAt ?? null,
        atualizadoEm: new Date(),
      })
      .where(and(eq(orders.id, pedido.id), eq(orders.status, 'draft')));
  } catch (e) {
    console.error('[checkout] falha ao criar cobrança', e);
    return {
      erro: 'O sistema de pagamento não respondeu. Seus ingressos continuam reservados — tente de novo.',
    };
  }

  revalidatePath(`/checkout/${orderId}`);
  return {};
}

/**
 * Simula a confirmação do Pix — ambiente de teste apenas.
 *
 * Monta o corpo do webhook, assina com o mesmo segredo do provider falso e
 * entrega ao processador. É o caminho real: o pedido só vira pago pelo
 * webhook, nunca por retorno de tela. Em produção, quem chama é a PSP.
 */
export async function simularPagamento(orderId: string): Promise<{ erro?: string }> {
  if (process.env.APP_ENV === 'production') {
    return { erro: 'Indisponível.' };
  }

  const db = serviceDb();
  const [pedido] = await db
    .select({
      providerTransactionId: orders.providerTransactionId,
      totalCentavos: orders.totalCentavos,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!pedido?.providerTransactionId) return { erro: 'Cobrança ainda não foi criada.' };
  if (pedido.status !== 'awaiting_payment') return { erro: 'Este pedido não está aguardando.' };

  const { FakeProvider } = await import('@/lib/payments/fake');
  const { processarWebhook } = await import('@/lib/webhook-processor');
  const { env } = await import('@/lib/env');

  const fake = new FakeProvider(process.env.PAYMENT_WEBHOOK_SECRET ?? 'fake-webhook-secret');
  const { body, headers } = fake.envelope({
    providerEventId: `sim_${pedido.providerTransactionId}`,
    type: 'transaction.paid',
    occurredAt: new Date(),
    providerTransactionId: pedido.providerTransactionId,
    status: 'paid',
    amount: pedido.totalCentavos,
    raw: {},
  });

  const resultado = await processarWebhook(body, headers, {
    provider: fake,
    ticketSecret: env().TICKET_HMAC_SECRET,
  });

  revalidatePath(`/checkout/${orderId}`);
  return resultado.status === 200 ? {} : { erro: resultado.detalhe };
}
