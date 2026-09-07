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
import { events, tenants, ticketTypes, venues } from '@/db/schema';

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
  tenantSlug: string;
  tenantNome: string;
  precoMinimoCentavos: number | null;
};

type Filtros = {
  /** Busca por título do evento, nome do espaço ou nome do produtor. */
  busca?: string;
  cidade?: string;
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

  // Preço mínimo entre os lotes que ainda podem ser comprados.
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
