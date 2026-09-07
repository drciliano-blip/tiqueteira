/**
 * Envelope de cookie da sessão. Separado de `src/lib/auth.ts` de propósito:
 * este arquivo importa `next/headers` e só roda dentro de requisição; o outro
 * é testável sem simular HTTP.
 */
import 'server-only';

import { cookies } from 'next/headers';

import { resolveSession, SESSION_COOKIE, type AuthContext } from '@/lib/auth';

export async function readSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/**
 * `httpOnly` tira o cookie do alcance de JavaScript, então XSS não rouba a
 * sessão. `sameSite: 'lax'` barra CSRF em POST vindo de outro site, mas
 * preserva o clique do magic link vindo do e-mail.
 */
export async function setSessionCookie(token: string, expiraEm: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiraEm,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Contexto de autenticação da requisição atual, ou `null`. */
export async function getAuth(): Promise<AuthContext | null> {
  return resolveSession(await readSessionToken());
}
