# Runbook

O que fazer quando algo der errado, escrito para ser lido às 23h com fila na
porta. Cada seção começa pelo sintoma, não pela causa.

Primeiro lugar para olhar sempre: **`/painel/saude`**. Ele mede os sinais que
importam e diz o que fazer em cada um.

---

## Índice

1. [O comprador diz que pagou e não recebeu o ingresso](#1-o-comprador-diz-que-pagou-e-não-recebeu-o-ingresso)
2. [A portaria está sem internet](#2-a-portaria-está-sem-internet)
3. [O leitor de QR não abre a câmera](#3-o-leitor-de-qr-não-abre-a-câmera)
4. [O mesmo ingresso passou duas vezes](#4-o-mesmo-ingresso-passou-duas-vezes)
5. [O webhook não chegou](#5-o-webhook-não-chegou)
6. [A operadora saiu do ar durante a venda](#6-a-operadora-saiu-do-ar-durante-a-venda)
7. [Precisa cancelar um evento às pressas](#7-precisa-cancelar-um-evento-às-pressas)
8. [O repasse não caiu](#8-o-repasse-não-caiu)
9. [O site está lento ou fora do ar](#9-o-site-está-lento-ou-fora-do-ar)
10. [Comandos de emergência](#10-comandos-de-emergência)

---

## 1. O comprador diz que pagou e não recebeu o ingresso

**Na hora, na porta:**

1. Abra **Painel → Vendas** e busque pelo **nome, CPF ou e-mail**.
2. Se o pedido aparece como **Pago**, o ingresso existe. Clique no pedido e
   veja os códigos. A portaria pode liberar pela busca por nome.
3. Clique em **Reenviar ingresso**. Peça para a pessoa conferir o spam.

**Se o pedido aparece como Aguardando:**

O dinheiro pode ter entrado sem o aviso chegar. A conciliação roda de hora em
hora e resolve sozinha; para não esperar, dispare manualmente:

```
curl -X POST https://SEU_DOMINIO/api/jobs/conciliacao \
  -H "Authorization: Bearer $JOB_SECRET"
```

**Se o pedido não existe:** a pessoa pagou um Pix que não é nosso, ou usou
outro e-mail. Peça o comprovante e confira o destinatário.

---

## 2. A portaria está sem internet

**O sistema foi feito para isso.** O aparelho valida com a lista baixada.

1. Confira o cabeçalho da tela: deve dizer **sem rede** e mostrar a idade da
   lista.
2. Se disser "sem lista baixada", leve o aparelho até onde houver sinal, abra
   a portaria uma vez e volte. A lista fica guardada.
3. As entradas ficam numa fila e sobem sozinhas quando o sinal voltar. O
   contador do cabeçalho mostra quantas faltam.

**Cuidado com dois portões offline ao mesmo tempo.** Sem comunicação entre
eles, o mesmo QR passa duas vezes. Se a rede caiu e há mais de um portão:
concentre a entrada num só, ou aceite o risco sabendo que a duplicidade
aparece na sincronização — não na hora.

---

## 3. O leitor de QR não abre a câmera

1. **O endereço precisa ser HTTPS.** Câmera não funciona em `http://`.
2. Toque no cadeado da barra de endereço → **Permissões** → liberar câmera →
   recarregar.
3. Se a permissão foi negada antes, o navegador não pergunta de novo: é
   preciso liberar manualmente nas configurações do site.
4. **Enquanto resolve:** use **Buscar nome**. Funciona sem câmera e sem rede.

---

## 4. O mesmo ingresso passou duas vezes

A segunda leitura mostra **a hora e o nome de quem liberou a primeira**. Use
isso na conversa: "este ingresso entrou às 23h14".

**Se a pessoa insiste que não entrou**, provavelmente o QR foi repassado por
print. Confira o documento contra o nome do titular. Em evento nominal, o
nome no ingresso é a defesa.

**Se as duas leituras foram offline em portões diferentes**, o sistema não
tinha como impedir. Registre o caso e trate na hora.

---

## 5. O webhook não chegou

**Sintoma:** pedidos parados em "Aguardando pagamento" há mais de 24h, no
painel de saúde.

1. Dispare a conciliação (comando na seção 1).
2. Se continuar, confira no painel da operadora se a URL do webhook está
   correta: `https://SEU_DOMINIO/api/webhooks/payments`.
3. Veja **Painel → Saúde → Últimos webhooks**. Se aparecerem entradas com
   **assinatura inválida**, o segredo mudou de um lado só — compare
   `PAYMENT_WEBHOOK_SECRET` com o que está na operadora.

---

## 6. A operadora saiu do ar durante a venda

1. O comprador vê "O sistema de pagamento não respondeu". **Os ingressos dele
   continuam reservados** — a reserva não é perdida por falha da operadora.
2. Se a instabilidade durar, **tire o evento da vitrine**: Painel → evento →
   **Tirar da vitrine**. É melhor que vender e não conseguir cobrar.
3. Avise nas redes. Silêncio durante instabilidade gera mais chamado que o
   problema em si.

---

## 7. Precisa cancelar um evento às pressas

1. Painel → evento → **Zona de risco** → **Cancelar evento**.
2. Escreva o motivo de verdade: ele fica na auditoria e é o que sustenta a
   conversa com o consumidor depois.
3. Digite o título do evento para confirmar.

**O que acontece em seguida:** as vendas encerram, todos os pedidos pagos
entram na fila de reembolso integral — taxa incluída —, os ingressos são
invalidados e os repasses agendados são cancelados.

O reembolso roda em lotes. Acompanhe em **Painel → Saúde**: se aparecerem
tarefas mortas, alguma devolução falhou e precisa de gente.

---

## 8. O repasse não caiu

1. **Painel → Saúde** → sinal "Repasses com falha".
2. Confira se o cadastro do produtor na operadora está **aprovado**. KYC
   reprovado ou pendente trava a liberação.
3. Confira se a data prevista já passou: a parcela principal sai em D+2 úteis,
   e a reserva de garantia só em D+30/45.

**Nunca prometa data que o sistema não mostra.** O produtor confere no extrato
da operadora, e promessa quebrada custa mais que atraso avisado.

---

## 9. O site está lento ou fora do ar

1. Veja o painel da Vercel: se o deploy mais recente falhou, o anterior
   continua no ar.
2. Veja o painel do Supabase: **conexões em uso**. O plano atual tem 15
   conexões e 200 clientes simultâneos.
3. **Em abertura de vendas grande, suba o tamanho do banco antes.** É
   configuração de minutos, e o sintoma de faltar é erro de conexão
   exatamente na hora em que todo mundo tenta comprar.

---

## 10. Comandos de emergência

Todos exigem o `JOB_SECRET`, que está nas variáveis de ambiente da Vercel.

```bash
# Recuperar pagamentos cujo aviso não chegou
curl -X POST https://SEU_DOMINIO/api/jobs/conciliacao \
  -H "Authorization: Bearer $JOB_SECRET"

# Devolver reservas vencidas e liberar estoque
curl -X POST https://SEU_DOMINIO/api/jobs/expirar-reservas \
  -H "Authorization: Bearer $JOB_SECRET"

# Reenviar ingressos que estão na fila
curl -X POST https://SEU_DOMINIO/api/jobs/enviar-ingressos \
  -H "Authorization: Bearer $JOB_SECRET"

# Devolver Pix pago depois da expiração
curl -X POST https://SEU_DOMINIO/api/jobs/pagamento-atrasado \
  -H "Authorization: Bearer $JOB_SECRET"
```

---

## Antes de cada evento

- [ ] Abrir a portaria em cada aparelho **com rede** e confirmar que a lista
      baixou
- [ ] Confirmar que a bateria dos aparelhos está cheia e há carregador na porta
- [ ] Conferir **Painel → Saúde**: nenhum sinal em vermelho
- [ ] Testar a leitura de um ingresso real antes de abrir os portões
- [ ] Decidir: portão único ou vários? Se vários, garantir rede para todos

## Depois de cada evento

- [ ] Conferir se a fila de sincronização zerou em todos os aparelhos
- [ ] Comparar o contador de presentes com a contagem física
- [ ] Conferir **Painel → Saúde** antes de dormir

---

## Nota de infraestrutura

As tarefas automáticas rodam pelo agendador da Vercel, configurado em
`vercel.json`. **O plano Hobby limita o número de tarefas agendadas e a
frequência.** Se as tarefas não estiverem rodando de minuto em minuto,
verifique o plano da conta — ou dispare pelos comandos acima.
