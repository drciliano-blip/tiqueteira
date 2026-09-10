/**
 * Equipe do produtor — quem entra no painel e quem opera a porta.
 *
 * Sem isto, cada espaço novo dependia de alguém com acesso ao banco para
 * cadastrar a pessoa da portaria. Era o item que impedia vender a plataforma
 * para um terceiro: ninguém compra um sistema em que criar o usuário da porta
 * é um chamado para o fornecedor.
 *
 * O modelo já existia no esquema desde a Fase 0 — papel por tenant, com o
 * papel `portaria` opcionalmente preso a um evento. O que faltava era tela.
 */
import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events, memberships, sessions, users } from '@/db/schema';
import { hashPassword, revokeAllSessions, type Role } from '@/lib/auth';

export type PessoaDaEquipe = {
  membershipId: string;
  userId: string;
  nome: string;
  email: string;
  role: Role;
  eventoId: string | null;
  eventoTitulo: string | null;
  status: string;
  sessoesAtivas: number;
};

export async function equipeDoTenant(tenantId: string): Promise<PessoaDaEquipe[]> {
  const linhas = await serviceDb()
    .select({
      membershipId: memberships.id,
      userId: users.id,
      nome: users.nome,
      email: users.email,
      role: memberships.role,
      eventoId: memberships.eventoId,
      eventoTitulo: events.titulo,
      status: users.status,
      sessoesAtivas: sql<number>`(
        select count(*) from sessions s
         where s.user_id = ${users.id}
           and s.revogada_em is null
           and s.expira_em > now()
      )`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(events, eq(events.id, memberships.eventoId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(asc(users.nome));

  return linhas.map((l) => ({ ...l, sessoesAtivas: Number(l.sessoesAtivas) }));
}

/**
 * Senha temporária legível em voz alta.
 *
 * Sem `0`, `O`, `1`, `l` e `I`: quem digita isto é a pessoa da portaria, no
 * escuro, com fila atrás, geralmente com alguém ditando por telefone. Cada
 * caractere ambíguo vira uma tentativa perdida.
 */
export function senhaTemporaria(): string {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);

  const bloco = [...bytes].map((b) => alfabeto[b % alfabeto.length]).join('');
  return `${bloco.slice(0, 4)}-${bloco.slice(4, 8)}-${bloco.slice(8, 12)}`;
}

export type ResultadoConvite =
  | { ok: true; senha: string | null; jaExistia: boolean }
  | { ok: false; erro: string };

/**
 * Põe alguém na equipe.
 *
 * Se o e-mail já é usuário da plataforma, só cria o vínculo — e a senha dele
 * continua sendo dele. Se não é, cria a conta com senha temporária, devolvida
 * **uma vez** para o produtor repassar. Não guardamos senha em texto em lugar
 * nenhum, então ela não pode ser mostrada de novo depois: só trocada.
 */
export async function adicionarNaEquipe(params: {
  tenantId: string;
  nome: string;
  email: string;
  role: Role;
  eventoId: string | null;
}): Promise<ResultadoConvite> {
  const db = serviceDb();
  const email = params.email.trim().toLowerCase();

  const [existente] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  let userId = existente?.id;
  let senha: string | null = null;

  if (!userId) {
    senha = senhaTemporaria();
    const [criado] = await db
      .insert(users)
      .values({ nome: params.nome.trim(), email, senhaHash: await hashPassword(senha) })
      .returning({ id: users.id });

    userId = criado!.id;
  }

  /**
   * A unique é (usuário, tenant, evento). Uma pessoa pode ser operador da casa
   * e portaria de um evento específico ao mesmo tempo — são vínculos
   * diferentes, e o papel efetivo é o mais alto entre os que se aplicam.
   */
  const vinculo = await db
    .insert(memberships)
    .values({
      userId,
      tenantId: params.tenantId,
      role: params.role,
      eventoId: params.eventoId,
    })
    .onConflictDoNothing()
    .returning({ id: memberships.id });

  if (vinculo.length === 0) {
    return { ok: false, erro: 'Esta pessoa já tem esse acesso.' };
  }

  return { ok: true, senha, jaExistia: Boolean(existente) };
}

/**
 * Tira o vínculo e derruba as sessões abertas.
 *
 * Derrubar junto não é exagero: o caso real de remover alguém é a pessoa ter
 * saído da equipe hoje, e o celular da portaria dela continuar logado.
 */
export async function removerDaEquipe(tenantId: string, membershipId: string): Promise<boolean> {
  const db = serviceDb();

  const removidos = await db
    .delete(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId)))
    .returning({ userId: memberships.userId });

  const removido = removidos[0];
  if (!removido) return false;

  // Só derruba se a pessoa não tiver mais nenhum outro vínculo com este tenant.
  const [resto] = await db
    .select({ total: sql<number>`count(*)` })
    .from(memberships)
    .where(
      and(eq(memberships.userId, removido.userId), eq(memberships.tenantId, tenantId)),
    );

  if (Number(resto?.total ?? 0) === 0) {
    await revokeAllSessions(removido.userId);
  }

  return true;
}

/** Nova senha temporária, para quem esqueceu ou perdeu o aparelho. */
export async function trocarSenha(
  tenantId: string,
  membershipId: string,
): Promise<string | null> {
  const db = serviceDb();

  const [vinculo] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId)))
    .limit(1);

  if (!vinculo) return null;

  const senha = senhaTemporaria();
  await db
    .update(users)
    .set({ senhaHash: await hashPassword(senha), atualizadoEm: new Date() })
    .where(eq(users.id, vinculo.userId));

  // Senha trocada derruba o que estava aberto: é metade do motivo de trocar.
  await revokeAllSessions(vinculo.userId);

  return senha;
}

/** Derruba as sessões de alguém sem tirar o acesso. Celular perdido no meio da festa. */
export async function derrubarSessoes(
  tenantId: string,
  membershipId: string,
): Promise<number | null> {
  const db = serviceDb();

  const [vinculo] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId)))
    .limit(1);

  if (!vinculo) return null;
  return revokeAllSessions(vinculo.userId);
}

/** Eventos do produtor, para prender o papel de portaria a um deles. */
export async function eventosParaEscopo(
  tenantId: string,
): Promise<{ id: string; titulo: string }[]> {
  return serviceDb()
    .select({ id: events.id, titulo: events.titulo })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), isNull(events.canceladoEm)))
    .orderBy(asc(events.dataInicio));
}

/** Quantas sessões de portaria estão abertas agora, por evento. */
export async function sessoesDePortaria(
  tenantId: string,
): Promise<{ eventoId: string; total: number }[]> {
  const linhas = await serviceDb()
    .select({
      eventoId: sessions.scopeEventId,
      total: sql<number>`count(*)`,
    })
    .from(sessions)
    .innerJoin(events, eq(events.id, sessions.scopeEventId))
    .where(
      and(
        eq(events.tenantId, tenantId),
        isNull(sessions.revogadaEm),
        sql`${sessions.expiraEm} > now()`,
      ),
    )
    .groupBy(sessions.scopeEventId);

  return linhas
    .filter((l): l is { eventoId: string; total: number } => l.eventoId !== null)
    .map((l) => ({ eventoId: l.eventoId, total: Number(l.total) }));
}
