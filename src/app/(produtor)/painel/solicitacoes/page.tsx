import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { dataCurta, hora } from '@/lib/datas';
import { tenantAtual } from '@/lib/painel-contexto';
import { ROTULO_SOLICITACAO, solicitacoesDoProdutor } from '@/lib/solicitacoes';

export const metadata: Metadata = { title: 'Solicitações' };
export const dynamic = 'force-dynamic';

const SITUACAO: Record<string, { texto: string; cor: string }> = {
  aberta: { texto: 'Aguardando resposta', cor: 'text-alerta' },
  devolvida: { texto: 'Devolvida', cor: 'text-sucesso' },
  recusada: { texto: 'Respondida sem devolução', cor: 'text-muted' },
};

/** Caixa de entrada das solicitações dos compradores — ADR-023. */
export default async function Solicitacoes() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const linhas = await solicitacoesDoProdutor(ctx.tenant.id);
  const abertas = linhas.filter((l) => l.status === 'aberta').length;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Solicitações de compradores</h1>
      <p className="prosa mt-1.5 max-w-2xl text-sm text-muted">
        Quando um comprador relata problema com o evento em “Meus ingressos”, o pedido aparece
        aqui. Responda rápido: quem não recebe resposta reclama no Procon ou contesta no cartão.
      </p>
      {abertas > 0 && (
        <p className="mt-5 rounded-botao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          {abertas} {abertas === 1 ? 'solicitação aguarda' : 'solicitações aguardam'} resposta.
        </p>
      )}

      {linhas.length === 0 ? (
        <div className="mt-8 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
          <p className="font-titulo font-semibold">Nenhuma solicitação</p>
          <p className="prosa mx-auto mt-2 text-sm text-muted">
            Bom sinal. Quando houver, chega também por e-mail.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {linhas.map((l) => {
            const s = SITUACAO[l.status]!;
            return (
              <li key={l.id}>
                <Link
                  href={`/painel/vendas/${l.orderId}`}
                  className="block rounded-cartao border border-line bg-raised p-4 transition hover:border-line-forte"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {ROTULO_SOLICITACAO[l.tipo]}
                      <span className="text-faint"> · pedido #{l.pedidoNumero}</span>
                    </p>
                    <p className={`text-xs ${s.cor}`}>{s.texto}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-faint">
                    {l.comprador ?? '—'} · {l.eventoTitulo} · {dataCurta(l.criadoEm)},{' '}
                    {hora(l.criadoEm)}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm text-muted">{l.relato}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
