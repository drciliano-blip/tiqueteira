import type { Metadata } from 'next';
import Link from 'next/link';

import { listarProdutores } from '@/lib/admin';
import { dataCurta } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';

export const metadata: Metadata = { title: 'Produtores' };
export const dynamic = 'force-dynamic';

const KYC: Record<string, string> = {
  pendente: 'Sem cadastro',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  suspenso: 'Suspenso',
};

export default async function Produtores({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const lista = await listarProdutores(q);
  return (
    <>
      <h1 className="font-titulo text-xl font-bold">Produtores</h1>
      <form className="mt-4">
        <input
          name="q"
          defaultValue={q}
          placeholder="Nome, e-mail ou endereço da vitrine"
          className="w-full max-w-md rounded-botao border border-line bg-raised px-3 py-2 text-sm"
        />
      </form>
      <div className="mt-5 overflow-x-auto rounded-cartao border border-line">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-raised text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-3">Produtor</th>
              <th className="px-4 py-3">Recebimento</th>
              <th className="px-4 py-3 text-right">Eventos</th>
              <th className="px-4 py-3 text-right">Vendido</th>
              <th className="px-4 py-3">Desde</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lista.map((t) => (
              <tr key={t.id as string}>
                <td className="px-4 py-3">
                  <Link href={`/admin/produtores/${t.id}`} className="font-medium hover:text-accent">
                    {t.nome as string}
                  </Link>
                  <p className="text-xs text-faint">
                    /{t.slug as string} · {t.email as string}
                  </p>
                </td>
                <td className="px-4 py-3 text-muted">{KYC[t.kyc_status as string] ?? (t.kyc_status as string)}</td>
                <td className="tabular px-4 py-3 text-right">{Number(t.eventos)}</td>
                <td className="tabular px-4 py-3 text-right">{formatarBRL(Number(t.vendido))}</td>
                <td className="tabular px-4 py-3 text-muted">{dataCurta(new Date(t.criado_em as string))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
