# Benchmark e Direção de Design — Tiqueteira

Documento complementar ao `docs/plano.md`.

Reúne o que Sympla e Ticket360 já resolveram publicamente, converte isso em decisões nossas, e define a direção visual e de interface do produto.

---

## Índice

1. [O que copiar e o que não copiar](#1-o-que-copiar-e-o-que-não-copiar)
2. [Benchmark de políticas com decisão](#2-benchmark-de-políticas-com-decisão)
3. [Cadastro sem atrito](#3-cadastro-sem-atrito)
4. [Direção visual](#4-direção-visual)
5. [Anatomia das telas](#5-anatomia-das-telas)
6. [Voz da interface](#6-voz-da-interface)
7. [Impacto no schema](#7-impacto-no-schema)
8. [Prompts para o Claude Code](#8-prompts-para-o-claude-code)
9. [Fontes](#9-fontes)

---

## 1. O que copiar e o que não copiar

**Copiar:** regras de negócio, prazos, fluxos, arquitetura de informação e nomenclatura já compreendida pelo público brasileiro ("Meus Ingressos", "Meus Pedidos", "Transferir ingresso", "virada de lote").

**Não copiar:** texto literal de termos de uso e política de privacidade, identidade visual, logotipo, paleta e layout característico. São obra protegida. Usar como referência de estrutura e escrever os nossos.

**Calibragem:** Sympla e Ticket360 operam em escala e perfil diferentes — grandes turnês, teatro, mapa de assentos, milhares de produtores. Nosso cliente opera casas e espaços com público recorrente e entrada por setor. Copiar complexidade que não precisamos atrasa o piloto.

---

## 2. Benchmark de políticas com decisão

### 2.1. Cancelamento e reembolso pelo comprador

| | Sympla | Ticket360 | **Nossa decisão** |
|---|---|---|---|
| Prazo padrão | Até 7 dias corridos da compra | Política do produtor + garantia opcional | 7 dias corridos, alinhado ao CDC |
| Compra próxima ao evento | Se faltam 7 dias ou menos, cancelar até 48h antes do início | — | Mesma regra |
| Reembolso parcial | Não faz — cancela o pedido inteiro | — | **Permitir parcial.** Ver 2.2 |
| Flexibilização | O organizador pode ampliar prazos | Política por produtor | Configurável por evento, nunca abaixo do mínimo legal |
| Taxa de conveniência | Descontada do reembolso | Descontada | **Devolver integralmente.** Ver 2.3 |
| Quem executa | Obrigatoriamente pelas ferramentas da plataforma; reembolso por fora é vedado | — | Mesma regra, em contrato e no sistema |

### 2.2. Reembolso parcial — onde discordamos do mercado

A Sympla não permite cancelar um ingresso dentro de um pedido com vários: cancela tudo. A orientação usual deles é cancelar e recomprar, ou repassar os ingressos excedentes a outra pessoa.

Isso é limitação técnica virando política. Quem compra 4 ingressos e precisa devolver 1 fica preso. **Decisão: suportar reembolso parcial por ingresso desde a Fase 2.** É diferencial real, custa pouco se o modelo de dados já nasce com `refunds` ligado a ingresso e não só a pedido, e é péssimo de retrofitar depois.

Consequência no schema: `refunds` ganha `ticket_id` opcional; quando preenchido, o reembolso é do ingresso, não do pedido.

### 2.3. Taxa de conveniência no reembolso

Prática do mercado: descontar a taxa de serviço do valor devolvido.

Entendimento do Procon-SP: a venda do ingresso é serviço acessório ao evento. Se o consumidor desiste dentro do prazo legal, cabe restituição integral do que foi pago, taxa de conveniência incluída — e cláusula em contrário é tida como abusiva.

**Decisão: devolver 100%, taxa incluída, na desistência dentro dos 7 dias.** Custa pouco no volume real e elimina uma frente inteira de reclamação e exposição. Fora desse prazo, vale a política do evento.

Consequência: o motor de reembolso calcula dois cenários — devolução integral (arrependimento legal) e devolução conforme política do evento (fora do prazo). O primeiro debita a comissão do operador; o segundo não necessariamente.

### 2.4. Transferência de titularidade

| | Sympla | **Nossa decisão** |
|---|---|---|
| Limite | Uma troca por ingresso, por padrão | Igual — `max_transferencias_por_ingresso = 1`, configurável |
| Prazo | Até 24h antes do início | Igual |
| Custo | Sem cobrança | Sem cobrança no piloto |
| Ingresso anterior | Invalidado automaticamente | Igual — é o que faz a coisa funcionar |
| Vínculo do pedido | Permanece com quem comprou | Igual. **Reembolso vai sempre para quem pagou** |
| Reversão | Não pode ser desfeita | Igual, com override de admin registrado no `audit_log` |
| Fora da plataforma | Não se responsabilizam | Igual, e dizemos isso no ato da transferência |

Ponto que vale copiar quase literalmente na lógica: eles tratam a troca como **autorização de uso**, não como cessão do pedido. É o enquadramento que resolve a fraude do reembolso.

### 2.5. Cancelamento pelo produtor e pelo evento

- A Sympla permite ao organizador cancelar um pedido de forma self-service **até 48h após o término do evento**. Prazo sensato: cobre o "comprou e não veio por erro nosso" sem abrir janela indefinida. **Adotar.**
- Evento cancelado: reembolso obrigatoriamente pela plataforma. **Adotar**, e é o que garante que a reserva retida cubra a devolução.
- Adiamento: ingresso migra para a nova data, com janela de reembolso para quem não puder. Já está no plano.

### 2.6. Repasse ao produtor

| | Sympla | **Nossa decisão** |
|---|---|---|
| Prazo padrão | 3º dia útil após o término do evento | D+2 úteis para a parcela principal |
| Reserva de garantia | Não divulgada publicamente | 10% a 30%, liberada em D+30/45, **separada por método** |
| Antecipação | 20/40/60/80% das vendas, mínimo R$ 300, taxa de 3,49%, análise de risco, crédito em até 1 dia útil após aprovação | Fora do MVP. Modelar campo desde já |
| Custo de transferência | Isento em alguns bancos, com custo em outros | Repassar o custo real da PSP, exibido no extrato |
| Configuração | Conta bancária cadastrada por evento no menu financeiro | Recebedor por tenant, não por evento — mais simples |

O modelo de antecipação deles é uma boa referência de produto: percentual escalonado, piso mínimo, taxa fixa e análise de risco. Quando chegar a Fase 4, é esse o desenho a seguir.

### 2.7. Modelo de taxa

A Sympla deixa o produtor escolher **absorver ou repassar** a taxa de serviço, e aplica taxa mínima fixa em ingressos de valor baixo (no material deles, R$ 3,99 para ingressos de até R$ 39,90).

Ambas as ideias são boas e baratas de implementar:

- `taxa_absorvida_pelo_produtor` (bool por tenant ou por evento). Se true, o comprador paga o preço cheio e o produtor recebe menos. Se false, a taxa entra somada no checkout.
- `taxa_minima_centavos` — protege a margem em ingresso barato, onde o percentual não paga o custo da transação.

**Adotar as duas.**

### 2.8. Antifraude e cambismo

Os termos da Ticket360 preveem suspensão de conta e retenção de valores diante de indícios de revenda ilegal e de uso reiterado de benefícios sem direito, como meia-entrada indevida.

**Adotar como regra de produto:** limite por CPF (já no plano), bloqueio de conta por padrão suspeito, e retenção do repasse quando houver indício de fraude. Precisa estar previsto no contrato com o produtor, senão a retenção é indefensável.

### 2.9. Garantia de reembolso como produto pago

A Ticket360 vende uma garantia opcional: taxa de adesão de 10% sobre o total pago, não reembolsável, que cobre óbito, problema grave de saúde e viagem profissional imprevista, com limite por ingresso e análise documental em até 10 dias úteis. Não cobre arrependimento, conflito de agenda nem cancelamento pelo produtor.

É uma linha de receita adicional inteligente, mas é produto securitário na prática e atrai discussão regulatória e de consumidor. **Fora do escopo.** Registrado aqui como possibilidade futura, não como meta.

---

## 3. Cadastro sem atrito

Observação de campo: no login da Sympla, a primeira opção oferecida é **continuar sem senha**, antes de Google e antes de e-mail com senha. Isso não é detalhe de interface, é decisão de conversão. Quem compra ingresso não quer criar conta.

**Nossa decisão — três camadas, nesta ordem:**

1. **Compra sem conta.** Nome, e-mail e CPF no checkout. Pronto. Nenhum cadastro é exigido para comprar.
2. **Acesso por link mágico.** Depois, para ver o ingresso ou transferir, o comprador informa o e-mail e recebe um link de acesso. Sem senha, nunca.
3. **Google** como atalho opcional, para quem prefere.

Senha própria não entra no produto do lado do comprador. Do lado do produtor e do admin, sim — ali a conta é permanente e o risco é outro.

Consequência técnica: o "usuário comprador" é derivado do e-mail do pedido, não de um cadastro prévio. A tabela `users` continua servindo produtor, admin e portaria; o comprador acessa por token de e-mail com expiração curta e uso único.

---

## 4. Direção visual

### 4.1. O problema com o padrão do mercado

Sympla e Ticket360 usam fundo branco e cartões uniformes. O efeito é que os cartazes dos eventos — que são peças gráficas fortes, coloridas e feitas para chamar atenção — viram produtos numa prateleira de e-commerce, todos com o mesmo peso. A interface compete com a arte em vez de emoldurá-la.

Nosso conteúdo é o cartaz. A casa noturna, o show, a festa. **A interface deve ser uma moldura silenciosa e deixar a arte carregar a cor.**

### 4.2. Tokens

```css
/* Base — tom de tinta, com leve viés frio. Não é preto puro:
   preto puro achata a arte e cansa a vista em tela de celular à noite. */
--surface-base:      #12131A;
--surface-raised:    #1C1E28;   /* cartão, modal, campo */
--surface-line:      #2A2D3A;   /* divisor, borda */

/* Texto — off-white levemente quente. Branco puro sobre escuro vibra. */
--text-primary:      #F2F0EB;
--text-muted:        #8A8B99;

/* Acento — INJETADO POR TENANT.
   Cada casa tem identidade própria: KIKI não é Fabrique não é Usine.
   O sistema é neutro; a cor vem do produtor. */
--accent:            var(--tenant-accent, #5B4BFF);
--accent-contrast:   #FFFFFF;

/* Semânticos */
--success:           #2FBF71;
--warning:           #E8A33D;   /* contagem regressiva, últimos ingressos */
--danger:            #E5484D;
```

O acento por tenant é a decisão de produto mais importante desta seção. Uma tiqueteira white-label não pode ter uma cor só. O token vem do banco (`tenants.cor_acento`) e é injetado na raiz do documento na renderização da vitrine.

### 4.3. Tipografia

Duas famílias, com papéis claros:

- **Archivo** para títulos e números. Tem largura e peso variáveis, aguenta caixa alta de cartaz sem parecer genérica e funciona bem em título curto de evento.
- **Inter** para corpo, formulário e dados de interface.

Escala: 12 / 14 / 16 / 20 / 28 / 40 / 56. Corpo com no máximo 70 caracteres por linha. Número de preço em tabular, para alinhar coluna.

Evitar: caixa alta em rótulo de formulário, uma palavra colorida dentro do título, e "eyebrow" acima de cada seção.

### 4.4. Princípios

1. **Mobile primeiro, de verdade.** A compra acontece no celular, à noite, quase sempre a partir de um link do Instagram. A tela de 380px é o projeto; o desktop é a adaptação.
2. **Do link ao pagamento em três telas.** Evento → carrinho → pagamento. Sem cadastro no meio.
3. **O cartaz manda.** Proporção 3:4, sem recorte que corte o texto da arte, sem sobreposição de gradiente por decoração.
4. **Urgência honesta.** Contagem regressiva da reserva e aviso de últimos ingressos só quando forem verdade. Escassez falsa destrói confiança e é problema de consumidor.
5. **Uma ousadia só.** O botão de compra é o elemento memorável — grande, fixo no rodapé no celular, na cor do produtor. Todo o resto é quieto.

---

## 5. Anatomia das telas

### 5.1. Vitrine do produtor — `/[tenantSlug]`

```
┌──────────────────────────────┐
│ [logo do produtor]      ⌄    │
├──────────────────────────────┤
│                              │
│   PRÓXIMOS                   │
│  ┌────────┐  ┌────────┐      │
│  │        │  │        │      │  cartaz 3:4
│  │ cartaz │  │ cartaz │      │  título + data + local
│  └────────┘  └────────┘      │  "a partir de R$ X"
│   Título       Título        │
│   sex, 12 set  sáb, 13 set   │
│                              │
│   ESGOTADOS / PASSADOS       │
└──────────────────────────────┘
```

Sem carrossel automático. Sem banner rotativo. Grade simples de dois por linha no celular.

### 5.2. Página do evento — `/e/[eventSlug]`

Ordem vertical: cartaz em largura total → título, data, local → seletor de ingressos → descrição → política de reembolso e transferência → local com mapa.

O **seletor de ingressos fica acima da descrição**, não abaixo. Quem chegou pelo Instagram já sabe qual é o evento; obrigar a rolar até o fim para comprar é perda de conversão.

Botão de compra fixo no rodapé assim que o usuário rola, sempre visível, com o total atualizado.

Cada tipo de ingresso mostra: nome, lote, preço, taxa de conveniência **discriminada** e quantidade. Taxa embutida sem exibição é risco de Procon.

### 5.3. Checkout — `/checkout/[orderId]`

Uma tela só, com a contagem regressiva no topo. Nome, e-mail, CPF, telefone. Escolha entre Pix e cartão. Resumo fixo com subtotal, conveniência e total.

No Pix: QR grande, botão de copiar código, e a tela detecta o pagamento sozinha — sem pedir para o usuário clicar em "já paguei".

Nenhuma criação de conta. Nenhum upsell antes do pagamento.

### 5.4. Meus ingressos — `/meus-ingressos`

Entrada por link mágico. Lista de ingressos com QR, botão de transferir e botão de cancelar quando dentro do prazo. Se o prazo passou, o botão não aparece — e uma linha explica por quê, em vez de sumir sem explicação.

### 5.5. Painel do produtor — `/painel`

Aqui a lógica se inverte: **densidade acima de estética.** Produtor quer número na tela.

Topo com vendidos, faturamento bruto, líquido a receber e data prevista do repasse. Abaixo, curva de vendas por dia. Depois, tabela de pedidos com busca por nome, CPF e código.

O status do repasse deve ser visível o tempo todo — agendado, pago ou com pendência. É a informação que o produtor mais procura e a que mais gera contato com o suporte.

### 5.6. Portaria — `/portaria/[eventId]`

Tela preta, câmera ocupando quase tudo. Resultado em bloco de cor cheia: verde entra, vermelho não entra, âmbar exige conferência de documento.

Fonte grande. Contador de presentes num canto. Botão de busca manual sempre alcançável com o polegar. Indicador de sincronização discreto, mas presente.

Nada mais. Portaria não é lugar de menu.

---

## 6. Voz da interface

- Frase curta, voz ativa, primeira pessoa do plural só quando necessário.
- O botão diz o que acontece: "Pagar com Pix", não "Continuar".
- A mesma ação tem o mesmo nome do começo ao fim: se o botão diz "Transferir ingresso", a confirmação diz "Ingresso transferido".
- Erro explica o que houve e o que fazer. Não pede desculpas, não é vago: "Este lote esgotou enquanto você preenchia. Veja os lotes disponíveis" em vez de "Ocorreu um erro".
- Tela vazia é convite: "Nenhum evento por aqui ainda" com o caminho para criar o primeiro.
- Nunca chamar o comprador de "usuário" na interface.

---

## 7. Impacto no schema

Acréscimos ao modelo da seção 7 do plano:

```
tenants
  + cor_acento                      -- token --accent da vitrine
  + logo_url
  + taxa_absorvida_pelo_produtor    -- bool
  + taxa_minima_centavos            -- piso da conveniência

events
  + cancelamento_ate_dias_compra        -- padrão 7
  + cancelamento_ate_horas_evento       -- padrão 48
  + permite_reembolso_parcial           -- padrão true
  + cancelamento_produtor_ate_horas_pos -- padrão 48

refunds
  + ticket_id (nullable)            -- reembolso por ingresso, não só por pedido
  + inclui_conveniencia             -- bool, true na desistência legal
  + tipo (arrependimento_legal | politica_evento | evento_cancelado | chargeback)

buyer_access_tokens                 -- tabela nova, link mágico
  id, email, token_hash, expires_at, usado_em, ip
```

Nenhum desses campos existe hoje. Todos são baratos agora e caros depois.

---

## 8. Prompts para o Claude Code

Encaixam entre as Fases 1 e 3 da seção 20 do plano.

**A. Design system (antes de qualquer tela)**

> "Leia `docs/benchmark-e-design.md`, seção 4. Configure o design system: tokens CSS em `globals.css`, Archivo e Inter via `next/font`, escala tipográfica, e o mecanismo de injeção do acento por tenant a partir de `tenants.cor_acento`. Crie uma página `/dev/tokens` mostrando paleta, escala e componentes base. Não crie nenhuma tela de produto ainda."

**B. Componentes base**

> "Componentes de UI conforme a seção 5: PosterCard, TicketTypeSelector, StickyBuyBar, CountdownTimer, EmptyState e ErrorState. Mobile primeiro, 380px como referência. Foco de teclado visível e `prefers-reduced-motion` respeitado."

**C. Acesso sem senha**

> "Implemente o acesso do comprador conforme a seção 3: compra sem conta; tabela `buyer_access_tokens` com token de uso único e expiração de 15 minutos; rota `/meus-ingressos` autenticada por link mágico enviado por e-mail. Sem senha para comprador. Testes primeiro, cobrindo token expirado, reutilizado e e-mail inexistente."

**D. Motor de política de reembolso**

> "Implemente `src/domain/refund-policy.ts` conforme a seção 2 do benchmark: dado um pedido, a data atual e a configuração do evento, determinar se o cancelamento é permitido e qual o valor devolvido. Regras: 7 dias corridos da compra; se faltarem 7 dias ou menos para o evento, até 48h antes do início; na desistência legal devolve 100% incluindo conveniência; fora do prazo vale a política do evento. Suporte a reembolso parcial por ingresso. Função pura, sem I/O, com testes cobrindo cada fronteira de prazo."

**E. Migration dos novos campos**

> "Adicione ao schema os campos da seção 7 do `docs/benchmark-e-design.md`, com migration e valores padrão. Atualize `docs/plano.md` seção 7 para refletir o schema real."

**F. Taxas configuráveis**

> "Estenda `src/lib/fees.ts` para suportar `taxa_absorvida_pelo_produtor` e `taxa_minima_centavos`. Quando a taxa é absorvida, o comprador paga o preço de face e o produtor recebe menos; quando é repassada, a taxa entra somada e discriminada no checkout. Testes cobrindo o piso mínimo em ingresso barato."

---

## 9. Fontes

Políticas públicas consultadas:

- Sympla — Como cancelar sua compra: https://ajuda.sympla.com.br/hc/pt-br/articles/6484108930580-Como-cancelar-sua-compra-na-Sympla
- Sympla — Posso cancelar uma compra de evento online ou presencial: https://ajuda.sympla.com.br/hc/pt-br/articles/360032895972-Posso-cancelar-uma-compra-de-um-evento-online-ou-presencial
- Sympla — Cancelar pedido e reembolsar participante (produtor): https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15445710943757-Posso-cancelar-um-pedido-e-reembolsar-um-participante
- Sympla — Meu evento foi cancelado: https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15446153783565-Meu-evento-foi-cancelado-O-que-devo-fazer
- Sympla — Troca de titularidade: https://ajuda.sympla.com.br/hc/pt-br/articles/360000383866-Como-trocar-a-titularidade-do-ingresso
- Sympla — Troca de titularidade self-service (produtor): https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15445792091661-Saiba-mais-troca-de-titularidade-self-service
- Sympla — Como funciona / repasse e taxas: https://produtores.sympla.com.br/como-funciona/
- Sympla — Adiantamento de repasse: https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/33630645675149-Adiantamento-de-Repasse-na-Sympla
- Ticket360 — Central de Ajuda (garantia de reembolso, termos de uso): https://www.ticket360.com.br/central-de-ajuda

Entendimento do Procon-SP sobre restituição da taxa de conveniência foi obtido por meio de respostas públicas da própria empresa em canal de reclamação, e **deve ser confirmado diretamente no Procon-SP** antes de virar cláusula contratual.

> Aviso: prazos, taxas e regras das plataformas mudam. Reconferir nas páginas acima antes do go-live.
