/**
 * Conciliação com a PSP — plano, seção 11.
 *
 * Webhook perdido acontece: a operadora tenta entregar, a Vercel está no meio
 * de um deploy, a entrega falha e a retentativa também. Sem este job, o pedido
 * fica órfão para sempre — o comprador pagou, o dinheiro está na PSP, e o
 * ingresso nunca é emitido.
 *
 * O que ele faz: varre os pedidos parados em `awaiting_payment` e pergunta à
 * operadora o que aconteceu de verdade. Quando a PSP diz que foi pago, o job
 * processa o pagamento pelo MESMO caminho do webhook — inclusive a máquina de
 * estado e a idempotência. Não existe atalho que confirme pagamento por fora.
 */
import 'server-only';

import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { orders } from '@/db/schema';
import { env } from '@/lib/env';
import { getPaymentProvider } from '@/lib/payments/provider';
import { processarEventoConfiavel } from '@/lib/webhook-processor';

export type RelatorioConciliacao = {
  verificados: number;
  recuperados: number;
  expirados: number;
  semInformacao: number;
  divergencias: string[];
};

/** Só olha o que já passou tempo suficiente para o webhook ter chegado. */
const MINUTOS_DE_TOLERANCIA = 30;

export async function conciliarPedidos(limite = 50): Promise<RelatorioConciliacao> {
  const db = serviceDb();
  const provider = getPaymentProvider();

  const pendentes = await db
    .select({
      id: orders.id,
      providerTransactionId: orders.providerTransactionId,
      totalCentavos: orders.totalCentavos,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'awaiting_payment'),
        sql`${orders.providerTransactionId} is not null`,
        lt(orders.criadoEm, sql`now() - interval '${sql.raw(String(MINUTOS_DE_TOLERANCIA))} minutes'`),
      ),
    )
    .limit(limite);

  const relatorio: RelatorioConciliacao = {
    verificados: pendentes.length,
    recuperados: 0,
    expirados: 0,
    semInformacao: 0,
    divergencias: [],
  };

  for (const pedido of pendentes) {
    let transacao;
    try {
      transacao = await provider.getTransaction(pedido.providerTransactionId!);
    } catch {
      /**
       * O provider falso guarda estado em memória e não sobrevive entre
       * processos, então nunca encontra a transação. Em produção, com PSP
       * real, isto aqui é erro de rede — e a próxima rodada tenta de novo.
       */
      relatorio.semInformacao += 1;
      continue;
    }

    if (transacao.status === 'paid') {
      /**
       * Divergência de valor não é conciliação, é alarme. Não processa: um
       * humano precisa olhar antes de emitir ingresso.
       */
      if (transacao.amount !== pedido.totalCentavos) {
        relatorio.divergencias.push(
          `pedido ${pedido.id}: PSP ${transacao.amount}, pedido ${pedido.totalCentavos}`,
        );
        continue;
      }

      /**
       * Entrega ao MESMO processador do webhook, marcado como origem de
       * conciliação. Assim a recuperação passa pela máquina de estado, pela
       * idempotência e pela emissão de ingresso — sem caminho paralelo que
       * confirme pagamento por fora.
       */
      const resultado = await processarEventoConfiavel(
        {
          providerEventId: `conciliacao:${pedido.providerTransactionId}`,
          type: 'transaction.paid',
          occurredAt: transacao.paidAt ?? new Date(),
          providerTransactionId: pedido.providerTransactionId!,
          status: 'paid',
          amount: transacao.amount,
          raw: transacao.raw,
        },
        { provider, ticketSecret: env().TICKET_HMAC_SECRET },
      );

      if (resultado.status === 200) relatorio.recuperados += 1;
      else relatorio.divergencias.push(`pedido ${pedido.id}: ${resultado.detalhe}`);
      continue;
    }

    if (
      transacao.status === 'expired' ||
      transacao.status === 'canceled' ||
      transacao.status === 'failed'
    ) {
      await db
        .update(orders)
        .set({ status: 'expired', canceladoEm: new Date(), atualizadoEm: new Date() })
        .where(and(eq(orders.id, pedido.id), inArray(orders.status, ['awaiting_payment'])));
      relatorio.expirados += 1;
      continue;
    }

    relatorio.semInformacao += 1;
  }

  return relatorio;
}
