/**
 * Área administrativa da plataforma — plano, seção 13; ADR-025.
 *
 * Quem opera aqui é a equipe da YOUR TICKET LTDA, não um produtor. Por isso
 * a leitura é transversal (conexão de serviço, sem RLS de tenant) — e por
 * isso toda escrita grava no `audit_log` com o usuário que fez.
 */
import 'server-only';

import { notFound } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { auditLog, payouts, tenants } from '@/db/schema';
import { transicionarPayout, type PayoutStatus } from '@/domain/payout';
import type { AuthContext } from '@/lib/auth';
import { getAuth } from '@/lib/session-cookie';

/**
 * Exige administrador da plataforma. Para quem não é, a área não existe
 * (404), em vez de anunciar que há algo ali a que ele não tem acesso.
 */
export async function exigirAdmin(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth?.adminPlataforma) notFound();
  return auth;
}

type Linha = Record<string, unknown>;
async function linhas(q: ReturnType<typeof sql>): Promise<Linha[]> {
  return (await serviceDb().execute(q)) as unknown as Linha[];
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

export async function visaoGeral() {
  const [r] = await linhas(sql`
    select
      (select count(*) from tenants) as produtores,
      (select count(*) from tenants where kyc_status = 'aprovado') as aprovados,
      (select count(*) from tenants where kyc_status in ('pendente', 'em_analise')) as aguardando_kyc,
      (select count(*) from orders where status in ('paid','partially_refunded') and pago_em > now() - interval '24 hours') as pedidos_24h,
      (select coalesce(sum(total_centavos),0) from orders where status in ('paid','partially_refunded','refunded','chargeback') and canal = 'online' and pago_em > now() - interval '30 days') as gmv_30d,
      (select coalesce(sum(valor_operador_centavos),0) from orders where status in ('paid','partially_refunded') and canal = 'online' and pago_em > now() - interval '30 days') as receita_30d,
      (select count(*) from payouts where status = 'failed') as repasses_falha,
      (select count(*) from payouts where status = 'released' and liberado_centavos < 0) as descobertos,
      (select count(*) from solicitacoes where status = 'aberta') as solicitacoes_abertas,
      (select count(*) from solicitacoes where status = 'aberta' and criado_em < now() - interval '48 hours') as solicitacoes_atrasadas,
      (select count(*) from jobs where status in ('failed','dead')) as jobs_falha,
      (select count(*) from webhook_events where erro is not null and recebido_em > now() - interval '7 days') as webhooks_erro
  `);
  const chaves = [
    'produtores', 'aprovados', 'aguardando_kyc', 'pedidos_24h', 'gmv_30d', 'receita_30d',
    'repasses_falha', 'descobertos', 'solicitacoes_abertas', 'solicitacoes_atrasadas',
    'jobs_falha', 'webhooks_erro',
  ] as const;
  return Object.fromEntries(chaves.map((k) => [k, Number(r?.[k] ?? 0)])) as Record<
    (typeof chaves)[number],
    number
  >;
}

// ---------------------------------------------------------------------------
// Produtores
// ---------------------------------------------------------------------------

export async function listarProdutores(busca?: string) {
  const termo = busca?.trim() ? `%${busca.trim()}%` : null;
  return linhas(sql`
    select t.id, t.nome, t.slug, t.email, t.cnpj, t.kyc_status, t.criado_em,
           (select count(*) from events e where e.tenant_id = t.id) as eventos,
           (select coalesce(sum(o.total_centavos),0) from orders o
             where o.tenant_id = t.id and o.status in ('paid','partially_refunded')) as vendido
      from tenants t
     where ${termo}::text is null or t.nome ilike ${termo} or t.email ilike ${termo} or t.slug ilike ${termo}
     order by t.criado_em desc
     limit 200
  `);
}

export async function produtor(id: string) {
  const [t] = await serviceDb().select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!t) return null;
  const donos = await linhas(sql`
    select u.nome, u.email, m.role from memberships m join users u on u.id = m.user_id
     where m.tenant_id = ${id} order by m.role
  `);
  return { tenant: t, equipe: donos };
}

export type NovasTaxas = {
  taxaConvenienciaBps: number;
  comissaoBps: number;
  taxaFixaCentavos: number;
  taxaMinimaCentavos: number;
  taxaAbsorvidaPeloProdutor: boolean;
  reservaPixBps: number;
  reservaCartaoBps: number;
  diasLiberacaoEvento: number;
  diasLiberacaoReserva: number;
};

/**
 * Mudança de taxa — plano, seção 14: exige `audit_log`. Vale só para pedidos
 * novos: todo pedido já gravou o snapshot do que foi cobrado.
 */
export async function alterarTaxas(
  auth: AuthContext,
  tenantId: string,
  novas: NovasTaxas,
  justificativa: string,
): Promise<void> {
  const db = serviceDb();
  await db.transaction(async (tx) => {
    const [antes] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!antes) throw new Error('Produtor não encontrado.');
    await tx.update(tenants).set({ ...novas, atualizadoEm: new Date() }).where(eq(tenants.id, tenantId));
    await tx.insert(auditLog).values({
      tenantId,
      userId: auth.userId,
      acao: 'mudanca_taxa',
      entidade: 'tenants',
      entidadeId: tenantId,
      antes: Object.fromEntries(Object.keys(novas).map((k) => [k, (antes as Linha)[k]])),
      depois: { ...novas, justificativa },
    });
  });
}

export async function alterarKyc(
  auth: AuthContext,
  tenantId: string,
  kyc: 'pendente' | 'em_analise' | 'aprovado' | 'reprovado' | 'suspenso',
  justificativa: string,
): Promise<void> {
  const db = serviceDb();
  await db.transaction(async (tx) => {
    const [antes] = await tx
      .select({ kyc: tenants.kycStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!antes) throw new Error('Produtor não encontrado.');
    await tx.update(tenants).set({ kycStatus: kyc, atualizadoEm: new Date() }).where(eq(tenants.id, tenantId));
    await tx.insert(auditLog).values({
      tenantId,
      userId: auth.userId,
      acao: 'kyc_alterado_manual',
      entidade: 'tenants',
      entidadeId: tenantId,
      antes: { kycStatus: antes.kyc },
      depois: { kycStatus: kyc, justificativa },
    });
  });
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export async function buscarPedidos(busca?: string) {
  const t = busca?.trim() ?? '';
  const like = t.length >= 2 ? `%${t}%` : null;
  const digitos = t.replace(/\D/g, '');
  const numero = /^\d{1,9}$/.test(t) ? Number(t) : null;
  return linhas(sql`
    select o.id, o.numero, o.status, o.canal, o.total_centavos, o.comprador_nome, o.comprador_email,
           o.criado_em, t.nome as produtor, e.titulo as evento
      from orders o
      join tenants t on t.id = o.tenant_id
      join events e on e.id = o.event_id
     where ${like}::text is null
        or o.comprador_email ilike ${like}
        or o.comprador_nome ilike ${like}
        or (${digitos.length >= 6} and o.comprador_cpf like ${`%${digitos}%`})
        or o.numero = ${numero}
        or exists (select 1 from tickets k where k.order_id = o.id and k.codigo ilike ${like})
     order by o.criado_em desc
     limit 100
  `);
}

export async function pedidoAdmin(id: string) {
  const [o] = await linhas(sql`
    select o.*, t.nome as produtor, e.titulo as evento, e.data_inicio as evento_inicio
      from orders o join tenants t on t.id = o.tenant_id join events e on e.id = o.event_id
     where o.id = ${id}
  `);
  if (!o) return null;
  const [ingressos, devolucoes, solicitacoes] = await Promise.all([
    linhas(sql`select codigo, status, titular_nome from tickets where order_id = ${id} order by codigo`),
    linhas(sql`select tipo, valor_centavos, status, observacao, criado_em from refunds where order_id = ${id} order by criado_em`),
    linhas(sql`select tipo, relato, status, resposta, criado_em from solicitacoes where order_id = ${id} order by criado_em`),
  ]);
  return { pedido: o, ingressos, devolucoes, solicitacoes };
}

// ---------------------------------------------------------------------------
// Repasses
// ---------------------------------------------------------------------------

export async function listarRepasses(filtro: 'problemas' | 'agendados' | 'todos') {
  const condicao =
    filtro === 'problemas'
      ? sql`p.status in ('failed','processing') or (p.status = 'released' and p.liberado_centavos < 0)`
      : filtro === 'agendados'
        ? sql`p.status = 'scheduled'`
        : sql`true`;
  return linhas(sql`
    select p.id, p.tranche, p.metodo, p.status, p.data_prevista, p.data_efetiva, p.liberado_centavos,
           p.tentativas, p.ultimo_erro, t.nome as produtor, e.titulo as evento
      from payouts p join tenants t on t.id = p.tenant_id join events e on e.id = p.event_id
     where ${condicao}
     order by p.data_prevista desc
     limit 200
  `);
}

/**
 * Libera nova tentativa de um repasse que parou no teto (erro definitivo
 * corrigido, recebedor cadastrado). Mantém a chave de idempotência: se a PSP
 * chegou a liberar, a nova chamada devolve o mesmo resultado.
 */
export async function reabrirRepasse(auth: AuthContext, payoutId: string, motivo: string) {
  const db = serviceDb();
  const [p] = await db
    .select({ status: payouts.status, tenantId: payouts.tenantId, tentativas: payouts.tentativas })
    .from(payouts)
    .where(eq(payouts.id, payoutId))
    .limit(1);
  if (!p) throw new Error('Repasse não encontrado.');
  if (p.status !== 'failed') throw new Error('Só repasse com falha pode ser reaberto.');

  await db.update(payouts).set({ tentativas: 0, atualizadoEm: new Date() }).where(
    and(eq(payouts.id, payoutId), eq(payouts.status, 'failed')),
  );
  await db.insert(auditLog).values({
    tenantId: p.tenantId,
    userId: auth.userId,
    acao: 'repasse_reaberto',
    entidade: 'payouts',
    entidadeId: payoutId,
    antes: { tentativas: p.tentativas },
    depois: { tentativas: 0, motivo },
  });
}

export async function cancelarRepasse(auth: AuthContext, payoutId: string, motivo: string) {
  const db = serviceDb();
  const [p] = await db
    .select({ status: payouts.status, tenantId: payouts.tenantId })
    .from(payouts)
    .where(eq(payouts.id, payoutId))
    .limit(1);
  if (!p) throw new Error('Repasse não encontrado.');
  const t = transicionarPayout(p.status as PayoutStatus, 'canceled');
  if (!t.ok) throw new Error('Este repasse não pode ser cancelado no estado atual.');

  await db
    .update(payouts)
    .set({ status: 'canceled', atualizadoEm: new Date() })
    .where(and(eq(payouts.id, payoutId), eq(payouts.status, p.status)));
  await db.insert(auditLog).values({
    tenantId: p.tenantId,
    userId: auth.userId,
    acao: 'repasse_cancelado',
    entidade: 'payouts',
    entidadeId: payoutId,
    antes: { status: p.status },
    depois: { status: 'canceled', motivo },
  });
}

// ---------------------------------------------------------------------------
// Operação e auditoria
// ---------------------------------------------------------------------------

export async function operacao() {
  const [fila, falhas, webhooks] = await Promise.all([
    linhas(sql`select nome, status, count(*) as n from jobs group by nome, status order by nome, status`),
    linhas(sql`
      select id, nome, status, tentativas, ultimo_erro, proxima_tentativa_em as quando from jobs
       where status in ('failed','dead') order by proxima_tentativa_em desc limit 50
    `),
    linhas(sql`
      select provider, tipo, recebido_em, processado_em, erro, assinatura_valida from webhook_events
       order by recebido_em desc limit 50
    `),
  ]);
  return { fila, falhas, webhooks };
}

export async function auditoria(filtro: { acao?: string | undefined; tenantId?: string | undefined }) {
  return serviceDb()
    .select({
      id: auditLog.id,
      acao: auditLog.acao,
      entidade: auditLog.entidade,
      entidadeId: auditLog.entidadeId,
      depois: auditLog.depois,
      criadoEm: auditLog.criadoEm,
      produtor: tenants.nome,
      usuario: sql<string | null>`(select u.email from users u where u.id = ${auditLog.userId})`,
    })
    .from(auditLog)
    .leftJoin(tenants, eq(tenants.id, auditLog.tenantId))
    .where(
      and(
        filtro.acao ? eq(auditLog.acao, filtro.acao) : undefined,
        filtro.tenantId ? eq(auditLog.tenantId, filtro.tenantId) : undefined,
      ),
    )
    .orderBy(desc(auditLog.criadoEm))
    .limit(200);
}

export async function acoesAuditadas(): Promise<string[]> {
  const r = await linhas(sql`select distinct acao from audit_log order by acao`);
  return r.map((x) => x.acao as string);
}
