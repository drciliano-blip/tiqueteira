import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { formatarBRL } from '@/lib/money';
import { tenantAtual } from '@/lib/painel-contexto';
import { fechamentoDeCaixa, lotesDeBalcao } from '@/lib/pdv';
import { Balcao } from './balcao';

export const metadata: Metadata = {
  title: 'Bilheteria',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const ROTULO: Record<string, string> = {
  dinheiro: 'Dinheiro',
  debito: 'Débito',
  credito: 'Crédito',
  cortesia: 'Cortesia',
  outro: 'Outro',
};

type Props = { params: Promise<{ eventId: string }> };

export default async function Bilheteria({ params }: Props) {
  const { eventId } = await params;
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const [evento] = await serviceDb()
    .select({ id: events.id, tenantId: events.tenantId, titulo: events.titulo })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento || evento.tenantId !== ctx.tenant.id) notFound();

  const [lotes, caixa] = await Promise.all([
    lotesDeBalcao(ctx.tenant.id, eventId),
    fechamentoDeCaixa(ctx.tenant.id, eventId),
  ]);

  const totalCaixa = caixa.reduce((a, l) => a + l.totalCentavos, 0);
  const totalIngressos = caixa.reduce((a, l) => a + l.ingressos, 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href={`/painel/eventos/${eventId}`} className="text-sm text-muted hover:text-txt">
        ← {evento.titulo}
      </Link>

      <h1 className="mt-3 font-titulo text-xl font-bold">Bilheteria</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        Venda no balcão, na porta. O dinheiro <strong>não passa pela plataforma</strong> — quem
        cobra é a sua maquininha, ou a sua mão. O que o sistema faz é registrar a venda,
        consumir o estoque e emitir o ingresso, para o número da porta fechar com o do painel.
      </p>

      <div className="mt-6">
        <Balcao eventId={eventId} lotes={lotes} />
      </div>

      <section className="mt-12">
        <h2 className="font-titulo text-lg font-bold">Fechamento de caixa</h2>
        <p className="mt-1.5 text-sm text-muted">
          Para conferir contra a maquininha no fim da noite.
        </p>

        {caixa.length === 0 ? (
          <p className="mt-4 rounded-cartao border border-line bg-raised px-4 py-6 text-center text-sm text-muted">
            Nenhuma venda de balcão ainda.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-cartao border border-line">
            <table className="w-full text-sm">
              <thead className="bg-raised text-left text-xs uppercase text-faint">
                <tr>
                  <th className="px-4 py-2 font-medium">Forma</th>
                  <th className="px-4 py-2 text-right font-medium">Vendas</th>
                  <th className="px-4 py-2 text-right font-medium">Ingressos</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {caixa.map((l) => (
                  <tr key={l.metodo}>
                    <td className="px-4 py-2.5">{ROTULO[l.metodo] ?? l.metodo}</td>
                    <td className="tabular px-4 py-2.5 text-right">{l.pedidos}</td>
                    <td className="tabular px-4 py-2.5 text-right">{l.ingressos}</td>
                    <td className="tabular px-4 py-2.5 text-right font-medium">
                      {formatarBRL(l.totalCentavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line-forte bg-raised">
                <tr>
                  <td className="px-4 py-2.5 font-semibold">Total</td>
                  <td />
                  <td className="tabular px-4 py-2.5 text-right font-semibold">
                    {totalIngressos}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">
                    {formatarBRL(totalCaixa)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
