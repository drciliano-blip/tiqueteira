/**
 * Consultas da loja pública.
 *
 * A vitrine não tem sessão, então não existe `app.tenant_id` vindo de um
 * login. O tenant é descoberto pelo slug da URL — e aí mora o único ponto
 * delicado deste arquivo:
 *
 *   Para achar o tenant pelo slug seria preciso ler a tabela `tenants`, mas a
 *   política de RLS dessa tabela exige justamente o `app.tenant_id` que ainda
 *   não temos. Galinha e ovo.
 *
 * A saída é uma única consulta pela conexão de serviço, restrita a três
 * colunas públicas (`id`, `slug`, `nome`) de tenants ativos. Nada de taxa,
 * CNPJ ou dado de recebedor passa por aqui. A partir do `id` resolvido, todo
 * o resto usa `withTenant()` e volta a ser protegido pelo RLS.
 *
 * ---
 *
 * **Por que estas leituras são cacheadas.**
 *
 * Numa abertura de vendas, a esmagadora maioria dos acessos é gente que só
 * abre a página. Se cada um desses acessos toca o banco, o banco cai antes de
 * a primeira compra acontecer — foi o que o teste de carga mostrou: com 200
 * acessos simultâneos, 83% receberam erro 500 na busca do tenant.
 *
 * O `export const revalidate` da página não resolvia isso: o cabeçalho lê o
 * cookie de sessão, e ler cookie torna a rota inteira dinâmica. O cache
 * precisa estar na consulta, não na página.
 *
 * O que fica velho por até 15 segundos é apenas o CONTADOR de estoque. Quem
 * decide se ainda há ingresso é o `UPDATE` atômico da reserva, que nunca é
 * cacheado. O pior caso é alguém ver "disponível" e receber "esgotou agora" —
 * incômodo, e infinitamente melhor que o site fora do ar.
 */
import 'server-only';

import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';

import { serviceDb, withTenant } from '@/db/client';
import { events, tenants, ticketTypes, venues } from '@/db/schema';
import { disponivel } from '@/domain/inventory';
import { etiquetaDeEventos, etiquetaDeTenant } from '@/lib/cache-publico';

/**
 * 15s é o ponto de equilíbrio: derruba a carga no banco em mais de 90% numa
 * abertura, e um contador de estoque com 15 segundos de atraso não muda a
 * decisão de ninguém.
 */
const CACHE_EVENTO_SEGUNDOS = 15;

/** O cadastro do produtor muda raramente; não há motivo para reler direto. */
const CACHE_TENANT_SEGUNDOS = 60;

export type TenantPublico = {
  id: string;
  slug: string;
  nome: string;
  corAcento: string;
  logoUrl: string | null;
  /**
   * Taxa de conveniência. Exposta de propósito: a exibição destacada é
   * obrigatória no checkout, e há histórico de autuação de Procon por taxa
   * embutida. O cálculo que vale é sempre o do servidor — isto aqui é para a
   * tela poder mostrar o valor antes de o pedido existir.
   */
  taxaConvenienciaBps: number;
  taxaAbsorvidaPeloProdutor: boolean;
  taxaMinimaCentavos: number;
};

/** Estados em que um evento aparece na vitrine. */
const VISIVEIS = ['publicado', 'esgotado'] as const;

/**
 * A consulta que a Vercel apontou no alerta de 5xx: era executada uma vez por
 * visita, e é a primeira coisa que toda página pública faz. Cacheada, deixa
 * de existir como carga.
 */
export async function resolverTenantPorSlug(slug: string): Promise<TenantPublico | null> {
  return unstable_cache(() => carregarTenantPorSlug(slug), ['tenant-por-slug', slug], {
    revalidate: CACHE_TENANT_SEGUNDOS,
    tags: [etiquetaDeTenant(slug)],
  })();
}

async function carregarTenantPorSlug(slug: string): Promise<TenantPublico | null> {
  const [linha] = await serviceDb()
    .select({
      id: tenants.id,
      slug: tenants.slug,
      nome: tenants.nome,
      corAcento: tenants.corAcento,
      logoUrl: tenants.logoUrl,
      taxaConvenienciaBps: tenants.taxaConvenienciaBps,
      taxaAbsorvidaPeloProdutor: tenants.taxaAbsorvidaPeloProdutor,
      taxaMinimaCentavos: tenants.taxaMinimaCentavos,
    })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), eq(tenants.status, 'ativo')))
    .limit(1);

  return linha ?? null;
}

/** Vitrine: produtores ativos que têm ao menos um evento à venda. */
export async function listarProdutores(): Promise<TenantPublico[]> {
  return serviceDb()
    .selectDistinct({
      id: tenants.id,
      slug: tenants.slug,
      nome: tenants.nome,
      corAcento: tenants.corAcento,
      logoUrl: tenants.logoUrl,
      taxaConvenienciaBps: tenants.taxaConvenienciaBps,
      taxaAbsorvidaPeloProdutor: tenants.taxaAbsorvidaPeloProdutor,
      taxaMinimaCentavos: tenants.taxaMinimaCentavos,
    })
    .from(tenants)
    .innerJoin(events, eq(events.tenantId, tenants.id))
    .where(
      and(
        eq(tenants.status, 'ativo'),
        inArray(events.status, [...VISIVEIS]),
        gt(events.dataFim, new Date()),
      ),
    )
    .orderBy(asc(tenants.nome));
}

/**
 * Configuração de taxa do produtor, para o cálculo no servidor.
 *
 * Separada de `TenantPublico` de propósito: `comissaoBps` é invisível ao
 * comprador, e tipo que chega a componente de tela é tipo que uma hora
 * alguém renderiza sem querer.
 */
export async function configDeTaxasDoTenant(tenantId: string) {
  const [linha] = await serviceDb()
    .select({
      taxaConvenienciaBps: tenants.taxaConvenienciaBps,
      comissaoBps: tenants.comissaoBps,
      taxaFixaCentavos: tenants.taxaFixaCentavos,
      taxaMinimaCentavos: tenants.taxaMinimaCentavos,
      taxaAbsorvidaPeloProdutor: tenants.taxaAbsorvidaPeloProdutor,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!linha) throw new Error(`Tenant ${tenantId} não existe`);
  return linha;
}

export type EventoResumo = {
  id: string;
  slug: string;
  titulo: string;
  imagemUrl: string | null;
  dataInicio: Date;
  status: string;
  venueNome: string;
  cidade: string | null;
  /** Menor preço entre os lotes à venda. `null` se nada disponível. */
  precoMinimoCentavos: number | null;
};

export async function listarEventosDoTenant(tenantId: string): Promise<EventoResumo[]> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({
        id: events.id,
        slug: events.slug,
        titulo: events.titulo,
        imagemUrl: events.imagemUrl,
        dataInicio: events.dataInicio,
        status: events.status,
        venueNome: venues.nome,
        cidade: venues.cidade,
      })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .where(and(inArray(events.status, [...VISIVEIS]), gt(events.dataFim, new Date())))
      .orderBy(asc(events.dataInicio));

    if (linhas.length === 0) return [];

    const lotes = await tx
      .select({
        eventId: ticketTypes.eventId,
        precoCentavos: ticketTypes.precoCentavos,
        tipo: ticketTypes.tipo,
        ativo: ticketTypes.ativo,
        quantidadeTotal: ticketTypes.quantidadeTotal,
        quantidadeVendida: ticketTypes.quantidadeVendida,
        quantidadeReservada: ticketTypes.quantidadeReservada,
      })
      .from(ticketTypes)
      .where(
        inArray(
          ticketTypes.eventId,
          linhas.map((l) => l.id),
        ),
      );

    const minimoPorEvento = new Map<string, number>();
    for (const lote of lotes) {
      if (!lote.ativo || disponivel(lote) <= 0) continue;
      // Gratuidade legal não define o "a partir de" — ver marketplace-queries.
      if (lote.tipo !== 'inteira' && lote.tipo !== 'meia') continue;
      const atual = minimoPorEvento.get(lote.eventId);
      if (atual === undefined || lote.precoCentavos < atual) {
        minimoPorEvento.set(lote.eventId, lote.precoCentavos);
      }
    }

    return linhas.map((l) => ({
      ...l,
      precoMinimoCentavos: minimoPorEvento.get(l.id) ?? null,
    }));
  });
}

export type LotePublico = {
  id: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  tipo: string;
  exigeDocumento: boolean;
  limitePorPedido: number;
  vendasInicio: Date;
  vendasFim: Date;
  ativo: boolean;
  disponivel: number;
  /** Regra de exibição: por que este lote não pode ser comprado agora. */
  situacao: 'a_venda' | 'esgotado' | 'em_breve' | 'encerrado' | 'inativo';
};

export type EventoPublico = {
  id: string;
  slug: string;
  titulo: string;
  descricao: string | null;
  imagemUrl: string | null;
  dataInicio: Date;
  dataFim: Date;
  classificacaoEtaria: number;
  status: string;
  /** Sobrepõe a cor do produtor quando o evento tem identidade própria. */
  corAcento: string | null;
  ingressoNominal: boolean;
  exigeDocumentoEntrada: boolean;
  politicaReembolso: string | null;
  venue: { nome: string; endereco: string | null; cidade: string | null; uf: string | null };
  lotes: LotePublico[];
};

function situacaoDoLote(
  lote: { ativo: boolean; vendasInicio: Date; vendasFim: Date } & {
    quantidadeTotal: number;
    quantidadeVendida: number;
    quantidadeReservada: number;
  },
  agora: Date,
): LotePublico['situacao'] {
  if (!lote.ativo) return 'inativo';
  if (agora < lote.vendasInicio) return 'em_breve';
  if (agora > lote.vendasFim) return 'encerrado';
  if (disponivel(lote) <= 0) return 'esgotado';
  return 'a_venda';
}

/**
 * A fronteira do cache é explícita de propósito.
 *
 * O cache do Next guarda JSON. Um `Date` que entra volta como `string`, sem
 * erro de tipo e sem aviso — a tela só quebraria em produção, na formatação.
 * Então `carregarEventoBruto` devolve texto ISO, e a conversão acontece aqui,
 * de um lado só.
 */
export async function buscarEventoPublico(
  tenantId: string,
  eventSlug: string,
): Promise<EventoPublico | null> {
  const bruto = await unstable_cache(
    () => carregarEventoBruto(tenantId, eventSlug),
    ['evento-publico', tenantId, eventSlug],
    { revalidate: CACHE_EVENTO_SEGUNDOS, tags: [etiquetaDeEventos(tenantId)] },
  )();

  if (!bruto) return null;

  /**
   * O relógio é lido AGORA, fora do cache, de propósito. Só os contadores de
   * estoque podem ficar velhos; a hora de abertura da venda, não. Se `agora`
   * viesse do cache, um lote marcado "em breve" continuaria "em breve" por até
   * 15 segundos depois da hora marcada — justo no minuto em que todo mundo
   * está com a página aberta esperando.
   */
  const agora = new Date();

  const lotes: LotePublico[] = bruto.lotes
    .map((l) => ({
      ...l,
      vendasInicio: new Date(l.vendasInicio),
      vendasFim: new Date(l.vendasFim),
    }))
    // Lote inativo de lote anterior não interessa ao comprador.
    .filter((l) => l.ativo || disponivel(l) > 0)
    .map((l) => ({
      id: l.id,
      nome: l.nome,
      descricao: l.descricao,
      precoCentavos: l.precoCentavos,
      tipo: l.tipo,
      exigeDocumento: l.exigeDocumento,
      limitePorPedido: l.limitePorPedido,
      vendasInicio: l.vendasInicio,
      vendasFim: l.vendasFim,
      ativo: l.ativo,
      disponivel: disponivel(l),
      situacao: situacaoDoLote(l, agora),
    }));

  return {
    ...bruto.evento,
    dataInicio: new Date(bruto.evento.dataInicio),
    dataFim: new Date(bruto.evento.dataFim),
    lotes,
  };
}

async function carregarEventoBruto(tenantId: string, eventSlug: string) {
  return withTenant(tenantId, async (tx) => {
    const [evento] = await tx
      .select({
        id: events.id,
        slug: events.slug,
        titulo: events.titulo,
        descricao: events.descricao,
        imagemUrl: events.imagemUrl,
        dataInicio: events.dataInicio,
        dataFim: events.dataFim,
        classificacaoEtaria: events.classificacaoEtaria,
        status: events.status,
        corAcento: events.corAcento,
        ingressoNominal: events.ingressoNominal,
        exigeDocumentoEntrada: events.exigeDocumentoEntrada,
        politicaReembolso: events.politicaReembolso,
        venueNome: venues.nome,
        venueEndereco: venues.endereco,
        venueCidade: venues.cidade,
        venueUf: venues.uf,
      })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .where(and(eq(events.slug, eventSlug), inArray(events.status, [...VISIVEIS])))
      .limit(1);

    if (!evento) return null;

    const linhas = await tx
      .select({
        id: ticketTypes.id,
        nome: ticketTypes.nome,
        descricao: ticketTypes.descricao,
        precoCentavos: ticketTypes.precoCentavos,
        tipo: ticketTypes.tipo,
        exigeDocumento: ticketTypes.exigeDocumento,
        limitePorPedido: ticketTypes.limitePorPedido,
        vendasInicio: ticketTypes.vendasInicio,
        vendasFim: ticketTypes.vendasFim,
        ativo: ticketTypes.ativo,
        ordem: ticketTypes.ordem,
        quantidadeTotal: ticketTypes.quantidadeTotal,
        quantidadeVendida: ticketTypes.quantidadeVendida,
        quantidadeReservada: ticketTypes.quantidadeReservada,
      })
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, evento.id))
      .orderBy(asc(ticketTypes.ordem), asc(ticketTypes.precoCentavos));

    return {
      evento: {
        id: evento.id,
        slug: evento.slug,
        titulo: evento.titulo,
        descricao: evento.descricao,
        imagemUrl: evento.imagemUrl,
        dataInicio: evento.dataInicio.toISOString(),
        dataFim: evento.dataFim.toISOString(),
        classificacaoEtaria: evento.classificacaoEtaria,
        status: evento.status,
        corAcento: evento.corAcento,
        ingressoNominal: evento.ingressoNominal,
        exigeDocumentoEntrada: evento.exigeDocumentoEntrada,
        politicaReembolso: evento.politicaReembolso,
        venue: {
          nome: evento.venueNome,
          endereco: evento.venueEndereco,
          cidade: evento.venueCidade,
          uf: evento.venueUf,
        },
      },
      lotes: linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        descricao: l.descricao,
        precoCentavos: l.precoCentavos,
        tipo: l.tipo,
        exigeDocumento: l.exigeDocumento,
        limitePorPedido: l.limitePorPedido,
        vendasInicio: l.vendasInicio.toISOString(),
        vendasFim: l.vendasFim.toISOString(),
        ativo: l.ativo,
        quantidadeTotal: l.quantidadeTotal,
        quantidadeVendida: l.quantidadeVendida,
        quantidadeReservada: l.quantidadeReservada,
      })),
    };
  });
}
