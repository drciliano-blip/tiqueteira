import { NextResponse } from 'next/server';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { temPapel } from '@/lib/auth';
import { compradoresDoProdutor, paraCsv } from '@/lib/publico-queries';
import { getAuth } from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

/**
 * Exportação da base de compradores em CSV — ADR-024.
 *
 * Dono e administrador. Toda exportação fica no audit_log: é dado pessoal de
 * terceiro saindo do sistema, e a pergunta "quem baixou a lista?" precisa ter
 * resposta.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await getAuth();
  const vinculo = auth?.papeis[0];
  if (!auth || !vinculo || !temPapel(auth, vinculo.tenantId, 'admin')) {
    return NextResponse.json({ erro: 'sem permissão' }, { status: 403 });
  }

  const evento = new URL(request.url).searchParams.get('evento');
  const eventId = evento && z.uuid().safeParse(evento).success ? evento : undefined;

  const { lista } = await compradoresDoProdutor(vinculo.tenantId, { eventId, limite: 100_000 });

  await serviceDb().insert(auditLog).values({
    tenantId: vinculo.tenantId,
    userId: auth.userId,
    acao: 'exportacao_publico',
    entidade: 'tenants',
    entidadeId: vinculo.tenantId,
    depois: { linhas: lista.length, eventId: eventId ?? null },
  });

  const hoje = new Date().toISOString().slice(0, 10);
  return new NextResponse(paraCsv(lista), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="compradores-${hoje}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
