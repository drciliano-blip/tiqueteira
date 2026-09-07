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

### 2. Staging na Vercel — 15 minutos
**Por quê:** último item do *Definition of Done* da Fase 0. Com ele, cada push
vira um link que você abre e vê funcionando, em vez de depender da minha
palavra de que está tudo certo.

**Como:** entrar na Vercel, *Add New → Project*, importar o repositório
`drciliano-blip/tiqueteira`, e me avisar — as variáveis de ambiente eu passo.

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
