/**
 * Consultas do marketplace — a vitrine que cruza todos os produtores.
 *
 * Diferente de `public-queries.ts`, que sempre opera dentro de um tenant,
 * aqui a leitura é propositalmente cross-tenant: a home mostra o que está à
 * venda na plataforma inteira.
 *
 * Por isso usa a conexão de serviço, e por isso a seleção de colunas é
 * explícita e curta. A regra: só entra nesta consulta aquilo que já apareceria
 * numa página pública do evento. Nada de taxa, CNPJ, recebedor ou dado de
 * comprador.
 */
import 'server-only';

import { and, asc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events, orders, tenants, ticketTypes, venues } from '@/db/schema';
import { CATEGORIAS, type Categoria } from '@/domain/categorias';

export { CATEGORIAS };
export type { Categoria };

const VISIVEIS = ['publicado', 'esgotado'] as const;

export type EventoVitrine = {
  id: string;
  slug: string;
  titulo: string;
  imagemUrl: string | null;
  dataInicio: Date;
  status: string;
  venueNome: string;
  cidade: string | null;
  uf: string | null;
  categoria: string;
  tenantSlug: string;
  tenantNome: string;
  precoMinimoCentavos: number | null;
};

type Filtros = {
  /** Busca por título do evento, nome do espaço ou nome do produtor. */
  busca?: string;
  cidade?: string;
  categoria?: string;
  limite?: number;
};

export async function listarEventosDaPlataforma(filtros: Filtros = {}): Promise<EventoVitrine[]> {
  const db = serviceDb();
  const termo = filtros.busca?.trim();

  const condicoes = [
    inArray(events.status, [...VISIVEIS]),
    gt(events.dataFim, new Date()),
    eq(tenants.status, 'ativo'),
  ];

  if (termo && termo.length >= 2) {
    const like = `%${termo}%`;
    const busca = or(
      ilike(events.titulo, like),
      ilike(venues.nome, like),
      ilike(venues.cidade, like),
      ilike(tenants.nome, like),
    );
    if (busca) condicoes.push(busca);
  }

  if (filtros.cidade) {
    condicoes.push(eq(venues.cidade, filtros.cidade));
  }

  if (filtros.categoria && CATEGORIAS.some((c) => c.valor === filtros.categoria)) {
    condicoes.push(eq(events.categoria, filtros.categoria as Categoria));
  }

  const linhas = await db
    .select({
      id: events.id,
      slug: events.slug,
      titulo: events.titulo,
      imagemUrl: events.imagemUrl,
      dataInicio: events.dataInicio,
      status: events.status,
      venueNome: venues.nome,
      cidade: venues.cidade,
      uf: venues.uf,
      categoria: events.categoria,
      tenantSlug: tenants.slug,
      tenantNome: tenants.nome,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(tenants, eq(tenants.id, events.tenantId))
    .where(and(...condicoes))
    .orderBy(asc(events.dataInicio))
    .limit(filtros.limite ?? 60);

  if (linhas.length === 0) return [];

  /**
   * Preço mínimo entre os lotes que ainda podem ser comprados.
   *
   * Gratuidade legal (PCD, idoso) e cortesia ficam de fora: um evento com
   * ingresso de PCD a R$ 0 anunciaria "a partir de R$ 0,00", o que é falso
   * para quem paga e é o tipo de promessa que gera reclamação na porta.
   */
  const precos = await db
    .select({
      eventId: ticketTypes.eventId,
      minimo: sql<number>`min(${ticketTypes.precoCentavos})`,
    })
    .from(ticketTypes)
    .where(
      and(
        inArray(
          ticketTypes.eventId,
          linhas.map((l) => l.id),
        ),
        eq(ticketTypes.ativo, true),
        inArray(ticketTypes.tipo, ['inteira', 'meia']),
        sql`${ticketTypes.quantidadeVendida} + ${ticketTypes.quantidadeReservada} < ${ticketTypes.quantidadeTotal}`,
        sql`now() between ${ticketTypes.vendasInicio} and ${ticketTypes.vendasFim}`,
      ),
    )
    .groupBy(ticketTypes.eventId);

  const minimoPorEvento = new Map(precos.map((p) => [p.eventId, Number(p.minimo)]));

  return linhas.map((l) => ({
    ...l,
    precoMinimoCentavos: minimoPorEvento.get(l.id) ?? null,
  }));
}

/**
 * Eventos mais vendidos nas últimas 24 horas.
 *
 * Prova social honesta: é contagem real de pedidos pagos, não curadoria
 * disfarçada de "destaque". Se ninguém comprou, a seção não aparece.
 */
export async function listarMaisVendidos(limite = 8): Promise<EventoVitrine[]> {
  const db = serviceDb();

  const ranking = await db
    .select({
      eventId: orders.eventId,
      pedidos: sql<number>`count(*)`,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ['paid', 'partially_refunded']),
        sql`${orders.pagoEm} >= now() - interval '24 hours'`,
      ),
    )
    .groupBy(orders.eventId)
    .orderBy(sql`count(*) desc`)
    .limit(limite);

  if (ranking.length === 0) return [];

  const ids = ranking.map((r) => r.eventId);
  const eventos = await listarEventosDaPlataforma({ limite: 60 });

  // Preserva a ordem do ranking; eventos já encerrados somem naturalmente,
  // porque `listarEventosDaPlataforma` só devolve o que ainda está à venda.
  const porId = new Map(eventos.map((e) => [e.id, e]));
  return ids.map((id) => porId.get(id)).filter((e): e is EventoVitrine => Boolean(e));
}

/** Cidades com evento à venda, para o filtro da home. */
export async function listarCidades(): Promise<string[]> {
  const linhas = await serviceDb()
    .selectDistinct({ cidade: venues.cidade })
    .from(venues)
    .innerJoin(events, eq(events.venueId, venues.id))
    .innerJoin(tenants, eq(tenants.id, events.tenantId))
    .where(
      and(
        inArray(events.status, [...VISIVEIS]),
        gt(events.dataFim, new Date()),
        eq(tenants.status, 'ativo'),
      ),
    )
    .orderBy(asc(venues.cidade));

  return linhas.map((l) => l.cidade).filter((c): c is string => Boolean(c));
}
