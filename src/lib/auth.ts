/**
 * Autenticação e sessão — ADR-005.
 *
 * Sessão com estado no banco, não JWT: revogar precisa ser imediato. Num
 * sistema que move dinheiro, "o token ainda vale por 15 minutos" não é uma
 * resposta aceitável quando alguém é desligado.
 *
 * Este módulo NÃO importa `next/headers`. O envelope de cookie fica em
 * `src/lib/session-cookie.ts`, para que a lógica de sessão seja testável
 * sem simular uma requisição HTTP.
 *
 * Runtime Node obrigatório: o Argon2 é binário nativo e não roda no Edge.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { memberships, sessions, users } from '@/db/schema';

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'tq_session';

/** Duração da sessão por perfil de uso. */
export const SESSION_TTL_MS = {
  /** Painel do produtor e admin. */
  painel: 12 * 60 * 60 * 1000,
  /**
   * Portaria. Curta de propósito: o aparelho fica na mão de terceiro, na rua,
   * e costuma ser emprestado entre turnos.
   */
  portaria: 8 * 60 * 60 * 1000,
  /** Área do comprador, via magic link. */
  comprador: 30 * 24 * 60 * 60 * 1000,
} as const;

/**
 * OWASP recomenda, para Argon2id, no mínimo 19 MiB de memória, 2 iterações e
 * paralelismo 1. Ficamos acima disso: 64 MiB e 3 iterações. Custa ~100 ms por
 * login, o que é irrelevante para o usuário e caro para quem tenta força bruta.
 */
const ARGON_OPTS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export type Role = 'owner' | 'admin' | 'operador' | 'portaria';

/** Quem pode o que. Papel mais alto contém os de baixo. */
const HIERARQUIA: Record<Role, number> = {
  owner: 40,
  admin: 30,
  operador: 20,
  portaria: 10,
};

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

export async function hashPassword(senha: string): Promise<string> {
  if (senha.length < 10) {
    throw new Error('Senha precisa de pelo menos 10 caracteres');
  }
  return argonHash(senha, ARGON_OPTS);
}

export async function verifyPassword(hash: string, senha: string): Promise<boolean> {
  try {
    return await argonVerify(hash, senha, ARGON_OPTS);
  } catch {
    // Hash corrompido ou formato desconhecido. Não é motivo para vazar erro
    // ao cliente — é login inválido.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Token de sessão
// ---------------------------------------------------------------------------

/**
 * O cookie carrega um token opaco de 256 bits. O banco guarda só o SHA-256
 * dele: vazamento de dump de banco não vira sessão ativa.
 *
 * SHA-256 sem salt é adequado AQUI — e só aqui — porque a entrada já é
 * aleatória de 256 bits. Não há dicionário a montar. Para senha, jamais.
 */
function novoToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparação em tempo constante, para não vazar prefixo por timing. */
function tokensBatem(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Ciclo de vida da sessão
// ---------------------------------------------------------------------------

export type CreateSessionInput = {
  userId: string;
  /** Tenant ativo. Alimenta `app.tenant_id`. Nulo para comprador e admin. */
  tenantId?: string | null;
  /** Escopo de portaria: a sessão só vale para este evento. */
  scopeEventId?: string | null;
  ttlMs?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type CreatedSession = {
  /** Valor a colocar no cookie. Só existe aqui — nunca é relido do banco. */
  token: string;
  sessionId: string;
  expiraEm: Date;
};

export async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  const token = novoToken();
  const expiraEm = new Date(Date.now() + (input.ttlMs ?? SESSION_TTL_MS.painel));

  const [row] = await serviceDb()
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: hashToken(token),
      tenantId: input.tenantId ?? null,
      scopeEventId: input.scopeEventId ?? null,
      expiraEm,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning({ id: sessions.id });

  if (!row) throw new Error('Falha ao criar sessão');

  return { token, sessionId: row.id, expiraEm };
}

export type AuthContext = {
  userId: string;
  nome: string;
  email: string;
  sessionId: string;
  tenantId: string | null;
  scopeEventId: string | null;
  expiraEm: Date;
  /** Papéis do usuário, por tenant. */
  papeis: { tenantId: string; role: Role; eventoId: string | null }[];
};

/**
 * Resolve o token do cookie em contexto de autenticação.
 * Devolve `null` para qualquer motivo de invalidez — sessão inexistente,
 * expirada, revogada ou usuário bloqueado. O chamador não precisa saber qual.
 */
export async function resolveSession(token: string | undefined | null): Promise<AuthContext | null> {
  if (!token) return null;

  const esperado = hashToken(token);
  const db = serviceDb();

  const [row] = await db
    .select({
      sessionId: sessions.id,
      tokenHash: sessions.tokenHash,
      tenantId: sessions.tenantId,
      scopeEventId: sessions.scopeEventId,
      expiraEm: sessions.expiraEm,
      userId: users.id,
      nome: users.nome,
      email: users.email,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, esperado),
        isNull(sessions.revogadaEm),
        gt(sessions.expiraEm, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (!tokensBatem(row.tokenHash, esperado)) return null;
  if (row.status !== 'ativo') return null;

  const papeis = await db
    .select({
      tenantId: memberships.tenantId,
      role: memberships.role,
      eventoId: memberships.eventoId,
    })
    .from(memberships)
    .where(eq(memberships.userId, row.userId));

  return {
    userId: row.userId,
    nome: row.nome,
    email: row.email,
    sessionId: row.sessionId,
    tenantId: row.tenantId,
    scopeEventId: row.scopeEventId,
    expiraEm: row.expiraEm,
    papeis,
  };
}

export async function revokeSession(token: string): Promise<void> {
  await serviceDb()
    .update(sessions)
    .set({ revogadaEm: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revogadaEm)));
}

/** Desliga todas as sessões de um usuário. Usado em troca de senha. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const linhas = await serviceDb()
    .update(sessions)
    .set({ revogadaEm: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revogadaEm)))
    .returning({ id: sessions.id });
  return linhas.length;
}

/** Higiene: remove sessão expirada há mais de 30 dias. Roda como job. */
export async function purgeExpiredSessions(): Promise<number> {
  const linhas = await serviceDb()
    .delete(sessions)
    .where(sql`${sessions.expiraEm} < now() - interval '30 days'`)
    .returning({ id: sessions.id });
  return linhas.length;
}

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: 'nao_autenticado' | 'sem_permissao' | 'fora_do_escopo',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Papel efetivo do usuário num tenant. Considera o papel global do tenant
 * (`evento_id` nulo) e o papel restrito ao evento, quando informado.
 */
export function papelNoTenant(
  ctx: AuthContext,
  tenantId: string,
  eventoId?: string | null,
): Role | null {
  const candidatos = ctx.papeis.filter(
    (p) => p.tenantId === tenantId && (p.eventoId === null || p.eventoId === eventoId),
  );
  if (candidatos.length === 0) return null;

  return candidatos.reduce<Role>(
    (maior, p) => (HIERARQUIA[p.role] > HIERARQUIA[maior] ? p.role : maior),
    candidatos[0]!.role,
  );
}

export function temPapel(
  ctx: AuthContext,
  tenantId: string,
  minimo: Role,
  eventoId?: string | null,
): boolean {
  const papel = papelNoTenant(ctx, tenantId, eventoId);
  if (!papel) return false;
  return HIERARQUIA[papel] >= HIERARQUIA[minimo];
}

/**
 * Exige papel mínimo no tenant. Lança `AuthError` — o chamador traduz para
 * 401/403 ou redirect, conforme o contexto.
 */
export function requireRole(
  ctx: AuthContext | null,
  tenantId: string,
  minimo: Role,
  eventoId?: string | null,
): asserts ctx is AuthContext {
  if (!ctx) throw new AuthError('Não autenticado', 'nao_autenticado');
  if (!temPapel(ctx, tenantId, minimo, eventoId)) {
    throw new AuthError('Sem permissão neste tenant', 'sem_permissao');
  }
}

/**
 * Portaria: além do papel, a sessão precisa estar no escopo do evento.
 * Sessão com `scopeEventId` definido só vale para aquele evento — mesmo que o
 * usuário tenha papel mais alto em outro lugar.
 */
export function requireGateAccess(
  ctx: AuthContext | null,
  tenantId: string,
  eventoId: string,
): asserts ctx is AuthContext {
  if (!ctx) throw new AuthError('Não autenticado', 'nao_autenticado');
  if (ctx.scopeEventId !== null && ctx.scopeEventId !== eventoId) {
    throw new AuthError('Sessão restrita a outro evento', 'fora_do_escopo');
  }
  if (!temPapel(ctx, tenantId, 'portaria', eventoId)) {
    throw new AuthError('Sem permissão na portaria deste evento', 'sem_permissao');
  }
}
