/**
 * Máquina de estado do pedido — plano, seção 8.
 *
 * Função pura, sem I/O. Toda mudança de `orders.status` passa por aqui;
 * transição que não está na tabela é bug, não caso especial.
 *
 * Duas exigências do plano moldam o formato desta API:
 *
 * 1. "Transição inválida não é erro: registra e ignora" (seção 11, passo 5).
 *    Webhook chega fora de ordem — `refunded` antes de `paid` acontece. Por
 *    isso o retorno é um resultado descritivo, e não uma exceção: quem chama
 *    decide se loga e segue ou se aborta.
 *
 * 2. Reentrega de webhook é rotina. Ir de `paid` para `paid` não pode ser
 *    tratado como falha, mas também não pode disparar o efeito colateral duas
 *    vezes — daí o motivo `ja_esta_assim`, distinto de `nao_permitida`.
 */

export const ORDER_STATUSES = [
  'draft',
  'awaiting_payment',
  'paid',
  'partially_refunded',
  'refunded',
  'expired',
  'canceled',
  'chargeback',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Tabela de transições. Ler como: "de X, pode ir para".
 * O que não está aqui não acontece.
 */
const TRANSICOES: Record<OrderStatus, readonly OrderStatus[]> = {
  // O rascunho é transitório: existe entre reservar estoque e criar a
  // cobrança na PSP. Pode morrer ali mesmo se a PSP falhar.
  draft: ['awaiting_payment', 'canceled', 'expired'],

  // `paid` só por webhook verificado. Ver plano, seção 8.
  awaiting_payment: ['paid', 'expired', 'canceled'],

  paid: ['partially_refunded', 'refunded', 'chargeback'],

  // Reembolso parcial pode virar total, e ainda pode ser contestado depois.
  partially_refunded: ['refunded', 'chargeback'],

  // Terminais.
  refunded: [],
  expired: [],
  canceled: [],
  chargeback: [],
};

export const ESTADOS_TERMINAIS: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (s) => TRANSICOES[s].length === 0,
);

export type MotivoRecusa = 'ja_esta_assim' | 'estado_terminal' | 'nao_permitida';

export type TransitionResult =
  | { ok: true; de: OrderStatus; para: OrderStatus }
  | { ok: false; motivo: MotivoRecusa; de: OrderStatus; para: OrderStatus };

export function podeTransicionar(de: OrderStatus, para: OrderStatus): boolean {
  return TRANSICOES[de].includes(para);
}

export function transicionar(de: OrderStatus, para: OrderStatus): TransitionResult {
  if (de === para) return { ok: false, motivo: 'ja_esta_assim', de, para };
  if (TRANSICOES[de].length === 0) return { ok: false, motivo: 'estado_terminal', de, para };
  if (!podeTransicionar(de, para)) return { ok: false, motivo: 'nao_permitida', de, para };
  return { ok: true, de, para };
}

export function transicoesPossiveis(de: OrderStatus): readonly OrderStatus[] {
  return TRANSICOES[de];
}

export function ehTerminal(status: OrderStatus): boolean {
  return TRANSICOES[status].length === 0;
}

// ---------------------------------------------------------------------------
// Leituras de negócio
// ---------------------------------------------------------------------------

/** O dinheiro entrou? Vale para o cálculo de bruto no repasse. */
export function foiPago(status: OrderStatus): boolean {
  return (
    status === 'paid' ||
    status === 'partially_refunded' ||
    status === 'refunded' ||
    status === 'chargeback'
  );
}

/**
 * O pedido ainda ocupa estoque?
 *
 * `awaiting_payment` e `draft` seguram reserva; `paid` consumiu.
 * `partially_refunded` continua consumindo: o reembolso parcial devolve
 * dinheiro, mas os ingressos não reembolsados seguem válidos.
 */
export function ocupaEstoque(status: OrderStatus): boolean {
  return (
    status === 'draft' ||
    status === 'awaiting_payment' ||
    status === 'paid' ||
    status === 'partially_refunded'
  );
}

/** Conta para o limite por CPF (plano, seção 10). */
export function contaParaLimiteCpf(status: OrderStatus): boolean {
  return status === 'awaiting_payment' || status === 'paid' || status === 'partially_refunded';
}

// ---------------------------------------------------------------------------
// Webhook → estado
// ---------------------------------------------------------------------------

import type { WebhookEventType } from '@/lib/payments/types';

/**
 * Para onde o evento da PSP quer levar o pedido.
 *
 * `null` significa "este evento não muda o pedido" — não é erro. Evento de
 * recebedor ou de repasse chega no mesmo canal e não tem nada a ver com o
 * status do pedido.
 *
 * `transaction.refunded` mapeia para `refunded` (total). Reembolso parcial é
 * decidido pela aplicação comparando o valor devolvido com o total do pedido,
 * porque o webhook sozinho não sabe quanto já havia sido devolvido antes.
 */
export function estadoAlvoDoEvento(tipo: WebhookEventType): OrderStatus | null {
  switch (tipo) {
    case 'transaction.paid':
      return 'paid';
    case 'transaction.failed':
      return 'canceled';
    case 'transaction.expired':
      return 'expired';
    case 'transaction.refunded':
      return 'refunded';
    case 'transaction.chargeback':
      return 'chargeback';
    case 'recipient.status_changed':
    case 'payout.completed':
    case 'payout.failed':
    case 'unknown':
      return null;
  }
}

/**
 * Decide o que fazer com um evento que chegou, dado o estado atual.
 *
 * É aqui que "webhook fora de ordem" deixa de ser problema: se o alvo não é
 * alcançável a partir do estado atual, o resultado diz o motivo e o handler
 * registra e responde 200 — sem tentar forçar a transição e sem devolver erro
 * para a PSP, que reentregaria para sempre.
 */
export function aplicarEvento(
  atual: OrderStatus,
  tipo: WebhookEventType,
): TransitionResult | { ok: false; motivo: 'evento_irrelevante'; de: OrderStatus } {
  const alvo = estadoAlvoDoEvento(tipo);
  if (alvo === null) return { ok: false, motivo: 'evento_irrelevante', de: atual };
  return transicionar(atual, alvo);
}
