import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { serviceDb, withTenant } from '@/db/client';
import { events, tickets, ticketTypes } from '@/db/schema';
import { temPapel } from '@/lib/auth';
import { getAuth } from '@/lib/session-cookie';

/**
 * Manifesto assinado da portaria — plano, seções 12 e 24.
 *
 * O celular baixa esta lista ANTES de abrir os portões e valida no próprio
 * aparelho. Sem esse passo, a portaria depende da rede da casa — que, em casa
 * noturna, é a primeira coisa a cair quando enche.
 *
 * O manifesto carrega o HASH do token, nunca o token. O aparelho calcula o
 * hash do QR lido e procura na lista: confere a validade sem precisar do
 * segredo do servidor, e um celular perdido não vira gerador de ingresso.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const { eventId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    return NextResponse.json({ erro: 'inválido' }, { status: 400 });
  }

  const auth = await getAuth();
  if (!auth) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const [evento] = await serviceDb()
    .select({
      tenantId: events.tenantId,
      titulo: events.titulo,
      nominal: events.ingressoNominal,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento) return NextResponse.json({ erro: 'evento não encontrado' }, { status: 404 });

  const foraDoEscopo = auth.scopeEventId !== null && auth.scopeEventId !== eventId;
  if (foraDoEscopo || !temPapel(auth, evento.tenantId, 'portaria', eventId)) {
    return NextResponse.json({ erro: 'sem permissão' }, { status: 403 });
  }

  const linhas = await withTenant(evento.tenantId, (tx) =>
    tx
      .select({
        h: tickets.tokenHash,
        c: tickets.codigo,
        n: tickets.titularNome,
        d: tickets.titularCpf,
        l: ticketTypes.nome,
        s: tickets.status,
        e: tickets.checkedInEm,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .where(eq(tickets.eventId, eventId)),
  );

  return NextResponse.json(
    {
      eventId,
      titulo: evento.titulo,
      nominal: evento.nominal,
      geradoEm: new Date().toISOString(),
      total: linhas.length,
      ingressos: linhas.map((t) => ({
        h: t.h,
        c: t.c,
        n: t.n,
        // Só os dígitos do meio: dá para distinguir homônimos sem levar o
        // documento inteiro para dentro de um celular emprestado.
        d: t.d ? t.d.slice(3, 9) : null,
        l: t.l,
        s: t.s,
        e: t.e ? t.e.toISOString() : null,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
