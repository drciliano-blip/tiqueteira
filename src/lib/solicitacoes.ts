/**
 * Solicitações do comprador — ADR-023.
 *
 * O comprador relata um problema com o evento pela área "Meus ingressos". A
 * decisão é do produtor: devolve (pelo reembolso por falha na prestação do
 * serviço, ADR-022) ou responde por escrito por que não devolve. Os dois
 * lados ficam registrados, e os dois são avisados por e-mail.
 *
 * O comprador não tem tenant: entra pela sessão do link mágico, que guarda
 * só o e-mail. Por isso a abertura usa a conexão de serviço e confere,
 * explicitamente, que o pedido é daquele e-mail.
 */
import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { serviceDb, withTenant } from '@/db/client';
import { auditLog, events, orders, solicitacoes } from '@/db/schema';
import { JUSTIFICATIVA_MINIMA, PROBLEMAS_NO_EVENTO, type ProblemaNoEvento } from '@/domain/refund-policy';
import { enfileirar } from '@/lib/jobs';

export const ROTULO_SOLICITACAO: Record<ProblemaNoEvento, string> = {
  evento_nao_realizado: 'O evento não aconteceu',
  servico_nao_prestado: 'Não consegui aproveitar o evento',
  servico_diferente_do_ofertado: 'O evento foi diferente do anunciado',
  reclamacao_procedente: 'Outro problema',
};

export type ResultadoSolicitacao = { ok: true; id: string } | { ok: false; erro: string };

/** O pedido é deste e-mail, e está pago. Devolve o que a tela precisa. */
export async function pedidoDoComprador(email: string, orderId: string) {
  const [p] = await serviceDb()
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      numero: orders.numero,
      status: orders.status,
      totalCentavos: orders.totalCentavos,
      compradorEmail: orders.compradorEmail,
      pagoEm: orders.pagoEm,
      eventoTitulo: events.titulo,
      eventoInicio: events.dataInicio,
      eventoStatus: events.status,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(and(eq(orders.id, orderId), sql`lower(${orders.compradorEmail}) = lower(${email})`))
    .limit(1);
  return p ?? null;
}

export async function solicitacoesDoPedido(orderId: string) {
  return serviceDb()
    .select({
      id: solicitacoes.id,
      tipo: solicitacoes.tipo,
      relato: solicitacoes.relato,
      status: solicitacoes.status,
      resposta: solicitacoes.resposta,
      criadoEm: solicitacoes.criadoEm,
      respondidoEm: solicitacoes.respondidoEm,
    })
    .from(solicitacoes)
    .where(eq(solicitacoes.orderId, orderId))
    .orderBy(desc(solicitacoes.criadoEm));
}

export async function abrirSolicitacao(input: {
  email: string;
  orderId: string;
  tipo: string;
  relato: string;
}): Promise<ResultadoSolicitacao> {
  if (!(PROBLEMAS_NO_EVENTO as readonly string[]).includes(input.tipo)) {
    return { ok: false, erro: 'Escolha o que aconteceu.' };
  }
  const relato = input.relato.trim();
  if (relato.length < JUSTIFICATIVA_MINIMA) {
    return {
      ok: false,
      erro: `Conte o que aconteceu (pelo menos ${JUSTIFICATIVA_MINIMA} caracteres).`,
    };
  }
  if (relato.length > 2000) return { ok: false, erro: 'O relato está longo demais.' };

  const pedido = await pedidoDoComprador(input.email, input.orderId);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  if (pedido.status !== 'paid' && pedido.status !== 'partially_refunded') {
    return { ok: false, erro: 'Este pedido não está ativo.' };
  }

  const db = serviceDb();
  const abertas = await db
    .select({ id: solicitacoes.id })
    .from(solicitacoes)
    .where(and(eq(solicitacoes.orderId, pedido.id), eq(solicitacoes.status, 'aberta')))
    .limit(1);
  if (abertas.length > 0) {
    return { ok: false, erro: 'Já existe uma solicitação aberta para este pedido.' };
  }

  const id = await db.transaction(async (tx) => {
    const [criada] = await tx
      .insert(solicitacoes)
      .values({
        tenantId: pedido.tenantId,
        orderId: pedido.id,
        tipo: input.tipo as ProblemaNoEvento,
        relato,
      })
      .returning({ id: solicitacoes.id });

    await tx.insert(auditLog).values({
      tenantId: pedido.tenantId,
      acao: 'solicitacao_aberta',
      entidade: 'orders',
      entidadeId: pedido.id,
      depois: { solicitacaoId: criada!.id, tipo: input.tipo, por: 'comprador' },
    });

    await enfileirar(tx, {
      nome: 'avisar-solicitacao',
      tenantId: pedido.tenantId,
      payload: { solicitacaoId: criada!.id, evento: 'aberta' },
      dedupeKey: `solicitacao-aberta:${criada!.id}`,
    });

    return criada!.id;
  });

  return { ok: true, id };
}

/** O produtor responde sem devolver. A resposta é obrigatória. */
export async function recusarSolicitacao(input: {
  tenantId: string;
  solicitacaoId: string;
  resposta: string;
  userId: string | null;
}): Promise<ResultadoSolicitacao> {
  const resposta = input.resposta.trim();
  if (resposta.length < JUSTIFICATIVA_MINIMA) {
    return {
      ok: false,
      erro: `Explique ao comprador por que não haverá devolução (pelo menos ${JUSTIFICATIVA_MINIMA} caracteres).`,
    };
  }

  const atualizada = await withTenant(input.tenantId, async (tx) =>
    tx
      .update(solicitacoes)
      .set({
        status: 'recusada',
        resposta,
        respondidoPor: input.userId,
        respondidoEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(and(eq(solicitacoes.id, input.solicitacaoId), eq(solicitacoes.status, 'aberta')))
      .returning({ id: solicitacoes.id, orderId: solicitacoes.orderId }),
  );

  const linha = atualizada[0];
  if (!linha) return { ok: false, erro: 'Esta solicitação já foi respondida.' };

  const db = serviceDb();
  await db.insert(auditLog).values({
    tenantId: input.tenantId,
    userId: input.userId,
    acao: 'solicitacao_recusada',
    entidade: 'orders',
    entidadeId: linha.orderId,
    depois: { solicitacaoId: linha.id, resposta },
  });
  await enfileirar(db, {
    nome: 'avisar-solicitacao',
    tenantId: input.tenantId,
    payload: { solicitacaoId: linha.id, evento: 'respondida' },
    dedupeKey: `solicitacao-respondida:${linha.id}`,
  });

  return { ok: true, id: linha.id };
}

/**
 * Fecha a solicitação aberta do pedido como devolvida, depois que o produtor
 * fez o reembolso por problema no evento. Sem solicitação aberta, não faz nada.
 */
export async function marcarSolicitacaoDevolvida(input: {
  tenantId: string;
  orderId: string;
  refundId: string;
  userId: string | null;
  resposta: string;
}): Promise<void> {
  const atualizadas = await withTenant(input.tenantId, async (tx) =>
    tx
      .update(solicitacoes)
      .set({
        status: 'devolvida',
        refundId: input.refundId,
        resposta: input.resposta,
        respondidoPor: input.userId,
        respondidoEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(and(eq(solicitacoes.orderId, input.orderId), eq(solicitacoes.status, 'aberta')))
      .returning({ id: solicitacoes.id }),
  );

  for (const s of atualizadas) {
    await enfileirar(serviceDb(), {
      nome: 'avisar-solicitacao',
      tenantId: input.tenantId,
      payload: { solicitacaoId: s.id, evento: 'respondida' },
      dedupeKey: `solicitacao-respondida:${s.id}`,
    });
  }
}

export type LinhaSolicitacao = {
  id: string;
  orderId: string;
  pedidoNumero: number;
  comprador: string | null;
  eventoTitulo: string;
  tipo: ProblemaNoEvento;
  relato: string;
  status: 'aberta' | 'devolvida' | 'recusada';
  resposta: string | null;
  criadoEm: Date;
};

/** Caixa de entrada do produtor. Abertas primeiro. */
export async function solicitacoesDoProdutor(tenantId: string): Promise<LinhaSolicitacao[]> {
  return withTenant(tenantId, async (tx) =>
    tx
      .select({
        id: solicitacoes.id,
        orderId: solicitacoes.orderId,
        pedidoNumero: orders.numero,
        comprador: orders.compradorNome,
        eventoTitulo: events.titulo,
        tipo: solicitacoes.tipo,
        relato: solicitacoes.relato,
        status: solicitacoes.status,
        resposta: solicitacoes.resposta,
        criadoEm: solicitacoes.criadoEm,
      })
      .from(solicitacoes)
      .innerJoin(orders, eq(orders.id, solicitacoes.orderId))
      .innerJoin(events, eq(events.id, orders.eventId))
      .orderBy(sql`${solicitacoes.status} = 'aberta' desc`, desc(solicitacoes.criadoEm))
      .limit(200),
  );
}

export async function contarSolicitacoesAbertas(tenantId: string): Promise<number> {
  const [r] = await withTenant(tenantId, async (tx) =>
    tx
      .select({ n: sql<number>`count(*)` })
      .from(solicitacoes)
      .where(eq(solicitacoes.status, 'aberta')),
  );
  return Number(r?.n ?? 0);
}

export async function solicitacaoAbertaDoPedido(tenantId: string, orderId: string) {
  const [r] = await withTenant(tenantId, async (tx) =>
    tx
      .select({
        id: solicitacoes.id,
        tipo: solicitacoes.tipo,
        relato: solicitacoes.relato,
        criadoEm: solicitacoes.criadoEm,
      })
      .from(solicitacoes)
      .where(and(eq(solicitacoes.orderId, orderId), eq(solicitacoes.status, 'aberta')))
      .limit(1),
  );
  return r ?? null;
}
