import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { dataCurta, hora } from '@/lib/datas';
import { convidadosDaLista, listasDoEvento, lotesDoEvento } from '@/lib/listas';
import { tenantAtual } from '@/lib/painel-contexto';
import { FormularioLista, FormularioNomes } from './formulario-lista';
import { BotaoLigar, BotaoRemover } from './botoes';

export const metadata: Metadata = { title: 'Listas de convidados' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ eventId: string }> };

export default async function Listas({ params }: Props) {
  const { eventId } = await params;
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const [evento] = await serviceDb()
    .select({ id: events.id, tenantId: events.tenantId, titulo: events.titulo })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento || evento.tenantId !== ctx.tenant.id) notFound();

  const [listas, lotes] = await Promise.all([
    listasDoEvento(ctx.tenant.id, eventId),
    lotesDoEvento(ctx.tenant.id, eventId),
  ]);

  const convidados = await Promise.all(
    listas.map((l) => convidadosDaLista(ctx.tenant.id, l.id)),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href={`/painel/eventos/${eventId}`} className="text-sm text-muted hover:text-txt">
        ← {evento.titulo}
      </Link>

      <h1 className="mt-3 font-titulo text-xl font-bold">Listas de convidados</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        Cada nome aqui vira uma cortesia emitida na porta, que consome lugar no lote. É ingresso
        que deixou de ser vendido — por isso a lista tem cota, e a cota é o teto.
      </p>

      {lotes.length === 0 && (
        <p className="mt-6 rounded-cartao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm">
          Este evento ainda não tem lote. Crie um lote antes da lista: a cortesia precisa
          consumir lugar de algum lote, senão a lista fura a capacidade do espaço.
        </p>
      )}

      {listas.map((lista, i) => {
        const nomes = convidados[i] ?? [];

        return (
          <section
            key={lista.id}
            className="mt-8 overflow-hidden rounded-cartao border border-line"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-raised px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {lista.nome}
                  {!lista.ativo && (
                    <span className="ml-2 text-xs uppercase text-faint">desativada</span>
                  )}
                </p>
                <p className="text-xs text-faint">
                  {lista.promoterNome ? `${lista.promoterNome} · ` : ''}
                  {lista.loteNome ?? 'sem lote'}
                  {lista.validoAte
                    ? ` · até ${dataCurta(lista.validoAte)}, ${hora(lista.validoAte)}`
                    : ''}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <p className="tabular text-right text-sm">
                  <span className="font-bold">{lista.cota.nomes}</span>
                  <span className="text-faint"> / {lista.cota.cota}</span>
                  <span className="block text-xs text-faint">{lista.entraram} entraram</span>
                </p>
                <BotaoLigar eventId={eventId} listaId={lista.id} ativo={lista.ativo} />
              </div>
            </header>

            {nomes.length > 0 && (
              <ul className="divide-y divide-line">
                {nomes.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{c.nome}</p>
                      {c.tipo !== 'cortesia' && (
                        <p className="text-xs text-faint">desconto — paga na bilheteria</p>
                      )}
                    </div>

                    {c.usadoEm ? (
                      <span className="shrink-0 text-xs text-sucesso">
                        entrou {hora(c.usadoEm)}
                      </span>
                    ) : (
                      <BotaoRemover eventId={eventId} entradaId={c.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-line px-4 py-4">
              <FormularioNomes eventId={eventId} listaId={lista.id} vagas={lista.cota.vagas} />
            </div>
          </section>
        );
      })}

      {lotes.length > 0 && (
        <section className="mt-12">
          <h2 className="font-titulo text-lg font-bold">Nova lista</h2>
          <p className="mt-1.5 text-sm text-muted">
            Uma lista por promoter facilita a conta no fim da noite: dá para ver quantos nomes
            cada um colocou e quantos apareceram.
          </p>
          <div className="mt-4">
            <FormularioLista eventId={eventId} lotes={lotes} />
          </div>
        </section>
      )}
    </main>
  );
}
