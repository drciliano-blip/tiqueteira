import type { Metadata } from 'next';

import { acoesAuditadas, auditoria } from '@/lib/admin';
import { dataCurta, hora } from '@/lib/datas';

export const metadata: Metadata = { title: 'Auditoria' };
export const dynamic = 'force-dynamic';

export default async function Auditoria({ searchParams }: { searchParams: Promise<{ acao?: string }> }) {
  const { acao } = await searchParams;
  const [linhas, acoes] = await Promise.all([auditoria({ acao: acao || undefined }), acoesAuditadas()]);

  return (
    <>
      <h1 className="font-titulo text-xl font-bold">Auditoria</h1>
      <p className="mt-1 text-sm text-muted">
        Reembolsos, mudanças de taxa, liberações de repasse, exportações e decisões manuais. Só
        leitura: ninguém, nem a aplicação, altera este registro.
      </p>
      <form className="mt-4">
        <select name="acao" defaultValue={acao ?? ''} className="rounded-botao border border-line bg-raised px-3 py-2 text-sm">
          <option value="">Todas as ações</option>
          {acoes.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button className="ml-2 text-sm text-accent">Filtrar</button>
      </form>
      <ul className="mt-5 divide-y divide-line rounded-cartao border border-line text-sm">
        {linhas.map((l) => (
          <li key={l.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">{l.acao}</p>
              <p className="tabular text-xs text-faint">
                {dataCurta(l.criadoEm)} {hora(l.criadoEm)}
              </p>
            </div>
            <p className="text-xs text-muted">
              {l.produtor ?? 'plataforma'} · {l.usuario ?? 'sistema'} · {l.entidade}
            </p>
            {l.depois ? (
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-faint">
                {JSON.stringify(l.depois)}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
