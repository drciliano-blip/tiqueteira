import type { Metadata } from 'next';

import { operacao } from '@/lib/admin';
import { dataCurta, hora } from '@/lib/datas';

export const metadata: Metadata = { title: 'Operação' };
export const dynamic = 'force-dynamic';

const quando = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(v as string);
  return `${dataCurta(d)} ${hora(d)}`;
};

export default async function Operacao() {
  const { fila, falhas, webhooks } = await operacao();
  return (
    <>
      <h1 className="font-titulo text-xl font-bold">Operação</h1>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Fila de tarefas</h2>
        <table className="mt-2 text-sm">
          <tbody>
            {fila.map((f) => (
              <tr key={`${f.nome}-${f.status}`}>
                <td className="pr-6">{f.nome as string}</td>
                <td className="pr-6 text-muted">{f.status as string}</td>
                <td className="tabular text-right">{Number(f.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Tarefas com falha</h2>
        {falhas.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nenhuma.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {falhas.map((j) => (
              <li key={j.id as string}>
                {j.nome as string} · {j.status as string} · {Number(j.tentativas)} tentativas ·{' '}
                {quando(j.quando)}
                <span className="block text-xs text-perigo">{j.ultimo_erro as string}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Últimos webhooks</h2>
        <div className="mt-2 overflow-x-auto rounded-cartao border border-line">
          <table className="w-full min-w-[40rem] text-sm">
            <tbody className="divide-y divide-line">
              {webhooks.map((w, n) => (
                <tr key={n}>
                  <td className="px-3 py-2">{w.tipo as string}</td>
                  <td className="px-3 py-2 text-muted">{w.provider as string}</td>
                  <td className="tabular px-3 py-2 text-muted">{quando(w.recebido_em)}</td>
                  <td className="px-3 py-2">
                    {w.erro ? (
                      <span className="text-perigo">{w.erro as string}</span>
                    ) : w.processado_em ? (
                      <span className="text-sucesso">processado</span>
                    ) : (
                      <span className="text-alerta">pendente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
