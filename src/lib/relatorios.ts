/**
 * Relatórios do evento — plano, seção 17.
 *
 * Três perguntas que o produtor faz e que ninguém conseguia responder:
 *
 * 1. **A que horas a casa encheu?** Sai do livro da porta. É o que decide a
 *    escala de bar e de segurança do próximo evento, e é o número que ele
 *    hoje estima de cabeça.
 * 2. **Quanto vendi por dia, e quando?** Mostra se a divulgação funcionou e
 *    quando parar de gastar com ela.
 * 3. **Quantos compraram e não foram?** O comparecimento é a conta que
 *    ninguém faz e que muda o planejamento inteiro — vender mil ingressos
 *    para setecentas pessoas aparecerem é outro evento.
 *
 * Tudo leitura, nada muda estado. As consultas agrupam no banco, não em
 * JavaScript: trazer 10 mil linhas para contar no servidor é o tipo de coisa
 * que funciona no teste e cai no evento grande.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/db/client';

export type PontoDaNoite = {
  /** Início da faixa de 15 minutos, em UTC. */
  em: Date;
  entradas: number;
  saidas: number;
  /** Quantas pessoas havia na casa ao fim desta faixa. */
  dentro: number;
};

/**
 * A curva da noite, em faixas de quinze minutos.
 *
 * O `sum() over (order by ...)` faz a soma corrida no banco: cada faixa já
 * chega sabendo quantas pessoas havia dentro naquele momento. Fazer essa
 * conta em JavaScript exigiria trazer a noite inteira para a memória.
 */
export async function curvaDaNoite(
  tenantId: string,
  eventId: string,
): Promise<PontoDaNoite[]> {
  const linhas = (await withTenant(tenantId, (tx) =>
    tx.execute(sql`
      with faixas as (
        select date_bin('15 minutes', em, timestamptz '2000-01-01') as faixa,
               count(*) filter (where tipo = 'entrada')::int as entradas,
               count(*) filter (where tipo = 'saida')::int    as saidas
          from ticket_movimentos
         where event_id = ${eventId}
         group by 1
      )
      select faixa,
             entradas,
             saidas,
             sum(entradas - saidas) over (order by faixa)::int as dentro
        from faixas
       order by faixa
    `),
  )) as unknown as {
    faixa: string;
    entradas: number;
    saidas: number;
    dentro: number;
  }[];

  return linhas.map((l) => ({
    em: new Date(l.faixa),
    entradas: Number(l.entradas),
    saidas: Number(l.saidas),
    dentro: Number(l.dentro),
  }));
}

export type PontoDeVenda = {
  /** Dia, em UTC. */
  dia: Date;
  pedidos: number;
  ingressos: number;
  brutoCentavos: number;
};

/** Vendas por dia, para ver se a divulgação funcionou e quando parar. */
export async function curvaDeVendas(
  tenantId: string,
  eventId: string,
): Promise<PontoDeVenda[]> {
  const linhas = (await withTenant(tenantId, (tx) =>
    tx.execute(sql`
      select date_trunc('day', o.pago_em) as dia,
             count(distinct o.id)::int    as pedidos,
             coalesce(sum(oi.quantidade), 0)::int as ingressos,
             coalesce(sum(o.total_centavos), 0)::bigint as bruto
        from orders o
        left join order_items oi on oi.order_id = o.id
       where o.event_id = ${eventId}
         and o.pago_em is not null
         and o.status in ('paid', 'partially_refunded')
       group by 1
       order by 1
    `),
  )) as unknown as {
    dia: string;
    pedidos: number;
    ingressos: number;
    bruto: string | number;
  }[];

  return linhas.map((l) => ({
    dia: new Date(l.dia),
    pedidos: Number(l.pedidos),
    ingressos: Number(l.ingressos),
    brutoCentavos: Number(l.bruto),
  }));
}

export type Comparecimento = {
  emitidos: number;
  compareceram: number;
  /** Em basis points, para não perder precisão na divisão. */
  taxaBps: number;
  /** Quem está na casa agora. Só faz sentido com controle de saída. */
  dentroAgora: number;
  /** Primeira e última entrada da noite. */
  primeiraEntrada: Date | null;
  ultimaEntrada: Date | null;
};

export async function comparecimento(
  tenantId: string,
  eventId: string,
): Promise<Comparecimento> {
  const linhas = (await withTenant(tenantId, (tx) =>
    tx.execute(sql`
      select
        count(*) filter (where status in ('valido', 'usado'))::int as emitidos,
        count(*) filter (where entradas_count > 0)::int            as compareceram,
        count(*) filter (where dentro)::int                        as dentro_agora,
        min(coalesce(ultima_entrada_em, checked_in_em))            as primeira,
        max(coalesce(ultima_entrada_em, checked_in_em))            as ultima
      from tickets
     where event_id = ${eventId}
    `),
  )) as unknown as {
    emitidos: number;
    compareceram: number;
    dentro_agora: number;
    primeira: string | null;
    ultima: string | null;
  }[];

  const l = linhas[0]!;
  const emitidos = Number(l.emitidos);
  const compareceram = Number(l.compareceram);

  return {
    emitidos,
    compareceram,
    // Aritmética inteira: `Math.round` sobre a divisão perderia o caso de
    // 999 em 1000, que arredondaria para 100% e esconderia a ausência.
    taxaBps: emitidos === 0 ? 0 : Math.floor((compareceram * 10_000) / emitidos),
    dentroAgora: Number(l.dentro_agora),
    primeiraEntrada: l.primeira ? new Date(l.primeira) : null,
    ultimaEntrada: l.ultima ? new Date(l.ultima) : null,
  };
}

export type LinhaDeLote = {
  nome: string;
  emitidos: number;
  compareceram: number;
};

/** Comparecimento por lote: camarote costuma faltar mais que pista. */
export async function comparecimentoPorLote(
  tenantId: string,
  eventId: string,
): Promise<LinhaDeLote[]> {
  const linhas = (await withTenant(tenantId, (tx) =>
    tx.execute(sql`
      select tt.nome,
             count(*) filter (where t.status in ('valido', 'usado'))::int as emitidos,
             count(*) filter (where t.entradas_count > 0)::int            as compareceram
        from tickets t
        join ticket_types tt on tt.id = t.ticket_type_id
       where t.event_id = ${eventId}
       group by tt.nome, tt.ordem
       order by tt.ordem
    `),
  )) as unknown as { nome: string; emitidos: number; compareceram: number }[];

  return linhas.map((l) => ({
    nome: l.nome,
    emitidos: Number(l.emitidos),
    compareceram: Number(l.compareceram),
  }));
}
