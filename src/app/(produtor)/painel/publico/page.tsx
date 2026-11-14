import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { dataCurta } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';
import { tenantAtual } from '@/lib/painel-contexto';
import { compradoresDoProdutor } from '@/lib/publico-queries';

export const metadata: Metadata = { title: 'Público' };
export const dynamic = 'force-dynamic';

/** Base de compradores e recorrência — Caminho A, ADR-024. */
export default async function Publico() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  if (ctx.papel !== 'owner' && ctx.papel !== 'admin') {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-titulo text-lg font-bold">Acesso restrito</h1>
        <p className="prosa mx-auto mt-2 text-sm text-muted">
          A base de compradores tem dados pessoais e só é visível para o dono e os administradores.
        </p>
      </main>
    );
  }

  const { resumo, lista } = await compradoresDoProdutor(ctx.tenant.id, { limite: 200 });
  const taxaRetorno = resumo.compradores > 0 ? Math.round((resumo.recorrentes / resumo.compradores) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-titulo text-xl font-bold">Seu público</h1>
          <p className="prosa mt-1.5 max-w-2xl text-sm text-muted">
            Quem comprou com você, quantas vezes voltou e quanto gastou. A base é sua: baixe a
            planilha quando quiser. Use os contatos de acordo com a LGPD — para falar com quem
            comprou de você, e respeitando quem pedir para sair.
          </p>
        </div>
        {/* Download de arquivo, não navegação: <Link> faria prefetch e geraria
            uma exportação (com registro na auditoria) só de passar o mouse. */}
        <a
          download
          href="/painel/publico/exportar"
          className="shrink-0 rounded-botao bg-accent px-4 py-2.5 text-sm font-semibold text-accent-txt"
        >
          Baixar planilha (CSV)
        </a>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Numero rotulo="Compradores" valor={resumo.compradores.toLocaleString('pt-BR')} />
        <Numero
          rotulo="Voltaram em outro evento"
          valor={`${resumo.recorrentes.toLocaleString('pt-BR')} (${taxaRetorno}%)`}
        />
        <Numero rotulo="Gasto médio por pessoa" valor={formatarBRL(resumo.gastoMedioCentavos)} />
      </dl>

      {lista.length === 0 ? (
        <div className="mt-8 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
          <p className="font-titulo font-semibold">Ninguém por aqui ainda</p>
          <p className="prosa mx-auto mt-2 text-sm text-muted">Depois da primeira venda, o público aparece.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-cartao border border-line">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-raised text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-3 font-semibold">Comprador</th>
                <th className="px-4 py-3 text-right font-semibold">Eventos</th>
                <th className="px-4 py-3 text-right font-semibold">Ingressos</th>
                <th className="px-4 py-3 text-right font-semibold">Gasto</th>
                <th className="px-4 py-3 font-semibold">Última compra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lista.map((c) => (
                <tr key={c.email}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.nome || '—'}</p>
                    <p className="text-xs text-faint">
                      {c.email}
                      {c.telefone ? ` · ${c.telefone}` : ''}
                    </p>
                  </td>
                  <td className="tabular px-4 py-3 text-right">{c.eventos}</td>
                  <td className="tabular px-4 py-3 text-right">{c.ingressos}</td>
                  <td className="tabular px-4 py-3 text-right">{formatarBRL(c.gastoCentavos)}</td>
                  <td className="tabular px-4 py-3 text-muted">{dataCurta(c.ultimaCompra)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resumo.compradores > lista.length && (
        <p className="mt-3 text-xs text-faint">
          Mostrando os {lista.length} que mais voltaram. A planilha tem todos os{' '}
          {resumo.compradores.toLocaleString('pt-BR')}.
        </p>
      )}
    </main>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-cartao border border-line bg-raised px-4 py-4">
      <dt className="text-xs uppercase tracking-wide text-faint">{rotulo}</dt>
      <dd className="tabular mt-1 font-titulo text-2xl font-bold">{valor}</dd>
    </div>
  );
}
