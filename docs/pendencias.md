# O que depende de você

Lista viva. O que está aqui **não depende de código** — depende de decisão,
cadastro ou assinatura. Atualizada em 2026-09-07.

Nada nesta lista bloqueia o desenvolvimento hoje. O que está marcado como
**bloqueia go-live** impede o primeiro evento real, não o próximo commit.

---

## Agora (custa pouco hoje, caro depois)

### 1. ~~Região do banco~~ — resolvido de outro jeito
**Decidido em 2026-09-07 (ADR-009):** o banco de desenvolvimento fica onde
está. O projeto de **produção** é que nasce em `sa-east-1` (São Paulo), quando
for criado, antes do evento piloto. Migrar agora traria dois projetos em
paralelo e nenhum ganho real.

**Ação sua:** apagar o projeto `tiqueteira2`, que não está em uso.

### 2. ~~Staging na Vercel~~ — feito em 2026-09-07
No ar em **https://tiqueteira.vercel.app**, com as 12 variáveis de ambiente
configuradas nos três ambientes. Todo push na `main` gera deploy automático.

Aprendizado operacional: preencher variável de ambiente pelo formulário da
Vercel não escala e erra fácil. O caminho é a CLI — `vercel login` uma vez, e
daí em diante tudo por comando. Vale o mesmo para qualquer painel: se existe
CLI, use a CLI.

---

## Nas próximas duas semanas (bloqueiam a Fase 2)

### 3. Escolher a PSP
**Bloqueia:** o adaptador real, a venda de verdade. Não bloqueia mais nada —
o sistema inteiro está sendo construído contra o `FakeProvider`.

**Como decidir, na ordem:**
1. Criar conta de **sandbox em duas candidatas**
2. Em cada uma, fazer o *spike*: criar um recebedor, transacionar com split,
   e **liberar o saldo manualmente**
3. Registrar o resultado em `docs/psp-avaliacao.md`

**O que testar, porque é onde elas diferem:**

| Pergunta | Por que importa |
|---|---|
| Consegue segurar o saldo do produtor e liberar sob nosso comando? | Sem isso não existe reserva de garantia, e o chargeback vira prejuízo nosso |
| O onboarding do recebedor é 100% por API? | Se tiver etapa manual, cada produtor novo vira trabalho de escritório |
| Aceita split em valor absoluto, ou só percentual? | Nosso cálculo chega em centavos fechados; percentual reintroduz arredondamento |
| Devolve Pix por API? | Reembolso em massa de evento cancelado precisa ser automático |
| Manda webhook de chargeback? | Sem isso a reserva não tem como ser recalculada |

O código já recusa, na inicialização, qualquer PSP que falhe nesses pontos —
então essa conversa com o comercial delas é obrigatória, não opcional.

### 4. Taxas negociadas
Percentual de conveniência, comissão e taxa fixa iniciais. Não vão para o
código: são configuração por produtor no banco. Mas preciso de um número para
o piloto.

---

## Decisões comerciais a alinhar (levantadas em 2026-09-07)

### Domínio próprio
Comprar `.com.br` no Registro.br ou `.com` na Cloudflare (preço de custo, sem
markup na renovação).

**Recomendação:** usar subdomínio para ingressos — `ingressos.dominio.com.br` —
e não a raiz. O e-mail transacional precisa de reputação própria, e problema de
entrega de ingresso não pode contaminar o domínio institucional do grupo.

A ligação com a Vercel é um CNAME.

### CNPJ operador e CNAE
**Decisão tomada em 2026-09-07:** reaproveitar um CNPJ existente do grupo
(espaço de eventos) e adicionar os CNAEs da atividade de bilheteria. Empresa
com histórico passa mais rápido no KYC da PSP do que empresa recém-aberta.

**CNAEs candidatos** (validar com o contador):

| CNAE | Descrição |
|---|---|
| 6319-4/00 | Portais, provedores de conteúdo e outros serviços de informação na internet |
| 7990-2/00 | Serviços de reservas e outros serviços de turismo não especificados |
| 8230-0/01 | Organização de feiras, congressos, exposições e festas |
| 6209-1/00 ou 6311-9/00 | Serviços de TI / tratamento de dados |
| 7319-0/02 | Promoção de vendas |

**Não incluir** CNAE que sugira atividade financeira ou de pagamento: alimenta
exatamente a discussão de instituição de pagamento que a arquitetura evita.

**Mais importante que o CNAE:** o código de serviço da NFS-e, que define o ISS.
Para intermediação, LC 116/2003 itens 10.05 (agenciamento, corretagem ou
intermediação) e 10.09 (representação). Alíquota de 2% a 5%, conforme o
município.

A nota é sobre a **comissão e a conveniência**, nunca sobre o valor do
ingresso — é o que separa tributar R$ 10 mil de tributar R$ 100 mil.

**Três perguntas para o contador:**
1. Adicionando esses CNAEs, a empresa muda de anexo no Simples (III ou V)?
2. O faturamento da plataforma aproxima a empresa do teto de R$ 4,8 milhões?
3. Como fica a responsabilidade da empresa quando um produtor terceiro
   cancelar um evento? O consumidor reclama de quem emitiu a nota.

**Prazo:** ajustar o CNAE **antes** de abrir cadastro na PSP. Se o cadastro
disser apenas "espaço de eventos" e a operação for bilheteria com split para
terceiros, a operadora pode classificar como risco alto ou recusar — e
refazer custa semanas.

### Parcelamento com juros — quem paga
Três formatos possíveis, e o campo `tenants.juros_parcelamento_absorvidos` já
permite regra diferente por produtor:

| Modelo | Quem paga | Efeito |
|---|---|---|
| Sem juros, produtor absorve | Produtor recebe menos | Ticket médio sobe, margem cai |
| Com juros, comprador paga | Comprador vê parcela maior | Margem preservada, conversão cai |
| Sem juros até N parcelas | Misto | O mais usado no mercado |

**Falta:** a tabela de juros por número de parcelas da PSP escolhida. Sem ela
não há como calcular, e cada PSP tem a sua.

### Adiantamento de repasse
É **operação de crédito**, não de bilheteria: adiantar R$ 50 mil e o evento ser
cancelado transforma a plataforma em credora de quem acabou de perder dinheiro.

Referência de mercado (Sympla): percentual escalonado 20/40/60/80% das vendas,
valor mínimo, taxa fixa e análise de risco caso a caso.

**Decisão de arquitetura:** modelar a condição comercial por produtor agora —
conveniência, comissão, reserva, prazo de liberação e limite de adiantamento —
para que negociar com um cliente novo seja preencher formulário, não mexer em
código.

**A conversar com a PSP:** várias oferecem antecipação com recurso próprio
delas. A plataforma fica com parte da taxa sem assumir risco de crédito nem
imobilizar capital.

### Carga simultânea na abertura de vendas
Estado atual do banco (plano gratuito): **15 conexões** ao Postgres e teto de
**200 clientes** no pooler. Serve para venda normal; **não serve** para abertura
com milhares de pessoas ao mesmo tempo — e o sintoma seria erro de conexão na
hora exata em que todos tentam comprar.

Soluções, em ordem de custo:

1. **Subir o tamanho do banco no dia da abertura.** Minutos para aplicar,
   dezenas de dólares no mês.
2. **Cache da página do evento.** Quem só olha não precisa tocar no banco;
   só quem clica em comprar precisa. Derruba a carga em mais de 90%.
3. **Fila virtual** (Fase 4). Em vez de 2.000 pessoas travarem o sistema, 200
   compram e as demais veem a posição na fila.

O **check-in não preocupa**: a portaria baixa o manifesto assinado antes de
abrir os portões e valida no próprio aparelho. Mil pessoas entrando não geram
mil consultas ao banco.

**Ação:** incluir teste de carga na Fase 1.5, junto com o evento fantasma —
500 compras simultâneas contra o ambiente de teste, para decidir o tamanho do
banco com número e não com opinião.

---

## Bloqueiam go-live (não bloqueiam código)

### 5. Cinco decisões de negócio (plano, seção 1)

| # | Decisão | Impacto se ficar em aberto |
|---|---|---|
| 1 | Qual CNPJ do grupo é o operador da plataforma | Sem ele não há conta na PSP nem nota fiscal |
| 2 | Qual PSP | Ver item 3 |
| 3 | Quem responde pelo reembolso se o evento for cancelado: produtor ou grupo | Define o contrato e o tamanho da reserva de garantia |
| 4 | Receita: conveniência sobre o comprador, comissão sobre o produtor, ou os dois | Já está configurável; falta o número |
| 5 | Ingresso nominal (com CPF) ou ao portador | **Recomendação: nominal.** É a defesa mais barata e mais eficaz contra print revendido |

### 6. Regras de transferência de titularidade
Prazo limite antes do evento, quantas transferências por ingresso, se cobra
taxa, e se o novo titular pode herdar meia-entrada.

**Sugestão para o piloto:** 24h antes, 1 transferência, sem taxa, meia-entrada
não transferível.

### 7. Jurídico
- [ ] Contrato plataforma–produtor
- [ ] Termos de uso e política de privacidade do comprador
- [ ] Definir quem é controlador e quem é operador dos dados, para a LGPD
- [ ] Política de reembolso escrita

Ponto sensível: **repassar a base de compradores ao produtor é
compartilhamento de dado pessoal** e precisa estar previsto em contrato e na
política de privacidade. É comum passar despercebido e é exatamente o que a
ANPD olha.

### 8. Operação
- [ ] Conferência de documento na porta: sim ou não, e para quais eventos
- [ ] Quem são as pessoas da portaria e quantos aparelhos
- [ ] E-mail transacional: domínio próprio para enviar os ingressos
      (`ingressos@seudominio.com.br`), com SPF, DKIM e DMARC configurados —
      senão o ingresso cai no spam, que é o pior suporte possível

---

## Já resolvido

- [x] Repositório criado, privado, com histórico
- [x] Banco provisionado, com migrations e RLS aplicados
- [x] Isolamento entre produtores provado por teste automatizado
- [x] CI rodando lint, tipos, migrations, RLS, testes e build
