import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb, withTenant } from '@/db/client';
import { events, tickets } from '@/db/schema';
import { temPapel } from '@/lib/auth';
import { getAuth } from '@/lib/session-cookie';

/**
 * Sincronização das passagens feitas offline — plano, seção 12, e ADR-011.
 *
 * O que sobe daqui é o **livro da porta**, não o estado do ingresso: cada
 * linha é "este QR passou neste sentido nesta hora". O estado corrente é
 * recalculado a partir do livro depois de cada inserção.
 *
 * Essa inversão é o que faz a sincronização tolerar o mundo real. Dois
 * aparelhos sobem em ordens diferentes, um deles fica três horas sem rede e
 * sobe a noite inteira de uma vez, a aba é recarregada e a fila é reenviada:
 * em todos os casos o resultado final é o mesmo, porque o livro é ordenado
 * por quando o fato aconteceu, não por quando chegou.
 *
 * A idempotência vem da chave natural (ingresso, tipo, hora) com
 * `on conflict do nothing`. Sem ela, reenviar a fila inflaria o contador —
 * e o contador é exatamente o número que o produtor confere no dia seguinte.
 *
 * O limite continua honesto: offline, dois portões sem comunicação deixam o
 * mesmo QR passar duas vezes. Nada resolve isso do lado do aparelho. O que a
 * sincronização dá é o registro de que aconteceu, para a operação saber.
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

type Situacao = 'registrado' | 'duplicado' | 'invalido';

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
    const saida: { tokenHash: string; situacao: Situacao }[] = [];

    for (const mov of corpo.data.movimentos) {
      const [ingresso] = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.tokenHash, mov.tokenHash), eq(tickets.eventId, eventId)))
        .limit(1);

      if (!ingresso) {
        saida.push({ tokenHash: mov.tokenHash, situacao: 'invalido' });
        continue;
      }

      /**
       * O livro primeiro. Se a linha já existia, este movimento já subiu — de
       * outra tentativa, ou de outra aba — e nada mais precisa acontecer.
       */
      const inseridas = (await tx.execute(sql`
        insert into ticket_movimentos
          (tenant_id, event_id, ticket_id, tipo, em, operador_id, device_id, origem)
        values (${evento.tenantId}, ${eventId}, ${ingresso.id}, ${mov.tipo},
                ${mov.em}::timestamptz, ${auth.userId}, ${mov.deviceId ?? null}, 'offline')
        on conflict do nothing
        returning id
      `)) as unknown as { id: string }[];

      if (inseridas.length === 0) {
        saida.push({ tokenHash: mov.tokenHash, situacao: 'duplicado' });
        continue;
      }

      /**
       * Estado recalculado a partir do livro inteiro do ingresso, e não
       * incrementado a partir do que chegou. É o que faz a chegada fora de
       * ordem convergir: quem manda é o movimento mais recente pelo horário
       * do fato.
       */
      await tx.execute(sql`
        update tickets t
           set entradas_count   = m.entradas,
               ultima_entrada_em = m.ultima_entrada,
               ultima_saida_em   = m.ultima_saida,
               checked_in_em     = least(coalesce(t.checked_in_em, m.primeira_entrada),
                                         m.primeira_entrada),
               checked_in_by     = coalesce(t.checked_in_by, ${auth.userId}),
               checked_in_device_id = coalesce(t.checked_in_device_id, ${mov.deviceId ?? null}),
               status = case when m.entradas > 0 and t.status = 'valido' then 'usado'
                             else t.status end,
               dentro = (m.ultimo_tipo = 'entrada') and m.entradas > 0,
               atualizado_em = now()
          from (
            select
              count(*) filter (where tipo = 'entrada')                as entradas,
              max(em)  filter (where tipo = 'entrada')                as ultima_entrada,
              min(em)  filter (where tipo = 'entrada')                as primeira_entrada,
              max(em)  filter (where tipo = 'saida')                  as ultima_saida,
              (array_agg(tipo order by em desc, criado_em desc))[1]   as ultimo_tipo
              from ticket_movimentos
             where ticket_id = ${ingresso.id}
          ) m
         where t.id = ${ingresso.id}
      `);

      saida.push({ tokenHash: mov.tokenHash, situacao: 'registrado' });
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
