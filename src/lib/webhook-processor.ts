/**
 * Processamento de webhook de pagamento — plano, seção 11.
 *
 * Os sete passos, e o porquê de cada um:
 *
 * 1. Corpo cru antes de qualquer parse — assinatura é calculada sobre bytes.
 * 2. Assinatura inválida: persiste e responde 401. Nunca processa.
 * 3. Normaliza o evento pelo adaptador da PSP.
 * 4. `ON CONFLICT DO NOTHING` no `provider_event_id`. Se não inseriu, é
 *    reentrega: responde 200 e sai. Esta unique é o que impede pagamento
 *    processado duas vezes.
 * 5. Processa em transação, pela máquina de estado. Transição inválida NÃO é
 *    erro: eventos chegam fora de ordem, e devolver erro faria a PSP
 *    reentregar para sempre.
 * 6. Responde 200 rápido. Trabalho pesado vai para a fila.
 * 7. Erro inesperado responde 500, para a PSP reentregar.
 *
 * A separação entre este módulo e o route handler existe para que os sete
 * passos sejam testáveis sem levantar servidor HTTP.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { serviceDb, type Database } from '@/db/client';
import { events, orderItems, orders, tickets, webhookEvents } from '@/db/schema';
import { aplicarEvento, type OrderStatus } from '@/domain/order';
import { confirmarEstoque, devolverEstoque } from '@/lib/inventory';
import { enfileirar } from '@/lib/jobs';
import { emitirTicket } from '@/lib/tickets';
import type { NormalizedWebhookEvent, PaymentProvider } from '@/lib/payments/types';

export type ResultadoWebhook = {
  status: 200 | 401 | 500;
  /** Para log e para o teste. Nunca vai para o corpo da resposta. */
  detalhe: string;
};

export type Dependencias = {
  provider: PaymentProvider;
  db?: Database;
  /** Segredo do HMAC do ingresso. Injetado para o teste não depender do ambiente. */
  ticketSecret: string;
};

export async function processarWebhook(
  rawBody: string,
  headers: Record<string, string>,
  deps: Dependencias,
): Promise<ResultadoWebhook> {
  const db = deps.db ?? serviceDb();
  const provider = deps.provider;

  // Passo 2 — assinatura.
  const assinaturaValida = provider.verifyWebhook(rawBody, headers);

  let evento: NormalizedWebhookEvent | null = null;
  if (assinaturaValida) {
    try {
      evento = provider.parseWebhook(rawBody);
    } catch {
      evento = null;
    }
  }

  if (!assinaturaValida || !evento) {
    /**
     * Persistir o evento recusado é o que permite investigar depois: ataque,
     * segredo trocado sem avisar, ou PSP mudando o formato do payload.
     * O id sintético evita colidir com evento legítimo.
     */
    await db
      .insert(webhookEvents)
      .values({
        provider: provider.name,
        providerEventId: `invalido:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        tipo: 'assinatura_invalida',
        payloadRaw: rawBody.slice(0, 20_000),
        headers,
        assinaturaValida: false,
        erro: assinaturaValida ? 'payload ilegível' : 'assinatura inválida',
      })
      .onConflictDoNothing();

    return { status: 401, detalhe: 'assinatura inválida' };
  }

  // Passo 4 — idempotência. A unique é a tranca; o insert é a chave.
  const inserido = await db
    .insert(webhookEvents)
    .values({
      provider: provider.name,
      providerEventId: evento.providerEventId,
      tipo: evento.type,
      payloadRaw: rawBody.slice(0, 20_000),
      headers,
      assinaturaValida: true,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });

  if (inserido.length === 0) {
    return { status: 200, detalhe: 'reentrega ignorada' };
  }

  const registroId = inserido[0]!.id;

  try {
    const detalhe = await processarEvento(db, evento, deps.ticketSecret);

    await db
      .update(webhookEvents)
      .set({ processadoEm: new Date() })
      .where(eq(webhookEvents.id, registroId));

    return { status: 200, detalhe };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    await db
      .update(webhookEvents)
      .set({ erro: mensagem, tentativas: sql`${webhookEvents.tentativas} + 1` })
      .where(eq(webhookEvents.id, registroId));

    // 500 faz a PSP reentregar. Como o registro já existe, a reentrega cairia
    // na idempotência e nunca seria reprocessada — por isso a linha do evento
    // é apagada, deixando a próxima entrega tentar de novo do zero.
    await db.delete(webhookEvents).where(eq(webhookEvents.id, registroId));

    return { status: 500, detalhe: mensagem };
  }
}

async function processarEvento(
  db: Database,
  evento: NormalizedWebhookEvent,
  ticketSecret: string,
): Promise<string> {
  if (!evento.providerTransactionId) return 'evento sem transação — ignorado';

  const [pedido] = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      eventId: orders.eventId,
      status: orders.status,
      totalCentavos: orders.totalCentavos,
      compradorNome: orders.compradorNome,
      compradorEmail: orders.compradorEmail,
      compradorCpf: orders.compradorCpf,
      ingressoNominal: events.ingressoNominal,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.providerTransactionId, evento.providerTransactionId))
    .limit(1);

  if (!pedido) return `nenhum pedido para a transação ${evento.providerTransactionId}`;

  const transicao = aplicarEvento(pedido.status as OrderStatus, evento.type);

  if (!transicao.ok) {
    // Registrado e ignorado, de propósito. Ver o cabeçalho deste arquivo.
    return `transição recusada (${transicao.motivo}) de ${pedido.status} por ${evento.type}`;
  }

  /**
   * O valor do webhook nunca vira verdade sozinho. Se a PSP diz que entraram
   * R$ 50 num pedido de R$ 110, alguma coisa está muito errada — e marcar o
   * pedido como pago aí seria entregar ingresso sem receber.
   */
  if (
    evento.type === 'transaction.paid' &&
    typeof evento.amount === 'number' &&
    evento.amount !== pedido.totalCentavos
  ) {
    throw new Error(
      `Divergência de valor no pedido ${pedido.id}: webhook ${evento.amount}, pedido ${pedido.totalCentavos}`,
    );
  }

  return db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({
        status: transicao.para,
        ...(transicao.para === 'paid' ? { pagoEm: evento.occurredAt } : {}),
        ...(transicao.para === 'canceled' || transicao.para === 'expired'
          ? { canceladoEm: evento.occurredAt }
          : {}),
        atualizadoEm: new Date(),
      })
      .where(and(eq(orders.id, pedido.id), eq(orders.status, pedido.status)));

    if (transicao.para === 'paid') {
      const { confirmados } = await confirmarEstoque(tx, pedido.id);

      /**
       * Caso de borda 1: o Pix foi pago depois de a reserva expirar. O estoque
       * já voltou para a venda, então não há o que confirmar e não podemos
       * emitir ingresso. O pedido fica pago e entra na fila de reembolso
       * automático.
       */
      if (confirmados === 0) {
        return `pedido ${pedido.id} pago após a expiração da reserva — reembolso devido`;
      }

      const emitidos = await emitirIngressos(tx, pedido, ticketSecret);

      /**
       * O envio entra na MESMA transação que confirmou o pagamento. Ou os dois
       * acontecem, ou nenhum — não existe pedido pago sem e-mail enfileirado.
       * A chave de deduplicação garante que reentrega não enfileire de novo.
       */
      await enfileirar(tx, {
        nome: 'enviar-ingressos',
        tenantId: pedido.tenantId,
        payload: { orderId: pedido.id },
        dedupeKey: `enviar-ingressos:${pedido.id}`,
      });

      return `pedido ${pedido.id} pago, ${emitidos} ingressos emitidos`;
    }

    if (transicao.para === 'expired' || transicao.para === 'canceled') {
      await devolverEstoque(tx, pedido.id, transicao.para === 'expired' ? 'expirada' : 'cancelada');
      return `pedido ${pedido.id} → ${transicao.para}, estoque devolvido`;
    }

    if (transicao.para === 'refunded' || transicao.para === 'chargeback') {
      await tx
        .update(tickets)
        .set({
          status: 'cancelado',
          canceladoEm: evento.occurredAt,
          canceladoMotivo: transicao.para,
          atualizadoEm: new Date(),
        })
        .where(and(eq(tickets.orderId, pedido.id), inArray(tickets.status, ['valido'])));

      return `pedido ${pedido.id} → ${transicao.para}, ingressos cancelados`;
    }

    return `pedido ${pedido.id} → ${transicao.para}`;
  });
}

type PedidoParaEmissao = {
  id: string;
  tenantId: string;
  eventId: string;
  compradorNome: string | null;
  compradorEmail: string | null;
  compradorCpf: string | null;
  ingressoNominal: boolean;
};

/**
 * Um ingresso por unidade comprada.
 *
 * O titular nasce como o comprador. Em evento nominal, é esse nome que a
 * portaria confere no documento — e é por isso que a transferência precisa
 * existir: sem ela, quem comprou para o grupo não consegue passar adiante.
 */
async function emitirIngressos(
  tx: Database,
  pedido: PedidoParaEmissao,
  segredo: string,
): Promise<number> {
  const itens = await tx
    .select({
      ticketTypeId: orderItems.ticketTypeId,
      quantidade: orderItems.quantidade,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, pedido.id));

  const novos = itens.flatMap((item) =>
    Array.from({ length: item.quantidade }, () => {
      const emitido = emitirTicket(segredo);
      return {
        tenantId: pedido.tenantId,
        orderId: pedido.id,
        ticketTypeId: item.ticketTypeId,
        eventId: pedido.eventId,
        codigo: emitido.codigo,
        tokenHash: emitido.tokenHash,
        titularNome: pedido.compradorNome ?? 'Comprador',
        titularCpf: pedido.compradorCpf,
        titularEmail: pedido.compradorEmail,
      };
    }),
  );

  if (novos.length === 0) return 0;

  await tx.insert(tickets).values(novos);
  return novos.length;
}
