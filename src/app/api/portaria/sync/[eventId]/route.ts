import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { temPapel } from '@/lib/auth';
import { sincronizarMovimentos } from '@/lib/portaria-sync';
import { getAuth } from '@/lib/session-cookie';

/**
 * Recebe a fila de passagens que o aparelho acumulou sem rede.
 *
 * A rota faz o que rota faz: confere quem está pedindo, valida o formato e
 * entrega para `src/lib/portaria-sync.ts`. A regra de convergência mora lá,
 * junto do teste que a prova.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MovimentoRecebido = z.object({
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  tipo: z.enum(['entrada', 'saida']),
  em: z.iso.datetime(),
  deviceId: z.string().max(120).optional(),
});

const Corpo = z.object({ movimentos: z.array(MovimentoRecebido).min(1).max(500) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const { eventId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    return NextResponse.json({ erro: 'inválido' }, { status: 400 });
  }

  const auth = await getAuth();
  if (!auth) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const [evento] = await serviceDb()
    .select({ tenantId: events.tenantId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento) return NextResponse.json({ erro: 'evento não encontrado' }, { status: 404 });

  const foraDoEscopo = auth.scopeEventId !== null && auth.scopeEventId !== eventId;
  if (foraDoEscopo || !temPapel(auth, evento.tenantId, 'portaria', eventId)) {
    return NextResponse.json({ erro: 'sem permissão' }, { status: 403 });
  }

  const corpo = Corpo.safeParse(await request.json().catch(() => null));
  if (!corpo.success) return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });

  const resumo = await sincronizarMovimentos(
    { tenantId: evento.tenantId, eventId, userId: auth.userId },
    corpo.data.movimentos,
  );

  return NextResponse.json(resumo);
}
