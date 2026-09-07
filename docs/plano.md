# Projeto Tiqueteira — Plano de Execução

Plataforma de venda de ingressos multi-tenant, integrada ao dashboard existente do grupo de espaços de eventos, para que os produtores clientes operem a venda dos próprios eventos.

Este documento é a especificação de trabalho. Ele vive em `/docs/plano.md` no repositório e é referenciado nos prompts do Claude Code.

---

## Índice

1. [Sumário executivo e decisões pendentes](#1-sumário-executivo-e-decisões-pendentes)
2. [Modelo de negócio e papéis](#2-modelo-de-negócio-e-papéis)
3. [A questão do dinheiro](#3-a-questão-do-dinheiro)
4. [Requisitos legais, fiscais e de compliance](#4-requisitos-legais-fiscais-e-de-compliance)
5. [Arquitetura técnica](#5-arquitetura-técnica)
6. [Estrutura do repositório](#6-estrutura-do-repositório)
7. [Modelo de dados](#7-modelo-de-dados)
8. [Máquinas de estado](#8-máquinas-de-estado)
9. [Contrato PaymentProvider](#9-contrato-paymentprovider)
10. [Concorrência e controle de estoque](#10-concorrência-e-controle-de-estoque)
11. [Webhooks](#11-webhooks)
12. [Fluxos críticos](#12-fluxos-críticos)
13. [Superfície de API e rotas](#13-superfície-de-api-e-rotas)
14. [Segurança](#14-segurança)
15. [Variáveis de ambiente](#15-variáveis-de-ambiente)
16. [Plano de testes](#16-plano-de-testes)
17. [Observabilidade e operação](#17-observabilidade-e-operação)
18. [Catálogo de casos de borda](#18-catálogo-de-casos-de-borda)
19. [Roadmap por fases com Definition of Done](#19-roadmap-por-fases-com-definition-of-done)
20. [Biblioteca de prompts para o Claude Code](#20-biblioteca-de-prompts-para-o-claude-code)
21. [CLAUDE.md](#21-claudemd)
22. [Checklist pré-start](#22-checklist-pré-start)
23. [Jornada operacional: venda, portaria e transferência](#23-jornada-operacional-venda-portaria-e-transferência)
24. [Segurança do ingresso: o que o QR resolve e o que não resolve](#24-segurança-do-ingresso-o-que-o-qr-resolve-e-o-que-não-resolve)
25. [Fontes oficiais consultadas](#25-fontes-oficiais-consultadas)

---

## 1. Sumário executivo e decisões pendentes

| Item | Definição |
|---|---|
| Modelo de negócio | Marketplace de ingressos multi-tenant. O grupo é o operador; cada produtor é um vendedor. |
| Custódia do dinheiro | **Não custodiar.** Split de pagamento em PSP licenciada, com retenção até o pós-evento. |
| Meios de pagamento | Pix (principal) e cartão de crédito com parcelamento. |
| Stack | Next.js App Router + TypeScript + Postgres (Supabase) + Drizzle + Tailwind, na Vercel. |
| Estratégia de construção | Interface `PaymentProvider` com `FakeProvider` primeiro; adaptador real depois. |
| Fase 1 (MVP) | Evento, lote, Pix, ingresso com QR, check-in por PWA. |

**Cinco decisões de negócio que ainda precisam ser fechadas.** Nenhuma delas bloqueia o início do código, mas todas bloqueiam o go-live.

1. Qual CNPJ do grupo será o operador da plataforma (Super Festas, Hey Hey, Wow Club ou uma sociedade veículo nova).
2. Qual PSP será usada. Bloqueia apenas o adaptador real, não o resto.
3. Quem responde pelo reembolso em caso de cancelamento do evento: o produtor ou o grupo.
4. Modelo de receita: taxa de conveniência sobre o comprador, comissão sobre o produtor, ou os dois.
5. Ingresso nominal (com CPF do titular) ou ao portador.

**Regra de ouro do projeto:** taxa é dado, não arquitetura. Nenhum percentual entra no código como constante.

---

## 2. Modelo de negócio e papéis

**Atores:**

- **Operador da plataforma** — a empresa do grupo. Fornece a tecnologia, define regras, cobra taxa.
- **Produtor / organizador** — cliente do grupo. Cadastra evento, define lotes e preços, recebe o líquido.
- **Comprador** — consumidor final. Relação de consumo regida pelo CDC (Código de Defesa do Consumidor).
- **Portaria / staff** — valida ingressos na entrada. Acesso restrito, por evento.
- **Espaço** — o local (Complexo Jussara, Espaço Solon, Fabrique, Usine, House Pacaembu, KIKI). Tem capacidade e alvará próprios.

**Multi-tenancy:** cada produtor é um *tenant*. Todo registro carrega `tenant_id`. Isolamento por Row Level Security no banco, nunca apenas por filtro na aplicação.

**Receita do operador — três alavancas, todas configuráveis por tenant:**

| Alavanca | Como funciona | Observação |
|---|---|---|
| Taxa de conveniência | Percentual somado ao preço, pago pelo comprador | Exibição destacada obrigatória no checkout |
| Comissão | Percentual descontado do produtor no split | Invisível ao comprador |
| Taxa fixa por ingresso | Valor fixo por ingresso emitido | Viabiliza evento gratuito ou de ticket baixo |

Padrão de mercado: 8% a 12% de conveniência. Comece com um número e deixe configurável desde a primeira migration.

---

## 3. A questão do dinheiro

### 3.1. Modelo A — Custódia própria (NÃO recomendado)

O comprador paga em conta bancária do grupo; depois do evento o grupo transfere ao produtor.

- **Risco regulatório.** Receber recursos de terceiros, mantê-los em conta própria e repassá-los depois é, na prática, atividade de instituição de pagamento. A Resolução BCB nº 80/2021 disciplina a constituição e o funcionamento das instituições de pagamento e fixa parâmetros de volumetria a partir dos quais a autorização do Banco Central passa a ser obrigatória. O ambiente vem apertando: em apresentação à Comissão de Assuntos Econômicos do Senado (19/05/2026), o Banco Central registrou que o prazo final para instituições de pagamento não autorizadas solicitarem autorização de funcionamento foi antecipado de dezembro de 2029 para maio de 2026.
- **Risco tributário.** Se o bruto transita pela receita do grupo, há exposição a tributação sobre o bruto e não sobre a comissão. A diferença entre tributar R$ 100.000 e tributar R$ 10.000 de comissão é o próprio negócio.
- **Risco contábil.** Dinheiro de terceiro misturado ao caixa próprio.
- **Risco operacional.** Conciliação manual, chargeback sem lastro, reembolso sem automação.

### 3.2. Modelo B — Conta escrow bancária

Conta garantia formal, contrato de três pontas com o banco. Juridicamente limpo, mas caro por conta, lento de abrir e não escala para dezenas de produtores. Serve para um evento único de valor muito alto, não como arquitetura da plataforma.

### 3.3. Modelo C — Split em PSP licenciada (ADOTADO)

O dinheiro nunca passa pela conta do grupo:

1. O produtor faz onboarding na PSP através da plataforma (KYC/KYB). A PSP cria um **recebedor** (subconta).
2. O comprador paga. O recurso entra na PSP.
3. Na própria transação a PSP aplica a **regra de split**: parcela do operador (comissão + conveniência) e parcela do produtor.
4. O saldo do produtor fica **retido** até a data configurada.
5. Após o evento e vencida a retenção, o saldo é liberado e o produtor saca.

Resolve de uma vez: enquadramento regulatório, tributação correta (o operador emite nota só sobre a comissão), repasse automático, chargeback debitado do recebedor certo e trilha de auditoria por transação.

### 3.4. Cronograma de repasse

| Momento | O que acontece |
|---|---|
| D0 (venda) | Split aplicado. Parcela do operador conforme regra da PSP. Saldo do produtor retido. |
| Até 7 dias da compra | Janela de arrependimento (CDC, art. 49). Reembolso integral automatizado. |
| Até 48h antes do evento | Cancelamento pelo comprador, se a política do produtor permitir. |
| Evento + 2 dias úteis | Libera 70% a 90% do saldo do produtor. |
| Evento + 30 a 45 dias | Libera a reserva de garantia, descontados chargebacks e reembolsos. |

A reserva de garantia é o item mais esquecido e o mais importante. Chargeback de cartão chega meses depois. **Nunca liberar 100% antes de vencida a janela de contestação.**

Adiantamento de repasse é boa linha de receita futura, mas é crédito — fora do escopo.

### 3.5. Pix versus cartão

| | Pix | Cartão |
|---|---|---|
| Custo | Muito baixo | 2,5% a 5% mais antecipação |
| Chargeback | Não existe | Existe, até ~180 dias |
| Parcelamento | Não | Sim — eleva ticket médio |
| Risco de repasse | Baixíssimo | Alto |

Consequência de arquitetura: **o repasse é calculado por meio de pagamento, não sobre o total.** Duas reservas distintas, dois prazos distintos. Isso é campo no modelo de dados, não regra de negócio improvisada.

### 3.6. Cancelamento de evento

- Se o produtor cancela, a obrigação de devolver é dele. O saldo retido é a garantia; se não cobrir, há saldo a descoberto — daí a reserva.
- Reembolso em massa precisa ser função do sistema, com fila e retentativa.
- Devolver a taxa de conveniência é a posição mais segura frente ao CDC. Definir em contrato.
- Adiamento não é cancelamento: o ingresso migra para a nova data, com opção de reembolso para quem não puder.

---

## 4. Requisitos legais, fiscais e de compliance

A validar antes do lançamento e a refletir no produto, não só no contrato:

1. **Meia-entrada** — Lei nº 12.933/2013. Cota de 40% do total, com conferência de documento na portaria. Exige tipo de ingresso, cota e validação.
2. **Gratuidades legais** — idoso, PCD e acompanhante. Não consomem a cota de meia-entrada.
3. **Direito de arrependimento** — CDC, art. 49: 7 dias na compra online.
4. **Transparência da taxa de conveniência** — exibição destacada; há histórico de autuação de Procon por taxa embutida.
5. **Nota fiscal** — NFS-e do operador sobre a comissão/conveniência (ISS no município). Cada produtor responde pelo próprio faturamento.
6. **LGPD** — Lei nº 13.709/2018. Definir em contrato quem é controlador e quem é operador dos dados do comprador. Base legal, política de privacidade, prazo de retenção e canal do titular. Repassar a base de compradores ao produtor é compartilhamento e precisa estar previsto.
7. **ECAD** — obrigação do produtor/espaço, mas o relatório de bilheteria da plataforma é o documento do cálculo. Gerar esse relatório é diferencial comercial.
8. **Alvará, AVCB e capacidade** — a capacidade do espaço é teto rígido no sistema, não sugestão.
9. **Termos em três camadas** — plataforma–produtor, plataforma–comprador, política de reembolso por evento.
10. **Antifraude e revenda** — ingresso nominal com CPF e transferência controlada dentro da plataforma.

> Conferir cada item na fonte oficial vigente (Planalto, legislação municipal de ISS, ANPD) antes do go-live. Esta é pauta de verificação, não parecer fechado.

---

## 5. Arquitetura técnica

```
┌──────────────────────────────────────────────────────┐
│  Next.js App Router (Vercel)                         │
│  ├── (public)   loja, evento, checkout               │
│  ├── (produtor) painel do tenant                     │
│  ├── (admin)    operador — integra ao dashboard      │
│  ├── (portaria) PWA de check-in, offline-first       │
│  └── /api       webhooks, jobs, endpoints internos   │
└───────────────┬──────────────────────────────────────┘
                │
   ┌────────────┼──────────────┬───────────────┐
   │            │              │               │
┌──▼───────┐ ┌──▼──────────┐ ┌─▼───────────┐ ┌─▼────────┐
│ Postgres │ │ PaymentProv │ │ Fila (jobs) │ │  n8n     │
│ Supabase │ │ Fake → PSP  │ │ Inngest ou  │ │ e-mail,  │
│ + RLS    │ │ real        │ │ tabela jobs │ │ WhatsApp │
└──────────┘ └─────────────┘ └─────────────┘ └──────────┘
```

**Decisões e por quê:**

- **Next.js na Vercel** — já é o stack do grupo; o dashboard existente pode virar módulo ou consumir a mesma API.
- **Postgres com RLS** — em multi-tenant, filtro só na aplicação vaza mais cedo ou mais tarde.
- **Drizzle ORM** — schema em TypeScript, migrations versionadas, SQL previsível. Bom para o Claude Code, que erra menos com tipagem explícita.
- **Webhook como fonte da verdade do pagamento.** Nunca confirmar pedido pelo retorno do frontend.
- **Fila para tarefas críticas** — emissão e reembolso em massa, e-mails. Serverless tem timeout; use Inngest, QStash ou tabela `jobs` com worker.
- **n8n só para o não crítico** — notificações, relatórios, conciliação diária. Fluxo de pagamento não passa pelo n8n.

**Segurança do ingresso:**

- O QR carrega token assinado (HMAC-SHA256 com segredo do servidor), não o ID em texto puro.
- Validação idempotente por ingresso: a segunda leitura acusa duplicidade, com horário e operador da primeira.
- Portaria funciona offline: baixa manifesto assinado antes do evento, valida local, sincroniza depois.
- Rate limit no checkout e reserva com TTL, contra bot esgotando estoque.

---

## 6. Estrutura do repositório

```
tiqueteira/
├── CLAUDE.md
├── docs/
│   ├── plano.md                  ← este documento
│   ├── decisoes.md               ← ADRs curtos, uma decisão por entrada
│   └── psp-avaliacao.md          ← resultado do spike de sandbox
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── [tenantSlug]/page.tsx
│   │   │   ├── e/[eventSlug]/page.tsx
│   │   │   └── checkout/[orderId]/page.tsx
│   │   ├── (produtor)/painel/...
│   │   ├── (admin)/admin/...
│   │   ├── (portaria)/portaria/[eventId]/...
│   │   └── api/
│   │       ├── webhooks/payments/route.ts
│   │       ├── jobs/[name]/route.ts
│   │       └── portaria/manifest/[eventId]/route.ts
│   ├── db/
│   │   ├── schema.ts
│   │   ├── migrations/
│   │   └── rls.sql
│   ├── lib/
│   │   ├── payments/
│   │   │   ├── types.ts          ← contrato
│   │   │   ├── provider.ts       ← factory + registry
│   │   │   ├── fake.ts           ← FakeProvider
│   │   │   └── <psp>.ts          ← adaptador real
│   │   ├── money.ts              ← aritmética em centavos
│   │   ├── fees.ts               ← cálculo de taxas e split
│   │   ├── tickets.ts            ← emissão, HMAC, validação
│   │   ├── payouts.ts            ← motor de repasse
│   │   └── auth.ts
│   ├── domain/                   ← regras puras, sem I/O
│   │   ├── order.ts
│   │   ├── inventory.ts
│   │   └── payout.ts
│   └── jobs/
│       ├── expire-reservations.ts
│       ├── settle-event.ts
│       ├── release-reserve.ts
│       └── mass-refund.ts
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

Regra: `src/domain/` não importa nada de I/O. Regra de negócio testável sem banco e sem rede.

---

## 7. Modelo de dados

Convenções: identificadores `uuid`; valores monetários `integer` em **centavos**; timestamps `timestamptz` em UTC; toda tabela de negócio tem `tenant_id`, `created_at`, `updated_at`.

```
tenants
  id, slug (unique), nome, razao_social, cnpj, email, telefone,
  provider_recipient_id, kyc_status, status,
  taxa_conveniencia_pct, comissao_pct, taxa_fixa_centavos,
  reserva_pix_pct, reserva_cartao_pct,
  dias_liberacao_evento, dias_liberacao_reserva,
  dominio_customizado (nullable, unique), dominio_verificado

users
  id, email (unique), nome, senha_hash, status

memberships
  id, user_id, tenant_id, role (owner|admin|operador|portaria)
  -- um usuário pode servir vários tenants

venues
  id, tenant_id, nome, endereco, capacidade_maxima, observacoes

events
  id, tenant_id, venue_id, slug, titulo, descricao, imagem_url,
  data_inicio, data_fim, classificacao_etaria, capacidade,
  status, politica_reembolso, permite_cancelamento_ate_horas,
  ingresso_nominal, exige_documento_entrada,
  permite_transferencia, transferencia_ate_horas,
  max_transferencias_por_ingresso, taxa_transferencia_centavos,
  transferencia_permite_meia,
  settled_at
  UNIQUE (tenant_id, slug)

ticket_types
  id, tenant_id, event_id, nome, descricao,
  preco_centavos, tipo (inteira|meia|cortesia|pcd|idoso),
  quantidade_total, quantidade_vendida, quantidade_reservada,
  lote, ordem, vendas_inicio, vendas_fim,
  limite_por_pedido, limite_por_cpf, exige_documento, ativo
  CHECK (quantidade_vendida + quantidade_reservada <= quantidade_total)

reservations
  id, ticket_type_id, order_id, quantidade, expires_at
  INDEX (expires_at) WHERE liberada = false

orders
  id, tenant_id, event_id, numero (sequencial por tenant),
  comprador_nome, comprador_email, comprador_cpf, comprador_telefone,
  subtotal_centavos, conveniencia_centavos, desconto_centavos,
  total_centavos, valor_produtor_centavos, valor_operador_centavos,
  taxa_conveniencia_pct_snapshot, comissao_pct_snapshot,
  metodo (pix|credit_card), parcelas,
  status, provider_transaction_id, idempotency_key (unique),
  expires_at, paid_at, canceled_at, ip_address, user_agent

order_items
  id, order_id, ticket_type_id, quantidade,
  preco_unitario_centavos_snapshot

tickets
  id, tenant_id, order_id, ticket_type_id, event_id,
  codigo (unique, curto e legível), token_hash,
  titular_nome, titular_cpf, titular_email, status,
  checked_in_at, checked_in_by, checked_in_device_id,
  documento_conferido, transferido_de_ticket_id,
  transferencias_count

coupons
  id, tenant_id, event_id (nullable), codigo, tipo (pct|valor),
  valor, usos_maximos, usos_atuais, valido_ate, ativo
  UNIQUE (tenant_id, codigo)

payouts
  id, tenant_id, event_id, tranche (principal|reserva),
  metodo (pix|credit_card),
  bruto_centavos, reembolsos_centavos, chargebacks_centavos,
  comissao_centavos, retido_centavos, liberado_centavos,
  status, data_prevista, data_efetiva,
  provider_payout_id, idempotency_key (unique)

refunds
  id, tenant_id, order_id, motivo, valor_centavos,
  status, provider_refund_id, idempotency_key (unique),
  solicitado_por, solicitado_em, concluido_em

chargebacks
  id, tenant_id, order_id, valor_centavos, status,
  aberto_em, resolvido_em, provider_dispute_id

webhook_events
  id, provider, provider_event_id (UNIQUE), tipo,
  payload_raw, assinatura_valida, processado_em, erro
  -- esta unique é o que impede pagamento processado duas vezes

jobs
  id, nome, payload, status, tentativas, proxima_tentativa_em,
  ultimo_erro, criado_em, concluido_em

audit_log
  id, tenant_id, user_id, acao, entidade, entidade_id,
  antes (jsonb), depois (jsonb), ip, criado_em
```

**Índices que importam:** `orders(event_id, status)`, `orders(provider_transaction_id)`, `tickets(codigo)`, `tickets(event_id, status)`, `reservations(expires_at)`, `webhook_events(provider_event_id)`.

**RLS:** habilitar em todas as tabelas com `tenant_id`. Política padrão: `tenant_id = current_setting('app.tenant_id')::uuid`. A role de serviço (jobs e webhooks) usa bypass explícito e auditado.

> Correções aplicadas na implementação em relação ao rascunho acima estão registradas em `docs/decisoes.md` (ADR-001 a ADR-004): coluna `liberada` e `tenant_id` em `reservations`, guarda contra contador negativo na confirmação de estoque, e cota de meia-entrada no nível do evento.

---

## 8. Máquinas de estado

Transições fora destas tabelas são bug. Implementar como função pura em `src/domain/` e testar exaustivamente.

**Pedido (`orders.status`)**

```
draft ──▶ awaiting_payment ──▶ paid ──▶ partially_refunded ──▶ refunded
             │                   │
             ├──▶ expired        ├──▶ chargeback
             └──▶ canceled       └──▶ refunded
```

- `draft → awaiting_payment`: reserva de estoque criada, transação criada na PSP.
- `awaiting_payment → paid`: **somente por webhook verificado.**
- `awaiting_payment → expired`: TTL vencido; libera reserva.
- `paid → refunded`: reembolso total confirmado; cancela ingressos.
- `paid → chargeback`: contestação aberta; ingressos passam a `cancelado` e o valor entra no cálculo de reserva.

**Ingresso (`tickets.status`)**

```
valido ──▶ usado
   │
   ├───▶ cancelado        (reembolso, chargeback ou cancelamento do evento)
   └───▶ transferido      (gera novo ticket vinculado por transferido_de_ticket_id)
```

`usado` é terminal. Reverter exige ação de admin registrada no `audit_log`.

**Repasse (`payouts.status`)**

```
scheduled ──▶ processing ──▶ released
                  │
                  └───▶ failed ──▶ (retry) processing
```

**Reembolso (`refunds.status`)**

```
requested ──▶ processing ──▶ succeeded
                  │
                  └───▶ failed ──▶ (retry manual)
```

---

## 9. Contrato PaymentProvider

Este é o coração da estratégia: permite construir o sistema inteiro antes de escolher a PSP. Arquivo `src/lib/payments/types.ts`.

```ts
/** Valor monetário em centavos. SEMPRE inteiro. Nunca float. */
export type Cents = number;

export type PaymentMethod = 'pix' | 'credit_card';

/**
 * Capacidades variam entre PSPs. A aplicação consulta antes de assumir
 * comportamento. Se conditionalRelease for false, o motor de repasse
 * precisa de estratégia alternativa — e isso deve falhar ruidosamente
 * na inicialização, não em produção.
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
  bankCode: string;          // 3 dígitos
  branch: string;
  branchDigit?: string;
  account: string;
  accountDigit: string;
  accountType: 'checking' | 'savings';
  holderName: string;
  holderDocument: string;    // só dígitos
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
    street: string; number: string; complement?: string;
    neighborhood: string; city: string; state: string; zipCode: string;
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
 * Regra de split. A soma dos amounts DEVE ser igual ao total da transação.
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
    name: string; email: string; document: string;
    documentType: DocumentType; phone?: string;
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
  | 'pending' | 'authorized' | 'paid' | 'failed'
  | 'refunded' | 'partially_refunded'
  | 'chargeback' | 'expired' | 'canceled';

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
  | 'buyer_request' | 'event_canceled' | 'event_postponed'
  | 'duplicate' | 'fraud' | 'other';

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

export type NormalizedWebhookEvent = {
  /** Identificador único do evento na PSP. Chave de idempotência. */
  providerEventId: string;
  type:
    | 'transaction.paid' | 'transaction.failed' | 'transaction.expired'
    | 'transaction.refunded' | 'transaction.chargeback'
    | 'recipient.status_changed'
    | 'payout.completed' | 'payout.failed'
    | 'unknown';
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
  ) { super(message); }
}

export interface PaymentProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  // --- Recebedores ---
  createRecipient(input: RecipientInput): Promise<Recipient>;
  getRecipient(providerRecipientId: string): Promise<Recipient>;
  updateRecipientBankAccount(
    providerRecipientId: string, bankAccount: BankAccount,
  ): Promise<Recipient>;

  // --- Transações ---
  createTransaction(input: CreateTransactionInput): Promise<Transaction>;
  getTransaction(providerTransactionId: string): Promise<Transaction>;
  cancelTransaction(
    providerTransactionId: string, idempotencyKey: string,
  ): Promise<Transaction>;

  // --- Reembolso ---
  refund(input: RefundInput): Promise<RefundResult>;

  // --- Saldo e repasse ---
  getBalance(providerRecipientId: string): Promise<Balance>;
  releaseFunds(input: ReleaseFundsInput): Promise<ReleaseResult>;

  // --- Webhook ---
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;
  parseWebhook(rawBody: string): NormalizedWebhookEvent;
}
```

### 9.1. FakeProvider

Implementação em memória, determinística, para desenvolvimento e testes. Além do contrato, expõe métodos de controle de cenário (fora da interface):

```ts
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
```

O `FakeProvider` deve declarar `conditionalRelease: true` e manter saldos por recebedor, para que o motor de repasse seja exercitado de ponta a ponta.

### 9.2. Regras invioláveis do adaptador

1. O adaptador **traduz**, não decide. Cálculo de taxa e de split vive em `src/lib/fees.ts`.
2. Todo método que altera estado recebe `idempotencyKey` da aplicação.
3. `raw` sempre preenchido e persistido — é o que salva a conciliação.
4. Erro de rede e 5xx → `retryable: true`. Erro de validação e 4xx → `retryable: false`.
5. Na inicialização, a aplicação valida as `capabilities` contra o que o produto exige e falha se faltar algo.

---

## 10. Concorrência e controle de estoque

O ponto mais difícil do sistema. Dois compradores disputando o último ingresso não podem ambos vender.

**Estratégia: reserva com TTL e atualização atômica.**

```sql
-- Reserva. Uma única instrução, sem leitura prévia.
UPDATE ticket_types
   SET quantidade_reservada = quantidade_reservada + $2
 WHERE id = $1
   AND ativo = true
   AND now() BETWEEN vendas_inicio AND vendas_fim
   AND quantidade_vendida + quantidade_reservada + $2 <= quantidade_total
RETURNING id;
```

Se não retornar linha, não há estoque. Sem `SELECT` antes, sem race condition.

**Confirmação** (no processamento do webhook de pagamento):

```sql
UPDATE ticket_types
   SET quantidade_reservada = quantidade_reservada - $2,
       quantidade_vendida   = quantidade_vendida + $2
 WHERE id = $1;
```

> Ver ADR-003 em `docs/decisoes.md`: a confirmação real é feita a partir da linha de `reservations`, marcando-a como liberada de forma atômica, para que a reserva já expirada não decremente o contador uma segunda vez.

**Expiração:** job a cada minuto varre `reservations` com `expires_at < now()`, devolve estoque e marca o pedido como `expired`. TTL de 10 minutos para Pix, 5 para cartão.

**Regras adicionais:**

- Toda a operação de criar pedido roda em uma transação de banco. Falha na PSP → rollback da reserva.
- Limite por CPF verificado dentro da mesma transação, contando pedidos `paid` e `awaiting_payment`.
- Capacidade do venue é teto agregado: soma de `quantidade_total` dos tipos ativos não pode ultrapassá-la. Validar no cadastro, não na venda.
- Para eventos de alta demanda (Fase 4), fila virtual antes do checkout, com token de vez.

---

## 11. Webhooks

O handler é o componente mais crítico do sistema. Especificação:

1. Ler o **corpo cru** (`await req.text()`), antes de qualquer parse. Assinatura é calculada sobre bytes.
2. `verifyWebhook(rawBody, headers)`. Falhou → responder **401 e persistir** com `assinatura_valida = false`. Nunca processar.
3. `parseWebhook(rawBody)` → evento normalizado.
4. Inserir em `webhook_events` com `ON CONFLICT (provider_event_id) DO NOTHING`. Se não inseriu, é reentrega → responder **200 e sair**.
5. Processar dentro de transação de banco, com a máquina de estado. Transição inválida não é erro: registra e ignora (eventos chegam fora de ordem).
6. Responder **200 rápido**. Trabalho pesado (e-mail, PDF, emissão em massa) vai para a fila.
7. Erro inesperado → responder **500**, para a PSP reentregar. O registro fica com `erro` preenchido.

**Nunca:** confiar em ordem de chegada; usar o valor do webhook como verdade sem comparar com o pedido; confirmar pedido pelo retorno do frontend.

**Reconciliação diária:** job que varre pedidos `awaiting_payment` com mais de 24h e consulta `getTransaction` na PSP. Webhook perdido acontece; sem esse job, o pedido fica órfão.

---

## 12. Fluxos críticos

**Compra (Pix)**

```
1. Comprador seleciona ingressos
2. BEGIN
     valida janela de vendas, limite por pedido e por CPF
     reserva estoque (UPDATE atômico)
     calcula taxas → grava snapshot dos percentuais no pedido
     cria order (awaiting_payment, expires_at = now + 10min)
   COMMIT
3. provider.createTransaction({ idempotencyKey: order.id, splits })
4. Exibe QR Pix e inicia polling do status
5. Webhook transaction.paid
6. BEGIN
     order → paid; confirma estoque; emite tickets
   COMMIT
7. Enfileira: e-mail com QR + PDF
8. Se expirar: order → expired; devolve estoque
```

**Check-in**

```
1. Portaria autentica (papel restrito ao evento)
2. Baixa manifesto assinado (lista de token_hash válidos)
3. Lê QR → verifica HMAC local → confere no manifesto
4. Marca usado localmente com timestamp
5. Sincroniza em lote; conflito resolve pelo menor timestamp
6. Segunda leitura → alerta de duplicidade com hora e operador da primeira
```

**Repasse**

```
1. Evento termina → job settle-event (D+2 úteis)
2. Para cada método (pix, credit_card):
     bruto = soma dos pedidos pagos
     menos reembolsos, chargebacks e comissão
     retido = líquido × reserva_<metodo>_pct
     liberado = líquido − retido
3. Cria payouts (tranche principal) → status scheduled
4. Job dispara provider.releaseFunds na data prevista
5. Notifica produtor
6. Job release-reserve em D+30/45: recalcula descontando chargebacks
   posteriores e libera a tranche reserva
```

**Cancelamento de evento**

```
1. Admin ou produtor cancela, com justificativa (audit_log)
2. Evento → canceled; vendas encerradas
3. Enfileira reembolso de todos os pedidos pagos, em lotes
4. Cada refund é idempotente e retryable
5. Tickets → cancelado
6. Payouts scheduled não executados são cancelados
7. Relatório de saldo a descoberto, se houver
```

---

## 13. Superfície de API e rotas

**Públicas**

| Rota | Função |
|---|---|
| `GET /[tenantSlug]` | Vitrine do produtor |
| `GET /e/[eventSlug]` | Página do evento |
| `POST /api/orders` | Cria pedido e reserva |
| `GET /checkout/[orderId]` | Pagamento |
| `GET /api/orders/[id]/status` | Polling do status |
| `GET /ingresso/[codigo]` | Visualização do ingresso |
| `GET /meus-ingressos` | Área do comprador (login por magic link no e-mail da compra) |
| `POST /api/tickets/[id]/transfer` | Transferência de titularidade |

**Produtor** — `/painel/*`: eventos, tipos de ingresso, cupons, vendas, financeiro (repasses), relatórios, configurações e onboarding de recebedor.

**Admin** — `/admin/*`: tenants, aprovação de KYC, configuração de taxas por tenant, todos os pedidos, reembolso manual, repasses, fila de jobs, webhooks recebidos, `audit_log`.

**Portaria** — `/portaria/[eventId]`: scanner, busca manual por nome ou CPF, contador ao vivo, sincronização.

**Internas** — `POST /api/webhooks/payments`, `POST /api/jobs/[name]` (protegido por segredo), `GET /api/portaria/manifest/[eventId]`.

---

## 14. Segurança

- [ ] RLS ativa em todas as tabelas com `tenant_id`; teste automatizado que tenta ler dado de outro tenant e **espera falha**
- [ ] Toda entrada validada com Zod, inclusive parâmetros de rota
- [ ] Chaves da PSP apenas em variável de ambiente; produção só na Vercel
- [ ] PAN de cartão nunca no servidor — tokenização no cliente pelo SDK da PSP
- [ ] CPF armazenado com propósito declarado (LGPD) e mascarado na interface
- [ ] Rate limit: criação de pedido, login, validação de cupom, endpoint de manifesto
- [ ] Token do QR com HMAC-SHA256 e segredo rotacionável; guardar apenas o hash
- [ ] Papel de portaria com escopo restrito ao evento e expiração de sessão curta
- [ ] `audit_log` obrigatório em: reembolso, cancelamento, mudança de taxa, liberação de repasse, reversão de check-in
- [ ] Headers de segurança e CSP configurados
- [ ] Backup do banco com restauração testada, não apenas configurada

---

## 15. Variáveis de ambiente

```
DATABASE_URL=
DIRECT_URL=

AUTH_SECRET=
NEXT_PUBLIC_APP_URL=

# Pagamento
PAYMENT_PROVIDER=fake            # fake | <psp>
PAYMENT_API_KEY=
PAYMENT_WEBHOOK_SECRET=
PAYMENT_OPERATOR_RECIPIENT_ID=

# Ingressos
TICKET_HMAC_SECRET=
TICKET_HMAC_SECRET_PREVIOUS=     # rotação sem invalidar emitidos

# Jobs
JOB_SECRET=

# E-mail
RESEND_API_KEY=
MAIL_FROM=

# Observabilidade
SENTRY_DSN=
```

`PAYMENT_PROVIDER=fake` deve ser **recusado em produção** por checagem na inicialização.

---

## 16. Plano de testes

**Unitários** (`src/domain/`, sem I/O):

- Cálculo de taxa e split: soma das parcelas igual ao total, em todos os arredondamentos; centavo residual sempre para o operador, nunca perdido
- Máquinas de estado: toda transição válida e toda inválida
- Cálculo de repasse: com reembolso, com chargeback, por método, com reserva
- Aritmética monetária: ausência de float em qualquer caminho

**Integração** (banco real, `FakeProvider`):

- Reserva concorrente: 50 requisições simultâneas para 10 ingressos → exatamente 10 sucessos
- Webhook duplicado: mesmo `provider_event_id` duas vezes → um único pedido pago
- Webhook fora de ordem: `refunded` antes de `paid`
- Expiração de reserva devolve estoque
- Isolamento entre tenants sob RLS
- Reembolso parcial e depois total
- Chargeback após repasse principal reduz a tranche reserva

**E2E** (Playwright):

- Compra Pix completa, do evento ao e-mail com QR
- Compra com cartão parcelado
- Check-in válido, duplicado e inválido
- Cancelamento de evento com reembolso em massa
- Produtor vê o próprio repasse e não vê o de outro

**Regra:** todo bug de dinheiro ganha teste de regressão **antes** da correção.

---

## 17. Observabilidade e operação

- **Sentry** para exceções, com `tenant_id` e `order_id` no contexto.
- **Alertas obrigatórios:** webhook com assinatura inválida; job falhando 3 vezes; pedido `awaiting_payment` há mais de 24h; divergência entre soma dos splits e total; `releaseFunds` falhando.
- **Painel de saúde no admin:** fila de jobs, últimos webhooks, transações pendentes, próximos repasses.
- **Runbook** em `/docs/runbook.md` para: webhook não chegou, repasse falhou, evento cancelado às pressas, portaria sem internet, PSP fora do ar durante venda.
- **Conciliação diária:** relatório comparando pedidos pagos no banco com transações na PSP. Divergência gera alerta.

---

## 18. Catálogo de casos de borda

Cada item vira teste:

1. Pix pago **depois** da expiração da reserva → estoque já devolvido. Decisão: reembolsar automaticamente e notificar.
2. Dois webhooks `paid` para a mesma transação.
3. Webhook `refunded` sem `paid` anterior.
4. Comprador paga duas vezes o mesmo QR.
5. Chargeback após a liberação total do repasse → saldo a descoberto.
6. Produtor com KYC reprovado após ter vendas.
7. Evento com capacidade reduzida depois de vendas realizadas.
8. Cupom aplicado que zera o total → fluxo sem transação na PSP.
9. Ingresso transferido e depois reembolsado. **Decisão: o reembolso vai sempre para quem pagou** (o comprador original), nunca para o titular atual. Caso contrário vira porta de fraude. A interface deve avisar isso na tela de transferência.
10. Meia-entrada esgotada com inteira disponível.
11. Portaria offline por todo o evento; sincronização em massa no fim.
12. Mesmo QR lido em dois portões simultaneamente, ambos offline e sem rede local entre si — o furo clássico. Ver seção 24.
13. Evento adiado: ingresso migra, comprador pede reembolso mesmo assim.
14. PSP fora do ar durante pico de venda → fila de retentativa e mensagem honesta ao comprador.
15. Reembolso parcial de pedido com vários ingressos.
16. CPF com limite atingido tentando comprar em pedidos simultâneos.
17. Alteração de taxa entre a criação do pedido e o pagamento → vale o snapshot.
18. Fuso: evento que atravessa a virada do horário.

---

## 19. Roadmap por fases com Definition of Done

**Fase 0 — Fundação (1 semana)**
Repo, `CLAUDE.md`, schema completo, migrations, RLS, auth multi-tenant, seed com dados realistas, CI rodando lint e testes.
*DoD:* teste automatizado prova isolamento entre tenants; `pnpm test` verde; deploy de staging no ar.

**Fase 1 — MVP vendável (2 a 3 semanas)**
`FakeProvider`, cadastro de evento e tipos de ingresso, página pública, carrinho com reserva, checkout Pix, webhook idempotente, emissão de ingresso com QR, e-mail, painel de vendas, PWA de check-in online.
*DoD:* compra ponta a ponta com `FakeProvider`; teste de concorrência passando; check-in duplicado bloqueado.

**Fase 1.5 — Evento fantasma interno (1 a 2 dias)**
Antes de qualquer PSP real: criar um evento fictício, "vender" 50 ingressos para a equipe, imprimir e enviar os QRs, e fazer um check-in encenado no escritório — com celulares diferentes, um deles em modo avião, luz baixa e QR na tela e no papel.
*DoD:* lista escrita dos problemas encontrados (leitura no escuro, aparelho lento, fila, tela quebrada) e correções aplicadas. Esta fase não produz código novo; produz conhecimento operacional que muda o produto.

**Fase 2 — Financeiro completo (2 semanas)**
Adaptador da PSP real, cartão com parcelamento, onboarding de recebedor via API, motor de repasse com reserva por método, reembolso individual e em massa, conciliação diária.
*DoD:* venda real de R$ 1,00 em produção, com split e repasse conferidos no extrato da PSP.

**Fase 3 — Operação real (2 semanas)**
Check-in offline com sincronização por rede local, lotes e cupons, meia-entrada com cota, limite por CPF, ingresso nominal com conferência de documento, área do comprador e transferência de titularidade, relatórios (bilheteria, ECAD, curva de vendas), runbook.
*DoD:* um evento real do grupo operado inteiro na plataforma, incluindo ao menos uma transferência de titularidade e uma conferência de documento na porta.

**Fase 4 — Escala**
QR dinâmico rotativo, domínio customizado por produtor (CNAME), fila virtual, mapa de assentos, app nativo de portaria, adiantamento de repasse, integração com o dashboard existente, marketing (pixel, UTM, afiliados).

---

## 20. Biblioteca de prompts para o Claude Code

Um domínio por sessão. Nunca "constrói a tiqueteira". Sempre iniciar com: *"Leia `CLAUDE.md` e `docs/plano.md` antes de começar."*

**Fase 0**

1. "Crie o schema Drizzle completo conforme a seção 7 do plano, com todas as constraints, índices e o arquivo `db/rls.sql`. Gere as migrations. Não implemente lógica de negócio ainda."
2. "Implemente auth multi-tenant com `memberships` e papéis owner/admin/operador/portaria. Inclua o helper que define `app.tenant_id` na conexão. Escreva um teste que prove que um usuário do tenant A não lê dados do tenant B."
3. "Crie o seed com 2 tenants, 3 venues, 4 eventos em estados diferentes e 200 pedidos distribuídos entre os status."

**Fase 1**

4. "Implemente `src/lib/payments/types.ts` exatamente como a seção 9 do plano. Depois implemente `FakeProvider` com os controles de cenário descritos em 9.1. Testes primeiro."
5. "Implemente `src/lib/fees.ts`: cálculo de conveniência, comissão e montagem das `SplitRule`. A soma das parcelas deve bater com o total em todos os casos de arredondamento. Escreva testes de propriedade cobrindo valores de R$ 0,01 a R$ 10.000,00."
6. "Implemente `src/domain/order.ts` com a máquina de estado da seção 8, como função pura. Teste toda transição válida e inválida."
7. "Implemente a reserva de estoque conforme a seção 10, com o UPDATE atômico. Escreva o teste de concorrência: 50 requisições simultâneas para 10 ingressos, exatamente 10 sucessos."
8. "CRUD de eventos e tipos de ingresso no painel do produtor, com validação Zod e o teto de capacidade do venue."
9. "Página pública do evento e carrinho, com reserva com TTL e contagem regressiva."
10. "Checkout Pix usando `FakeProvider`: cria pedido, cria transação com split, exibe QR, faz polling."
11. "Route handler do webhook seguindo os 7 passos da seção 11. Testes primeiro, incluindo evento duplicado, assinatura inválida e evento fora de ordem."
12. "Emissão de ingresso: código curto legível, token HMAC-SHA256, geração de PDF e e-mail transacional. Guardar apenas o hash do token."
13. "PWA de check-in online: scanner, validação idempotente, contador ao vivo, busca manual por nome ou CPF."

**Fase 2**

14. "Implemente o adaptador `<PSP>` do `PaymentProvider`. Não altere a interface: se algo não couber, pare e me avise antes de adaptar o contrato. Declare as `capabilities` reais e adicione a checagem de inicialização."
15. "Motor de repasse em `src/lib/payouts.ts` conforme a seção 12: cálculo separado por método, reserva, tranches principal e reserva, agendamento. Testes cobrindo reembolso, chargeback e chargeback posterior ao repasse principal."
16. "Fluxo de reembolso individual e em massa, com fila, idempotência e retentativa exponencial."
17. "Job de conciliação diária comparando pedidos pagos com transações na PSP, com alerta em divergência."

**Fase 3**

18. "Check-in offline: manifesto assinado, cache local, validação sem rede, sincronização em lote com resolução de conflito pelo menor timestamp. Inclua sincronização entre aparelhos por rede local (WebRTC ou polling num aparelho eleito como servidor da sala), conforme a seção 24, para que dois portões offline não deixem passar o mesmo QR."
19. "Meia-entrada com cota de 40%, gratuidades que não consomem a cota, e conferência de documento na portaria."
20. "Relatórios: bilheteria, base para ECAD, curva de vendas, exportação CSV."
21. "Área do comprador com login por magic link e transferência de titularidade conforme a seção 23.3: cancela o ingresso original, emite novo com QR distinto, respeita prazo, limite de transferências e regra de meia-entrada. O reembolso continua vinculado a quem pagou — deixe isso explícito na interface e no teste."
22. "Conferência de documento na portaria para evento com `ingresso_nominal = true`: exibir o nome do titular na tela de validação, exigir confirmação do operador e gravar `documento_conferido`."

**Fase 4**

23. "QR dinâmico rotativo na área do comprador, com token de 30 segundos derivado do segredo do ingresso, e validação com tolerância de janela na portaria. Manter o QR estático como alternativa por evento."
24. "Domínio customizado por produtor: verificação de CNAME, roteamento por hostname para o tenant correto, emissão de certificado."

**Revisões — rodar ao fim de cada fase**

- "Revise este módulo procurando: vazamento entre tenants, race condition de estoque, webhook não idempotente, float em valor monetário e segredo em código."
- "Liste todos os pontos onde o sistema aceita uma transição de estado sem validar a máquina de estado."
- "Aponte todo lugar onde um valor monetário é calculado sem snapshot no pedido."

---

## 21. CLAUDE.md

O arquivo `CLAUDE.md` na raiz do repositório é a versão viva deste bloco. Ele resume as regras invioláveis, a stack, as convenções e os comandos. Alterou regra aqui? Atualize lá também.

---

## 22. Checklist pré-start

**Negócio**
- [ ] CNPJ operador definido
- [ ] Modelo de receita e percentuais iniciais definidos
- [ ] Política de reembolso e cancelamento escrita
- [ ] Quem responde pelo reembolso em cancelamento de evento
- [ ] Ingresso nominal ou ao portador
- [ ] Regras de transferência: prazo, limite por ingresso, taxa, meia-entrada
- [ ] Conferência de documento na porta: sim ou não, por tipo de evento

**Pagamento**
- [ ] Contas de sandbox de duas candidatas criadas
- [ ] Spike executado: criar recebedor, transacionar com split, liberar manualmente
- [ ] Resultado registrado em `docs/psp-avaliacao.md`
- [ ] Prazos e percentuais de retenção definidos, separados por Pix e cartão
- [ ] Taxas negociadas

**Jurídico**
- [ ] Contrato plataforma–produtor
- [ ] Termos de uso e política de privacidade do comprador
- [ ] Papéis LGPD definidos entre plataforma e produtor
- [ ] Regras de meia-entrada e gratuidades mapeadas

**Técnico**
- [x] Repo criado com `CLAUDE.md` e `docs/plano.md`
- [ ] Banco provisionado (dev, staging, prod)
- [ ] Domínio e ambientes na Vercel
- [ ] E-mail transacional configurado
- [ ] Sentry e CI ativos

---

## 23. Jornada operacional: venda, portaria e transferência

Esta seção descreve o produto do ponto de vista de quem usa. É a referência para decidir dúvidas de interface que a especificação técnica não cobre.

### 23.0. A loja pública não é um projeto separado

A vitrine onde os eventos ficam hospedados é o **mesmo projeto, mesmo banco, mesmo deploy** — apenas outro grupo de rotas (`src/app/(public)/`). Isso não é economia de esforço, é requisito: o estoque precisa ser lido e travado em tempo real pelo mesmo banco em que o painel do produtor escreve. Separar cria duas fontes da verdade e o sistema vende o mesmo ingresso duas vezes.

O que pode ser separado é a **aparência**. Cada produtor tem sua vitrine em `plataforma.com/[tenantSlug]`. Na Fase 4, quem quiser aponta um domínio próprio por CNAME para a mesma aplicação: visualmente parece o site dele, tecnicamente é o mesmo sistema, com roteamento por hostname.

### 23.1. Venda

1. O comprador abre a página do evento e escolhe os ingressos.
2. O sistema **reserva o estoque por 10 minutos** (5 no cartão). A partir daí ninguém mais compra aqueles lugares. Contagem regressiva visível.
3. Ele preenche nome, e-mail, CPF e telefone, e escolhe Pix ou cartão.
4. **No Pix:** aparece o QR de cobrança e a tela entra em espera, com polling do status.
5. **Nada é confirmado pela tela.** Quem confirma é o webhook da PSP. Quando o dinheiro entra, o pedido vira `paid`, o estoque migra de reservado para vendido e os ingressos são emitidos.
6. O ingresso chega por e-mail em PDF, com QR que carrega um código assinado — não é o número do ingresso escrito ali.
7. Se o comprador abandonar, a reserva expira, o pedido vira `expired` e o estoque volta para a venda.

Duas mensagens que precisam estar bem escritas na interface, porque geram a maior parte do suporte: o que acontece se o Pix for pago depois da expiração (reembolso automático, caso de borda 1) e onde o comprador encontra o ingresso se apagar o e-mail (área do comprador).

### 23.2. Portaria

1. O staff abre o PWA no celular — sem instalação por loja de aplicativos — e entra com acesso restrito àquele evento.
2. **Antes de abrir os portões, baixa o manifesto**: lista assinada de todos os ingressos válidos. Sem esse passo, a portaria depende da rede da casa.
3. A validação roda **local**: lê o QR, confere o HMAC, checa o manifesto, marca como usado e mostra verde.
4. Segunda leitura do mesmo QR → vermelho, com a **hora e o operador** da primeira leitura, para permitir a conversa na porta.
5. Em evento com `ingresso_nominal = true`, a tela exibe o nome do titular e exige que o operador confirme a conferência do documento. Isso grava `documento_conferido`.
6. Busca manual por nome ou CPF, para quem chegou sem bateria.
7. Contador ao vivo de público presente, visível ao produtor no painel.
8. Sincronização contínua entre aparelhos e com o servidor.

### 23.3. Transferência de titularidade

Só funciona bem com ingresso nominal. **Recomendação: nominal.**

Mecânica: o comprador entra na área dele, escolhe o ingresso, informa nome, CPF e e-mail do destinatário. O sistema **cancela o ingresso original e emite um novo**, com QR distinto, vinculado pelo campo `transferido_de_ticket_id`. O QR antigo morre no ato — o print antigo é barrado na porta.

Regras configuráveis por evento (campos já no schema):

| Campo | Decisão sugerida |
|---|---|
| `permite_transferencia` | true |
| `transferencia_ate_horas` | 24h antes do evento |
| `max_transferencias_por_ingresso` | 1 ou 2 |
| `taxa_transferencia_centavos` | 0 no piloto |
| `transferencia_permite_meia` | false (o novo titular teria de comprovar o próprio direito) |

**Regra inegociável:** se houver reembolso depois da transferência, o dinheiro volta para **quem pagou**, não para o titular atual. Sem isso, a transferência vira mecanismo de fraude. A interface avisa isso antes de confirmar.

Efeito colateral desejado: oferecer um caminho legítimo de repasse reduz a circulação de prints por fora, que é onde o controle se perde.

### 23.4. Caminho até os primeiros eventos

| Etapa | O que é | Quando |
|---|---|---|
| 1 | Fundação: repo, banco, auth, RLS | Semana 1 |
| 2 | Sistema completo com `FakeProvider` — venda, webhook, ingresso e check-in inteiros, sem PSP contratada | Semanas 2 a 4 |
| 3 | Evento fantasma interno (Fase 1.5) | 1 a 2 dias |
| 4 | PSP real e venda de R$ 1,00, com conferência do split nos dois extratos | Semana 5 |
| 5 | Evento piloto do próprio grupo — se falhar, o prejuízo é de casa | Semanas 6 a 7 |
| 6 | Segundo evento, com um produtor de confiança que aceite ser cobaia | — |
| 7 | Abertura, só após dois eventos limpos | — |

---

## 24. Segurança do ingresso: o que o QR resolve e o que não resolve

Registro honesto, para não se construir sobre uma premissa falsa.

**O QR pode ser copiado.** É uma imagem: print, foto, encaminhamento. Nada impede. Quem promete QR incopiável está vendendo ilusão.

**O que a assinatura HMAC impede é a falsificação.** Sem o segredo do servidor ninguém gera um QR válido do nada. Copiar um QR verdadeiro e fabricar um falso são problemas diferentes; só o segundo é resolvido por criptografia.

**O que resolve a cópia é a validação de uso único.** O primeiro a entrar entra; os demais são barrados. Se o cambista vendeu o mesmo print para cinco pessoas, quatro ficam na porta. O sistema não é violado — mas o atrito social existe e recai sobre a portaria, o que precisa constar do treinamento e do runbook.

**Três camadas, em ordem de custo-benefício:**

1. **Ingresso nominal com conferência de documento.** A defesa mais eficaz e mais barata. O print copiado não passa se o documento não bate.
2. **Transferência oficial dentro da plataforma.** Dá um caminho legítimo de repasse e mata o QR antigo na hora. Sem isso, todo mundo repassa por print.
3. **QR dinâmico** (Fase 4). Código rotativo de 30 segundos na área logada do comprador, como token de banco. Print não funciona porque expira. Custo: exige internet no celular do comprador e login na fila — atrito real. Só se o perfil dos eventos justificar; em casa noturna raramente justifica.

**O ponto fraco de verdade é o offline.** Dois portões sem rede e sem comunicação entre si deixam o mesmo QR passar duas vezes. Não é hipótese, é o furo clássico. Mitigações, em ordem:

- Sincronização entre os aparelhos por **rede local** no próprio evento, não apenas pela internet (um aparelho eleito como servidor da sala; os demais fazem polling)
- Portão único sempre que a operação permitir
- Com vários portões, sincronização a cada poucos minutos
- Modo totalmente offline reservado para contingência, nunca como padrão

**Configuração recomendada para o piloto:** ingresso nominal, uso único, portão único, sincronização online com fallback offline. QR dinâmico depois, se necessário.

---

## 25. Fontes oficiais consultadas

- Banco Central do Brasil — apresentação à Comissão de Assuntos Econômicos do Senado, 19/05/2026: https://www.bcb.gov.br/conteudo/home-ptbr/TextosApresentacoes/GG_PPT_CAE_19_05_26.pdf
- Banco Central do Brasil — base de normativos, para conferência do texto vigente da Resolução BCB nº 80/2021 e alterações: https://normativos.bcb.gov.br
- Banco Central do Brasil — consulta de instituições autorizadas a funcionar: https://www.gov.br/pt-br/servicos/consultar-instituicoes-autorizadas-pelo-banco-central

As referências ao CDC, à Lei nº 12.933/2013 (meia-entrada) e à LGPD devem ser conferidas no texto vigente em https://www.planalto.gov.br antes do lançamento.
