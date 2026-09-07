/**
 * FakeProvider — plano, seção 9.1.
 *
 * PSP em memória, determinística. Existe para que a Fase 1 inteira — checkout,
 * webhook, emissão, repasse — seja construída e testada antes de haver
 * contrato com PSP nenhuma.
 *
 * Ele declara `conditionalRelease: true` e mantém saldo por recebedor de
 * propósito: sem isso o motor de repasse nunca seria exercitado de ponta a
 * ponta, e o primeiro teste real seria em produção.
 *
 * NUNCA em produção — `src/lib/payments/provider.ts` recusa na inicialização.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  PaymentProviderError,
  type Balance,
  type BankAccount,
  type Cents,
  type CreateTransactionInput,
  type FakeProviderControls,
  type NormalizedWebhookEvent,
  type PaymentProvider,
  type ProviderCapabilities,
  type Recipient,
  type RecipientInput,
  type RefundInput,
  type RefundResult,
  type ReleaseFundsInput,
  type ReleaseResult,
  type SplitRule,
  type Transaction,
  type TransactionStatus,
  type WebhookEventType,
} from './types';

type TransacaoInterna = {
  tx: Transaction;
  splits: SplitRule[];
  orderId: string;
  reembolsado: Cents;
};

type SaldoInterno = { available: Cents; waitingFunds: Cents; blocked: Cents };

/** Envelope pronto para ser postado no route handler do webhook, nos testes. */
export type WebhookEnvelope = { body: string; headers: Record<string, string> };

const CAPABILITIES: ProviderCapabilities = {
  conditionalRelease: true,
  apiRecipientOnboarding: true,
  pixRefundApi: true,
  absoluteSplitAmounts: true,
  maxCardInstallments: 12,
  chargebackWebhook: true,
};

export class FakeProvider implements PaymentProvider, FakeProviderControls {
  readonly name = 'fake';
  readonly capabilities = CAPABILITIES;

  private readonly segredo: string;
  private recebedores = new Map<string, Recipient>();
  private transacoes = new Map<string, TransacaoInterna>();
  private saldos = new Map<string, SaldoInterno>();
  private repasses = new Map<string, ReleaseResult>();
  /** Resultado por chave de idempotência. É o que a PSP real também faz. */
  private idempotencia = new Map<string, unknown>();
  private falhaProxima = new Map<string, PaymentProviderError>();
  private latenciaMs = 0;
  private sequencia = 0;

  constructor(segredoWebhook = 'fake-webhook-secret') {
    this.segredo = segredoWebhook;
  }

  // -------------------------------------------------------------------------
  // Infra interna
  // -------------------------------------------------------------------------

  /** Ids sequenciais: teste que compara saída não pode depender de sorteio. */
  private id(prefixo: string): string {
    this.sequencia += 1;
    return `fake_${prefixo}_${String(this.sequencia).padStart(6, '0')}`;
  }

  private async antes(metodo: string): Promise<void> {
    if (this.latenciaMs > 0) {
      await new Promise((r) => setTimeout(r, this.latenciaMs));
    }
    const erro = this.falhaProxima.get(metodo);
    if (erro) {
      this.falhaProxima.delete(metodo);
      throw erro;
    }
  }

  private memoizar<T>(chave: string, produzir: () => T): T {
    const existente = this.idempotencia.get(chave);
    if (existente !== undefined) return existente as T;
    const novo = produzir();
    this.idempotencia.set(chave, novo);
    return novo;
  }

  private saldo(recipientId: string): SaldoInterno {
    let s = this.saldos.get(recipientId);
    if (!s) {
      s = { available: 0, waitingFunds: 0, blocked: 0 };
      this.saldos.set(recipientId, s);
    }
    return s;
  }

  private exigirTransacao(id: string): TransacaoInterna {
    const t = this.transacoes.get(id);
    if (!t) {
      throw new PaymentProviderError(`Transação ${id} não existe`, 'not_found', false);
    }
    return t;
  }

  // -------------------------------------------------------------------------
  // Recebedores
  // -------------------------------------------------------------------------

  async createRecipient(input: RecipientInput): Promise<Recipient> {
    await this.antes('createRecipient');

    const recebedor: Recipient = {
      providerRecipientId: this.id('rcpt'),
      // KYC real leva dias. Quem consumir isto precisa lidar com `pending`.
      status: 'pending',
      statusMessage: 'Em análise',
      raw: { input },
    };
    this.recebedores.set(recebedor.providerRecipientId, recebedor);
    this.saldo(recebedor.providerRecipientId);
    return recebedor;
  }

  async getRecipient(providerRecipientId: string): Promise<Recipient> {
    await this.antes('getRecipient');
    const r = this.recebedores.get(providerRecipientId);
    if (!r) {
      throw new PaymentProviderError(
        `Recebedor ${providerRecipientId} não existe`,
        'not_found',
        false,
      );
    }
    return r;
  }

  async updateRecipientBankAccount(
    providerRecipientId: string,
    bankAccount: BankAccount,
  ): Promise<Recipient> {
    await this.antes('updateRecipientBankAccount');
    const atual = await this.getRecipient(providerRecipientId);
    const novo: Recipient = { ...atual, raw: { ...(atual.raw as object), bankAccount } };
    this.recebedores.set(providerRecipientId, novo);
    return novo;
  }

  /** Atalho de teste: cria um recebedor já aprovado. */
  criarRecebedorAtivo(rotulo = 'ativo'): string {
    const id = this.id(`rcpt_${rotulo}`);
    this.recebedores.set(id, { providerRecipientId: id, status: 'active', raw: {} });
    this.saldo(id);
    return id;
  }

  // -------------------------------------------------------------------------
  // Transações
  // -------------------------------------------------------------------------

  async createTransaction(input: CreateTransactionInput): Promise<Transaction> {
    await this.antes('createTransaction');

    if (!input.idempotencyKey) {
      throw new PaymentProviderError('idempotencyKey é obrigatória', 'validation', false);
    }
    if (input.amount <= 0) {
      throw new PaymentProviderError('amount precisa ser positivo', 'validation', false);
    }

    // A soma dos splits tem que fechar com o total. A PSP real recusa; esta
    // recusa também, senão o Fake seria mais permissivo que a produção — e
    // aí ele deixa passar exatamente o bug que deveria pegar.
    const somaSplits = input.splits.reduce((a, s) => a + s.amount, 0);
    if (somaSplits !== input.amount) {
      throw new PaymentProviderError(
        `Soma dos splits (${somaSplits}) difere do total (${input.amount})`,
        'split_mismatch',
        false,
      );
    }
    for (const s of input.splits) {
      if (!this.recebedores.has(s.providerRecipientId)) {
        throw new PaymentProviderError(
          `Recebedor ${s.providerRecipientId} não existe`,
          'not_found',
          false,
        );
      }
    }
    if (input.method === 'credit_card') {
      if (!input.cardToken) {
        throw new PaymentProviderError('cardToken é obrigatório no cartão', 'validation', false);
      }
      const parcelas = input.installments ?? 1;
      if (parcelas < 1 || parcelas > CAPABILITIES.maxCardInstallments) {
        throw new PaymentProviderError(
          `Parcelamento fora do permitido: ${parcelas}`,
          'validation',
          false,
        );
      }
    }

    return this.memoizar(`tx:${input.idempotencyKey}`, () => {
      const providerTransactionId = this.id('tx');
      const expiresAt = new Date(Date.now() + (input.pixExpiresInSeconds ?? 600) * 1000);

      const tx: Transaction = {
        providerTransactionId,
        status: 'pending',
        amount: input.amount,
        raw: { input },
        ...(input.method === 'pix'
          ? { pix: { qrCode: `00020126FAKE${providerTransactionId}`, expiresAt } }
          : { card: { brand: 'visa', last4: '4242' } }),
      };

      this.transacoes.set(providerTransactionId, {
        tx,
        splits: input.splits,
        orderId: input.orderId,
        reembolsado: 0,
      });

      return tx;
    });
  }

  async getTransaction(providerTransactionId: string): Promise<Transaction> {
    await this.antes('getTransaction');
    return this.exigirTransacao(providerTransactionId).tx;
  }

  async cancelTransaction(
    providerTransactionId: string,
    idempotencyKey: string,
  ): Promise<Transaction> {
    await this.antes('cancelTransaction');
    const interna = this.exigirTransacao(providerTransactionId);

    return this.memoizar(`cancel:${idempotencyKey}`, () => {
      if (interna.tx.status !== 'pending') {
        throw new PaymentProviderError(
          `Só transação pendente pode ser cancelada (está ${interna.tx.status})`,
          'invalid_state',
          false,
        );
      }
      interna.tx = { ...interna.tx, status: 'canceled' };
      return interna.tx;
    });
  }

  // -------------------------------------------------------------------------
  // Reembolso
  // -------------------------------------------------------------------------

  async refund(input: RefundInput): Promise<RefundResult> {
    await this.antes('refund');
    const interna = this.exigirTransacao(input.providerTransactionId);

    return this.memoizar(`refund:${input.idempotencyKey}`, () => {
      if (interna.tx.status !== 'paid' && interna.tx.status !== 'partially_refunded') {
        throw new PaymentProviderError(
          `Só transação paga pode ser reembolsada (está ${interna.tx.status})`,
          'invalid_state',
          false,
        );
      }
      const restante = interna.tx.amount - interna.reembolsado;
      if (input.amount > restante) {
        throw new PaymentProviderError(
          `Reembolso de ${input.amount} excede o restante de ${restante}`,
          'validation',
          false,
        );
      }

      // Debita cada recebedor na proporção do split. É o que a PSP faz, e é o
      // que faz o reembolso parcial de pedido com vários ingressos bater.
      for (const split of interna.splits) {
        const parte = Math.round((input.amount * split.amount) / interna.tx.amount);
        this.debitar(split.providerRecipientId, parte);
      }

      interna.reembolsado += input.amount;
      const total = interna.reembolsado >= interna.tx.amount;
      interna.tx = { ...interna.tx, status: total ? 'refunded' : 'partially_refunded' };

      return {
        providerRefundId: this.id('rf'),
        status: 'succeeded' as const,
        raw: { input },
      };
    });
  }

  /** Tira do saldo, na ordem: disponível, retido, a liberar. Pode ficar negativo. */
  private debitar(recipientId: string, valor: Cents): void {
    const s = this.saldo(recipientId);
    let resta = valor;

    const consumir = (campo: keyof SaldoInterno) => {
      const usa = Math.min(s[campo], resta);
      s[campo] -= usa;
      resta -= usa;
    };

    consumir('available');
    consumir('blocked');
    consumir('waitingFunds');

    // Saldo a descoberto — caso de borda 5 do plano. Fica negativo de
    // propósito: esconder isso seria esconder o prejuízo.
    if (resta > 0) s.available -= resta;
  }

  // -------------------------------------------------------------------------
  // Saldo e repasse
  // -------------------------------------------------------------------------

  async getBalance(providerRecipientId: string): Promise<Balance> {
    await this.antes('getBalance');
    const s = this.saldo(providerRecipientId);
    return { available: s.available, waitingFunds: s.waitingFunds, blocked: s.blocked };
  }

  async releaseFunds(input: ReleaseFundsInput): Promise<ReleaseResult> {
    await this.antes('releaseFunds');

    return this.memoizar(`release:${input.idempotencyKey}`, () => {
      const s = this.saldo(input.providerRecipientId);
      if (input.amount <= 0) {
        throw new PaymentProviderError('amount precisa ser positivo', 'validation', false);
      }
      if (input.amount > s.blocked) {
        throw new PaymentProviderError(
          `Liberação de ${input.amount} excede o retido de ${s.blocked}`,
          'insufficient_blocked',
          false,
        );
      }
      s.blocked -= input.amount;
      s.available += input.amount;

      const resultado: ReleaseResult = {
        providerPayoutId: this.id('po'),
        status: 'completed',
        raw: { input },
      };
      this.repasses.set(resultado.providerPayoutId, resultado);
      return resultado;
    });
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  private assinar(body: string): string {
    return createHmac('sha256', this.segredo).update(body, 'utf8').digest('hex');
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean {
    const recebida = headers['x-fake-signature'] ?? headers['X-Fake-Signature'];
    if (!recebida) return false;

    const esperada = this.assinar(rawBody);
    const a = Buffer.from(esperada, 'utf8');
    const b = Buffer.from(recebida, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    let dados: Record<string, unknown>;
    try {
      dados = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new PaymentProviderError('Corpo do webhook não é JSON', 'parse_error', false);
    }

    const providerEventId = dados.id;
    if (typeof providerEventId !== 'string') {
      throw new PaymentProviderError('Webhook sem id', 'parse_error', false);
    }

    return {
      providerEventId,
      type: (dados.type as WebhookEventType) ?? 'unknown',
      occurredAt: new Date(String(dados.occurred_at ?? new Date().toISOString())),
      ...(typeof dados.transaction_id === 'string'
        ? { providerTransactionId: dados.transaction_id }
        : {}),
      ...(typeof dados.recipient_id === 'string' ? { providerRecipientId: dados.recipient_id } : {}),
      ...(typeof dados.payout_id === 'string' ? { providerPayoutId: dados.payout_id } : {}),
      ...(typeof dados.status === 'string' ? { status: dados.status as TransactionStatus } : {}),
      ...(typeof dados.amount === 'number' ? { amount: dados.amount } : {}),
      raw: dados,
    };
  }

  /**
   * Empacota um evento como a PSP entregaria: corpo cru e assinatura.
   * Fora da interface `FakeProviderControls` do plano, mas necessário para
   * testar o route handler do webhook do jeito certo — sobre bytes, não sobre
   * objeto já parseado.
   */
  envelope(evento: NormalizedWebhookEvent): WebhookEnvelope {
    const body = JSON.stringify({
      id: evento.providerEventId,
      type: evento.type,
      occurred_at: evento.occurredAt.toISOString(),
      transaction_id: evento.providerTransactionId,
      recipient_id: evento.providerRecipientId,
      payout_id: evento.providerPayoutId,
      status: evento.status,
      amount: evento.amount,
    });
    return {
      body,
      headers: { 'content-type': 'application/json', 'x-fake-signature': this.assinar(body) },
    };
  }

  // -------------------------------------------------------------------------
  // Controles de cenário — fora da interface, só para teste
  // -------------------------------------------------------------------------

  private evento(
    type: WebhookEventType,
    extra: Partial<NormalizedWebhookEvent> = {},
  ): NormalizedWebhookEvent {
    return {
      providerEventId: this.id('evt'),
      type,
      occurredAt: new Date(),
      raw: {},
      ...extra,
    };
  }

  simulatePayment(providerTransactionId: string): NormalizedWebhookEvent {
    const interna = this.exigirTransacao(providerTransactionId);
    if (interna.tx.status !== 'pending') {
      throw new PaymentProviderError(
        `Só transação pendente pode ser paga (está ${interna.tx.status})`,
        'invalid_state',
        false,
      );
    }

    interna.tx = { ...interna.tx, status: 'paid', paidAt: new Date() };

    // Distribui o split. Parcela com retenção futura entra como bloqueada;
    // é isso que o motor de repasse vai depois liberar.
    const agora = Date.now();
    for (const split of interna.splits) {
      const s = this.saldo(split.providerRecipientId);
      if (split.holdUntil && split.holdUntil.getTime() > agora) {
        s.blocked += split.amount;
      } else {
        s.available += split.amount;
      }
    }

    return this.evento('transaction.paid', {
      providerTransactionId,
      status: 'paid',
      amount: interna.tx.amount,
    });
  }

  simulateFailure(providerTransactionId: string, reason: string): NormalizedWebhookEvent {
    const interna = this.exigirTransacao(providerTransactionId);
    interna.tx = { ...interna.tx, status: 'failed', failureReason: reason };
    return this.evento('transaction.failed', {
      providerTransactionId,
      status: 'failed',
      amount: interna.tx.amount,
    });
  }

  simulateExpiration(providerTransactionId: string): NormalizedWebhookEvent {
    const interna = this.exigirTransacao(providerTransactionId);
    interna.tx = { ...interna.tx, status: 'expired' };
    return this.evento('transaction.expired', {
      providerTransactionId,
      status: 'expired',
      amount: interna.tx.amount,
    });
  }

  simulateChargeback(providerTransactionId: string): NormalizedWebhookEvent {
    const interna = this.exigirTransacao(providerTransactionId);
    if (interna.tx.status !== 'paid' && interna.tx.status !== 'partially_refunded') {
      throw new PaymentProviderError(
        `Chargeback exige transação paga (está ${interna.tx.status})`,
        'invalid_state',
        false,
      );
    }

    // O débito recai sobre quem foi marcado como responsável no split.
    const responsaveis = interna.splits.filter((s) => s.liableForChargeback);
    const alvo = responsaveis.length > 0 ? responsaveis : interna.splits;
    const somaAlvo = alvo.reduce((a, s) => a + s.amount, 0);

    for (const split of alvo) {
      const parte = somaAlvo === 0 ? 0 : Math.round((interna.tx.amount * split.amount) / somaAlvo);
      this.debitar(split.providerRecipientId, parte);
    }

    interna.tx = { ...interna.tx, status: 'chargeback' };
    return this.evento('transaction.chargeback', {
      providerTransactionId,
      status: 'chargeback',
      amount: interna.tx.amount,
    });
  }

  simulateRecipientApproval(providerRecipientId: string): NormalizedWebhookEvent {
    const r = this.recebedores.get(providerRecipientId);
    if (!r) {
      throw new PaymentProviderError(
        `Recebedor ${providerRecipientId} não existe`,
        'not_found',
        false,
      );
    }
    this.recebedores.set(providerRecipientId, { ...r, status: 'active', statusMessage: 'Aprovado' });
    return this.evento('recipient.status_changed', { providerRecipientId });
  }

  failNext(method: keyof PaymentProvider, error: PaymentProviderError): void {
    this.falhaProxima.set(String(method), error);
  }

  setLatency(ms: number): void {
    this.latenciaMs = ms;
  }

  reset(): void {
    this.recebedores.clear();
    this.transacoes.clear();
    this.saldos.clear();
    this.repasses.clear();
    this.idempotencia.clear();
    this.falhaProxima.clear();
    this.latenciaMs = 0;
    this.sequencia = 0;
  }
}
