import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { dataCurta, hora } from '@/lib/datas';
import { tenantAtual } from '@/lib/painel-contexto';
import { medirSaude, type Gravidade } from '@/lib/saude';

export const metadata: Metadata = { title: 'Saúde' };
export const dynamic = 'force-dynamic';

const CORES: Record<Gravidade, string> = {
  ok: 'text-sucesso border-sucesso/30',
  atencao: 'text-alerta border-alerta/40',
  critico: 'text-perigo border-perigo/50',
};

/**
 * Painel de saúde — plano, seção 17.
 *
 * Fica no painel do produtor, mas mede a plataforma inteira: são sinais de
 * infraestrutura, e webhook não pertence a tenant nenhum. Quando existir a
 * área do operador, esta tela migra para lá.
 */
export default async function Saude() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  // Sinais de plataforma não são do produtor: só administração vê.
  if (ctx.papel !== 'owner' && ctx.papel !== 'admin') {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-titulo text-lg font-bold">Acesso restrito</h1>
        <p className="prosa mx-auto mt-2 text-sm text-muted">
          Esta tela mostra sinais da plataforma e só é visível para a administração.
        </p>
      </main>
    );
  }

  const { sinais, ultimosWebhooks, filaTravada } = await medirSaude();
  const problemas = sinais.filter((s) => s.gravidade !== 'ok');

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Saúde da operação</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        Os sinais que precisam ser olhados antes de um evento, e principalmente durante.
      </p>

      {problemas.length === 0 ? (
        <p className="mt-6 rounded-botao border border-sucesso/30 bg-sucesso/10 px-4 py-3 text-sm text-sucesso">
          Nenhum sinal de problema no momento.
        </p>
      ) : (
        <p className="mt-6 rounded-botao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          {problemas.length} {problemas.length === 1 ? 'sinal precisa' : 'sinais precisam'} de
          atenção.
        </p>
      )}

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {sinais.map((s) => (
          <li
            key={s.chave}
            className={`rounded-cartao border bg-raised px-4 py-4 ${
              s.gravidade === 'ok' ? 'border-line' : CORES[s.gravidade]
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">{s.titulo}</p>
              <p className={`tabular font-titulo text-xl font-bold ${CORES[s.gravidade]}`}>
                {s.valor}
              </p>
            </div>
            {s.gravidade !== 'ok' && (
              <p className="prosa mt-2 text-xs text-muted">{s.acao}</p>
            )}
          </li>
        ))}
      </ul>

      <section className="mt-12">
        <h2 className="font-titulo text-lg font-bold">Últimos webhooks</h2>
        {ultimosWebhooks.length === 0 ? (
          <p className="mt-3 text-sm text-faint">Nenhum webhook recebido ainda.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-cartao border border-line">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-raised text-left text-xs uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Tipo</th>
                  <th className="px-4 py-2.5 font-semibold">Recebido</th>
                  <th className="px-4 py-2.5 font-semibold">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ultimosWebhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="px-4 py-2.5 font-medium">{w.tipo}</td>
                    <td className="tabular px-4 py-2.5 text-muted">
                      {dataCurta(w.recebidoEm)} · {hora(w.recebidoEm)}
                    </td>
                    <td className="px-4 py-2.5">
                      {!w.assinaturaValida ? (
                        <span className="text-perigo">assinatura inválida</span>
                      ) : w.erro ? (
                        <span className="text-alerta">{w.erro.slice(0, 60)}</span>
                      ) : w.processadoEm ? (
                        <span className="text-sucesso">processado</span>
                      ) : (
                        <span className="text-muted">pendente</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-titulo text-lg font-bold">Tarefas com problema</h2>
        {filaTravada.length === 0 ? (
          <p className="mt-3 text-sm text-faint">Nenhuma tarefa travada.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-cartao border border-line">
            {filaTravada.map((j) => (
              <li key={j.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{j.nome}</p>
                  <p className="tabular text-xs text-faint">
                    {j.tentativas} {j.tentativas === 1 ? 'tentativa' : 'tentativas'}
                  </p>
                </div>
                {j.ultimoErro && (
                  <p className="mt-1 break-all text-xs text-perigo">{j.ultimoErro}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
