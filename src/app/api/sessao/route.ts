import { NextResponse } from 'next/server';

import { getAuth } from '@/lib/session-cookie';

/**
 * O estado de login, e só ele — ADR-015.
 *
 * Existe para tirar a leitura do cookie de dentro das páginas públicas. Ler
 * cookie no servidor torna a rota dinâmica, e rota dinâmica não é cacheável
 * na borda; com esta rota separada, a página do evento vira HTML igual para
 * todo mundo e só este pedacinho é pessoal.
 *
 * Devolve o mínimo de propósito: um booleano. Nome, e-mail e papéis não têm
 * o que fazer numa resposta que existe para escolher o rótulo de um botão.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await getAuth();

  return NextResponse.json(
    { temPainel: auth !== null && auth.papeis.length > 0 },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}
