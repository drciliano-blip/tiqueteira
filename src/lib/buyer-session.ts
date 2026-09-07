/**
 * Acesso do comprador — benchmark, seção 3.
 *
 * O comprador NUNCA cria senha. Ele compra sem conta e, depois, informa o
 * e-mail da compra e recebe um link de acesso. Quem compra ingresso não quer
 * cadastro, e cada campo a mais no caminho custa conversão.
 *
 * Duas peças:
 *
 * 1. `buyer_access_tokens` — token de uso único com validade curta, guardado
 *    como hash. É o que chega no e-mail.
 * 2. Cookie assinado — depois que o link é usado, o navegador guarda um
 *    cookie com o e-mail e a assinatura. Sem tabela de sessão: o comprador
 *    não tem conta para revogar, e o cookie expira sozinho.
 */
import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { buyerAccessTokens } from '@/db/schema';

export const COOKIE_COMPRADOR = 'tq_comprador';

/** Curto de propósito: link de e-mail vaza por encaminhamento e por print. */
export const VALIDADE_LINK_MINUTOS = 15;
export const VALIDADE_SESSAO_DIAS = 30;

function hash(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Link mágico
// ---------------------------------------------------------------------------

export async function criarLinkDeAcesso(
  email: string,
  contexto: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiraEm: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiraEm = new Date(Date.now() + VALIDADE_LINK_MINUTOS * 60_000);

  await serviceDb().insert(buyerAccessTokens).values({
    email: normalizarEmail(email),
    tokenHash: hash(token),
    expiraEm,
    ip: contexto.ip ?? null,
    userAgent: contexto.userAgent ?? null,
  });

  return { token, expiraEm };
}

export type ResultadoLink =
  | { ok: true; email: string }
  | { ok: false; motivo: 'invalido' | 'expirado' | 'usado' };

/**
 * Troca o token do link por acesso. Uso único: o mesmo link clicado duas vezes
 * (o que acontece com pré-carregamento de e-mail) só vale na primeira.
 */
export async function consumirLinkDeAcesso(token: string): Promise<ResultadoLink> {
  if (!token || token.length < 20) return { ok: false, motivo: 'invalido' };

  const db = serviceDb();
  const esperado = hash(token);

  // O UPDATE condicional é o que garante o uso único, mesmo com dois cliques
  // simultâneos: só um consegue marcar `usado_em`.
  const consumidos = await db
    .update(buyerAccessTokens)
    .set({ usadoEm: new Date() })
    .where(
      and(
        eq(buyerAccessTokens.tokenHash, esperado),
        isNull(buyerAccessTokens.usadoEm),
        gt(buyerAccessTokens.expiraEm, new Date()),
      ),
    )
    .returning({ email: buyerAccessTokens.email });

  if (consumidos.length > 0) return { ok: true, email: consumidos[0]!.email };

  // Não consumiu: dizer por quê ajuda o comprador a saber o que fazer.
  const [existente] = await db
    .select({ usadoEm: buyerAccessTokens.usadoEm, expiraEm: buyerAccessTokens.expiraEm })
    .from(buyerAccessTokens)
    .where(eq(buyerAccessTokens.tokenHash, esperado))
    .limit(1);

  if (!existente) return { ok: false, motivo: 'invalido' };
  if (existente.usadoEm) return { ok: false, motivo: 'usado' };
  return { ok: false, motivo: 'expirado' };
}

/** Higiene: apaga token vencido há mais de 7 dias. */
export async function limparTokensAntigos(): Promise<number> {
  const apagados = await serviceDb()
    .delete(buyerAccessTokens)
    .where(sql`${buyerAccessTokens.expiraEm} < now() - interval '7 days'`)
    .returning({ id: buyerAccessTokens.id });
  return apagados.length;
}

// ---------------------------------------------------------------------------
// Cookie de sessão do comprador
// ---------------------------------------------------------------------------

/**
 * Formato: `<email em base64url>.<expiração>.<assinatura>`.
 *
 * Assinado, não criptografado: o conteúdo não é segredo — é o próprio e-mail
 * de quem está usando o navegador. O que a assinatura impede é alguém trocar
 * o e-mail no cookie e ver os ingressos de outra pessoa.
 */
export function assinarSessaoComprador(email: string, segredo: string): string {
  const expira = Date.now() + VALIDADE_SESSAO_DIAS * 24 * 3600 * 1000;
  const dados = `${Buffer.from(normalizarEmail(email), 'utf8').toString('base64url')}.${expira}`;
  const assinatura = createHmac('sha256', segredo).update(dados).digest('base64url');
  return `${dados}.${assinatura}`;
}

export function lerSessaoComprador(cookie: string | undefined, segredo: string): string | null {
  if (!cookie) return null;

  const partes = cookie.split('.');
  if (partes.length !== 3) return null;

  const [emailB64, expiraTexto, assinatura] = partes as [string, string, string];
  const dados = `${emailB64}.${expiraTexto}`;

  const esperada = createHmac('sha256', segredo).update(dados).digest('base64url');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(assinatura, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const expira = Number(expiraTexto);
  if (!Number.isFinite(expira) || expira <= Date.now()) return null;

  try {
    return Buffer.from(emailB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}
