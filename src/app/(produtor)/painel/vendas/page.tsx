import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { dataCurta, hora } from '@/lib/datas';
import { mascararCpf } from '@/domain/cpf';
import { formatarBRL } from '@/lib/money';
import { tenantAtual } from '@/lib/painel-contexto';
import { buscarVendas, eventosParaFiltro, POR_PAGINA } from '@/lib/vendas-queries';
import { FiltrosVendas } from './filtros';

export const metadata: Metadata = { title: 'Vendas' };
export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{ q?: string; evento?: string; status?: string; pagina?: string }>;
};

const ROTULO: Record<string, { texto: string; cor: string }> = {
  paid: { texto: 'Pago', cor: 'text-sucesso' },
  partially_refunded: { texto: 'Reembolso parcial', cor: 'text-alerta' },
  awaiting_payment: { texto: 'Aguardando', cor: 'text-muted' },
  draft: { texto: 'Rascunho', cor: 'text-faint' },
  expired: { texto: 'Expirado', cor: 'text-faint' },
  canceled: { texto: 'Cancelado', cor: 'text-faint' },
  refunded: { texto: 'Reembolsado', cor: 'text-alerta' },
  chargeback: { texto: 'Contestado', cor: 'text-perigo' },
};

export default async function Vendas({ searchParams }: Props) {
  const { q, evento, status, pagina } = await searchParams;

  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const [resultado, eventos] = await Promise.all([
    buscarVendas(ctx.tenant.id, {
      termo: q,
      eventId: evento,
      status,
      pagina: pagina ? Number.parseInt(pagina, 10) : 1,
    }),
    eventosParaFiltro(ctx.tenant.id),
  ]);

  const paginas = Math.max(1, Math.ceil(resultado.total / POR_PAGINA));

  function link(p: number): string {
    const busca = new URLSearchParams();
    if (q) busca.set('q', q);
    if (evento) busca.set('evento', evento);
    if (status) busca.set('status', status);
    if (p > 1) busca.set('pagina', String(p));
    return busca.size ? `/painel/vendas?${busca}` : '/painel/vendas';
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-titulo text-xl font-bold">Vendas</h1>
        <p className="tabular text-sm text-muted">
          {resultado.total} {resultado.total === 1 ? 'pedido' : 'pedidos'}
        </p>
      </div>

      <div className="mt-5">
        <Suspense fallback={<div className="h-11" />}>
          <FiltrosVendas eventos={eventos} />
        </Suspense>
      </div>

      {resultado.linhas.length === 0 ? (
        <div className="mt-8 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
          <p className="font-titulo font-semibold">Nenhum pedido encontrado</p>
          <p className="prosa mx-auto mt-2 text-sm text-muted">
            {q
              ? 'Confira a grafia do nome ou tente pelo CPF, pelo código do ingresso ou pelo número do pedido.'
              : 'Quando alguém comprar, o pedido aparece aqui.'}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-cartao border border-line">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-raised text-left text-xs uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-4 py-3 font-semibold">Pedido</th>
                  <th className="px-4 py-3 font-semibold">Comprador</th>
                  <th className="px-4 py-3 font-semibold">Evento</th>
                  <th className="px-4 py-3 text-right font-semibold">Ingressos</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {resultado.linhas.map((v) => {
                  const r = ROTULO[v.status] ?? { texto: v.status, cor: 'text-muted' };
                  return (
                    <tr key={v.id} className="transition hover:bg-raised">
                      <td className="px-4 py-3">
                        <Link
                          href={`/painel/vendas/${v.id}`}
                          className="tabular font-medium transition hover:text-accent"
                        >
                          #{v.numero}
                        </Link>
                        <p className="tabular text-xs text-faint">
                          {dataCurta(v.criadoEm)} · {hora(v.criadoEm)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="truncate font-medium">{v.compradorNome ?? '—'}</p>
                        <p className="tabular truncate text-xs text-faint">
                          {v.compradorCpf ? mascararCpf(v.compradorCpf) : ''}
                          {v.compradorEmail ? ` · ${v.compradorEmail}` : ''}
                        </p>
                      </td>
                      <td className="max-w-[16rem] px-4 py-3">
                        <p className="truncate text-muted">{v.eventoTitulo}</p>
                        {v.canal !== 'online' && (
                          <p className="text-xs text-faint">
                            {v.canal === 'pdv' ? 'bilheteria' : 'lista'}
                          </p>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-right">{v.ingressos}</td>
                      <td className="tabular px-4 py-3 text-right font-medium">
                        {formatarBRL(v.totalCentavos)}
                      </td>
                      <td className={`px-4 py-3 ${r.cor}`}>{r.texto}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {paginas > 1 && (
            <nav aria-label="Paginação" className="mt-6 flex items-center justify-center gap-3">
              {resultado.pagina > 1 && (
                <Link
                  href={link(resultado.pagina - 1)}
                  className="rounded-botao border border-line px-4 py-2 text-sm transition hover:border-accent hover:text-accent"
                >
                  Anterior
                </Link>
              )}
              <span className="tabular text-sm text-muted">
                {resultado.pagina} de {paginas}
              </span>
              {resultado.pagina < paginas && (
                <Link
                  href={link(resultado.pagina + 1)}
                  className="rounded-botao border border-line px-4 py-2 text-sm transition hover:border-accent hover:text-accent"
                >
                  Próxima
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
