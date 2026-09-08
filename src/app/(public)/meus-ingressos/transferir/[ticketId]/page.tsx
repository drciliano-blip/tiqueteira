import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { Rodape } from '@/components/rodape';
import { serviceDb } from '@/db/client';
import { events, orders, tickets, ticketTypes } from '@/db/schema';
import { avaliarTransferencia } from '@/domain/transferencia';
import { COOKIE_COMPRADOR, lerSessaoComprador } from '@/lib/buyer-session';
import { dataLonga, hora } from '@/lib/datas';
import { env } from '@/lib/env';
import { FormularioTransferencia } from '../formulario';

export const metadata: Metadata = {
  title: 'Transferir ingresso',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ ticketId: string }> };

export default async function Transferir({ params }: Props) {
  const { ticketId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) notFound();

  const store = await cookies();
  const email = lerSessaoComprador(store.get(COOKIE_COMPRADOR)?.value, env().AUTH_SECRET);
  if (!email) redirect('/meus-ingressos');

  const [linha] = await serviceDb()
    .select({
      id: tickets.id,
      codigo: tickets.codigo,
      status: tickets.status,
      titular: tickets.titularNome,
      transferenciasCount: tickets.transferenciasCount,
      tipo: ticketTypes.tipo,
      lote: ticketTypes.nome,
      compradorEmail: orders.compradorEmail,
      eventoTitulo: events.titulo,
      eventoInicio: events.dataInicio,
      eventoStatus: events.status,
      permiteTransferencia: events.permiteTransferencia,
      transferenciaAteHoras: events.transferenciaAteHoras,
      maxTransferencias: events.maxTransferenciasPorIngresso,
      transferenciaPermiteMeia: events.transferenciaPermiteMeia,
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(eq(tickets.id, ticketId))
    .limit(1);

  // Só quem comprou transfere. O titular atual não repassa adiante — senão
  // quem pagou perderia o controle do que comprou.
  if (!linha || linha.compradorEmail?.toLowerCase() !== email.toLowerCase()) notFound();

  const avaliacao = avaliarTransferencia({
    configuracao: {
      permiteTransferencia: linha.permiteTransferencia,
      transferenciaAteHoras: linha.transferenciaAteHoras,
      maxTransferenciasPorIngresso: linha.maxTransferencias,
      transferenciaPermiteMeia: linha.transferenciaPermiteMeia,
    },
    ingresso: {
      status: linha.status,
      transferenciasCount: linha.transferenciasCount,
      tipo: linha.tipo,
    },
    eventoInicio: linha.eventoInicio,
    eventoStatus: linha.eventoStatus,
    agora: new Date(),
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho comBusca={false} comCategorias={false} />
      </Suspense>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
        <h1 className="font-titulo text-xl font-bold">Transferir ingresso</h1>

        <div className="mt-4 rounded-cartao border border-line bg-raised p-4 text-sm">
          <p className="font-medium">{linha.eventoTitulo}</p>
          <p className="tabular mt-1 text-muted">
            {dataLonga(linha.eventoInicio)}, às {hora(linha.eventoInicio)}
          </p>
          <p className="tabular mt-2 text-faint">
            {linha.codigo} · {linha.lote} · titular atual: {linha.titular}
          </p>
        </div>

        <div className="mt-8">
          {avaliacao.permitido ? (
            <FormularioTransferencia ticketId={linha.id} codigo={linha.codigo} />
          ) : (
            /*
              Quando não dá, a tela explica por quê. Sumir com o botão sem
              dizer nada é o que gera chamado de suporte.
            */
            <div className="rounded-cartao border border-line bg-raised p-6 text-center">
              <p className="font-titulo font-semibold">Não é possível transferir</p>
              <p className="prosa mx-auto mt-2 text-sm text-muted">{avaliacao.explicacao}</p>
              <Link
                href="/meus-ingressos"
                className="mt-5 inline-block rounded-botao border border-line-forte px-5 py-3 text-sm font-medium transition hover:border-accent hover:text-accent"
              >
                Voltar
              </Link>
            </div>
          )}
        </div>
      </main>

      <Rodape />
    </div>
  );
}
