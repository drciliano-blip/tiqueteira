import type { Metadata } from 'next';
import Link from 'next/link';

import { buscarPedidos } from '@/lib/admin';
import { dataCurta, hora } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';

export const metadata: Metadata = { title: 'Pedidos' };
export const dynamic = 'force-dynamic';

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const lista = await buscarPedidos(q);
  return (
    <>
      <h1 className="font-titulo text-xl font-bold">Pedidos de todos os produtores</h1>
      <form className="mt-4">
        <input
          name="q"
          defaultValue={q}
          placeholder="E-mail, nome, CPF, número do pedido ou código do ingresso"
          className="w-full max-w-lg rounded-botao border border-line bg-raised px-3 py-2 text-sm"
        />
      </form>
      <div className="mt-5 overflow-x-auto rounded-cartao border border-line">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-raised text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Comprador</th>
              <th className="px-4 py-3">Produtor · evento</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lista.map((o) => {
              const quando = new Date(o.criado_em as string);
              return (
                <tr key={o.id as string}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/pedidos/${o.id}`} className="tabular font-medium hover:text-accent">
                      #{Number(o.numero)}
                    </Link>
                    <p className="tabular text-xs text-faint">
                      {dataCurta(quando)} · {hora(quando)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{(o.comprador_nome as string) ?? '—'}</p>
                    <p className="text-xs text-faint">{(o.comprador_email as string) ?? ''}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {o.produtor as string} · {o.evento as string}
                  </td>
                  <td className="tabular px-4 py-3 text-right">{formatarBRL(Number(o.total_centavos))}</td>
                  <td className="px-4 py-3 text-muted">
                    {o.status as string}
                    {o.canal !== 'online' ? ` · ${o.canal as string}` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
