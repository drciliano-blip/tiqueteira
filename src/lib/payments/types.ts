/**
 * Contrato de PSP — plano, seção 9.
 *
 * Este arquivo é a fronteira entre o sistema e o mundo do dinheiro. Ele existe
 * para que a plataforma inteira seja construída e testada antes de a PSP ser
 * escolhida, e para que trocar de PSP seja escrever um adaptador, não
 * reescrever o produto.
 *
 * Antes de alterar qualquer coisa aqui, leia a seção 9.2 e pergunte.
 */

/** Valor monetário em centavos. SEMPRE inteiro. Nunca float. */
export type Cents = number;

export type PaymentMethod = 'pix' | 'credit_card';

/**
 * Capacidades variam entre PSPs. A aplicação consulta antes de assumir
 * comportamento. Se `conditionalRelease` for false, o motor de repasse precisa
 * de estratégia alternativa — e isso deve falhar ruidosamente na
 * inicialização, não em produção.
 */
export type ProviderCapabilities = {
  /** Consegue segurar saldo do recebedor e liberar sob comando da plataforma? */
  conditionalRelease: boolean;
  /** Onboarding de recebedor 100% via API, sem etapa manual? */
  apiRecipientOnboarding: boolean;
  /** Devolução de Pix via API? */
  pixRefundApi: boolean;
  /** Split com valores absolutos (true) ou apenas percentuais (false)? */
  absoluteSplitAmounts: boolean;
  maxCardInstallments: number;
  chargebackWebhook: boolean;
};

export type DocumentType = 'cnpj' | 'cpf';

export type BankAccount = {
  bankCode: string; // 3 dígitos
  branch: string;
  branchDigit?: string;
  account: string;
  accountDigit: string;
  accountType: 'checking' | 'savings';
  holderName: string;
  holderDocument: string; // só dígitos
};

export type RecipientInput = {
  tenantId: string;
  legalName: string;
  tradeName?: string;
  document: string;
  documentType: DocumentType;
  email: string;
  phone: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  bankAccount: BankAccount;
};

export type RecipientStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export type Recipient = {
  providerRecipientId: string;
  status: RecipientStatus;
  statusMessage?: string;
  raw: unknown;
};

/**
 * Regra de split. A soma dos `amount` DEVE ser igual ao total da transação.
 * O cálculo é responsabilidade da aplicação (src/lib/fees.ts), nunca do
 * provider — assim a lógica de taxa é testável e portável entre PSPs.
 */
export type SplitRule = {
  providerRecipientId: string;
  amount: Cents;
  /** Quem arca com o chargeback desta parcela. */
  liableForChargeback: boolean;
  /** Quem absorve a taxa de processamento da PSP. */
  absorbsProcessingFee: boolean;
  /** Retenção, quando o provider suportar (ver capabilities). */
  holdUntil?: Date;
};

export type CreateTransactionInput = {
  /** Chave de idempotência gerada pela aplicação. Obrigatória. */
  idempotencyKey: string;
  orderId: string;
  method: PaymentMethod;
  /** Total pago pelo comprador, já com conveniência. */
  amount: Cents;
  installments?: number;
  customer: {
    name: string;
    email: string;
    document: string;
    documentType: DocumentType;
    phone?: string;
  };
  /** Token do cartão. O PAN NUNCA trafega pelo servidor. */
  cardToken?: string;
  splits: SplitRule[];
  pixExpiresInSeconds?: number;
  /** Descrição na fatura do comprador. Máx. 22 caracteres. */
  statementDescriptor?: string;
  metadata?: Record<string, string>;
};

export type TransactionStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'chargeback'
  | 'expired'
  | 'canceled';

export type Transaction = {
  providerTransactionId: string;
  status: TransactionStatus;
  amount: Cents;
  pix?: { qrCode: string; qrCodeImageUrl?: string; expiresAt: Date };
  card?: { brand: string; last4: string; authorizationCode?: string };
  paidAt?: Date;
  failureReason?: string;
  raw: unknown;
};

export type RefundReason =
  | 'buyer_request'
  | 'event_canceled'
  | 'event_postponed'
  | 'duplicate'
  | 'fraud'
  | 'other';

export type RefundInput = {
  idempotencyKey: string;
  providerTransactionId: string;
  /** Parcial permitido. */
  amount: Cents;
  reason: RefundReason;
};

export type RefundResult = {
  providerRefundId: string;
  status: 'pending' | 'succeeded' | 'failed';
  raw: unknown;
};

export type Balance = {
  /** Disponível para saque agora. */
  available: Cents;
  /** A liberar por cronograma da PSP. */
  waitingFunds: Cents;
  /** Bloqueado por comando da plataforma. */
  blocked: Cents;
};

export type ReleaseFundsInput = {
  idempotencyKey: string;
  providerRecipientId: string;
  amount: Cents;
  description?: string;
};

export type ReleaseResult = {
  providerPayoutId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  raw: unknown;
};

export type WebhookEventType =
  | 'transaction.paid'
  | 'transaction.failed'
  | 'transaction.expired'
  | 'transaction.refunded'
  | 'transaction.chargeback'
  | 'recipient.status_changed'
  | 'payout.completed'
  | 'payout.failed'
  | 'unknown';

export type NormalizedWebhookEvent = {
  /** Identificador único do evento na PSP. Chave de idempotência. */
  providerEventId: string;
  type: WebhookEventType;
  occurredAt: Date;
  providerTransactionId?: string;
  providerRecipientId?: string;
  providerPayoutId?: string;
  status?: TransactionStatus;
  amount?: Cents;
  raw: unknown;
};

/** Erro tipado. Distinguir o que é retryable do que não é. */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export interface PaymentProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  // --- Recebedores ---
  createRecipient(input: RecipientInput): Promise<Recipient>;
  getRecipient(providerRecipientId: string): Promise<Recipient>;
  updateRecipientBankAccount(
    providerRecipientId: string,
    bankAccount: BankAccount,
  ): Promise<Recipient>;

  // --- Transações ---
  createTransaction(input: CreateTransactionInput): Promise<Transaction>;
  getTransaction(providerTransactionId: string): Promise<Transaction>;
  cancelTransaction(providerTransactionId: string, idempotencyKey: string): Promise<Transaction>;

  // --- Reembolso ---
  refund(input: RefundInput): Promise<RefundResult>;

  // --- Saldo e repasse ---
  getBalance(providerRecipientId: string): Promise<Balance>;
  releaseFunds(input: ReleaseFundsInput): Promise<ReleaseResult>;

  // --- Webhook ---
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;
  parseWebhook(rawBody: string): NormalizedWebhookEvent;
}

/**
 * Controles de cenário do FakeProvider. Ficam FORA da interface de propósito:
 * nenhum código de produção pode depender deles.
 */
export interface FakeProviderControls {
  /** Simula o pagamento de uma transação pendente e devolve o webhook. */
  simulatePayment(providerTransactionId: string): NormalizedWebhookEvent;
  simulateFailure(providerTransactionId: string, reason: string): NormalizedWebhookEvent;
  simulateExpiration(providerTransactionId: string): NormalizedWebhookEvent;
  simulateChargeback(providerTransactionId: string): NormalizedWebhookEvent;
  simulateRecipientApproval(providerRecipientId: string): NormalizedWebhookEvent;
  /** Força erro na próxima chamada do método indicado. */
  failNext(method: keyof PaymentProvider, error: PaymentProviderError): void;
  /** Introduz latência artificial, para testar timeout. */
  setLatency(ms: number): void;
  reset(): void;
}
