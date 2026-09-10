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


---

## ADR-010 — Operador da plataforma

**Data:** 2026-09-08
**Status:** aceita

**Contexto.** A decisão nº 1 da seção 1 do plano — qual CNPJ do grupo opera a
plataforma — bloqueava a conta na PSP, o contrato com produtor e a nota fiscal.

**Decisão.** O operador é **CR ADMINISTRACAO E PARTICIPACOES LTDA**,
CNPJ **47.301.164/0001-12**. Dígitos verificadores conferidos.

É este CNPJ que:
- abre o cadastro de recebedor "operador" na PSP;
- assina o contrato plataforma–produtor;
- emite NFS-e sobre a comissão e a taxa de conveniência — **nunca** sobre o
  valor do ingresso;
- figura como controlador ou operador dos dados nos termos de LGPD.

**Consequências a resolver antes do go-live.**

1. **Inscrição municipal e habilitação para NFS-e.** Empresa de administração
   e participações frequentemente não tem inscrição municipal, porque holding
   pura não presta serviço. Sem ela, não há como emitir nota da conveniência —
   e obter leva de dias a semanas. É o item mais urgente de verificar.
2. **CNAE de serviço.** Ver a seção correspondente em `docs/pendencias.md`.
   Sem CNAE compatível, a PSP classifica como risco alto ou recusa.
3. **Regime tributário.** Holding costuma estar no Lucro Presumido. Para
   serviço, a base presumida é de 32%, não os 8% do comércio — muda a conta e
   precisa de confirmação do contador.
4. **Nome visível ao consumidor.** "CR ADMINISTRACAO E PARTICIPACOES" não diz
   nada a quem comprou um ingresso. Nome desconhecido na fatura e na nota é
   uma das causas mais comuns de contestação de cartão. Mitigação: descritor
   de fatura curto e reconhecível (já configurado como `INGRESSOS`), nome
   fantasia registrado, e identificação clara do operador no checkout e nos
   termos.

---

## ADR-011 — Controle de saída e reentrada na portaria

**Data:** 2026-09-09
**Status:** aceita

**Contexto.** Até aqui o ingresso ia de `valido` para `usado` e parava ali. O
contador da portaria dizia **quem já entrou**, e esse número só cresce. Ele
não responde às duas perguntas que aparecem na operação real: quantas pessoas
estão na casa agora — que é o que o bombeiro pergunta — e o que fazer com
quem sai para o carro e quer voltar, que em casa noturna é a regra, não a
exceção.

**Decisão.** A porta passa a registrar os dois sentidos, com duas chaves de
configuração **por evento**:

- `controla_saida` — desligado por padrão. Desligado, o evento se comporta
  exatamente como antes.
- `permite_reentrada` — ligado por padrão. Só tem efeito com o controle de
  saída ligado.

Três peças sustentam isso:

1. **`src/domain/portaria.ts`** — função pura que decide entrada, saída ou
   recusa. A recusa carrega motivo e uma frase pronta com a hora do fato.
2. **Colunas em `tickets`** (`dentro`, `entradas_count`, `ultima_entrada_em`,
   `ultima_saida_em`) — o estado atual, para o `UPDATE` condicional atômico.
3. **Tabela `ticket_movimentos`** — o livro da porta, com a chave natural
   (ingresso, tipo, hora).

**Razão de o estado ser coluna e não contagem sobre o livro.** A porta precisa
decidir com um `UPDATE` condicional: ler para depois decidir abre a janela por
onde dois portões deixam o mesmo QR passar duas vezes. Contar movimentos a
cada leitura seria ler antes de decidir, com outro nome.

**Razão de o livro existir mesmo assim.** O estado diz onde a pessoa está; o
livro diz o caminho que ela fez. É dele que sai a resposta para "a que horas
ela saiu", a curva de público da noite, e — principalmente — a convergência da
sincronização offline: o servidor recalcula o estado a partir do livro
inteiro, então filas que sobem fora de ordem, ou duas vezes, chegam ao mesmo
resultado.

**A regra que não pode cair: quem está dentro não entra de novo.** Sem ela, o
controle de saída viraria exatamente a brecha que o controle de entrada existe
para fechar — bastaria alternar leituras para o mesmo ingresso servir a duas
pessoas a noite inteira. Está no domínio, no `UPDATE` (`dentro = false` é
condição da reentrada) e no teste de concorrência.

**Sair é sempre permitido a quem está dentro**, inclusive com ingresso
cancelado depois da entrada. Reembolso ou chargeback às 23h não podem prender
ninguém lá dentro, e um contador que nunca zera é pior que um contador com uma
saída a mais. Por isso o CHECK de `dentro` se apoia em `entradas_count > 0`, e
não no status.

**Consequência para a portaria offline.** O manifesto passou a levar a
política e o estado de cada ingresso, e o aparelho decide com a **mesma
função pura** do servidor. Duplicar a regra no cliente seria garantir que um
dia as duas divergissem — e a divergência apareceria na porta, à uma da manhã.
O sentido escolhido (entrada ou saída) fica gravado no aparelho: um celular
escalado para a saída não pode voltar sozinho para "entrada" depois de
recarregar a página.

**Limite que continua o mesmo.** Offline, dois portões sem comunicação entre
si deixam o mesmo QR passar duas vezes. Nada resolve isso do lado do aparelho.
A sincronização registra que aconteceu; só portão único ou rede entre
aparelhos evita o furo.

---

## ADR-012 — Lista de convidados e o pedido de cortesia

**Data:** 2026-09-09
**Status:** aceita

**Contexto.** As tabelas `guest_lists` e `guest_list_entries` existiam no
esquema desde a Fase 0 e nunca tiveram tela. Sem tela, a lista VIP continua no
papel ou no WhatsApp — e é exatamente aí que o controle de portaria falha:
ninguém confere cota, ninguém sabe quem já entrou, e o mesmo nome passa em
dois portões.

**Decisão.** A cortesia é emitida **na porta**, numa transação só: reserva o
nome, consome o estoque, cria o pedido, emite o ingresso e registra a entrada.
O ingresso nasce `usado` e dentro da casa.

**Por que nasce usado.** A pessoa está atravessando a porta agora. Emitir um
ingresso válido e pedir ao segurança que escaneie o QR em seguida seria
trabalho inventado, com fila atrás.

**Cortesia é pedido de valor zero, canal `lista`, método `cortesia`.** Poderia
ser um ingresso sem pedido, e a tentação era essa. Mas ingresso sem pedido
some de todo relatório: o produtor nunca saberia quantas cortesias deu, que é
justamente a conta que ele quer fazer — cada cortesia é um ingresso que deixou
de ser vendido.

**Cortesia consome estoque.** A condição está no `WHERE` do `UPDATE` do lote.
É o que impede a lista de furar a capacidade do espaço, que é limite de
bombeiro, não de bilheteria. Quando o lote esgota, a porta recusa a cortesia e
**devolve o nome à lista** — ele não entrou, e vai ser preciso de novo.

**Consequência: `orders_comprador_ck` foi relaxado.** O CHECK exigia nome,
e-mail e CPF de todo pedido fora de `draft`. Ele foi escrito supondo que todo
pedido vem de um checkout — suposição falsa para os canais `lista` e `pdv`,
que o próprio esquema já declarava. Convidado de lista não tem e-mail para
dar, e exigir um produziria endereço inventado no banco, que é pior que campo
vazio. O CHECK passou a exigir a identificação completa **apenas no canal
`online`**; o nome continua obrigatório em todos os casos, porque sem ele não
há a quem entregar o ingresso. Os invariantes de dinheiro — o split fecha com
o total, o total é subtotal mais conveniência menos desconto — não foram
tocados.

**Convidado de `desconto` não é admitido pela porta.** Preço menor ainda é
venda: emitir cortesia para quem deveria pagar seria furar a bilheteria pelo
caminho mais silencioso possível. A porta mostra o nome, diz que é desconto e
manda para a bilheteria.

**A lista precisa de rede.** Diferente da leitura de QR, admitir alguém emite
um ingresso novo, e emitir exige o segredo do servidor — que o aparelho não
tem de propósito, para que um celular perdido não vire máquina de fabricar
cortesia. A tela diz isso quando está sem rede, em vez de falhar em silêncio.

---

## ADR-013 — O cadeado do lote e o tempo da fila

**Data:** 2026-09-09
**Status:** aceita

**Contexto.** A pergunta era direta: o sistema aguenta um festival de 5 a 10
mil pessoas, e três eventos abrindo venda no mesmo horário? Não dava para
responder com opinião, então virou `src/db/bench.ts` — que mede os dois
caminhos que **não são cacheáveis por natureza**: quem compra e quem passa
pela porta.

**O que a medição mostrou.** Com 500 compras simultâneas disputando o mesmo
lote, a taxa era de **5 reservas por segundo**, com p50 de 82 segundos. Não
era falta de conexão nem falta de CPU: nenhuma requisição falhou, e o estoque
fechou exato (200 vendidos para 200 disponíveis). Era **espera**.

A causa: o `UPDATE` que decrementa o lote tranca aquela linha, e o Postgres só
solta a tranca no `COMMIT`. Entre um e outro havia mais duas idas ao banco — o
`INSERT` da reserva e o próprio `COMMIT`. **Toda a fila espera por essas idas**,
porque todo mundo quer a mesma linha. A linha do lote é um ponto de
serialização global, e o que a serializa não é trabalho de banco: é latência
de rede multiplicada pelo tamanho da fila.

**Decisão 1 — o mínimo de idas ao banco com a tranca na mão.**

- A reserva virou **um comando só**: o `INSERT` em `reservations` mora dentro
  de um CTE junto do `UPDATE` do lote. Duas idas seguradas viraram uma.
- O check-in virou **um comando só**: `UPDATE` do ingresso, `INSERT` no livro
  da porta e o nome do lote saem juntos. Quatro idas por pessoa viraram duas.
- A sincronização offline virou **dois comandos para o lote inteiro**, em vez
  de três por movimento.

**Medido, na mesma máquina e no mesmo banco:**

| Caminho | Antes | Depois |
|---|---|---|
| 500 compras no mesmo lote | 5/s, p50 82 s | 11/s, p50 31 s |
| Check-in, uma leitura | p50 982 ms | p50 742 ms |
| 200 leituras simultâneas | 16/s, p95 12,0 s | 22/s, p95 8,7 s |
| Subir 300 passagens offline | ~3 idas × 300 | 2,4 s no total |

**Decisão 2 — a porta não depende do banco.** A validação offline foi medida
em **5 µs por leitura** contra um manifesto de 5.000 ingressos, sem tocar no
banco. É três ordens de grandeza mais rápida que a leitura online, e é a razão
de a portaria de um festival ser um problema resolvido enquanto a abertura de
vendas não é. **Recomendação operacional: em evento grande, a portaria opera
com o manifesto baixado, não online.**

**O que continua sendo o teto, e não se resolve com código.** Depois da
correção, o que sobra na fila de compra é latência de rede vezes o número de
pessoas esperando pela mesma linha. Dois caminhos, nesta ordem:

1. **Banco no mesmo continente.** O banco de desenvolvimento está em
   `us-east-1`, a uns 120 ms daqui. Produção nasce em `sa-east-1` (ADR-009),
   com ida e volta de 10 a 20 ms. Como o tempo de tranca é dominado por essa
   volta, a expectativa é de **5 a 10 vezes** mais vazão no mesmo código —
   algo entre 60 e 100 reservas por segundo por lote. **Precisa ser medido lá,
   não estimado.**
2. **Fila virtual** (Fase 4, já no plano). Acima disso, o caminho não é fazer
   a fila andar mais rápido: é não deixar todo mundo entrar na fila ao mesmo
   tempo.

**O que NÃO mudou, de propósito.** A correção do estoque continua sendo a
mesma: `UPDATE` condicional, sem leitura prévia. O teste de 50 compras
simultâneas para 10 ingressos continua verde, e a medição de 500 para 200
vendeu exatamente 200. Ganhar vazão à custa de vender ingresso a mais seria
troca ruim em qualquer velocidade.

---

## ADR-014 — Fila virtual

**Data:** 2026-09-09
**Status:** aceita

**Contexto.** A medição de ADR-013 mostrou o teto da abertura de vendas: cerca
de 11 reservas por segundo por lote. Para casa noturna isso é folgado. Para o
público novo — festivais de 5 a 10 mil pessoas — não é, e o motivo não é o
número: é **quem entra na fila**.

Numa abertura de festival não são 5 mil pessoas comprando 5 mil ingressos, são
20 mil tentando. As 15 mil que não vão conseguir **também disputam a mesma
linha travada do lote**, porque a tentativa que falha por falta de estoque
ainda precisa examinar aquela linha. Todo mundo espera por todo mundo, e quem
estava em primeiro lugar também estoura o tempo limite.

**Decisão.** Fila virtual, desligada por padrão e ligada por evento. Um número
fixo de pessoas compra por vez; as demais esperam **sabendo onde estão**.

O sistema não fica mais rápido. Fica **previsível** — e previsível é o que
impede a pessoa de recarregar a página dez vezes, que é o que transforma
lentidão em queda.

**A consulta precisa ser barata, e essa é a decisão técnica central.** Vinte
mil pessoas perguntando "já é minha vez?" a cada poucos segundos é carga de
sobra para derrubar exatamente o sistema que a fila protege. Então:

- cada pessoa recebe um **número de chegada**, imutável;
- o evento guarda uma **marca d'água**: todo número menor ou igual já foi
  chamado;
- a posição é a subtração de dois inteiros lidos da linha do evento. Nada
  percorre a fila.

Contar linhas a cada pergunta faria a fila virar o gargalo que ela existe para
evitar.

**O avanço é oportunista, não agendado.** Acontece dentro da própria consulta,
no máximo uma vez a cada poucos segundos por evento — a condição de tempo mora
no `WHERE`, então duas requisições simultâneas não avançam a fila duas vezes,
sem lock explícito. Sem cron, sem job, sem mais uma peça para dar errado às
duas da manhã.

**Entrar na fila é um comando só** (ADR-013): o contador do evento sobe e a
linha da fila nasce junto. É a operação mais disputada de uma abertura — 20 mil
pessoas passam por ela em poucos minutos, todas na mesma linha do evento.

**A vaga de quem some volta.** Cada pessoa chamada tem uma janela; quem não
conclui perde a vez e volta para o fim. É duro, e a alternativa é pior: a vaga
ficaria presa a quem fechou a aba, e a fila pararia de andar para todo mundo.

**A vez morre no uso.** Ao criar o pedido, a senha é queimada. Sem isso, quem
foi chamado uma vez compraria a noite inteira sem voltar para a fila — que é
precisamente o cambista com script que a fila existe para atrapalhar. E a vez
não é transferível: se fosse, viraria mercadoria.

**A estimativa vem do ritmo observado, não do teórico.** O teórico erra sempre
para pior — supõe que todo admitido usa a janela inteira, quando a maioria
compra em dois minutos. Uma fila que promete quarenta minutos e anda em cinco
perde a pessoa antes de andar. Enquanto não há ritmo medido, a tela diz
"calculando" em vez de inventar um número que a pessoa usaria para decidir se
fica.

**Consequência.** O `criarPedido` ganhou um porteiro: fila ligada sem vez
válida vira redirecionamento para a sala de espera, não mensagem de erro.
Evento com a fila desligada não paga nada por isso — uma leitura da linha do
evento, que já estava sendo lida.

---

## ADR-015 — A página do evento sai da borda

**Data:** 2026-09-09
**Status:** aceita

**Contexto.** O teste de carga anterior mediu teto de 500 acessos simultâneos
na página do evento. Para casa noturna sobra. Para uma abertura de festival em
que 20 mil pessoas abrem a página no mesmo minuto, não.

A causa estava escrita em `docs/pendencias.md` desde a medição de 08/09: o
cabeçalho lia o cookie de sessão para decidir entre "Entrar" e "Painel do
produtor", e **ler cookie torna a rota inteira dinâmica**. O Next passa a
ignorar `revalidate` em silêncio, e a página ia ao banco em toda visita.

**Decisão.** O estado de login saiu do servidor e foi para o navegador. O
cabeçalho virou HTML igual para todo mundo; um componente cliente pergunta a
`/api/sessao` se há painel e troca o botão depois.

**Segunda parte, e a que faltava no diagnóstico original:** numa rota com
parâmetros, `revalidate` sozinho **não faz nada**. Sem `generateStaticParams`,
o Next renderiza sob demanda a cada visita, e a configuração parece proteger
sem proteger — exatamente o defeito que a versão anterior tinha. A lista volta
vazia de propósito: não há o que pré-gerar no build, porque os eventos nascem
depois do deploy, e build que consulta banco é build que quebra quando o banco
pisca. O que importa é a rota entrar no regime de cache.

**Verificado, não suposto.** Antes: `Cache-Control: no-cache,
must-revalidate`. Depois: `x-nextjs-cache: MISS` na primeira visita, `HIT` nas
seguintes, com `s-maxage=15, stale-while-revalidate`. Com 500 acessos
simultâneos numa única máquina local: 500/500, p95 de 599 ms, zero falhas.

Na Vercel o ganho é maior que isso, e de outra natureza: a página cacheada é
servida pela borda e **não chega ao servidor**. A capacidade de quem só está
olhando deixa de depender do nosso banco.

**O preço.** O botão de conta aparece uma fração de segundo depois do resto da
página, como acontece na Sympla. O espaço dele é reservado antes, para que a
chegada não empurre o layout — botão que se mexe faz a pessoa clicar no lugar
errado. É troca de estética por capacidade, e numa abertura de festival não há
dúvida sobre qual das duas importa.

**O que continua fora do cache, de propósito.** Checkout, painel, portaria e
área do comprador são pessoais por natureza. E o contador de estoque na tela
pode envelhecer até 15 segundos: quem decide se ainda há ingresso é o `UPDATE`
atômico da reserva, que nunca lê cache. O pior caso é ver "disponível" e
receber "esgotou agora".
