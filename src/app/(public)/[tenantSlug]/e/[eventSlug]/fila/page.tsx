import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { estadoDaFila } from '@/lib/fila';
import { buscarEventoPublico, resolverTenantPublico } from '@/lib/public-queries';
import { SalaDeEspera } from './sala-de-espera';

export const metadata: Metadata = {
  title: 'Fila',
  robots: { index: false, follow: false },
};

/**
 * A sala de espera não é cacheável — cada pessoa vê a sua posição — mas ela é
 * uma página quase vazia: todo o movimento acontece em `/api/fila/[eventId]`.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ tenantSlug: string; eventSlug: string }> };

export default async function Fila({ params }: Props) {
  const { tenantSlug, eventSlug } = await params;

  const tenant = await resolverTenantPublico(tenantSlug);
  if (!tenant) notFound();

  const evento = await buscarEventoPublico(tenant.id, eventSlug);
  if (!evento) notFound();

  const destino = `/${tenantSlug}/e/${eventSlug}`;

  const estado = await estadoDaFila(evento.id);
  // Fila desligada: não existe sala de espera, existe a página do evento.
  if (!estado?.filaAtiva) redirect(destino);

  return <SalaDeEspera eventId={evento.id} destino={destino} evento={evento.titulo} />;
}
