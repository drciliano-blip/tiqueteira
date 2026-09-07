import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { temPapel } from '@/lib/auth';
import { contarPresentes } from '@/lib/checkin';
import { getAuth } from '@/lib/session-cookie';
import { PainelPortaria } from './painel-portaria';

export const metadata: Metadata = {
  title: 'Portaria',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ eventId: string }> };

export default async function Portaria({ params }: Props) {
  const { eventId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) redirect('/painel');

  const auth = await getAuth();
  if (!auth) redirect('/entrar');

  const [evento] = await serviceDb()
    .select({
      id: events.id,
      tenantId: events.tenantId,
      titulo: events.titulo,
      status: events.status,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento) redirect('/painel');

  /**
   * Sessão de portaria vale para UM evento. O aparelho fica na mão de
   * terceiro e é emprestado entre turnos — sem escopo, ele viraria acesso a
   * qualquer evento da casa.
   */
  const foraDoEscopo = auth.scopeEventId !== null && auth.scopeEventId !== eventId;

  if (foraDoEscopo || !temPapel(auth, evento.tenantId, 'portaria', eventId)) {
    return (
      <main className="grid min-h-dvh place-items-center bg-black px-6 text-center text-white">
        <div>
          <p className="text-2xl font-bold">Sem acesso a esta portaria</p>
          <p className="mt-3 max-w-xs text-sm text-white/60">
            Peça ao produtor para liberar seu usuário neste evento.
          </p>
          <Link href="/painel" className="mt-6 inline-block text-sm underline">
            Voltar ao painel
          </Link>
        </div>
      </main>
    );
  }

  const inicial = await contarPresentes(evento.tenantId, evento.id);

  return (
    <PainelPortaria
      eventId={evento.id}
      eventoTitulo={evento.titulo}
      inicial={inicial}
    />
  );
}
