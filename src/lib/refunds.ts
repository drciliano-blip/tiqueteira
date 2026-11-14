/**
 * Execução de reembolso — plano, seções 8 e 12.
 *
 * A regra de "pode ou não pode" vive em `src/domain/refund-policy.ts`, pura e
 * testável. Aqui é o que toca o mundo: chama a PSP, grava, cancela ingresso e
 * registra na trilha de auditoria.
 *
 * Três coisas não podem falhar aqui:
 *
 * - **Idempotência.** Reembolso duplicado devolve dinheiro duas vezes e não
 *   tem como desfazer. A chave é gravada antes da chamada à PSP.
 * - **Ordem.** Grava a intenção, chama a PSP, depois confirma. Se o processo
 *   morrer no meio, sobra um registro `processing` que alguém revisa — melhor
 *   que dinheiro devolvido sem rastro.
 * - **Auditoria.** Quem autorizou, quando e por quê. Sem isso, reembolso vira
 *   porta de fraude interna.
 */
import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { auditLog, events, orders, refunds, tickets } from '@/db/schema';
import {
  avaliarReembolso,
  reembolsoManual,
  reembolsoPorProblema,
  type Decisao,
  type PedidoPorProblema,
  type TipoReembolso,
} from '@/domain/refund-policy';
import { getPaymentProvider } from '@/lib/payments/provider';

export type PedidoDeReembolso = {
  tenantId: string;
  orderId: string;
  /** Quantos ingressos devolver. Igual ao total do pedido = reembolso total. */
  quantidade: number;
  motivo: 'buyer_request' | 'event_canceled' | 'event_postponed' | 'duplicate' | 'fraud' | 'other';
  /** Ignora prazos. Só para produtor ou suporte, e sempre auditado. */
  manual?: boolean;
  solicitadoPor?: string | null;
  observacao?: string | undefined;
  /**
   * Falha na prestação do serviço (ADR-022). Ignora prazos e a política do
   * evento; exige justificativa. Só dono ou administrador.
   */
  problema?: PedidoPorProblema;
};

export type ResultadoReembolso =
  | { ok: true; refundId: string; valorCentavos: number; tipo: TipoReembolso }
  | { ok: false; erro: string };

export async function executarReembolso(
  pedido: PedidoDeReembolso,
): Promise<ResultadoReembolso> {
  const db = serviceDb();

  const carregado = await carregarPedido(db, pedido.orderId, pedido.quantidade);
  if (!carregado.ok) return { ok: false, erro: carregado.erro };
  const { dados, validos, jaReembolsado, contexto } = carregado;
  if (dados.tenantId !== pedido.tenantId) return { ok: false, erro: 'Pedido não encontrado.' };

  const decisao: Decisao = pedido.problema
    ? reembolsoPorProblema(contexto, pedido.problema)
    : pedido.manual
      ? reembolsoManual(contexto)
      : avaliarReembolso(contexto);

  /**
   * Abatimento mantém o ingresso: o serviço foi prestado, só que pior do que
   * o anunciado. Em todos os outros casos, o ingresso devolvido deixa de
   * valer na porta.
   */
  const cancelaIngressos = pedido.problema?.modalidade !== 'abatimento';

  if (!decisao.permitido) return { ok: false, erro: decisao.explicacao };

  /**
   * Venda de bilheteria não passou pela PSP: o dinheiro está com a casa, em
   * espécie ou na maquininha dela. Registrar aqui e devolver na mão é o único
   * caminho honesto — pedir estorno à PSP de algo que ela não recebeu falha.
   */
  const semTransacao = !dados.providerTransactionId || dados.canal !== 'online';

  const idempotencyKey = `rf:${pedido.orderId}:${jaReembolsado}:${decisao.valorCentavos}`;

  const [registro] = await db
    .insert(refunds)
    .values({
      tenantId: pedido.tenantId,
      orderId: pedido.orderId,
      motivo: pedido.motivo,
      tipo: decisao.tipo,
      incluiConveniencia: decisao.incluiConveniencia,
      observacao: pedido.problema?.justificativa ?? pedido.observacao ?? decisao.explicacao,
      valorCentavos: decisao.valorCentavos,
      status: 'processing',
      idempotencyKey,
      solicitadoPor: pedido.solicitadoPor ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: refunds.id });

  if (!registro) {
    // A chave já existia: este mesmo reembolso já foi pedido.
    return { ok: false, erro: 'Este reembolso já foi solicitado.' };
  }

  if (!semTransacao) {
    try {
      const resultado = await getPaymentProvider().refund({
        idempotencyKey,
        providerTransactionId: dados.providerTransactionId!,
        amount: decisao.valorCentavos,
        reason: pedido.motivo,
      });

      await db
        .update(refunds)
        .set({
          providerRefundId: resultado.providerRefundId,
          status: resultado.status === 'succeeded' ? 'succeeded' : 'processing',
          concluidoEm: resultado.status === 'succeeded' ? new Date() : null,
        })
        .where(eq(refunds.id, registro.id));

      if (resultado.status === 'failed') {
        await db
          .update(refunds)
          .set({ status: 'failed', ultimoErro: 'PSP recusou o estorno' })
          .where(eq(refunds.id, registro.id));
        return { ok: false, erro: 'A operadora recusou o estorno. Tente de novo.' };
      }
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await db
        .update(refunds)
        .set({ status: 'failed', ultimoErro: erro.slice(0, 2000) })
        .where(eq(refunds.id, registro.id));
      return { ok: false, erro: 'Não foi possível falar com a operadora. Tente de novo.' };
    }
  } else {
    await db
      .update(refunds)
      .set({
        status: 'succeeded',
        concluidoEm: new Date(),
        observacao: `${pedido.problema?.justificativa ?? decisao.explicacao} Devolução fora da plataforma (venda de bilheteria).`,
      })
      .where(eq(refunds.id, registro.id));
  }

  // Cancela os ingressos devolvidos e atualiza o pedido, numa transação.
  await db.transaction(async (tx) => {
    const paraCancelar = cancelaIngressos
      ? validos.slice(0, pedido.quantidade).map((t) => t.id)
      : [];

    if (paraCancelar.length > 0) {
      await tx
        .update(tickets)
        .set({
          status: 'cancelado',
          canceladoEm: new Date(),
          canceladoMotivo: 'reembolso',
          atualizadoEm: new Date(),
        })
        .where(inArray(tickets.id, paraCancelar));
    }

    const totalDevolvido = jaReembolsado + decisao.valorCentavos;
    const novoStatus = totalDevolvido >= dados.totalCentavos ? 'refunded' : 'partially_refunded';

    await tx
      .update(orders)
      .set({ status: novoStatus, atualizadoEm: new Date() })
      .where(eq(orders.id, pedido.orderId));

    /**
     * Trilha obrigatória. Reembolso sem registro de quem autorizou é a porta
     * de entrada da fraude interna — e é o primeiro item que uma auditoria
     * pede.
     */
    await tx.insert(auditLog).values({
      tenantId: pedido.tenantId,
      userId: pedido.solicitadoPor ?? null,
      acao: 'reembolso',
      entidade: 'orders',
      entidadeId: pedido.orderId,
      depois: {
        valorCentavos: decisao.valorCentavos,
        tipo: decisao.tipo,
        motivo: pedido.motivo,
        manual: Boolean(pedido.manual),
        ingressos: paraCancelar.length,
        ...(pedido.problema
          ? {
              problema: pedido.problema.problema,
              modalidade: pedido.problema.modalidade,
              justificativa: pedido.problema.justificativa,
            }
          : {}),
      },
    });
  });

  return {
    ok: true,
    refundId: registro.id,
    valorCentavos: decisao.valorCentavos,
    tipo: decisao.tipo,
  };
}

/**
 * Lê o pedido e monta o contexto da decisão. Compartilhado entre a execução
 * e a simulação que o comprador vê antes de confirmar.
 */
async function carregarPedido(db: ReturnType<typeof serviceDb>, orderId: string, quantidade: number) {
  const [dados] = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      status: orders.status,
      totalCentavos: orders.totalCentavos,
      subtotalCentavos: orders.subtotalCentavos,
      convenienciaCentavos: orders.convenienciaCentavos,
      criadoEm: orders.criadoEm,
      providerTransactionId: orders.providerTransactionId,
      canal: orders.canal,
      eventoInicio: events.dataInicio,
      eventoStatus: events.status,
      cancelamentoAteDiasCompra: events.cancelamentoAteDiasCompra,
      cancelamentoAteHorasEvento: events.cancelamentoAteHorasEvento,
      permiteReembolsoParcial: events.permiteReembolsoParcial,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!dados) return { ok: false as const, erro: 'Pedido não encontrado.' };
  if (dados.status !== 'paid' && dados.status !== 'partially_refunded') {
    return { ok: false as const, erro: 'Só pedido pago pode ser reembolsado.' };
  }

  const ingressos = await db
    .select({ id: tickets.id, status: tickets.status })
    .from(tickets)
    .where(eq(tickets.orderId, orderId));

  const validos = ingressos.filter((t) => t.status === 'valido');

  const [somaAnterior] = await db
    .select({ total: sql<number>`coalesce(sum(${refunds.valorCentavos}), 0)` })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), eq(refunds.status, 'succeeded')));

  const jaReembolsado = Number(somaAnterior?.total ?? 0);

  const contexto = {
    compradoEm: dados.criadoEm,
    eventoInicio: dados.eventoInicio,
    agora: new Date(),
    cancelamentoAteDiasCompra: dados.cancelamentoAteDiasCompra,
    cancelamentoAteHorasEvento: dados.cancelamentoAteHorasEvento,
    permiteReembolsoParcial: dados.permiteReembolsoParcial,
    eventoCancelado: dados.eventoStatus === 'cancelado',
    subtotalCentavos: dados.subtotalCentavos,
    convenienciaCentavos: dados.convenienciaCentavos,
    totalCentavos: dados.totalCentavos,
    ingressosNoPedido: ingressos.length,
    ingressosParaReembolsar: quantidade,
    jaReembolsadoCentavos: jaReembolsado,
  };

  return { ok: true as const, dados, ingressos, validos, jaReembolsado, contexto };
}

/**
 * O que aconteceria se o comprador pedisse o cancelamento agora — sem
 * executar nada. A tela mostra o valor e o prazo antes do botão.
 */
export async function simularReembolso(orderId: string, quantidade: number): Promise<Decisao> {
  const r = await carregarPedido(serviceDb(), orderId, quantidade);
  if (!r.ok) return { permitido: false, explicacao: r.erro };
  return avaliarReembolso(r.contexto);
}
