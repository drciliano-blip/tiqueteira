import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';

import { ContagemRegressiva } from '@/components/contagem-regressiva';
import { TemaTenant } from '@/components/tema-tenant';
import { serviceDb } from '@/db/client';
import { events, orderItems, orders, tenants, ticketTypes } from '@/db/schema';
import { dataLonga, hora } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pagamento',
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ orderId: string }> };

/**
 * O pedido é identificado por um UUID que só quem comprou conhece, e a página
 * não expõe dado de outro pedido. A leitura usa a conexão de serviço porque
 * não há sessão nem tenant no contexto — o comprador não tem conta.
 */
async function carregarPedido(orderId: string) {
  const db = serviceDb();

  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      status: orders.status,
      subtotalCentavos: orders.subtotalCentavos,
      convenienciaCentavos: orders.convenienciaCentavos,
      totalCentavos: orders.totalCentavos,
      expiresEm: orders.expiresEm,
      // O relógio que vale é o do banco: o do servidor de renderização pode
      // estar em outro fuso, ou adiantado.
      vencido: sql<boolean>`${orders.expiresEm} is not null and ${orders.expiresEm} <= now()`,
      eventoTitulo: events.titulo,
      eventoSlug: events.slug,
      eventoData: events.dataInicio,
      tenantSlug: tenants.slug,
      tenantNome: tenants.nome,
      corAcento: tenants.corAcento,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!pedido) return null;

  const itens = await db
    .select({
      quantidade: orderItems.quantidade,
      precoCentavos: orderItems.precoUnitarioCentavosSnapshot,
      loteNome: ticketTypes.nome,
    })
    .from(orderItems)
    .innerJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
    .where(eq(orderItems.orderId, orderId));

  return { ...pedido, itens };
}

export default async function Checkout({ params }: Props) {
  const { orderId } = await params;

  // UUID malformado não vai ao banco: evita ruído de erro e varredura.
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();

  const pedido = await carregarPedido(orderId);
  if (!pedido) notFound();

  const vencido = pedido.vencido === true;
  const encerrado = ['expired', 'canceled'].includes(pedido.status);

  return (
    <>
      <TemaTenant corAcento={pedido.corAcento} />

      <div className="flex min-h-dvh flex-col">
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
            <span className="text-sm text-muted">Pedido nº {pedido.numero}</span>
            {!vencido && !encerrado && pedido.expiresEm && (
              <ContagemRegressiva ate={pedido.expiresEm.toISOString()} />
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
          {vencido || encerrado ? (
            <div className="rounded-cartao border border-line bg-raised p-6 text-center">
              <h1 className="font-titulo text-lg font-bold">A reserva expirou</h1>
              <p className="prosa mx-auto mt-2 text-sm text-muted">
                Os ingressos voltaram para a venda. Se ainda houver lugar, é só escolher de
                novo — leva menos de um minuto.
              </p>
              <Link
                href={`/${pedido.tenantSlug}/e/${pedido.eventoSlug}`}
                className="mt-5 inline-block rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt"
              >
                Voltar ao evento
              </Link>
            </div>
          ) : (
            <>
              <h1 className="font-titulo text-xl font-bold leading-tight">
                {pedido.eventoTitulo}
              </h1>
              <p className="tabular mt-1 text-sm text-muted">
                {dataLonga(pedido.eventoData)}, às {hora(pedido.eventoData)}
              </p>

              <section className="mt-6 rounded-cartao border border-line bg-raised">
                <ul className="divide-y divide-line">
                  {pedido.itens.map((item, i) => (
                    <li key={i} className="flex items-baseline justify-between px-4 py-3">
                      <span className="text-sm">
                        <span className="tabular font-semibold">{item.quantidade}×</span>{' '}
                        {item.loteNome}
                      </span>
                      <span className="tabular text-sm">
                        {formatarBRL(item.precoCentavos * item.quantidade)}
                      </span>
                    </li>
                  ))}
                </ul>

                <dl className="space-y-2 border-t border-line px-4 py-3 text-sm">
                  <div className="flex justify-between text-muted">
                    <dt>Subtotal</dt>
                    <dd className="tabular">{formatarBRL(pedido.subtotalCentavos)}</dd>
                  </div>
                  {pedido.convenienciaCentavos > 0 && (
                    <div className="flex justify-between text-muted">
                      <dt>Taxa de conveniência</dt>
                      <dd className="tabular">{formatarBRL(pedido.convenienciaCentavos)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
                    <dt>Total</dt>
                    <dd className="tabular">{formatarBRL(pedido.totalCentavos)}</dd>
                  </div>
                </dl>
              </section>

              <div className="mt-6 rounded-cartao border border-dashed border-line-forte px-4 py-8 text-center">
                <p className="text-sm text-muted">
                  Aqui entram os dados do comprador e o pagamento com Pix.
                </p>
                <p className="mt-1 text-xs text-faint">Próxima etapa da construção.</p>
              </div>

              <p className="prosa mt-6 text-xs text-faint">
                Seus ingressos estão guardados até o fim da contagem. Passado esse tempo, eles
                voltam para a venda automaticamente.
              </p>
            </>
          )}
        </main>
      </div>
    </>
  );
}
