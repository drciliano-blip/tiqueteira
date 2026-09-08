/**
 * Pix pago depois da expiração da reserva — caso de borda 1 do plano.
 *
 * O comprador pagou, o dinheiro entrou, mas o estoque já tinha voltado para a
 * venda. Não dá para emitir ingresso: o lugar pode ter sido vendido para
 * outra pessoa nesse meio-tempo.
 *
 * A decisão do plano é devolver automaticamente e avisar. Fazer isso na mão
 * significaria alguém perceber, o que em noite de evento não acontece — e o
 * comprador descobriria na porta.
 */
import 'server-only';

import { and, eq, isNull, notExists, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events, orders, refunds, tickets, venues } from '@/db/schema';
import { dataLonga } from '@/lib/datas';
import { enviarEmail, esc, moldura } from '@/lib/email';
import { executarReembolso } from '@/lib/refunds';

/**
 * Encontra os pedidos nessa situação: pagos, sem nenhum ingresso emitido e
 * sem reembolso já registrado.
 *
 * "Pago e sem ingresso" só acontece por este caminho — a emissão é parte da
 * mesma transação que confirma o pagamento.
 */
export async function reembolsarPagamentosAtrasados(): Promise<string> {
  const db = serviceDb();

  const candidatos = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      compradorNome: orders.compradorNome,
      compradorEmail: orders.compradorEmail,
      totalCentavos: orders.totalCentavos,
      eventoTitulo: events.titulo,
      eventoInicio: events.dataInicio,
      venueNome: venues.nome,
      corAcento: events.corAcento,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(
      and(
        eq(orders.status, 'paid'),
        notExists(
          db.select({ um: sql`1` }).from(tickets).where(eq(tickets.orderId, orders.id)),
        ),
        notExists(
          db.select({ um: sql`1` }).from(refunds).where(eq(refunds.orderId, orders.id)),
        ),
        isNull(orders.canceladoEm),
      ),
    )
    .limit(20);

  if (candidatos.length === 0) return 'nenhum pagamento atrasado pendente';

  let devolvidos = 0;

  for (const pedido of candidatos) {
    const r = await executarReembolso({
      tenantId: pedido.tenantId,
      orderId: pedido.id,
      // Não há ingresso emitido; a quantidade serve só para o rateio, e aqui
      // a devolução é integral.
      quantidade: 1,
      motivo: 'duplicate',
      manual: true,
      observacao: 'Pix confirmado após a expiração da reserva. Devolução automática.',
    });

    if (!r.ok) continue;
    devolvidos += 1;

    if (!pedido.compradorEmail) continue;

    /**
     * O aviso importa tanto quanto a devolução: sem ele, a pessoa aparece na
     * porta com o comprovante do Pix na mão e ninguém entende o que houve.
     */
    await enviarEmail({
      para: pedido.compradorEmail,
      assunto: `Devolvemos o valor de ${pedido.eventoTitulo}`,
      html: moldura(
        `<h1 style="margin:0;font-size:20px;">Não conseguimos garantir seus ingressos</h1>
<p style="margin-top:12px;color:#8a8b99;">
  O pagamento de <strong style="color:#f2f0eb;">${esc(pedido.eventoTitulo)}</strong> chegou
  depois que a reserva expirou, e os ingressos já tinham voltado para a venda.
</p>
<p style="margin-top:12px;color:#8a8b99;">
  <strong style="color:#f2f0eb;">O valor já foi devolvido por inteiro</strong>, pelo mesmo
  meio de pagamento. No Pix, costuma cair em minutos.
</p>
<p style="margin-top:12px;color:#8a8b99;">
  Se ainda houver ingresso disponível, é só comprar de novo — desta vez a reserva fica válida
  por 10 minutos a partir do clique.
</p>
<p style="margin-top:16px;font-size:13px;color:#63667a;">
  ${esc(dataLonga(pedido.eventoInicio))} · ${esc(pedido.venueNome)}
</p>`,
        'Você não precisa fazer nada. A devolução é automática.',
      ),
      texto: `O pagamento de ${pedido.eventoTitulo} chegou após a expiração da reserva. O valor foi devolvido integralmente.`,
    });
  }

  return `${devolvidos} de ${candidatos.length} pagamentos atrasados devolvidos`;
}
