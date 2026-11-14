import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { Cabecalho } from '@/components/cabecalho';
import { Rodape } from '@/components/rodape';
import { serviceDb } from '@/db/client';
import { tickets, ticketTypes } from '@/db/schema';
import { COOKIE_COMPRADOR, lerSessaoComprador } from '@/lib/buyer-session';
import { dataCurta, dataLonga, hora } from '@/lib/datas';
import { env } from '@/lib/env';
import { formatarBRL } from '@/lib/money';
import { simularReembolso } from '@/lib/refunds';
import {
  pedidoDoComprador,
  ROTULO_SOLICITACAO,
  solicitacoesDoPedido,
} from '@/lib/solicitacoes';
import { CancelarCompra, ReenviarIngressos, RelatarProblema } from './formularios';

export const metadata: Metadata = { title: 'Meu pedido', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ orderId: string }> };

const SITUACAO_INGRESSO: Record<string, string> = {
  valido: 'Válido',
  usado: 'Entrou',
  cancelado: 'Cancelado',
  transferido: 'Transferido',
};

const SITUACAO_SOLICITACAO: Record<string, { texto: string; cor: string }> = {
  aberta: { texto: 'Aguardando o organizador', cor: 'text-alerta' },
  devolvida: { texto: 'Devolução aprovada', cor: 'text-sucesso' },
  recusada: { texto: 'Respondida', cor: 'text-muted' },
};

/**
 * Autoatendimento do comprador — ADR-023.
 *
 * As três dúvidas que geram quase todo o suporte de bilheteria têm resposta
 * aqui, sem falar com ninguém: "posso cancelar?", "não recebi o ingresso" e
 * "o evento deu problema".
 */
export default async function MeuPedido({ params }: Props) {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();

  const store = await cookies();
  const email = lerSessaoComprador(store.get(COOKIE_COMPRADOR)?.value, env().AUTH_SECRET);
  if (!email) redirect('/meus-ingressos');

  const pedido = await pedidoDoComprador(email, orderId);
  if (!pedido) notFound();

  const [ingressos, historico] = await Promise.all([
    serviceDb()
      .select({
        codigo: tickets.codigo,
        status: tickets.status,
        titular: tickets.titularNome,
        lote: ticketTypes.nome,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .where(eq(tickets.orderId, orderId))
      .orderBy(tickets.codigo),
    solicitacoesDoPedido(orderId),
  ]);

  const validos = ingressos.filter((i) => i.status === 'valido').length;
  const ativo = pedido.status === 'paid' || pedido.status === 'partially_refunded';
  const simulacao = ativo && validos > 0 ? await simularReembolso(orderId, validos) : null;
  const temAberta = historico.some((h) => h.status === 'aberta');

  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho comBusca={false} comCategorias={false} />
      </Suspense>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <Link href="/meus-ingressos" className="text-sm text-muted transition hover:text-txt">
          ← Meus ingressos
        </Link>

        <h1 className="mt-4 font-titulo text-xl font-bold">{pedido.eventoTitulo}</h1>
        <p className="tabular mt-1 text-sm text-muted">
          {dataLonga(pedido.eventoInicio)}, às {hora(pedido.eventoInicio)} · pedido nº{' '}
          {pedido.numero} · {formatarBRL(pedido.totalCentavos)}
        </p>
        {pedido.eventoStatus === 'cancelado' && (
          <p className="mt-3 rounded-botao border border-alerta/40 bg-alerta/10 px-3 py-2.5 text-sm text-alerta">
            Este evento foi cancelado. A devolução é automática e integral.
          </p>
        )}

        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">Ingressos</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-cartao border border-line">
            {ingressos.map((i) => (
              <li key={i.codigo} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  {i.status === 'valido' ? (
                    <Link href={`/ingresso/${i.codigo}`} className="font-medium hover:text-accent">
                      {i.titular}
                    </Link>
                  ) : (
                    <span className="font-medium text-muted">{i.titular}</span>
                  )}
                  <p className="tabular text-xs text-faint">
                    {i.codigo} · {i.lote}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {SITUACAO_INGRESSO[i.status] ?? i.status}
                </span>
              </li>
            ))}
          </ul>
          {ativo && validos > 0 && (
            <div className="mt-3">
              <ReenviarIngressos orderId={orderId} />
            </div>
          )}
        </section>

        {simulacao && (
          <section className="mt-10">
            <h2 className="font-titulo text-lg font-bold">Cancelar a compra</h2>
            {simulacao.permitido ? (
              <>
                <p className="prosa mt-2 text-sm text-muted">{simulacao.explicacao}</p>
                <div className="mt-4">
                  <CancelarCompra orderId={orderId} validos={validos} />
                </div>
              </>
            ) : (
              <p className="prosa mt-2 text-sm text-muted">
                {simulacao.explicacao} Se houve problema com o evento, relate abaixo.
              </p>
            )}
          </section>
        )}

        {ativo && (
          <section className="mt-10">
            <h2 className="font-titulo text-lg font-bold">Problema com o evento</h2>
            <p className="prosa mt-2 text-sm text-muted">
              O evento não aconteceu, foi diferente do anunciado ou você não conseguiu entrar? Conte
              o que houve. O organizador recebe na hora e responde por e-mail; tudo fica
              registrado.
            </p>
            <div className="mt-4">
              {temAberta ? (
                <p
                  role="status"
                  className="rounded-botao border border-sucesso/40 bg-sucesso/10 px-3 py-2.5 text-sm text-sucesso"
                >
                  Recebemos o seu relato. O organizador vai responder por e-mail — acompanhe
                  abaixo.
                </p>
              ) : (
                <RelatarProblema orderId={orderId} />
              )}
            </div>
          </section>
        )}

        {historico.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
              Suas solicitações
            </h2>
            <ul className="mt-3 space-y-3">
              {historico.map((h) => {
                const s = SITUACAO_SOLICITACAO[h.status]!;
                return (
                  <li key={h.id} className="rounded-cartao border border-line bg-raised p-4 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{ROTULO_SOLICITACAO[h.tipo]}</p>
                      <p className={`text-xs ${s.cor}`}>{s.texto}</p>
                    </div>
                    <p className="tabular mt-0.5 text-xs text-faint">{dataCurta(h.criadoEm)}</p>
                    <p className="mt-2 whitespace-pre-wrap text-muted">{h.relato}</p>
                    {h.resposta && (
                      <div className="mt-3 border-l-2 border-line pl-3">
                        <p className="text-xs text-faint">Resposta do organizador</p>
                        <p className="mt-1 whitespace-pre-wrap">{h.resposta}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>

      <Rodape />
    </div>
  );
}
