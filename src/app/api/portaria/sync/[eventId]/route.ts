import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb, withTenant } from '@/db/client';
import { events } from '@/db/schema';
import { temPapel } from '@/lib/auth';
import { getAuth } from '@/lib/session-cookie';

/**
 * Sincronização das entradas feitas offline — plano, seção 12.
 *
 * A regra de conflito é a do plano: **vence o menor timestamp**. Se dois
 * portões sem rede leram o mesmo QR, quem passou primeiro fica registrado
 * como quem entrou, e o outro aparelho descobre na sincronização que aquela
 * entrada foi duplicada.
 *
 * Isso não impede a segunda pessoa de ter entrado — offline, ninguém impede.
 * O que a sincronização dá é o registro de que aconteceu, para a operação
 * saber e o produtor conferir. É honesto quanto ao limite da tecnologia: só
 * portão único ou rede entre aparelhos evita o furo de verdade.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Entrada = z.object({
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  em: z.iso.datetime(),
  deviceId: z.string().max(120).optional(),
});

const Corpo = z.object({ entradas: z.array(Entrada).min(1).max(500) });

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

  const resultados = await withTenant(evento.tenantId, async (tx) => {
    const saida: { tokenHash: string; situacao: 'registrado' | 'duplicado' | 'invalido' }[] = [];

    for (const entrada of corpo.data.entradas) {
      /**
       * `LEAST` resolve o conflito dentro do próprio UPDATE: se já havia uma
       * entrada registrada, fica a mais antiga. Ler antes para comparar
       * depois abriria janela entre dois aparelhos sincronizando junto.
       */
      const linhas = (await tx.execute(sql`
        update tickets
           set status = 'usado',
               checked_in_em = least(
                 coalesce(checked_in_em, ${entrada.em}::timestamptz),
                 ${entrada.em}::timestamptz
               ),
               checked_in_by = coalesce(checked_in_by, ${auth.userId}),
               checked_in_device_id = coalesce(checked_in_device_id, ${entrada.deviceId ?? null}),
               atualizado_em = now()
         where token_hash = ${entrada.tokenHash}
           and event_id = ${eventId}
           and status in ('valido', 'usado')
        returning (status = 'usado' and checked_in_em < ${entrada.em}::timestamptz) as ja_estava
      `)) as unknown as { ja_estava: boolean }[];

      if (linhas.length === 0) {
        saida.push({ tokenHash: entrada.tokenHash, situacao: 'invalido' });
      } else if (linhas[0]!.ja_estava) {
        saida.push({ tokenHash: entrada.tokenHash, situacao: 'duplicado' });
      } else {
        saida.push({ tokenHash: entrada.tokenHash, situacao: 'registrado' });
      }
    }

    return saida;
  });

  const duplicados = resultados.filter((r) => r.situacao === 'duplicado').length;

  return NextResponse.json({
    processadas: resultados.length,
    duplicados,
    resultados,
  });
}
