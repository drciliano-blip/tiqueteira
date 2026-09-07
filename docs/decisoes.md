# Decisões de arquitetura (ADR)

Uma decisão por entrada. Formato curto: contexto, decisão, consequência.
Entrada nova vai no fim. Decisão revogada não é apagada — ganha um
"Substituída por ADR-XXX".

---

## ADR-001 — `reservations` ganha `tenant_id` e `liberada`

**Data:** 2026-09-07
**Status:** aceita

**Contexto.** A seção 7 do plano descreve o índice
`reservations(expires_at) WHERE liberada = false`, mas a coluna `liberada` não
aparece na lista de colunas da tabela. A tabela também não tem `tenant_id`, o
que a deixaria fora da política de RLS — e `reservations` é justamente onde o
estoque de outro produtor poderia vazar por engano de join.

**Decisão.** `reservations` passa a ter:
- `tenant_id uuid not null` — entra na política de RLS como todas as demais;
- `liberada boolean not null default false` — marca a reserva já resolvida,
  seja por confirmação de pagamento, seja por expiração;
- `liberada_em timestamptz` e `liberada_motivo` (`paga` | `expirada` |
  `cancelada`) — para auditoria de estoque.

**Consequência.** O índice parcial do plano passa a ser válido. A confirmação
e a expiração de estoque ficam idempotentes (ver ADR-003).

---

## ADR-002 — Contadores de estoque protegidos por CHECK

**Data:** 2026-09-07
**Status:** aceita

**Contexto.** O plano prevê
`CHECK (quantidade_vendida + quantidade_reservada <= quantidade_total)`.
Falta a guarda inferior: nada impede um dos contadores de ficar negativo se
uma devolução de estoque rodar duas vezes.

**Decisão.** Três CHECKs em `ticket_types`:
1. `quantidade_vendida >= 0`
2. `quantidade_reservada >= 0`
3. `quantidade_vendida + quantidade_reservada <= quantidade_total`

**Consequência.** Um bug de contabilidade de estoque falha alto, na hora, em
vez de vazar ingresso silenciosamente. O custo é que um caminho de código
errado gera erro de banco — o que é exatamente o desejado em estoque.

---

## ADR-003 — Confirmação e devolução de estoque partem da reserva, não do contador

**Data:** 2026-09-07
**Status:** aceita

**Contexto.** O plano confirma o estoque com
`SET quantidade_reservada = quantidade_reservada - $2, quantidade_vendida = quantidade_vendida + $2`.
Se a reserva já expirou e o job de expiração devolveu o estoque, esse UPDATE
decrementa `quantidade_reservada` uma segunda vez — o contador vai a negativo
e o sistema passa a vender ingresso que não existe. É o caso de borda 1 do
plano (Pix pago depois da expiração), e o SQL como escrito não o cobre.

**Decisão.** Tanto a confirmação quanto a expiração começam por um UPDATE
condicional na linha de `reservations`:

```sql
UPDATE reservations
   SET liberada = true, liberada_em = now(), liberada_motivo = $2
 WHERE id = $1 AND liberada = false
RETURNING quantidade, ticket_type_id;
```

Só se essa instrução retornar linha é que o contador de `ticket_types` é
mexido. A linha de `reservations` é o token de uso único da operação de
estoque.

**Consequência.** Confirmação e expiração ficam idempotentes e mutuamente
exclusivas. Pix pago após a expiração não corrompe o estoque: a reserva já
está `liberada = true`, o pedido segue para reembolso automático (caso de
borda 1) e o contador não é tocado.

---

## ADR-004 — Cota de meia-entrada vive no evento

**Data:** 2026-09-07
**Status:** aceita

**Contexto.** A Lei nº 12.933/2013 fixa cota de 40% do total de ingressos para
meia-entrada. O plano classifica o ingresso em `ticket_types.tipo`
(`inteira | meia | cortesia | pcd | idoso`), mas não há onde medir a cota
agregada por evento, nem como registrar que gratuidades legais (idoso, PCD)
não consomem essa cota.

**Decisão.** `events` ganha:
- `cota_meia_pct integer not null default 40` — configurável, porque a regra
  municipal pode ser mais generosa que a federal;
- `cota_meia_base` (`total_evento` | `por_tipo`) — como a cota é medida.

E `ticket_types` ganha:
- `consome_cota_meia boolean not null default false` — `true` para o tipo
  `meia`, `false` para `pcd` e `idoso`, que são gratuidade legal e ficam fora
  da cota.

A validação da cota é feita no cadastro do evento (soma das quantidades dos
tipos que consomem cota contra a capacidade), não na venda.

**Consequência.** A conformidade fica verificável por consulta, e o relatório
de bilheteria consegue provar a cota — que é o documento pedido em fiscalização.

---

## ADR-005 — Sessão própria com Argon2 e cookie assinado

**Data:** 2026-09-07
**Status:** aceita

**Contexto.** O sistema tem quatro públicos com necessidades de sessão
diferentes: operador (admin), produtor (painel), portaria e comprador. A
portaria é o caso atípico e decisivo: precisa de sessão **restrita a um único
evento**, com expiração curta, que deixa de valer quando o evento termina.
Nem Supabase Auth nem Auth.js modelam escopo por recurso — nos dois casos
seria preciso construir essa camada por cima.

**Opções avaliadas.** Supabase Auth; Auth.js v5; sessão própria.

**Decisão.** Sessão própria:
- `users` e `sessions` no nosso banco;
- senha com Argon2id (`@node-rs/argon2`);
- cookie `httpOnly`, `secure`, `sameSite=lax`, com id de sessão opaco —
  o estado fica no banco, para que revogar sessão seja imediato;
- `sessions.scope_event_id` (nullable) implementa o escopo da portaria;
- magic link para o comprador, reaproveitando o e-mail transacional dos
  ingressos; a recuperação de senha usa a mesma peça.

**Razões.**
1. O RLS depende de `set_config('app.tenant_id', ...)` na conexão do Drizzle.
   Com sessão própria isso é direto; com Supabase Auth o JWT não chega ao
   Drizzle e conviveriam dois mecanismos de sessão.
2. O `audit_log` precisa de `user_id` com FK real. Em `auth.users`, schema que
   não é nosso, a FK fica frágil.
3. Sistema que move dinheiro não é lugar para dependência em beta
   (Auth.js v5 com Next 16).

**Consequência.** Recuperação de senha, rate limit de login e expiração de
sessão passam a ser responsabilidade nossa, com teste próprio. Em troca,
o escopo por evento da portaria e o isolamento por tenant saem de graça.

---

## ADR-006 — Percentuais em basis points, nunca em decimal

**Data:** 2026-09-07
**Status:** aceita

**Contexto.** O plano nomeia as colunas de taxa como `taxa_conveniencia_pct`,
`comissao_pct`, `reserva_pix_pct`. "Pct" sugere `numeric(5,2)` ou, pior, um
`float` em JavaScript. A regra nº 4 do CLAUDE.md proíbe float em dinheiro —
mas a taxa é o **multiplicador** do dinheiro, e um multiplicador impreciso
estraga o valor exato tão bem quanto um valor impreciso.

**Decisão.** Todo percentual é armazenado em **basis points**, como `integer`:
`1000` = 10,00%; `4000` = 40,00%; `10000` = 100%. As colunas passam a se
chamar `*_bps` — `taxa_conveniencia_bps`, `comissao_bps`, `reserva_pix_bps`,
`reserva_cartao_bps`, `cota_meia_bps`, e os snapshots correspondentes em
`orders`. `coupons.valor` também: em cupom do tipo `pct` o valor é bps.

Todo cálculo vira aritmética inteira:
`conveniencia = Math.round(subtotal * bps / 10000)`, com o resíduo de
arredondamento indo para o operador (plano, seção 16).

CHECKs no banco garantem `between 0 and 10000`.

**Consequência.** Divergência de nome em relação à seção 7 do plano — este ADR
é a fonte da verdade. Em compensação, é impossível uma taxa entrar no sistema
como `0.1 + 0.2`. A interface converte para exibição, e só ali.

---

## ADR-007 — Dois papéis de banco e RLS forçada

**Data:** 2026-09-07
**Status:** aceita

**Contexto.** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` não vale para o dono
da tabela. Como as migrations rodam com o papel dono (`postgres`), uma
aplicação que se conectasse com esse mesmo papel passaria pelo teste de
isolamento sem que política nenhuma estivesse sendo aplicada — o pior tipo de
teste verde.

**Decisão.**
1. `FORCE ROW LEVEL SECURITY` em todas as tabelas, para que nem o dono escape.
2. Dois papéis de login separados:
   - `tiqueteira_app` (`NOBYPASSRLS`) — tudo que atende requisição de usuário;
   - `tiqueteira_service` (`BYPASSRLS`) — só webhook da PSP, fila de jobs e
     autenticação, que chegam antes de existir um tenant.
3. O tenant entra por `set_config('app.tenant_id', $1, true)` dentro da
   transação. O terceiro argumento `true` é obrigatório: sem ele o valor
   sobrevive ao COMMIT e vaza para a próxima requisição que pegar a mesma
   conexão do pool.
4. `audit_log` é somente-leitura para `tiqueteira_app`. Trilha de auditoria que
   a aplicação pode reescrever não é trilha de auditoria.

**Consequência.** Três strings de conexão no ambiente em vez de uma
(`DATABASE_URL`, `DIRECT_URL`, `SERVICE_DATABASE_URL`). Em troca, o teste de
isolamento da Fase 0 prova alguma coisa, e um `serviceDb()` usado por engano
numa rota de usuário vira revisão de código, não vazamento silencioso.

---

## ADR-008 — Conexão ao Supabase pelo pooler, não pela conexão direta

**Data:** 2026-09-07
**Status:** aceita

**Contexto.** Projetos novos do Supabase expõem a conexão direta
(`db.<ref>.supabase.co:5432`) **apenas por IPv6**. O add-on de IPv4 é pago. A
maior parte das redes brasileiras, domésticas e corporativas, é IPv4 — então
migrations e seed falhariam com erro de resolução de nome, que é confuso de
diagnosticar porque parece problema de credencial.

**Decisão.** Nenhuma conexão usa o host direto:

| Variável | Host | Porta | Papel | Uso |
|---|---|---|---|---|
| `DIRECT_URL` | pooler | 5432 (session) | `postgres` | migrations, seed, rls |
| `DATABASE_URL` | pooler | 6543 (transaction) | `tiqueteira_app` | aplicação |
| `SERVICE_DATABASE_URL` | pooler | 6543 (transaction) | `tiqueteira_service` | jobs, webhooks |

O nome `DIRECT_URL` é mantido por convenção do Drizzle: significa "sem pooling
em modo transação", não "sem pooler".

O modo transação (6543) exige `prepare: false` no cliente `postgres.js` —
prepared statements não sobrevivem à troca de conexão do pooler. Isso já está
em `src/db/client.ts`.

**Verificado em 2026-09-07:** o Supavisor aceita papel customizado no formato
`<papel>.<project_ref>` como usuário. Os dois papéis conectam e o
`tiqueteira_app` é submetido ao RLS — comprovado pelo teste que lê
`pg_roles.rolbypassrls`.

**Consequência.** Funciona em rede IPv4 sem custo adicional. Em contrapartida,
toda conexão passa pelo Supavisor, então indisponibilidade dele é
indisponibilidade do sistema — item para o runbook.

---

## ADR-009 — Região do projeto Supabase (em aberto)

**Data:** 2026-09-07
**Status:** pendente

**Contexto.** O projeto `yccaeuqepknwnqnvyslx` foi criado em **us-east-1**
(Norte da Virgínia). O público comprador está no Brasil. Cada ida e volta ao
banco custa ~120 ms a mais do que custaria em `sa-east-1` (São Paulo), e o
checkout faz várias em sequência.

**Opções.** Manter; ou recriar o projeto em `sa-east-1` — indolor enquanto não
há dado de produção, já que as migrations e o `rls.sql` reproduzem tudo.

**Decisão (2026-09-07).** Manter `us-east-1` para **desenvolvimento** e criar o
projeto de **produção** já em `sa-east-1`, no momento em que ele for criado —
antes do evento piloto.

**Razão.** A tentativa de migrar agora produziu dois projetos e nenhuma
melhora: a região é escolhida na criação, e o projeto novo saiu na mesma
região por engano. O ganho é de ~120 ms por ida e volta, real mas não
bloqueante em desenvolvimento; o custo de manter dois projetos em paralelo é
confusão sobre qual está em uso — que é o tipo de erro que faz alguém rodar
migration no banco errado.

Produção nasce em São Paulo, com plano pago e sem dado a migrar. O risco
some junto com a pressa.

**Consequência.** `docs/pendencias.md` deixa de listar a mudança de região
como tarefa imediata e passa a listá-la como requisito da criação do ambiente
de produção.
