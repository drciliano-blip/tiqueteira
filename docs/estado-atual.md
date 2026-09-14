# Estado atual do projeto

**Última verificação: 14/09/2026.** Documento de passagem de bastão: quem
chegar agora — pessoa ou sessão nova do Claude — lê este arquivo e sabe onde
o projeto está, sem precisar inspecionar o repositório de novo.

Os números aqui foram **medidos**, não estimados. Onde for estimativa, está
escrito que é.

> **Como manter:** este arquivo envelhece rápido. Quando a realidade divergir,
> corrija aqui em vez de criar outro documento. A hierarquia é: `CLAUDE.md` é o
> resumo operacional, `docs/plano.md` é a especificação, `docs/decisoes.md` é o
> histórico de decisões, e este arquivo é a fotografia do agora.

---

## Índice

1. [Em uma frase](#1-em-uma-frase)
2. [Estratégia: Caminho A](#2-estratégia-caminho-a)
3. [Estrutura do repositório](#3-estrutura-do-repositório)
4. [Banco de dados](#4-banco-de-dados)
5. [RLS](#5-rls)
6. [Configuração e deploy](#6-configuração-e-deploy)
7. [Camada de pagamento](#7-camada-de-pagamento)
8. [Testes](#8-testes)
9. [Capacidade medida](#9-capacidade-medida)
10. [Onde estamos na seção 20 do plano](#10-onde-estamos-na-seção-20-do-plano)
11. [O que falta, em ordem](#11-o-que-falta-em-ordem)
12. [O que depende de decisão humana](#12-o-que-depende-de-decisão-humana)
13. [Edições propostas no plano, aguardando aprovação](#13-edições-propostas-no-plano-aguardando-aprovação)
14. [Comandos](#14-comandos)

---

## 1. Em uma frase

Marketplace de ingressos multi-tenant, operado por **CR ADMINISTRACAO E
PARTICIPACOES LTDA** (CNPJ 47.301.164/0001-12), em que a plataforma **nunca
custodia dinheiro** — todo pagamento usa split na PSP.

O sistema vende, emite ingresso com QR, controla portaria com entrada e saída
(inclusive sem rede), transfere titularidade, reembolsa e concilia. **O que
ele ainda não faz: vender online de verdade**, porque não existe adaptador de
PSP — e **pagar o produtor**, porque o motor de repasse não foi escrito.

---

## 2. Estratégia: Caminho A

**Decidido em 14/09/2026. Registro completo em ADR-017.**

A plataforma é **infraestrutura white-label** para casas e espaços que **já têm
público próprio**. Não é marketplace de descoberta e não compete por audiência
com Sympla ou Ticket360.

O argumento de venda tem três partes, e cada uma tem consequência técnica:

1. **O produtor mantém a própria marca** → domínio customizado por CNAME,
   acento visual por tenant.
2. **O produtor é dono dos próprios dados** → exportação da base em CSV,
   relatório de público recorrente.
3. **Atendimento próximo** → onboarding self-service e autoatendimento do
   comprador, para que a proximidade não vire custo de suporte.

**Fora do escopo:** mapa de assentos complexo, app nativo, SEO e descoberta de
marketplace, vitrine agregadora de todos os produtores.

> A vitrine **por produtor** (`/[tenantSlug]`) continua e é essencial. O que
> saiu é a página que junta todos os produtores.

**Dívida que isso cria:** `src/lib/marketplace-queries.ts` e a home foram
construídos para o modelo abandonado. Não atrapalham, mas deixam de receber
investimento.

---

## 3. Estrutura do repositório

```
src/
  app/
    (public)/     vitrine do produtor, página do evento, checkout,
                  meus-ingressos, transferência, sala de espera da fila,
                  como-funciona, termos, privacidade, publique
    (produtor)/   painel: visão geral, vendas, espaços, equipe, saúde
                  por evento: lotes, listas de convidados, cupons,
                             bilheteria, relatórios, cancelamento
    (portaria)/   PWA de check-in
    api/          webhooks/payments, jobs/[nome], orders/[id]/status,
                  portaria/manifest, portaria/sync, fila/[eventId], sessao
  db/             schema.ts, rls.sql, client.ts, apply-rls.ts,
                  migrations/ (0000–0009), seed.ts, ensaio.ts, bench.ts
  domain/         PURO, sem banco nem rede: order, inventory, portaria, fila,
                  cupom, transferencia, refund-policy, lista-convidados,
                  cpf, categorias
  lib/            33 arquivos + payments/
  jobs/           expirar-reservas, enviar-ingressos, conciliacao,
                  cancelar-evento, reembolso-atrasado
  components/     cabecalho, acoes-da-conta, scanner-qr, seletor-ingressos,
                  tema-tenant, cartaz, busca-eventos, menu-mobile, …
tests/
  unit/           14 arquivos
  integration/    11 arquivos, contra o banco real
  e2e/            VAZIA — Playwright previsto no plano, nunca escrito
scripts/          teste-de-carga.mjs
docs/             plano, benchmark-e-design, decisoes, pendencias,
                  runbook, ensaio, estado-atual (este arquivo)
```

**Regra de arquitetura que não pode cair:** `src/domain/` é puro. Não importa
banco, rede nem SDK. Toda transição de estado passa por lá.

---

## 4. Banco de dados

**25 tabelas, 10 migrations aplicadas** (`0000` a `0009`).

### Comparação com a seção 7 do plano

**Nada do que a seção 7 prevê está faltando.** Verificação coluna a coluna em
`tenants`, `events`, `ticket_types`, `orders`, `reservations` e `tickets`:
todas completas, incluindo `provider_recipient_id`, `kyc_status`,
`dominio_customizado`, `dominio_verificado`, `limite_por_cpf`, `settled_em`.

O banco está **à frente** do plano:

| Acréscimo | Origem |
|---|---|
| `ticket_movimentos` | ADR-011 — livro da porta |
| `fila_virtual` + 7 colunas em `events` | ADR-014 — fila virtual |
| `guest_lists`, `guest_list_entries` | ADR-012 — lista de convidados |
| `event_splits` | rateio entre sócios do evento |
| `buyer_access_tokens` | link mágico do comprador |
| `rate_limits` | limite de tentativas |
| `orders.canal`, `metodo_externo`, `vendido_por`, `cupom_id` | bilheteria e cupons |

### Diferença de nomenclatura, não de substância

O plano escreve `taxa_conveniencia_pct` e `comissao_pct`; o banco usa `_bps`
(basis points). **ADR-006** — percentual em decimal no JavaScript é bug de
dinheiro esperando acontecer.

### Índices-chave confirmados

`orders_event_status_idx`, `tickets_codigo_key`, `tickets_event_status_idx`,
`webhook_events_provider_event_key`.

### Tabelas com dados hoje (banco de desenvolvimento)

`tickets` ~418, `orders` ~250, `order_items` ~250, `reservations` ~50,
`audit_log` ~26, `webhook_events` ~26, `refunds` ~11, `ticket_types` ~9,
`guest_list_entries` ~8, `users` ~7, `memberships` ~7, `events` ~5.

---

## 5. RLS

**Ativa e forçada nas 25 tabelas, sem exceção.**

- **19 tabelas** com política de isolamento por `tenant_id`.
- **6 tabelas** com RLS ligada e **nenhuma política**, de propósito: `users`,
  `sessions`, `webhook_events`, `jobs`, `rate_limits`, `buyer_access_tokens`.
  São acessadas só pelo papel de serviço, e RLS sem política significa que
  ninguém passa.

**Dois papéis de banco** (ADR-007):

| Papel | `bypassrls` | Uso |
|---|---|---|
| `tiqueteira_app` | `false` | toda requisição de usuário |
| `tiqueteira_service` | `true` | jobs, webhooks, login |

O isolamento é **provado por teste**, não presumido:
`tests/integration/rls.test.ts`, 11 casos — inclui tentativa de inserir
registro carimbado com outro tenant, de mover registro entre tenants, e o
vazamento por conexão reaproveitada do pool.

---

## 6. Configuração e deploy

`.env.local` existe, com **18 variáveis**, cobrindo as 17 que
`src/lib/env.ts` valida:

```
APP_DB_PASSWORD              AUTH_SECRET
DATABASE_URL                 DIRECT_URL
JOB_SECRET                   MAIL_FROM
NEXT_PUBLIC_APP_URL          PAYMENT_API_KEY
PAYMENT_OPERATOR_RECIPIENT_ID PAYMENT_PROVIDER
PAYMENT_WEBHOOK_SECRET       RESEND_API_KEY
SENTRY_DSN                   SERVICE_DATABASE_URL
SERVICE_DB_PASSWORD          TICKET_HMAC_SECRET
TICKET_HMAC_SECRET_PREVIOUS  VERCEL_OIDC_TOKEN
```

Também existem `.env.example` e `.env.vercel`.

### Deploy

`https://tiqueteira.vercel.app` responde **200** e **compartilha o mesmo banco
do desenvolvimento**.

> **Atenção:** o staging está **12 commits atrás** do `main` local. Ele roda o
> código de 09/09 contra o esquema novo — convivem, porque as colunas novas
> nasceram com valor padrão, mas nada do que foi construído depois está no ar.
> Um `git push` resolve; a Vercel publica sozinha.

**Região:** o banco de desenvolvimento está em `us-east-1`, a ~120 ms daqui. O
projeto de **produção nasce em `sa-east-1`** (ADR-009), e ainda não existe.

---

## 7. Camada de pagamento

`src/lib/payments/`, 965 linhas em três arquivos:

| Arquivo | Situação |
|---|---|
| `types.ts` | Contrato `PaymentProvider` com `capabilities`, conforme seção 9 |
| `fake.ts` | **`FakeProvider` completo** |
| `provider.ts` | Fábrica com `conferirCapacidades`, que recusa na inicialização um provider incapaz |

O `FakeProvider` declara `conditionalRelease: true` e implementa **os 8
controles de cenário** da seção 9.1, sem faltar nenhum: `simulatePayment`,
`simulateFailure`, `simulateExpiration`, `simulateChargeback`,
`simulateRecipientApproval`, `failNext`, `setLatency`, `reset`.

**Não existe adaptador de PSP real.** É o bloqueio nº 1 do projeto.

> **Regra inviolável:** antes de alterar a interface `PaymentProvider`,
> pergunte. Se algo da PSP não couber no contrato, pare e sinalize — não
> adapte o contrato por conta própria.

---

## 8. Testes

**369 testes em 25 arquivos, todos passando.** Build de produção, lint e tipos
limpos.

- **14 arquivos unitários** — domínio puro: dinheiro, taxas, máquina de
  estado, portaria, fila, cupom, transferência, CPF, política de reembolso.
- **11 arquivos de integração**, contra o banco real: RLS, estoque, webhook,
  portaria, listas, fila, cupons, bilheteria, relatórios, equipe, rate limit.

### Os testes que sustentam o sistema

| Teste | O que prova |
|---|---|
| 50 compras simultâneas para 10 ingressos | exatamente 10 sucessos |
| 500 compras disputando 200 | exatamente 200 vendidos, zero falha de conexão |
| 8 leituras simultâneas do mesmo QR | uma entrada só |
| 6 portões buscando o mesmo convidado | uma cortesia só |
| 50 usos simultâneos de cupom de 10 | exatamente 10 |
| 50 chegadas simultâneas na fila | 50 números distintos, em ordem |
| RLS, 11 casos | tenant A não lê, escreve nem move dado do tenant B |

### Lacuna

**`tests/e2e/` está vazia.** O plano prevê Playwright; nunca foi escrito. É a
lacuna de teste mais visível. As telas construídas recentemente — equipe,
fila, cupons, bilheteria, relatórios — têm teste na camada de biblioteca, mas
**a interface nunca foi clicada**: passou por tipos, lint e build, não por uso.

---

## 9. Capacidade medida

Medido com `pnpm bench` contra o banco de desenvolvimento em `us-east-1`
(~120 ms de ida e volta). Ver **ADR-013**.

| Caminho | Antes | Depois da correção |
|---|---|---|
| 500 compras no mesmo lote | 5/s, p50 82 s | **11/s, p50 31 s** |
| Check-in online, uma leitura | p50 982 ms | **p50 742 ms** |
| 200 leituras simultâneas | 16/s, p95 12,0 s | **22/s, p95 8,7 s** |
| Subir 300 passagens offline | ~900 idas ao banco | **2,4 s no total** |
| Validação offline, no aparelho | — | **5 µs, 215 mil/s** |
| Manifesto de 5.000 ingressos | — | **220 KB, ~1,8 s em 1 Mbps** |
| Página do evento, 500 acessos | teto de 500 | **cacheável na borda** (ADR-015) |

### O que isso significa por porte de evento

**A porta é problema resolvido, inclusive para 10 mil pessoas** — desde que
opere com o manifesto baixado. A validação acontece no aparelho, não depende
da rede da casa, e o gargalo passa a ser físico: quantos portões e leitores.
Assumindo ~3 s por pessoa (meta do ensaio, **não medida**): 5.000 pessoas em
1 h precisam de 5 portões; 10.000 em 2 h, de 5 portões.

**A abertura de vendas é o que ainda tem teto.** A 11 reservas/s, 5.000
ingressos levam ~7,5 min. A armadilha: numa abertura de festival não são 5.000
comprando, são 20.000 tentando — e quem não vai conseguir também disputa a
mesma linha travada do lote. Por isso a fila virtual existe.

**Próximo ganho, e não é código:** banco em `sa-east-1`. A espera é dominada
pela ida e volta de rede; a expectativa é de **5 a 10 vezes mais vazão sem
mudar uma linha**. **É expectativa, não medição** — rodar `pnpm bench` lá
quando o banco existir.

---

## 10. Onde estamos na seção 20 do plano

**O trabalho não seguiu a ordem da seção 20.** Avançou em profundidade por
domínio e pulou para a frente.

| Fase | Prompt | Situação |
|---|---|---|
| 0 | 1 schema + RLS | completo |
| 0 | 2 auth multi-tenant | completo |
| 0 | 3 seed | completo |
| 1 | 4 `FakeProvider` | completo |
| 1 | 5 `fees.ts` | completo |
| 1 | 6 máquina de estado | completo |
| 1 | 7 reserva de estoque | completo |
| 1 | 8 CRUD de evento e lotes | completo |
| 1 | 9 página pública e carrinho | completo |
| 1 | 10 checkout Pix | completo |
| 1 | 11 webhook | completo |
| 1 | 12 emissão de ingresso | completo *(QR e e-mail; sem PDF)* |
| 1 | 13 PWA de check-in | completo |
| 1.5 | ensaio geral | **ferramenta pronta, ensaio NÃO EXECUTADO** |
| 2 | 14 adaptador da PSP | **bloqueado — decisão comercial** |
| 2 | **15 motor de repasse** | **NÃO EXISTE** |
| 2 | 16 reembolso | completo |
| 2 | 17 conciliação | completo |
| 3 | 18 check-in offline | feito, **menos a sincronização entre aparelhos por rede local** |
| 3 | 19 meia-entrada com cota | completo |
| 3 | **20 relatórios** | curva de vendas e bilheteria feitos; **ECAD e CSV não** |
| 3 | 21 área do comprador e transferência | completo |
| 3 | 22 conferência de documento | completo |
| 4 | 23 QR dinâmico rotativo | não |
| 4 | **24 domínio customizado** | **entregue** — proxy por hostname, verificação de CNAME e tela do produtor (ADR-018). Falta só a emissão automática de certificado |

**A seção 19 do plano está desatualizada:** a fila virtual aparece na Fase 4 e
já está entregue (ADR-014).

### O maior buraco estrutural

**Prompt 15 — o motor de repasse.** E ele **não depende da PSP real**: a
seção 9.1 do plano diz que o `FakeProvider` declara `conditionalRelease` e
mantém saldos por recebedor *"para que o motor de repasse seja exercitado de
ponta a ponta"*. A tabela `payouts` existe com 19 colunas e **ninguém escreve
nela**.

Hoje o sistema sabe cobrar e sabe reembolsar, mas **não sabe pagar o
produtor**.

---

## 11. O que falta, em ordem

A ordem abaixo considera o Caminho A e o que **não** depende da PSP.

### ~~1º — Prompt 24: domínio customizado~~ — ENTREGUE em 14/09/2026

Proxy por hostname, resolução de tenant por domínio verificado, verificação de
CNAME e tela do produtor. Ver ADR-018. **Pendência:** a emissão de certificado
ainda é manual (adicionar o domínio ao projeto na Vercel).

### 2º — Prompt 15: motor de repasse

O maior buraco estrutural. Construível e testável inteiro contra o
`FakeProvider` hoje. Um sistema que não paga o produtor não opera um evento
real, mesmo com a PSP escolhida.

### 3º — Exportação CSV e público recorrente

O argumento nº 2 do Caminho A transformado em botão. Na Sympla a base pertence
à plataforma; aqui pertence ao produtor, e isso precisa ser demonstrável.

### 4º — Onboarding self-service

Cadastro, KYC pela API da PSP e primeiro evento publicado sem intervenção
humana. O KYC depende da PSP; o resto não.

### 5º — Autoatendimento do comprador

Reembolso, ingresso não recebido e troca de titularidade — as três dúvidas que
geram quase todo o suporte.

### Também em aberto

- `tests/e2e/` vazia — Playwright nunca escrito
- Sincronização entre aparelhos da portaria por rede local (parte do prompt 18)
- Relatório base para ECAD (parte do prompt 20)
- PDF do ingresso (parte do prompt 12; hoje o ingresso vai por QR no e-mail e
  por página web)

---

## 12. O que depende de decisão humana

Nada disto é código, e tudo isto bloqueia.

| O quê | Por que bloqueia |
|---|---|
| **Escolher a PSP** | Sem ela não há venda online. É a Fase 2 inteira, e é o bloqueio nº 1 |
| **Inscrição municipal e NFS-e** | A CR Administração é holding; holding pura costuma não ter inscrição municipal, e sem ela não há como faturar a conveniência. Obter leva de dias a semanas — **é o item mais urgente de verificar com o contador** |
| **CNAE de serviço** | Sem CNAE compatível, a PSP classifica como risco alto ou recusa o cadastro |
| **Taxas do piloto** | Conveniência, comissão e taxa fixa. São configuração no banco; falta o número |
| **`git push`** | 12 commits parados no local; o staging está desatualizado |
| **Rodar o ensaio geral** | Fase 1.5. Duas horas, dois celulares, a folha impressa. Encontra o que teste nenhum encontra. Roteiro em `docs/ensaio.md` |
| **Domínio próprio** | Recomendação: subdomínio (`ingressos.dominio.com.br`), não a raiz — problema de entrega de e-mail não pode contaminar o domínio institucional |

Detalhamento completo em `docs/pendencias.md`.

---

## 13. Edições propostas no plano, aguardando aprovação

**Estas edições NÃO foram aplicadas.** Ficam registradas aqui para não se
perderem.

### Seção 19, Fase 3 — substituir por

> **Fase 3 — Operação real e marca própria (3 semanas)**
> Check-in offline com sincronização por rede local, lotes e cupons,
> meia-entrada com cota, limite por CPF, ingresso nominal com conferência de
> documento, área do comprador e transferência de titularidade, relatórios
> (bilheteria, ECAD, curva de vendas), runbook.
>
> **Promovidos da Fase 4 pelo Caminho A (ADR-017):** domínio customizado por
> CNAME; acento visual por tenant *(já entregue)*; exportação da base de
> compradores em CSV e relatório de público recorrente; onboarding
> self-service do produtor; autoatendimento do comprador para reembolso,
> ingresso não recebido e troca de titularidade.
>
> *DoD:* um evento real operado inteiro na plataforma **no domínio do próprio
> produtor**, com pelo menos uma transferência e uma conferência de documento
> na porta, e o produtor exportando a própria base sem pedir nada a ninguém.

### Seção 19, Fase 4 — substituir por

> **Fase 4 — Escala**
> QR dinâmico rotativo, adiantamento de repasse, integração com o dashboard
> existente.
> *(Fila virtual saiu desta lista: entregue na Fase 3 — ADR-014.)*
>
> **Fora do escopo (ADR-017):** mapa de assentos complexo, app nativo de
> portaria, SEO e descoberta de marketplace, vitrine agregadora de todos os
> produtores.

### Seção 20

Mover o prompt 24 para a Fase 3 e acrescentar três prompts: exportação CSV +
público recorrente, onboarding self-service, autoatendimento do comprador.

### Seção 1

Acrescentar um parágrafo de posicionamento, para que quem ler o plano sem ler
as ADRs entenda que não somos marketplace.

---

## 14. Comandos

```
pnpm dev            servidor de desenvolvimento
pnpm build          build de produção
pnpm lint           eslint
pnpm typecheck      tsc --noEmit
pnpm test           vitest (unit + integração) — ~10 min, banco remoto
pnpm test:unit      só unitários, sem banco

pnpm db:generate    gera migration a partir do schema
pnpm db:migrate     aplica migrations
pnpm db:rls         aplica src/db/rls.sql e confere que nenhuma tabela ficou sem RLS
pnpm db:studio      drizzle studio
pnpm db:seed        popula dados de desenvolvimento (feios de propósito)

pnpm ensaio         monta o evento fantasma da Fase 1.5 e gera a folha de QRs
pnpm bench          mede capacidade: manifesto, check-in, compra, fila offline
```

Teste de carga da página pública:

```
node scripts/teste-de-carga.mjs --url <URL> --evento /<tenant>/e/<evento> --usuarios 500
```

> No Git Bash, prefixe com `MSYS_NO_PATHCONV=1`, senão o caminho do evento é
> convertido em caminho do Windows.

---

## Regras que não podem cair

Repetidas aqui porque são o que separa este projeto de uma tiqueteira que
perde dinheiro em silêncio. A lista canônica está em `CLAUDE.md`.

1. A plataforma **nunca custodia dinheiro**. Split na PSP, sempre.
2. Status de pagamento muda **só por webhook verificado e idempotente**.
3. **Toda query tem `tenant_id`.** RLS ativa em todas as tabelas.
4. Dinheiro em **centavos**, inteiro. Nunca float.
5. Taxas e percentuais são **configuração no banco**, e todo pedido grava
   snapshot dos percentuais aplicados.
6. Toda operação que altera estado externo recebe **idempotencyKey**.
7. Transição de estado **só pela máquina de estado** em `src/domain/`.
