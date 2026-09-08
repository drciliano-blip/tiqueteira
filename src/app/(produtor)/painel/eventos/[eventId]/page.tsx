import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import { events, ticketTypes, venues } from '@/db/schema';
import { tenantAtual } from '@/lib/painel-contexto';
import { atualizarEvento } from '../../acoes';
import { FormularioEvento } from '../formulario-evento';
import { Lotes } from './lotes';
import { BotoesStatus } from './status';

export const metadata: Metadata = { title: 'Evento' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ eventId: string }> };

/** Data e hora locais no formato dos campos do formulário. */
function partes(d: Date): { data: string; hora: string } {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [data, hora] = f.format(d).split(' ');
  return { data: data ?? '', hora: (hora ?? '').slice(0, 5) };
}

export default async function EditarEvento({ params }: Props) {
  const { eventId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();

  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const dados = await withTenant(ctx.tenant.id, async (tx) => {
    const [evento] = await tx
      .select({
        id: events.id,
        slug: events.slug,
        venueId: events.venueId,
        titulo: events.titulo,
        descricao: events.descricao,
        categoria: events.categoria,
        dataInicio: events.dataInicio,
        dataFim: events.dataFim,
        capacidade: events.capacidade,
        cotaMeiaBps: events.cotaMeiaBps,
        classificacaoEtaria: events.classificacaoEtaria,
        ingressoNominal: events.ingressoNominal,
        exigeDocumentoEntrada: events.exigeDocumentoEntrada,
        status: events.status,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!evento) return null;

    const espacos = await tx
      .select({ id: venues.id, nome: venues.nome, capacidadeMaxima: venues.capacidadeMaxima })
      .from(venues)
      .orderBy(asc(venues.nome));

    const lotes = await tx
      .select({
        id: ticketTypes.id,
        nome: ticketTypes.nome,
        descricao: ticketTypes.descricao,
        precoCentavos: ticketTypes.precoCentavos,
        tipo: ticketTypes.tipo,
        quantidadeTotal: ticketTypes.quantidadeTotal,
        quantidadeVendida: ticketTypes.quantidadeVendida,
        quantidadeReservada: ticketTypes.quantidadeReservada,
        limitePorPedido: ticketTypes.limitePorPedido,
        vendasInicio: ticketTypes.vendasInicio,
        vendasFim: ticketTypes.vendasFim,
        exigeDocumento: ticketTypes.exigeDocumento,
        ativo: ticketTypes.ativo,
      })
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, eventId))
      .orderBy(asc(ticketTypes.ordem), asc(ticketTypes.precoCentavos));

    return { evento, espacos, lotes };
  });

  if (!dados) notFound();

  const { evento, espacos, lotes } = dados;
  const inicio = partes(evento.dataInicio);
  const fim = partes(evento.dataFim);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-titulo text-xl font-bold leading-tight">{evento.titulo}</h1>
          <p className="mt-1 text-sm text-muted">
            {evento.status === 'publicado' ? (
              <Link
                href={`/${ctx.tenant.slug}/e/${evento.slug}`}
                className="text-accent transition hover:underline"
              >
                Ver na vitrine →
              </Link>
            ) : (
              'Ainda não está na vitrine.'
            )}
          </p>
        </div>

        <BotoesStatus
          tenantId={ctx.tenant.id}
          eventId={evento.id}
          status={evento.status}
          temLoteAtivo={lotes.some((l) => l.ativo)}
        />
      </div>

      <div className="mt-8">
        <Lotes
          tenantId={ctx.tenant.id}
          eventId={evento.id}
          lotes={lotes}
          capacidade={evento.capacidade}
          cotaMeiaBps={evento.cotaMeiaBps}
        />
      </div>

      <section className="mt-14">
        <h2 className="font-titulo text-lg font-bold">Dados do evento</h2>
        <div className="mt-5">
          <FormularioEvento
            acao={atualizarEvento.bind(null, ctx.tenant.id, evento.id)}
            espacos={espacos}
            rotuloBotao="Salvar alterações"
            valores={{
              venueId: evento.venueId,
              titulo: evento.titulo,
              descricao: evento.descricao ?? '',
              categoria: evento.categoria,
              dataInicio: inicio.data,
              horaInicio: inicio.hora,
              dataFim: fim.data,
              horaFim: fim.hora,
              capacidade: evento.capacidade,
              classificacaoEtaria: evento.classificacaoEtaria,
              ingressoNominal: evento.ingressoNominal,
              exigeDocumentoEntrada: evento.exigeDocumentoEntrada,
            }}
          />
        </div>
      </section>

      <section className="mt-14">
        <h2 className="font-titulo text-lg font-bold">Portaria</h2>
        <p className="prosa mt-2 text-sm text-muted">
          Abra este endereço no celular da portaria, no dia do evento. A leitura funciona pela
          câmera, e a busca por nome atende quem chegar sem bateria.
        </p>
        <Link
          href={`/portaria/${evento.id}`}
          className="mt-4 inline-block rounded-botao border border-line-forte px-5 py-3 text-sm font-medium transition hover:border-accent hover:text-accent"
        >
          Abrir portaria
        </Link>
      </section>
    </main>
  );
}
