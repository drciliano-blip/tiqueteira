import type { Metadata } from 'next';
import Link from 'next/link';

import { listarRepasses } from '@/lib/admin';
import { dataCurta } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';
import { acaoRepasse } from '../acoes';
import { FormAcao, Motivo } from '../form-acao';

export const metadata: Metadata = { title: 'Repasses' };
export const dynamic = 'force-dynamic';

const FILTROS = [
  { valor: 'problemas', rotulo: 'Com problema' },
  { valor: 'agendados', rotulo: 'Agendados' },
  { valor: 'todos', rotulo: 'Todos' },
] as const;

export default async function Repasses({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  const filtro = FILTROS.find((x) => x.valor === f)?.valor ?? 'problemas';
  const lista = await listarRepasses(filtro);

  return (
    <>
      <h1 className="font-titulo text-xl font-bold">Repasses</h1>
      <p className="mt-1 text-sm text-muted">
        O job roda de hora em hora. Repasse que parou no teto de tentativas espera alguém corrigir a
        causa e reabrir.
      </p>
      <div className="mt-4 flex gap-2 text-sm">
        {FILTROS.map((x) => (
          <Link
            key={x.valor}
            href={`/admin/repasses?f=${x.valor}`}
            className={`rounded-botao border px-3 py-1.5 ${x.valor === filtro ? 'border-accent text-accent' : 'border-line text-muted'}`}
          >
            {x.rotulo}
          </Link>
        ))}
      </div>

      {lista.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Nenhum repasse neste filtro.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {lista.map((p) => {
            const valor = Number(p.liberado_centavos);
            return (
              <li key={p.id as string} className="rounded-cartao border border-line p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {p.produtor as string} · {p.evento as string}
                  </p>
                  <p className={valor < 0 ? 'text-perigo' : ''}>
                    {p.tranche as string} · {p.metodo as string} · {formatarBRL(valor)}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-faint">
                  {p.status as string} · prevista {dataCurta(new Date(p.data_prevista as string))} ·{' '}
                  {Number(p.tentativas)} tentativas
                  {p.ultimo_erro ? ` · ${p.ultimo_erro as string}` : ''}
                </p>
                {(p.status === 'failed' || p.status === 'scheduled') && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-accent">Agir</summary>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      {p.status === 'failed' && (
                        <FormAcao acao={acaoRepasse.bind(null, p.id as string, 'reabrir')} botao="Tentar de novo">
                          <Motivo nome="motivo" />
                        </FormAcao>
                      )}
                      <FormAcao acao={acaoRepasse.bind(null, p.id as string, 'cancelar')} botao="Cancelar repasse" perigo>
                        <Motivo nome="motivo" />
                      </FormAcao>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
