import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { consultarFila, cookieDaFila, entrarNaFila, estadoDaFila } from '@/lib/fila';

/**
 * A senha da fila e a consulta dela.
 *
 * É a rota mais chamada de uma abertura de vendas: 20 mil pessoas perguntando
 * "já é minha vez?" a cada poucos segundos. Por isso ela não renderiza página
 * nenhuma e não toca em nada além da linha do evento e da linha da pessoa — o
 * intervalo entre uma pergunta e outra é decidido pelo servidor e devolvido
 * junto com a resposta, para que a fila grande pergunte menos.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function valido(eventId: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(eventId);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const { eventId } = await params;
  if (!valido(eventId)) return NextResponse.json({ erro: 'inválido' }, { status: 400 });

  const jar = await cookies();
  const token = jar.get(cookieDaFila(eventId))?.value;

  return NextResponse.json(await consultarFila(eventId, token), {
    headers: { 'cache-control': 'no-store' },
  });
}

/** Pega senha. Idempotente por cookie: recarregar não perde o lugar. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const { eventId } = await params;
  if (!valido(eventId)) return NextResponse.json({ erro: 'inválido' }, { status: 400 });

  const estado = await estadoDaFila(eventId);
  if (!estado) return NextResponse.json({ erro: 'evento não encontrado' }, { status: 404 });
  if (!estado.filaAtiva) return NextResponse.json({ situacao: 'sem_fila' });

  const jar = await cookies();
  const nome = cookieDaFila(eventId);
  const existente = jar.get(nome)?.value;

  if (existente) {
    const atual = await consultarFila(eventId, existente);
    // Só devolve um lugar novo se o antigo não vale mais.
    if (atual.situacao !== 'sem_lugar') return NextResponse.json(atual);
  }

  const lugar = await entrarNaFila(eventId, estado.tenantId);
  if (!lugar) return NextResponse.json({ erro: 'fila indisponível' }, { status: 409 });

  const resposta = NextResponse.json(await consultarFila(eventId, lugar.token));

  resposta.cookies.set(nome, lugar.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Uma abertura de vendas não dura mais que algumas horas.
    maxAge: 6 * 60 * 60,
  });

  return resposta;
}
