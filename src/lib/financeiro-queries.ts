/**
 * Financeiro do produtor — repasses por evento. ADR-021.
 *
 * Responde à pergunta que todo produtor faz no dia seguinte ao evento:
 * "quanto vou receber, e quando?". Por isso mostra também o que AINDA não
 * virou repasse: evento que não terminou, ou que terminou e o job não passou.
 *
 * A estimativa usa a mesma conta do motor (`somarPedidos`). O número que vale
 * é o gravado na tranche quando ela é executada — e a tela diz isso.
 *
 * Tudo por `withTenant`: o produtor só enxerga o próprio dinheiro, garantido
 * pela RLS, não por um `where` que alguém pode esquecer.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import {
  calcularPrincipal,
  datasDoRepasse,
  somarPedidos,
  type PedidoParaRepasse,
  type TotaisRepasse,
} from '@/domain/payout';
import { linhaParaPedido } from '@/lib/payouts';

type Metodo = 'pix' | 'credit_card';

export type TrancheNaTela = {
  tranche: 'principal' | 'reserva';
  metodo: Metodo;
  status: string;
  dataPrevista: Date;
  dataEfetiva: Date | null;
  /** Gravado na execução. Antes dela, é estimativa. */
  liberadoCentavos: number | null;
  estimadoCentavos: number;
  ultimoErro: string | null;
};

export type EventoFinanceiro = {
  eventId: string;
  titulo: string;
  dataFim: Date;
  /** O evento já terminou. */
  terminou: boolean;
  cancelado: boolean;
  totais: TotaisRepasse;
  tranches: TrancheNaTela[];
  /** Ainda sem tranche gravada: datas e valores calculados aqui. */
  previsto: boolean;
};

export type ResumoFinanceiro = {
  liberadoCentavos: number;
  aLiberarCentavos: number;
  descobertoCentavos: number;
  eventos: EventoFinanceiro[];
};

type Linha = Record<string, unknown>;

export async function financeiroDoProdutor(tenantId: string): Promise<ResumoFinanceiro> {
  return withTenant(tenantId, async (tx) => {
    const [config] = (await tx.execute(sql`
      select reserva_pix_bps, reserva_cartao_bps, dias_liberacao_evento, dias_liberacao_reserva
        from tenants where id = ${tenantId}
    `)) as unknown as Linha[];

    const eventos = (await tx.execute(sql`
      select e.id, e.titulo, e.data_fim, e.status
        from events e
       where e.tenant_id = ${tenantId}
         and exists (
           select 1 from orders o
            where o.event_id = e.id and o.canal = 'online'
              and o.provider_transaction_id is not null
              and o.status in ('paid', 'partially_refunded', 'refunded', 'chargeback'))
       order by e.data_fim desc
       limit 60
    `)) as unknown as Linha[];

    if (eventos.length === 0 || !config) {
      return { liberadoCentavos: 0, aLiberarCentavos: 0, descobertoCentavos: 0, eventos: [] };
    }

    const ids = eventos.map((e) => e.id as string);

    const pedidos = (await tx.execute(sql`
      select o.event_id, o.metodo, o.total_centavos, o.valor_produtor_centavos,
             o.valor_operador_centavos, o.status,
             coalesce((select sum(r.valor_centavos) from refunds r
                        where r.order_id = o.id and r.status = 'succeeded'), 0) as reembolsado
        from orders o
       where o.event_id in ${ids}
         and o.canal = 'online'
         and o.provider_transaction_id is not null
         and o.metodo is not null
         and o.status in ('paid', 'partially_refunded', 'refunded', 'chargeback')
    `)) as unknown as Linha[];

    const tranches = (await tx.execute(sql`
      select event_id, tranche, metodo, status, data_prevista, data_efetiva,
             liberado_centavos, tentativas, ultimo_erro
        from payouts
       where event_id in ${ids}
    `)) as unknown as Linha[];

    const cronograma = {
      diasLiberacaoEvento: Number(config.dias_liberacao_evento),
      diasLiberacaoReserva: Number(config.dias_liberacao_reserva),
    };
    const reservaBps = (m: Metodo) =>
      Number(m === 'pix' ? config.reserva_pix_bps : config.reserva_cartao_bps);

    let liberado = 0;
    let aLiberar = 0;
    let descoberto = 0;

    const resultado: EventoFinanceiro[] = eventos.map((e) => {
      const eventId = e.id as string;
      const dataFim = new Date(e.data_fim as string);
      const cancelado = e.status === 'cancelado';

      const porMetodo = new Map<Metodo, PedidoParaRepasse[]>();
      for (const p of pedidos) {
        if (p.event_id !== eventId) continue;
        const m = p.metodo as Metodo;
        porMetodo.set(m, [...(porMetodo.get(m) ?? []), linhaParaPedido(p)]);
      }

      const todos = [...porMetodo.values()].flat();
      const totais = somarPedidos(todos);
      const gravadas = tranches.filter((t) => t.event_id === eventId);
      const datas = datasDoRepasse(dataFim, cronograma);

      const linhasTranche: TrancheNaTela[] = [];
      let liberadoEvento = 0;

      for (const [metodo, lista] of porMetodo) {
        const t = somarPedidos(lista);
        const principal = calcularPrincipal(t, reservaBps(metodo));
        const estimativa = {
          principal: principal.liberadoCentavos,
          reserva: principal.retidoCentavos,
        };

        for (const tranche of ['principal', 'reserva'] as const) {
          const g = gravadas.find((x) => x.tranche === tranche && x.metodo === metodo);
          // Valor definitivo: o motor já calculou (tentou ao menos uma vez) ou
          // a tranche está liberada. Antes disso, só estimativa.
          const definitivo = g && (g.status === 'released' || Number(g.tentativas) > 0);
          const valor = definitivo ? Number(g.liberado_centavos) : null;

          // Reserva sem nada retido (Pix, por padrão) não tem o que mostrar.
          if (tranche === 'reserva' && valor === null && estimativa.reserva === 0) continue;

          if (g?.status === 'released' && valor !== null) {
            if (valor > 0) liberadoEvento += valor;
            if (valor < 0) descoberto += valor;
          }

          linhasTranche.push({
            tranche,
            metodo,
            status: g ? (g.status as string) : cancelado ? 'canceled' : 'previsto',
            dataPrevista: g
              ? new Date(g.data_prevista as string)
              : tranche === 'principal'
                ? datas.principal
                : datas.reserva,
            dataEfetiva: g?.data_efetiva ? new Date(g.data_efetiva as string) : null,
            liberadoCentavos: valor,
            estimadoCentavos: estimativa[tranche],
            ultimoErro: (g?.ultimo_erro as string | null) ?? null,
          });
        }
      }

      liberado += liberadoEvento;
      if (!cancelado) aLiberar += Math.max(totais.liquidoCentavos - liberadoEvento, 0);

      linhasTranche.sort(
        (a, b) => a.dataPrevista.getTime() - b.dataPrevista.getTime() || a.metodo.localeCompare(b.metodo),
      );

      return {
        eventId,
        titulo: e.titulo as string,
        dataFim,
        terminou: dataFim.getTime() <= Date.now(),
        cancelado,
        totais,
        tranches: linhasTranche,
        previsto: gravadas.length === 0,
      };
    });

    return {
      liberadoCentavos: liberado,
      aLiberarCentavos: aLiberar,
      descobertoCentavos: descoberto,
      eventos: resultado,
    };
  });
}
