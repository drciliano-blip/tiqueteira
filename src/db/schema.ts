/**
 * Schema do banco — Tiqueteira.
 *
 * Convenções (ver docs/plano.md, seção 7):
 * - identificadores `uuid`
 * - dinheiro em CENTAVOS, sempre `integer`, nunca float
 * - percentuais em BASIS POINTS (`integer`), nunca float — ver ADR-006
 * - timestamps `timestamptz` em UTC
 * - toda tabela de negócio tem `tenant_id`, `criado_em`, `atualizado_em`
 * - nomes de coluna em português; nomes de símbolo TypeScript em inglês
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timestamps = {
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
};

/** Dinheiro. Sempre centavos inteiros. */
const cents = (name: string) => integer(name);

/** Percentual em basis points: 1000 = 10,00%. Ver ADR-006. */
const bps = (name: string) => integer(name);

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const kycStatusEnum = pgEnum('kyc_status', [
  'pendente',
  'em_analise',
  'aprovado',
  'reprovado',
  'suspenso',
]);

export const tenantStatusEnum = pgEnum('tenant_status', ['ativo', 'suspenso', 'inativo']);

export const userStatusEnum = pgEnum('user_status', ['ativo', 'inativo', 'bloqueado']);

export const membershipRoleEnum = pgEnum('membership_role', [
  'owner',
  'admin',
  'operador',
  'portaria',
]);

export const eventStatusEnum = pgEnum('event_status', [
  'rascunho',
  'publicado',
  'esgotado',
  'encerrado',
  'cancelado',
  'adiado',
]);

export const ticketKindEnum = pgEnum('ticket_kind', [
  'inteira',
  'meia',
  'cortesia',
  'pcd',
  'idoso',
]);

export const cotaMeiaBaseEnum = pgEnum('cota_meia_base', ['total_evento', 'por_tipo']);

export const paymentMethodEnum = pgEnum('payment_method', ['pix', 'credit_card']);

export const orderStatusEnum = pgEnum('order_status', [
  'draft',
  'awaiting_payment',
  'paid',
  'partially_refunded',
  'refunded',
  'expired',
  'canceled',
  'chargeback',
]);

export const reservationReleaseReasonEnum = pgEnum('reservation_release_reason', [
  'paga',
  'expirada',
  'cancelada',
]);

export const ticketStatusEnum = pgEnum('ticket_status', [
  'valido',
  'usado',
  'cancelado',
  'transferido',
]);

export const couponTypeEnum = pgEnum('coupon_type', ['pct', 'valor']);

export const payoutTrancheEnum = pgEnum('payout_tranche', ['principal', 'reserva']);

export const payoutStatusEnum = pgEnum('payout_status', [
  'scheduled',
  'processing',
  'released',
  'failed',
  'canceled',
]);

export const refundStatusEnum = pgEnum('refund_status', [
  'requested',
  'processing',
  'succeeded',
  'failed',
]);

export const refundReasonEnum = pgEnum('refund_reason', [
  'buyer_request',
  'event_canceled',
  'event_postponed',
  'duplicate',
  'fraud',
  'other',
]);

export const chargebackStatusEnum = pgEnum('chargeback_status', [
  'aberto',
  'contestado',
  'ganho',
  'perdido',
]);

export const refundTypeEnum = pgEnum('refund_type', [
  'arrependimento_legal',
  'politica_evento',
  'evento_cancelado',
  'chargeback',
  'outro',
]);

/**
 * Por onde a venda entrou. `pdv` e `lista` não passam pela PSP: o dinheiro já
 * está com a casa, ou não houve dinheiro. Separar isso do meio de pagamento
 * evita o erro clássico de somar bilheteria física ao bruto do repasse.
 */
export const salesChannelEnum = pgEnum('sales_channel', ['online', 'pdv', 'lista']);

/** Forma de pagamento fora da PSP, na bilheteria física. */
export const externalPaymentEnum = pgEnum('external_payment', [
  'dinheiro',
  'debito',
  'credito',
  'cortesia',
  'outro',
]);

export const guestEntryTypeEnum = pgEnum('guest_entry_type', ['cortesia', 'desconto']);

export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'dead',
]);

// ---------------------------------------------------------------------------
// tenants — cada produtor é um tenant
// ---------------------------------------------------------------------------

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    nome: text('nome').notNull(),
    razaoSocial: text('razao_social'),
    cnpj: text('cnpj'),
    email: text('email').notNull(),
    telefone: text('telefone'),

    // Recebedor na PSP
    providerRecipientId: text('provider_recipient_id'),
    kycStatus: kycStatusEnum('kyc_status').notNull().default('pendente'),
    status: tenantStatusEnum('status').notNull().default('ativo'),

    // Receita do operador. Taxa é dado, não constante no código.
    taxaConvenienciaBps: bps('taxa_conveniencia_bps').notNull().default(1000),
    comissaoBps: bps('comissao_bps').notNull().default(0),
    taxaFixaCentavos: cents('taxa_fixa_centavos').notNull().default(0),

    // Reserva de garantia, separada por meio de pagamento (plano, seção 3.5)
    reservaPixBps: bps('reserva_pix_bps').notNull().default(0),
    reservaCartaoBps: bps('reserva_cartao_bps').notNull().default(2000),
    diasLiberacaoEvento: integer('dias_liberacao_evento').notNull().default(2),
    diasLiberacaoReserva: integer('dias_liberacao_reserva').notNull().default(35),

    // Identidade visual da vitrine — benchmark, seção 4.2.
    // Uma tiqueteira white-label não pode ter uma cor só: a cor vem do
    // produtor e é injetada como token na raiz do documento.
    corAcento: text('cor_acento').notNull().default('#5B4BFF'),
    logoUrl: text('logo_url'),

    // Modelo de taxa — benchmark, seção 2.7
    /** Se true, o comprador paga o preço de face e o produtor recebe menos. */
    taxaAbsorvidaPeloProdutor: boolean('taxa_absorvida_pelo_produtor').notNull().default(false),
    /** Piso da conveniência. Protege a margem em ingresso barato. */
    taxaMinimaCentavos: cents('taxa_minima_centavos').notNull().default(0),
    /**
     * Quem paga os juros do parcelamento. Nenhum dos documentos definia isso,
     * e é dinheiro: em 6x, ou o comprador paga mais, ou o produtor recebe menos.
     */
    jurosParcelamentoAbsorvidos: boolean('juros_parcelamento_absorvidos')
      .notNull()
      .default(false),

    // Marketing. Produtor de festa compra tráfego no Instagram; sem pixel de
    // conversão ele não mede retorno — e é a primeira pergunta que ele faz.
    pixelMetaId: text('pixel_meta_id'),
    googleAnalyticsId: text('google_analytics_id'),

    // Domínio customizado (Fase 4)
    dominioCustomizado: text('dominio_customizado'),
    dominioVerificado: boolean('dominio_verificado').notNull().default(false),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    uniqueIndex('tenants_dominio_key').on(t.dominioCustomizado),
    uniqueIndex('tenants_cnpj_key').on(t.cnpj),
    check('tenants_taxa_conveniencia_ck', sql`${t.taxaConvenienciaBps} between 0 and 10000`),
    check('tenants_comissao_ck', sql`${t.comissaoBps} between 0 and 10000`),
    check('tenants_taxa_fixa_ck', sql`${t.taxaFixaCentavos} >= 0`),
    check('tenants_reserva_pix_ck', sql`${t.reservaPixBps} between 0 and 10000`),
    check('tenants_reserva_cartao_ck', sql`${t.reservaCartaoBps} between 0 and 10000`),
    check('tenants_taxa_minima_ck', sql`${t.taxaMinimaCentavos} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// users / sessions / memberships — ADR-005
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    nome: text('nome').notNull(),
    /** Argon2id. Nulo para quem só usa magic link (comprador). */
    senhaHash: text('senha_hash'),
    status: userStatusEnum('status').notNull().default('ativo'),
    emailVerificadoEm: timestamp('email_verificado_em', { withTimezone: true }),
    ultimoLoginEm: timestamp('ultimo_login_em', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 do token do cookie. O token cru nunca é persistido. */
    tokenHash: text('token_hash').notNull(),
    /** Tenant ativo da sessão. Alimenta `app.tenant_id` no Postgres. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    /** Escopo de portaria: sessão vale só para este evento. */
    scopeEventId: uuid('scope_event_id').references((): AnyPgColumn => events.id, {
      onDelete: 'cascade',
    }),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    revogadaEm: timestamp('revogada_em', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expira_idx').on(t.expiraEm).where(sql`revogada_em is null`),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull(),
    /** Papel `portaria` pode ser restrito a um evento. Nulo = todos. */
    eventoId: uuid('evento_id').references((): AnyPgColumn => events.id, {
      onDelete: 'cascade',
    }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('memberships_user_tenant_evento_key').on(t.userId, t.tenantId, t.eventoId),
    index('memberships_tenant_idx').on(t.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// venues
// ---------------------------------------------------------------------------

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    endereco: text('endereco'),
    cidade: text('cidade'),
    uf: text('uf'),
    /** Teto rígido: alvará e AVCB. Não é sugestão. */
    capacidadeMaxima: integer('capacidade_maxima').notNull(),
    observacoes: text('observacoes'),
    ...timestamps,
  },
  (t) => [
    index('venues_tenant_idx').on(t.tenantId),
    check('venues_capacidade_ck', sql`${t.capacidadeMaxima} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    titulo: text('titulo').notNull(),
    descricao: text('descricao'),
    imagemUrl: text('imagem_url'),

    dataInicio: timestamp('data_inicio', { withTimezone: true }).notNull(),
    dataFim: timestamp('data_fim', { withTimezone: true }).notNull(),
    classificacaoEtaria: integer('classificacao_etaria').notNull().default(18),
    /** Nunca maior que venues.capacidade_maxima. Validado na aplicação. */
    capacidade: integer('capacidade').notNull(),

    status: eventStatusEnum('status').notNull().default('rascunho'),
    politicaReembolso: text('politica_reembolso'),
    permiteCancelamentoAteHoras: integer('permite_cancelamento_ate_horas').notNull().default(48),

    // Ingresso nominal e conferência de documento (plano, seção 24)
    ingressoNominal: boolean('ingresso_nominal').notNull().default(true),
    exigeDocumentoEntrada: boolean('exige_documento_entrada').notNull().default(false),

    // Transferência de titularidade (plano, seção 23.3)
    permiteTransferencia: boolean('permite_transferencia').notNull().default(true),
    transferenciaAteHoras: integer('transferencia_ate_horas').notNull().default(24),
    maxTransferenciasPorIngresso: integer('max_transferencias_por_ingresso').notNull().default(1),
    taxaTransferenciaCentavos: cents('taxa_transferencia_centavos').notNull().default(0),
    transferenciaPermiteMeia: boolean('transferencia_permite_meia').notNull().default(false),

    // Política de cancelamento — benchmark, seções 2.1 e 2.5
    /** Arrependimento legal (CDC art. 49). */
    cancelamentoAteDiasCompra: integer('cancelamento_ate_dias_compra').notNull().default(7),
    /** Se faltarem 7 dias ou menos para o evento, vale este limite. */
    cancelamentoAteHorasEvento: integer('cancelamento_ate_horas_evento').notNull().default(48),
    /** Onde discordamos da Sympla: cancelar um ingresso sem cancelar o pedido. */
    permiteReembolsoParcial: boolean('permite_reembolso_parcial').notNull().default(true),
    /** Janela do produtor para cancelar pedido depois do evento. */
    cancelamentoProdutorAteHorasPos: integer('cancelamento_produtor_ate_horas_pos')
      .notNull()
      .default(48),

    /** Sobrepõe a cor do produtor quando o evento tem identidade própria. */
    corAcento: text('cor_acento'),

    // Meia-entrada — ADR-004
    cotaMeiaBps: bps('cota_meia_bps').notNull().default(4000),
    cotaMeiaBase: cotaMeiaBaseEnum('cota_meia_base').notNull().default('total_evento'),

    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoMotivo: text('cancelado_motivo'),
    settledEm: timestamp('settled_em', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('events_tenant_slug_key').on(t.tenantId, t.slug),
    index('events_tenant_status_idx').on(t.tenantId, t.status),
    index('events_data_inicio_idx').on(t.dataInicio),
    check('events_periodo_ck', sql`${t.dataFim} > ${t.dataInicio}`),
    check('events_capacidade_ck', sql`${t.capacidade} > 0`),
    check('events_cota_meia_ck', sql`${t.cotaMeiaBps} between 0 and 10000`),
    check('events_taxa_transferencia_ck', sql`${t.taxaTransferenciaCentavos} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// ticket_types — lotes
// ---------------------------------------------------------------------------

export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    descricao: text('descricao'),
    precoCentavos: cents('preco_centavos').notNull(),
    tipo: ticketKindEnum('tipo').notNull().default('inteira'),
    /** ADR-004: `pcd` e `idoso` são gratuidade legal e ficam fora da cota. */
    consomeCotaMeia: boolean('consome_cota_meia').notNull().default(false),

    quantidadeTotal: integer('quantidade_total').notNull(),
    quantidadeVendida: integer('quantidade_vendida').notNull().default(0),
    quantidadeReservada: integer('quantidade_reservada').notNull().default(0),

    lote: integer('lote').notNull().default(1),
    ordem: integer('ordem').notNull().default(0),
    vendasInicio: timestamp('vendas_inicio', { withTimezone: true }).notNull(),
    vendasFim: timestamp('vendas_fim', { withTimezone: true }).notNull(),

    limitePorPedido: integer('limite_por_pedido').notNull().default(6),
    /** Nulo = sem limite. */
    limitePorCpf: integer('limite_por_cpf'),
    exigeDocumento: boolean('exige_documento').notNull().default(false),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('ticket_types_event_idx').on(t.eventId),
    index('ticket_types_tenant_idx').on(t.tenantId),
    check('ticket_types_preco_ck', sql`${t.precoCentavos} >= 0`),
    check('ticket_types_total_ck', sql`${t.quantidadeTotal} >= 0`),
    // ADR-002: guarda inferior, não só a superior.
    check('ticket_types_vendida_ck', sql`${t.quantidadeVendida} >= 0`),
    check('ticket_types_reservada_ck', sql`${t.quantidadeReservada} >= 0`),
    check(
      'ticket_types_estoque_ck',
      sql`${t.quantidadeVendida} + ${t.quantidadeReservada} <= ${t.quantidadeTotal}`,
    ),
    check('ticket_types_janela_ck', sql`${t.vendasFim} > ${t.vendasInicio}`),
    check('ticket_types_limite_pedido_ck', sql`${t.limitePorPedido} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// coupons
// ---------------------------------------------------------------------------

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Nulo = vale para todos os eventos do tenant. */
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    tipo: couponTypeEnum('tipo').notNull(),
    /** `pct` → basis points. `valor` → centavos. */
    valor: integer('valor').notNull(),
    usosMaximos: integer('usos_maximos'),
    usosAtuais: integer('usos_atuais').notNull().default(0),
    validoAte: timestamp('valido_ate', { withTimezone: true }),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('coupons_tenant_codigo_key').on(t.tenantId, sql`upper(${t.codigo})`),
    check('coupons_valor_ck', sql`${t.valor} > 0`),
    check('coupons_usos_ck', sql`${t.usosAtuais} >= 0`),
    check(
      'coupons_pct_ck',
      sql`${t.tipo} <> 'pct' or ${t.valor} <= 10000`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// orders
// ---------------------------------------------------------------------------

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    /** Sequencial por tenant, para o cliente citar no suporte. */
    numero: integer('numero').notNull(),

    compradorNome: text('comprador_nome').notNull(),
    compradorEmail: text('comprador_email').notNull(),
    /** Só dígitos. LGPD: propósito declarado, mascarado na interface. */
    compradorCpf: text('comprador_cpf').notNull(),
    compradorTelefone: text('comprador_telefone'),

    subtotalCentavos: cents('subtotal_centavos').notNull(),
    convenienciaCentavos: cents('conveniencia_centavos').notNull().default(0),
    descontoCentavos: cents('desconto_centavos').notNull().default(0),
    totalCentavos: cents('total_centavos').notNull(),
    valorProdutorCentavos: cents('valor_produtor_centavos').notNull(),
    valorOperadorCentavos: cents('valor_operador_centavos').notNull(),

    /** Snapshot: taxa vigente no momento do pedido. Caso de borda 17. */
    taxaConvenienciaBpsSnapshot: bps('taxa_conveniencia_bps_snapshot').notNull(),
    comissaoBpsSnapshot: bps('comissao_bps_snapshot').notNull(),
    taxaFixaCentavosSnapshot: cents('taxa_fixa_centavos_snapshot').notNull().default(0),

    cupomId: uuid('cupom_id').references(() => coupons.id, { onDelete: 'set null' }),

    /** Escolhido no checkout; nulo enquanto o comprador não decidiu. */
    metodo: paymentMethodEnum('metodo'),
    parcelas: integer('parcelas'),

    /**
     * Canal da venda. Boa parte do faturamento de casa noturna entra na
     * bilheteria física; se o sistema não registra, o contador de público, o
     * relatório do ECAD e o painel do produtor ficam todos errados.
     */
    canal: salesChannelEnum('canal').notNull().default('online'),
    /** Venda na porta: o dinheiro já está com a casa e NÃO entra no split. */
    metodoExterno: externalPaymentEnum('metodo_externo'),
    pdvOperadorId: uuid('pdv_operador_id').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),

    // Origem da venda, para o produtor medir campanha.
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    utmTerm: text('utm_term'),

    status: orderStatusEnum('status').notNull().default('draft'),
    providerTransactionId: text('provider_transaction_id'),
    idempotencyKey: text('idempotency_key').notNull(),

    expiresEm: timestamp('expires_em', { withTimezone: true }),
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('orders_tenant_numero_key').on(t.tenantId, t.numero),
    uniqueIndex('orders_idempotency_key').on(t.idempotencyKey),
    uniqueIndex('orders_provider_transaction_key').on(t.providerTransactionId),
    index('orders_event_status_idx').on(t.eventId, t.status),
    index('orders_tenant_idx').on(t.tenantId),
    index('orders_cpf_idx').on(t.eventId, t.compradorCpf),
    index('orders_canal_idx').on(t.eventId, t.canal),
    index('orders_utm_idx').on(t.eventId, t.utmSource),
    index('orders_expires_idx').on(t.expiresEm).where(sql`status = 'awaiting_payment'`),
    check('orders_subtotal_ck', sql`${t.subtotalCentavos} >= 0`),
    check('orders_conveniencia_ck', sql`${t.convenienciaCentavos} >= 0`),
    check('orders_desconto_ck', sql`${t.descontoCentavos} >= 0`),
    check('orders_total_ck', sql`${t.totalCentavos} >= 0`),
    // O split tem que fechar com o total. Invariante de dinheiro no banco.
    check(
      'orders_split_ck',
      sql`${t.valorProdutorCentavos} + ${t.valorOperadorCentavos} = ${t.totalCentavos}`,
    ),
    check(
      'orders_total_composicao_ck',
      sql`${t.totalCentavos} = ${t.subtotalCentavos} + ${t.convenienciaCentavos} - ${t.descontoCentavos}`,
    ),
    check('orders_parcelas_ck', sql`${t.parcelas} is null or ${t.parcelas} between 1 and 12`),
    // Venda de PDV não tem transação na PSP; venda online não tem método externo.
    check(
      'orders_canal_ck',
      sql`(${t.canal} = 'online' and ${t.metodoExterno} is null)
          or (${t.canal} <> 'online' and ${t.providerTransactionId} is null)`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'restrict' }),
    quantidade: integer('quantidade').notNull(),
    /** Preço congelado no momento da compra. */
    precoUnitarioCentavosSnapshot: cents('preco_unitario_centavos_snapshot').notNull(),
    ...timestamps,
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    check('order_items_quantidade_ck', sql`${t.quantidade} > 0`),
    check('order_items_preco_ck', sql`${t.precoUnitarioCentavosSnapshot} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// reservations — ADR-001 e ADR-003
// ---------------------------------------------------------------------------

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    quantidade: integer('quantidade').notNull(),
    expiresEm: timestamp('expires_em', { withTimezone: true }).notNull(),

    /**
     * ADR-003: esta linha é o token de uso único da operação de estoque.
     * Confirmação e expiração só mexem no contador se conseguirem virar
     * `liberada` de false para true.
     */
    liberada: boolean('liberada').notNull().default(false),
    liberadaEm: timestamp('liberada_em', { withTimezone: true }),
    liberadaMotivo: reservationReleaseReasonEnum('liberada_motivo'),
    ...timestamps,
  },
  (t) => [
    index('reservations_expires_idx').on(t.expiresEm).where(sql`liberada = false`),
    index('reservations_order_idx').on(t.orderId),
    index('reservations_ticket_type_idx').on(t.ticketTypeId),
    check('reservations_quantidade_ck', sql`${t.quantidade} > 0`),
    check(
      'reservations_liberada_ck',
      sql`(${t.liberada} = false and ${t.liberadaEm} is null and ${t.liberadaMotivo} is null)
          or (${t.liberada} = true and ${t.liberadaEm} is not null and ${t.liberadaMotivo} is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// tickets
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),

    /** Curto e legível, para busca manual na porta. Ex.: `7KQ2-4M9X`. */
    codigo: text('codigo').notNull(),
    /** SHA-256 do token HMAC do QR. O token cru nunca é persistido. */
    tokenHash: text('token_hash').notNull(),

    titularNome: text('titular_nome').notNull(),
    titularCpf: text('titular_cpf'),
    titularEmail: text('titular_email'),

    status: ticketStatusEnum('status').notNull().default('valido'),
    checkedInEm: timestamp('checked_in_em', { withTimezone: true }),
    checkedInBy: uuid('checked_in_by').references(() => users.id, { onDelete: 'set null' }),
    checkedInDeviceId: text('checked_in_device_id'),
    documentoConferido: boolean('documento_conferido').notNull().default(false),

    transferidoDeTicketId: uuid('transferido_de_ticket_id').references(
      (): AnyPgColumn => tickets.id,
      { onDelete: 'set null' },
    ),
    transferenciasCount: integer('transferencias_count').notNull().default(0),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoMotivo: text('cancelado_motivo'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tickets_codigo_key').on(t.codigo),
    uniqueIndex('tickets_token_hash_key').on(t.tokenHash),
    index('tickets_event_status_idx').on(t.eventId, t.status),
    index('tickets_order_idx').on(t.orderId),
    index('tickets_titular_cpf_idx').on(t.eventId, t.titularCpf),
    check('tickets_transferencias_ck', sql`${t.transferenciasCount} >= 0`),
    check(
      'tickets_checkin_ck',
      sql`(${t.status} <> 'usado') or (${t.checkedInEm} is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Financeiro: payouts, refunds, chargebacks
// ---------------------------------------------------------------------------

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    tranche: payoutTrancheEnum('tranche').notNull(),
    /** Repasse é calculado por meio de pagamento (plano, seção 3.5). */
    metodo: paymentMethodEnum('metodo').notNull(),

    brutoCentavos: cents('bruto_centavos').notNull(),
    reembolsosCentavos: cents('reembolsos_centavos').notNull().default(0),
    chargebacksCentavos: cents('chargebacks_centavos').notNull().default(0),
    comissaoCentavos: cents('comissao_centavos').notNull().default(0),
    retidoCentavos: cents('retido_centavos').notNull().default(0),
    liberadoCentavos: cents('liberado_centavos').notNull().default(0),

    status: payoutStatusEnum('status').notNull().default('scheduled'),
    dataPrevista: timestamp('data_prevista', { withTimezone: true }).notNull(),
    dataEfetiva: timestamp('data_efetiva', { withTimezone: true }),
    providerPayoutId: text('provider_payout_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    ultimoErro: text('ultimo_erro'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payouts_idempotency_key').on(t.idempotencyKey),
    uniqueIndex('payouts_event_tranche_metodo_key').on(t.eventId, t.tranche, t.metodo),
    index('payouts_status_data_idx').on(t.status, t.dataPrevista),
    index('payouts_tenant_idx').on(t.tenantId),
    check('payouts_bruto_ck', sql`${t.brutoCentavos} >= 0`),
    check('payouts_retido_ck', sql`${t.retidoCentavos} >= 0`),
    // Saldo a descoberto (caso de borda 5) é negativo e precisa ser representável.
    check('payouts_liberado_ck', sql`${t.liberadoCentavos} is not null`),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    /**
     * Reembolso por INGRESSO, não só por pedido — benchmark, seção 2.2.
     * Nulo = reembolso do pedido inteiro. É onde discordamos da Sympla: quem
     * compra 4 e precisa devolver 1 não pode ficar preso.
     */
    ticketId: uuid('ticket_id').references((): AnyPgColumn => tickets.id, {
      onDelete: 'set null',
    }),
    motivo: refundReasonEnum('motivo').notNull(),
    /**
     * Enquadramento do reembolso. Decide se a comissão do operador volta
     * junto — benchmark, seção 2.3.
     */
    tipo: refundTypeEnum('tipo').notNull().default('politica_evento'),
    /** True na desistência dentro dos 7 dias: devolve 100%, taxa incluída. */
    incluiConveniencia: boolean('inclui_conveniencia').notNull().default(false),
    observacao: text('observacao'),
    valorCentavos: cents('valor_centavos').notNull(),
    status: refundStatusEnum('status').notNull().default('requested'),
    providerRefundId: text('provider_refund_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    solicitadoPor: uuid('solicitado_por').references(() => users.id, { onDelete: 'set null' }),
    solicitadoEm: timestamp('solicitado_em', { withTimezone: true }).notNull().defaultNow(),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    ultimoErro: text('ultimo_erro'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('refunds_idempotency_key').on(t.idempotencyKey),
    index('refunds_order_idx').on(t.orderId),
    index('refunds_ticket_idx').on(t.ticketId),
    index('refunds_status_idx').on(t.status),
    check('refunds_valor_ck', sql`${t.valorCentavos} > 0`),
  ],
);

export const chargebacks = pgTable(
  'chargebacks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    valorCentavos: cents('valor_centavos').notNull(),
    status: chargebackStatusEnum('status').notNull().default('aberto'),
    providerDisputeId: text('provider_dispute_id'),
    abertoEm: timestamp('aberto_em', { withTimezone: true }).notNull().defaultNow(),
    resolvidoEm: timestamp('resolvido_em', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('chargebacks_provider_dispute_key').on(t.providerDisputeId),
    index('chargebacks_order_idx').on(t.orderId),
    index('chargebacks_tenant_idx').on(t.tenantId),
    check('chargebacks_valor_ck', sql`${t.valorCentavos} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Infraestrutura: webhooks, jobs, auditoria
// ---------------------------------------------------------------------------

/**
 * A unique em `provider_event_id` é o que impede pagamento processado duas
 * vezes. Tabela sem `tenant_id`: chega antes de sabermos o tenant, e é lida
 * apenas pela role de serviço.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    tipo: text('tipo').notNull(),
    /** Corpo cru, exatamente como recebido. A assinatura é sobre bytes. */
    payloadRaw: text('payload_raw').notNull(),
    headers: jsonb('headers'),
    assinaturaValida: boolean('assinatura_valida').notNull(),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
    processadoEm: timestamp('processado_em', { withTimezone: true }),
    erro: text('erro'),
    tentativas: integer('tentativas').notNull().default(0),
  },
  (t) => [
    uniqueIndex('webhook_events_provider_event_key').on(t.provider, t.providerEventId),
    index('webhook_events_pendentes_idx')
      .on(t.recebidoEm)
      .where(sql`processado_em is null`),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nome: text('nome').notNull(),
    /** Nulo para jobs de plataforma. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    /** Deduplica enfileiramento: mesmo trabalho não entra duas vezes. */
    dedupeKey: text('dedupe_key'),
    status: jobStatusEnum('status').notNull().default('pending'),
    tentativas: integer('tentativas').notNull().default(0),
    maxTentativas: integer('max_tentativas').notNull().default(5),
    proximaTentativaEm: timestamp('proxima_tentativa_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ultimoErro: text('ultimo_erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('jobs_dedupe_key').on(t.dedupeKey),
    index('jobs_fila_idx')
      .on(t.proximaTentativaEm)
      .where(sql`status in ('pending', 'failed')`),
    check('jobs_tentativas_ck', sql`${t.tentativas} >= 0`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Nulo para ação de plataforma que não pertence a um tenant. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    acao: text('acao').notNull(),
    entidade: text('entidade').notNull(),
    entidadeId: uuid('entidade_id'),
    antes: jsonb('antes'),
    depois: jsonb('depois'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tenant_idx').on(t.tenantId, t.criadoEm),
    index('audit_log_entidade_idx').on(t.entidade, t.entidadeId),
  ],
);

// ---------------------------------------------------------------------------
// Acesso do comprador — benchmark, seção 3
// ---------------------------------------------------------------------------

/**
 * Link mágico. O comprador NUNCA cria senha: compra sem conta e depois acessa
 * os ingressos por token enviado ao e-mail da compra.
 *
 * Sem `tenant_id` de propósito: o mesmo e-mail compra de vários produtores, e
 * a área do comprador mostra tudo. A tabela é lida só pela role de serviço.
 */
export const buyerAccessTokens = pgTable(
  'buyer_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /** SHA-256 do token do link. O token cru só existe dentro do e-mail. */
    tokenHash: text('token_hash').notNull(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    /** Uso único: preenchido na primeira troca por sessão. */
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('buyer_access_tokens_hash_key').on(t.tokenHash),
    index('buyer_access_tokens_email_idx').on(sql`lower(${t.email})`),
    index('buyer_access_tokens_expira_idx').on(t.expiraEm).where(sql`usado_em is null`),
  ],
);

// ---------------------------------------------------------------------------
// Rateio entre sócios do evento
// ---------------------------------------------------------------------------

/**
 * O contrato `PaymentProvider` aceita N recebedores por transação, não apenas
 * dois. Isso permite dividir automaticamente entre a casa, o produtor parceiro
 * e o artista, na hora da venda — sem ninguém precisar confiar em ninguém para
 * repassar depois. É argumento comercial forte, e o mercado não faz bem.
 *
 * A soma dos `participacaoBps` das linhas ativas de um evento deve dar 10000.
 * Validado na aplicação: o Postgres não checa invariante entre linhas.
 */
export const eventSplits = pgTable(
  'event_splits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    providerRecipientId: text('provider_recipient_id').notNull(),
    /** Fatia da parcela do produtor, em basis points. */
    participacaoBps: bps('participacao_bps').notNull(),
    /** Quem arca com chargeback e reembolso desta fatia. */
    arcaComEstorno: boolean('arca_com_estorno').notNull().default(true),
    ordem: integer('ordem').notNull().default(0),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('event_splits_event_recipient_key').on(t.eventId, t.providerRecipientId),
    index('event_splits_tenant_idx').on(t.tenantId),
    check('event_splits_participacao_ck', sql`${t.participacaoBps} between 0 and 10000`),
  ],
);

// ---------------------------------------------------------------------------
// Lista de convidados
// ---------------------------------------------------------------------------

/**
 * Em casa noturna a lista VIP é parte do negócio: o promoter coloca nomes, a
 * pessoa chega e entra. Sem isso no sistema, a lista continua no papel ou no
 * WhatsApp — e o controle de portaria falha exatamente onde mais importa.
 */
export const guestLists = pgTable(
  'guest_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    promoterNome: text('promoter_nome'),
    promoterUserId: uuid('promoter_user_id').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    /** Teto de nomes. A lista não pode furar a capacidade do evento. */
    cota: integer('cota').notNull(),
    /** Tipo de ingresso emitido na entrada. */
    ticketTypeId: uuid('ticket_type_id').references((): AnyPgColumn => ticketTypes.id, {
      onDelete: 'set null',
    }),
    /** Depois deste horário a lista não vale mais. */
    validoAte: timestamp('valido_ate', { withTimezone: true }),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('guest_lists_event_idx').on(t.eventId),
    index('guest_lists_tenant_idx').on(t.tenantId),
    check('guest_lists_cota_ck', sql`${t.cota} >= 0`),
  ],
);

export const guestListEntries = pgTable(
  'guest_list_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    guestListId: uuid('guest_list_id')
      .notNull()
      .references(() => guestLists.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    cpf: text('cpf'),
    telefone: text('telefone'),
    tipo: guestEntryTypeEnum('tipo').notNull().default('cortesia'),
    /** Ingresso emitido quando a pessoa chega. Nulo até a entrada. */
    ticketId: uuid('ticket_id').references((): AnyPgColumn => tickets.id, {
      onDelete: 'set null',
    }),
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    checkedInBy: uuid('checked_in_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    index('guest_list_entries_lista_idx').on(t.guestListId),
    index('guest_list_entries_event_idx').on(t.eventId),
    // Busca por nome na porta é o caso de uso principal desta tabela.
    index('guest_list_entries_nome_idx').on(t.eventId, sql`lower(${t.nome})`),
  ],
);

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type TicketType = typeof ticketTypes.$inferSelect;
export type NewTicketType = typeof ticketTypes.$inferInsert;
export type Coupon = typeof coupons.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type Payout = typeof payouts.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type Chargeback = typeof chargebacks.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type BuyerAccessToken = typeof buyerAccessTokens.$inferSelect;
export type EventSplit = typeof eventSplits.$inferSelect;
export type GuestList = typeof guestLists.$inferSelect;
export type GuestListEntry = typeof guestListEntries.$inferSelect;

/** Tabelas sujeitas a RLS por tenant. Usado pelo teste de isolamento. */
export const TENANT_SCOPED_TABLES = [
  'venues',
  'events',
  'ticket_types',
  'coupons',
  'orders',
  'order_items',
  'reservations',
  'tickets',
  'payouts',
  'refunds',
  'chargebacks',
  'memberships',
  'event_splits',
  'guest_lists',
  'guest_list_entries',
] as const;
