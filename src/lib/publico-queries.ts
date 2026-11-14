/**
 * Público do produtor — Caminho A, argumento nº 2 (ADR-017, ADR-024).
 *
 * "O produtor é dono dos próprios dados" vira tela e botão: quem comprou,
 * quantas vezes voltou, quanto gastou — e a planilha para levar embora.
 *
 * A pessoa é identificada pelo e-mail da compra, em minúsculas. CPF não sai
 * na exportação: o produtor precisa de contato e histórico para falar com o
 * público, não do documento — e dado que não sai não vaza.
 *
 * Tudo por `withTenant`: a RLS garante que um produtor só lê os próprios
 * compradores, mesmo que a mesma pessoa tenha comprado de vários.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/db/client';

export type Comprador = {
  email: string;
  nome: string;
  telefone: string | null;
  pedidos: number;
  eventos: number;
  ingressos: number;
  gastoCentavos: number;
  primeiraCompra: Date;
  ultimaCompra: Date;
};

export type ResumoPublico = {
  compradores: number;
  recorrentes: number;
  gastoMedioCentavos: number;
};

export async function compradoresDoProdutor(
  tenantId: string,
  opcoes: { eventId?: string | undefined; limite?: number } = {},
): Promise<{ resumo: ResumoPublico; lista: Comprador[] }> {
  return withTenant(tenantId, async (tx) => {
    const filtroEvento = opcoes.eventId ? sql`and o.event_id = ${opcoes.eventId}::uuid` : sql``;
    const limite = opcoes.limite ?? 200;

    const linhas = (await tx.execute(sql`
      with base as (
        select lower(o.comprador_email) as email, o.comprador_nome, o.comprador_telefone,
               o.event_id, o.criado_em,
               o.total_centavos - coalesce((select sum(r.valor_centavos) from refunds r
                                             where r.order_id = o.id and r.status = 'succeeded'), 0) as liquido,
               (select count(*) from tickets t where t.order_id = o.id and t.status in ('valido', 'usado')) as ingressos
          from orders o
         where o.tenant_id = ${tenantId}
           and o.comprador_email is not null
           and o.status in ('paid', 'partially_refunded')
           ${filtroEvento}
      )
      select email,
             (array_agg(comprador_nome order by criado_em desc))[1] as nome,
             (array_agg(comprador_telefone order by criado_em desc) filter (where comprador_telefone is not null))[1] as telefone,
             count(*) as pedidos,
             count(distinct event_id) as eventos,
             sum(ingressos) as ingressos,
             sum(liquido) as gasto,
             min(criado_em) as primeira,
             max(criado_em) as ultima,
             count(*) over () as total_compradores,
             sum(case when count(distinct event_id) >= 2 then 1 else 0 end) over () as recorrentes,
             avg(sum(liquido)) over () as gasto_medio
        from base
       group by email
       order by count(distinct event_id) desc, sum(liquido) desc
       limit ${limite}
    `)) as unknown as Record<string, unknown>[];

    const primeira = linhas[0];
    return {
      resumo: {
        compradores: Number(primeira?.total_compradores ?? 0),
        recorrentes: Number(primeira?.recorrentes ?? 0),
        gastoMedioCentavos: Math.round(Number(primeira?.gasto_medio ?? 0)),
      },
      lista: linhas.map((l) => ({
        email: l.email as string,
        nome: (l.nome as string | null) ?? '',
        telefone: (l.telefone as string | null) ?? null,
        pedidos: Number(l.pedidos),
        eventos: Number(l.eventos),
        ingressos: Number(l.ingressos),
        gastoCentavos: Number(l.gasto),
        primeiraCompra: new Date(l.primeira as string),
        ultimaCompra: new Date(l.ultima as string),
      })),
    };
  });
}

/** Planilha para Excel em português: ponto e vírgula, BOM e vírgula decimal. */
export function paraCsv(lista: Comprador[]): string {
  const celula = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const data = (d: Date) =>
    d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');

  const cabecalho = [
    'Nome',
    'E-mail',
    'Telefone',
    'Pedidos',
    'Eventos',
    'Ingressos',
    'Gasto (R$)',
    'Primeira compra',
    'Última compra',
  ];
  const linhas = lista.map((c) =>
    [
      c.nome,
      c.email,
      c.telefone ?? '',
      String(c.pedidos),
      String(c.eventos),
      String(c.ingressos),
      reais(c.gastoCentavos),
      data(c.primeiraCompra),
      data(c.ultimaCompra),
    ]
      .map(celula)
      .join(';'),
  );
  return '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n') + '\r\n';
}
