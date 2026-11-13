/**
 * Motor de repasse — plano, seções 3.4, 12 e prompt 15. ADR-021.
 *
 * Duas varreduras, chamadas pelo job `repasses`:
 *
 *   agendarRepassesPendentes  → evento terminou e ainda não tem repasse:
 *                               cria, por meio de pagamento, a tranche
 *                               principal (D+N dias úteis) e a reserva
 *                               (D+N dias corridos).
 *   executarRepassesVencidos  → tranche com data vencida: recalcula com os
 *                               estornos do momento e manda a PSP liberar.
 *
 * O motor NUNCA movimenta dinheiro. O saldo do produtor já está na PSP,
 * retido desde a venda (split com `holdUntil`). O que sai daqui é um comando
 * de liberação, com chave de idempotência estável por tranche.
 *
 * Por que recalcular na data, e não no agendamento: entre o fim do evento e a
 * liberação ainda chegam reembolsos e chargebacks. O número gravado no
 * agendamento é estimativa; o que vale é o da execução.
 *
 * Por que NÃO recalcular numa nova tentativa: a PSP memoriza o resultado pela
 * chave de idempotência. Se a primeira chamada chegou a liberar R$ 800 e a
 * resposta se perdeu, uma segunda chamada com R$ 750 e a mesma chave devolve
 * os R$ 800 — e o banco gravaria um valor que não aconteceu. Depois da
 * primeira tentativa, o valor fica congelado.
 */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { serviceDb, type Database } from '@/db/client';
import { auditLog, payouts, tenants } from '@/db/schema';
import {
  calcularPrincipal,
  calcularReserva,
  chaveDoRepasse,
  datasDoRepasse,
  somarPedidos,
  statusDeOrigemPara,
  transicionarPayout,
  type PayoutStatus,
  type PedidoParaRepasse,
} from '@/domain/payout';
import { getPaymentProvider } from '@/lib/payments/provider';
import { PaymentProviderError, type PaymentProvider } from '@/lib/payments/types';

type Metodo = 'pix' | 'credit_card';
type Tranche = 'principal' | 'reserva';

/** Teto de chamadas à PSP por tranche antes de exigir intervenção humana. */
export const MAX_TENTATIVAS_REPASSE = 5;

/**
 * Um repasse em `processing` há mais que isto é de um processo que morreu no
 * meio. É retomado com a mesma chave — a PSP devolve o resultado da chamada
 * original, se ela chegou a acontecer.
 */
const PROCESSAMENTO_ABANDONADO_MIN = 10;

export type OpcoesRepasse = {
  db?: Database;
  provider?: PaymentProvider;
  agora?: Date;
  /** Restringe a varredura a um evento. Sem isto, varre todos. */
  eventId?: string;
};

type Linha = Record<string, unknown>;

async function linhas(db: Database, q: ReturnType<typeof sql>): Promise<Linha[]> {
  return (await db.execute(q)) as unknown as Linha[];
}

// ---------------------------------------------------------------------------
// Leitura dos pedidos
// ---------------------------------------------------------------------------

/**
 * Pedidos que entram no repasse de um evento, num meio de pagamento.
 *
 * Só venda ONLINE com transação na PSP. Bilheteria de balcão não entra: o
 * dinheiro dela está com a casa e nunca passou pelo split.
 *
 * Pedido `refunded` conta como devolvido por inteiro mesmo sem linha em
 * `refunds` — o estorno pode ter sido feito direto no painel da PSP e chegado
 * só por webhook. Errar para menos é corrigível na reserva; errar para mais
 * é dinheiro que já saiu.
 */
export async function pedidosDoRepasse(
  db: Database,
  eventId: string,
  metodo: Metodo,
): Promise<PedidoParaRepasse[]> {
  const rs = await linhas(
    db,
    sql`
      select o.total_centavos, o.valor_produtor_centavos, o.valor_operador_centavos,
             o.status,
             coalesce((select sum(r.valor_centavos) from refunds r
                        where r.order_id = o.id and r.status = 'succeeded'), 0) as reembolsado
        from orders o
       where o.event_id = ${eventId}
         and o.metodo = ${metodo}
         and o.canal = 'online'
         and o.provider_transaction_id is not null
         and o.status in ('paid', 'partially_refunded', 'refunded', 'chargeback')
    `,
  );

  return rs.map((r) => {
    const total = Number(r.total_centavos);
    const reembolsado = r.status === 'refunded' ? total : Math.min(Number(r.reembolsado), total);
    return {
      totalCentavos: total,
      valorProdutorCentavos: Number(r.valor_produtor_centavos),
      valorOperadorCentavos: Number(r.valor_operador_centavos),
      reembolsadoCentavos: reembolsado,
      chargeback: r.status === 'chargeback',
    };
  });
}

// ---------------------------------------------------------------------------
// Agendamento
// ---------------------------------------------------------------------------

/**
 * Cria as tranches dos eventos que já terminaram e ainda não têm repasse.
 *
 * Idempotente: a unique (event_id, tranche, metodo) e a chave estável fazem
 * uma segunda passagem não criar nada. Evento cancelado não entra — o
 * dinheiro dele volta para os compradores, não para o produtor.
 */
export async function agendarRepassesPendentes(
  opcoes: OpcoesRepasse = {},
): Promise<{ eventos: number; tranches: number }> {
  const db = opcoes.db ?? serviceDb();
  const agora = opcoes.agora ?? new Date();

  const candidatos = await linhas(
    db,
    sql`
      select e.id as event_id, e.tenant_id, e.data_fim,
             t.dias_liberacao_evento, t.dias_liberacao_reserva,
             array_agg(distinct o.metodo) as metodos
        from events e
        join tenants t on t.id = e.tenant_id
        join orders o on o.event_id = e.id
       where e.data_fim <= ${agora.toISOString()}::timestamptz
         and e.status in ('publicado', 'esgotado', 'encerrado')
         and o.canal = 'online'
         and o.provider_transaction_id is not null
         and o.metodo is not null
         and o.status in ('paid', 'partially_refunded', 'refunded', 'chargeback')
         and not exists (select 1 from payouts p where p.event_id = e.id)
         and (${opcoes.eventId ?? null}::uuid is null or e.id = ${opcoes.eventId ?? null}::uuid)
       group by e.id, e.tenant_id, e.data_fim, t.dias_liberacao_evento, t.dias_liberacao_reserva
       limit 50
    `,
  );

  let tranches = 0;

  for (const c of candidatos) {
    const eventId = c.event_id as string;
    const tenantId = c.tenant_id as string;
    const datas = datasDoRepasse(new Date(c.data_fim as string), {
      diasLiberacaoEvento: Number(c.dias_liberacao_evento),
      diasLiberacaoReserva: Number(c.dias_liberacao_reserva),
    });
    const metodos = parseArray(c.metodos) as Metodo[];

    for (const metodo of metodos) {
      // Estimativa para o painel. O valor definitivo sai na execução.
      const totais = somarPedidos(await pedidosDoRepasse(db, eventId, metodo));

      for (const [tranche, data] of [
        ['principal', datas.principal],
        ['reserva', datas.reserva],
      ] as const) {
        const criados = await db
          .insert(payouts)
          .values({
            tenantId,
            eventId,
            tranche,
            metodo,
            brutoCentavos: totais.brutoCentavos,
            comissaoCentavos: totais.comissaoCentavos,
            reembolsosCentavos: totais.reembolsosCentavos,
            chargebacksCentavos: totais.chargebacksCentavos,
            status: 'scheduled',
            dataPrevista: data,
            idempotencyKey: chaveDoRepasse(eventId, tranche, metodo),
          })
          .onConflictDoNothing()
          .returning({ id: payouts.id });
        tranches += criados.length;
      }
    }
  }

  return { eventos: candidatos.length, tranches };
}

/** postgres.js devolve array de enum como texto `{pix,credit_card}`. */
function parseArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string')
    return v
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter(Boolean);
  return [];
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export type ResultadoRepasse = {
  payoutId: string;
  status: PayoutStatus;
  liberadoCentavos: number;
  detalhe: string;
};

/**
 * Executa as tranches vencidas.
 *
 * A reserva só sai depois que a principal do mesmo evento e meio saiu (ou foi
 * cancelada): ela é calculada como "o que sobrou" da principal.
 */
export async function executarRepassesVencidos(
  opcoes: OpcoesRepasse = {},
): Promise<ResultadoRepasse[]> {
  const db = opcoes.db ?? serviceDb();
  const agora = opcoes.agora ?? new Date();
  const origens = statusDeOrigemPara('processing');
  const resultados: ResultadoRepasse[] = [];

  // Principal antes da reserva, em duas leituras: assim a reserva vencida
  // sai na mesma passagem em que a principal dela foi liberada.
  for (const tranche of ['principal', 'reserva'] as const) {
    const vencidos = await linhas(
      db,
      sql`
      select p.id
        from payouts p
       where p.tranche = ${tranche}
         and p.data_prevista <= ${agora.toISOString()}::timestamptz
         and (
               (p.status in ${origens} and p.tentativas < ${MAX_TENTATIVAS_REPASSE})
            or (p.status = 'processing'
                and p.atualizado_em < ${agora.toISOString()}::timestamptz
                                      - make_interval(mins => ${PROCESSAMENTO_ABANDONADO_MIN}))
         )
         and (p.tranche = 'principal' or exists (
               select 1 from payouts pp
                where pp.event_id = p.event_id and pp.metodo = p.metodo
                  and pp.tranche = 'principal' and pp.status in ('released', 'canceled')))
         and (${opcoes.eventId ?? null}::uuid is null or p.event_id = ${opcoes.eventId ?? null}::uuid)
       order by p.data_prevista
       limit 50
    `,
    );

    for (const v of vencidos) {
      const r = await executarRepasse(v.id as string, { ...opcoes, db, agora });
      if (r) resultados.push(r);
    }
  }
  return resultados;
}

/**
 * Executa UMA tranche. Devolve `null` se outro processo pegou antes.
 *
 * O `UPDATE ... WHERE status in (...)` é o cadeado: dois workers rodando ao
 * mesmo tempo nunca processam o mesmo repasse, porque só um deles vê a linha
 * mudar.
 */
export async function executarRepasse(
  payoutId: string,
  opcoes: OpcoesRepasse = {},
): Promise<ResultadoRepasse | null> {
  const db = opcoes.db ?? serviceDb();
  const provider = opcoes.provider ?? getPaymentProvider();
  const agora = opcoes.agora ?? new Date();
  const origens = statusDeOrigemPara('processing');

  // Lê o estado anterior para saber se é a primeira tentativa.
  const [antes] = await db
    .select({ tentativas: payouts.tentativas, status: payouts.status })
    .from(payouts)
    .where(eq(payouts.id, payoutId))
    .limit(1);
  if (!antes) return null;

  const [repasse] = await linhas(
    db,
    sql`
      update payouts
         set status = 'processing',
             tentativas = tentativas + 1,
             atualizado_em = ${agora.toISOString()}::timestamptz
       where id = ${payoutId}
         and tentativas = ${antes.tentativas}
         and (
               (status in ${origens} and tentativas < ${MAX_TENTATIVAS_REPASSE})
            or (status = 'processing'
                and atualizado_em < ${agora.toISOString()}::timestamptz
                                    - make_interval(mins => ${PROCESSAMENTO_ABANDONADO_MIN}))
         )
      returning id, tenant_id, event_id, tranche, metodo, liberado_centavos,
                idempotency_key, tentativas
    `,
  );
  if (!repasse) return null;

  const tenantId = repasse.tenant_id as string;
  const eventId = repasse.event_id as string;
  const tranche = repasse.tranche as Tranche;
  const metodo = repasse.metodo as Metodo;
  const primeiraTentativa = antes.tentativas === 0;

  let liberado: number;

  if (primeiraTentativa) {
    const [tenant] = await db
      .select({
        reservaPixBps: tenants.reservaPixBps,
        reservaCartaoBps: tenants.reservaCartaoBps,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new Error(`tenant ${tenantId} não existe`);

    const totais = somarPedidos(await pedidosDoRepasse(db, eventId, metodo));

    let calculo;
    if (tranche === 'principal') {
      const reservaBps = metodo === 'pix' ? tenant.reservaPixBps : tenant.reservaCartaoBps;
      calculo = calcularPrincipal(totais, reservaBps);
    } else {
      const [principal] = await db
        .select({ liberado: payouts.liberadoCentavos, status: payouts.status })
        .from(payouts)
        .where(
          and(
            eq(payouts.eventId, eventId),
            eq(payouts.metodo, metodo),
            eq(payouts.tranche, 'principal'),
          ),
        )
        .limit(1);
      const jaLiberado = principal?.status === 'released' ? principal.liberado : 0;
      calculo = calcularReserva(totais, jaLiberado);
    }

    liberado = calculo.liberadoCentavos;

    await db
      .update(payouts)
      .set({
        brutoCentavos: totais.brutoCentavos,
        comissaoCentavos: totais.comissaoCentavos,
        reembolsosCentavos: totais.reembolsosCentavos,
        chargebacksCentavos: totais.chargebacksCentavos,
        retidoCentavos: calculo.retidoCentavos,
        liberadoCentavos: liberado,
      })
      .where(eq(payouts.id, payoutId));
  } else {
    liberado = Number(repasse.liberado_centavos);
  }

  // Nada a liberar. A tranche se encerra sem chamar a PSP.
  if (liberado <= 0) {
    await concluir(db, payoutId, 'released', { dataEfetiva: agora });

    if (liberado < 0) {
      /**
       * Saldo a descoberto — caso de borda 5. O produtor deve à PSP mais do
       * que ela ainda segura. Ninguém resolve isso automaticamente; precisa
       * aparecer para quem cobra.
       */
      console.error(`[repasse] saldo a descoberto: evento ${eventId}, ${metodo}, ${liberado}`);
      await db.insert(auditLog).values({
        tenantId,
        acao: 'repasse_a_descoberto',
        entidade: 'payouts',
        entidadeId: payoutId,
        depois: { eventId, tranche, metodo, saldoCentavos: liberado },
      });
    }

    return {
      payoutId,
      status: 'released',
      liberadoCentavos: liberado,
      detalhe: liberado < 0 ? 'saldo a descoberto' : 'nada a liberar',
    };
  }

  const [recebedor] = await db
    .select({ id: tenants.providerRecipientId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!recebedor?.id) {
    const erro = 'Produtor sem recebedor na PSP';
    await concluir(db, payoutId, 'failed', { erro, definitivo: true });
    return {
      payoutId,
      status: 'failed',
      liberadoCentavos: liberado,
      detalhe: erro,
    };
  }

  try {
    const resultado = await provider.releaseFunds({
      idempotencyKey: repasse.idempotency_key as string,
      providerRecipientId: recebedor.id,
      amount: liberado,
      description: `Repasse ${tranche} ${metodo} evento ${eventId}`,
    });

    if (resultado.status === 'failed') {
      const erro = 'PSP recusou a liberação';
      await concluir(db, payoutId, 'failed', {
        erro,
        providerPayoutId: resultado.providerPayoutId,
      });
      return {
        payoutId,
        status: 'failed',
        liberadoCentavos: liberado,
        detalhe: erro,
      };
    }

    await concluir(db, payoutId, 'released', {
      dataEfetiva: agora,
      providerPayoutId: resultado.providerPayoutId,
    });

    /** Plano, seção 14: liberação de repasse exige trilha no audit_log. */
    await db.insert(auditLog).values({
      tenantId,
      acao: 'liberacao_repasse',
      entidade: 'payouts',
      entidadeId: payoutId,
      depois: {
        eventId,
        tranche,
        metodo,
        liberadoCentavos: liberado,
        providerPayoutId: resultado.providerPayoutId,
      },
    });

    return {
      payoutId,
      status: 'released',
      liberadoCentavos: liberado,
      detalhe: 'liberado',
    };
  } catch (e) {
    const definitivo = e instanceof PaymentProviderError && !e.retryable;
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`[repasse] falha ao liberar ${payoutId}: ${erro}`);
    await concluir(db, payoutId, 'failed', { erro, definitivo });
    return {
      payoutId,
      status: 'failed',
      liberadoCentavos: liberado,
      detalhe: erro,
    };
  }
}

/** Fecha o processamento. Toda saída de `processing` passa por aqui. */
async function concluir(
  db: Database,
  payoutId: string,
  para: 'released' | 'failed',
  extra: {
    dataEfetiva?: Date;
    providerPayoutId?: string;
    erro?: string;
    /** Erro que não muda com nova tentativa: leva ao teto e para. */
    definitivo?: boolean;
  },
): Promise<void> {
  const transicao = transicionarPayout('processing', para);
  if (!transicao.ok) throw new Error(`transição inválida de repasse: processing → ${para}`);

  await db
    .update(payouts)
    .set({
      status: para,
      atualizadoEm: new Date(),
      ...(extra.dataEfetiva ? { dataEfetiva: extra.dataEfetiva } : {}),
      ...(extra.providerPayoutId ? { providerPayoutId: extra.providerPayoutId } : {}),
      ultimoErro: extra.erro ?? null,
      ...(extra.definitivo ? { tentativas: MAX_TENTATIVAS_REPASSE } : {}),
    })
    .where(and(eq(payouts.id, payoutId), eq(payouts.status, 'processing')));
}
