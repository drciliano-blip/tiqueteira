'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb, withTenant } from '@/db/client';
import { auditLog, events, ticketTypes, venues } from '@/db/schema';
import { excedeCapacidade, excedeCotaMeia } from '@/domain/inventory';
import { AuthError, requireRole } from '@/lib/auth';
import { enfileirar } from '@/lib/jobs';
import { reaisParaCentavos } from '@/lib/money';
import { getAuth } from '@/lib/session-cookie';

/**
 * Cadastro de evento, espaço e lotes.
 *
 * Duas validações aqui não são burocracia, são a razão de o sistema existir:
 *
 * - **Capacidade do espaço é teto rígido.** Alvará e AVCB não são sugestão, e
 *   vender além da lotação é problema de segurança antes de ser problema
 *   comercial.
 * - **Cota de meia-entrada.** Lei nº 12.933/2013 fixa 40%. Gratuidade legal
 *   (PCD, idoso) fica de fora da cota — ver ADR-004.
 *
 * As duas são checadas no CADASTRO, não na venda: descobrir na hora da compra
 * seria tarde para todo mundo.
 */

export type EstadoFormulario = { erro?: string; ok?: boolean };

function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Converte data e hora locais (São Paulo, UTC-3) para o instante em UTC. */
function instante(data: string, horaTexto: string): Date {
  return new Date(`${data}T${horaTexto}:00-03:00`);
}

async function contexto(tenantId: string) {
  const auth = await getAuth();
  requireRole(auth, tenantId, 'operador');
  return auth;
}

// ---------------------------------------------------------------------------
// Espaço
// ---------------------------------------------------------------------------

const EspacoSchema = z.object({
  tenantId: z.uuid(),
  nome: z.string().trim().min(2, 'Informe o nome do espaço.').max(120),
  endereco: z.string().trim().max(200).optional(),
  cidade: z.string().trim().max(80).optional(),
  uf: z.string().trim().length(2, 'UF com duas letras.').optional().or(z.literal('')),
  capacidadeMaxima: z.coerce
    .number()
    .int('Capacidade precisa ser um número inteiro.')
    .min(1, 'Capacidade precisa ser maior que zero.')
    .max(500_000),
});

export async function criarEspaco(
  tenantId: string,
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const dados = EspacoSchema.safeParse({
    tenantId,
    nome: formData.get('nome'),
    endereco: formData.get('endereco') ?? undefined,
    cidade: formData.get('cidade') ?? undefined,
    uf: formData.get('uf') ?? undefined,
    capacidadeMaxima: formData.get('capacidadeMaxima'),
  });

  if (!dados.success) {
    return { erro: dados.error.issues[0]?.message ?? 'Confira os dados.' };
  }

  try {
    await contexto(tenantId);
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Sem permissão.' };
  }

  await withTenant(tenantId, async (tx) => {
    await tx.insert(venues).values({
      tenantId,
      nome: dados.data.nome,
      endereco: dados.data.endereco || null,
      cidade: dados.data.cidade || null,
      uf: dados.data.uf ? dados.data.uf.toUpperCase() : null,
      capacidadeMaxima: dados.data.capacidadeMaxima,
    });
  });

  revalidatePath('/painel/espacos');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Evento
// ---------------------------------------------------------------------------

const EventoSchema = z
  .object({
    tenantId: z.uuid(),
    venueId: z.uuid('Escolha o espaço.'),
    titulo: z.string().trim().min(3, 'Informe o título do evento.').max(160),
    descricao: z.string().trim().max(4000).optional(),
    categoria: z.enum([
      'festa',
      'show',
      'teatro',
      'stand_up',
      'esporte',
      'gastronomia',
      'curso',
      'infantil',
      'outro',
    ]),
    dataInicio: z.string().min(10, 'Informe a data de início.'),
    horaInicio: z.string().min(4, 'Informe o horário de início.'),
    dataFim: z.string().min(10, 'Informe a data de término.'),
    horaFim: z.string().min(4, 'Informe o horário de término.'),
    capacidade: z.coerce.number().int().min(1, 'Capacidade precisa ser maior que zero.'),
    classificacaoEtaria: z.coerce.number().int().min(0).max(21),
    ingressoNominal: z.coerce.boolean().optional(),
    exigeDocumentoEntrada: z.coerce.boolean().optional(),
  })
  .refine(
    (d) => instante(d.dataFim, d.horaFim) > instante(d.dataInicio, d.horaInicio),
    { message: 'O término precisa ser depois do início.' },
  );

function lerEvento(tenantId: string, formData: FormData) {
  return EventoSchema.safeParse({
    tenantId,
    venueId: formData.get('venueId'),
    titulo: formData.get('titulo'),
    descricao: formData.get('descricao') ?? undefined,
    categoria: formData.get('categoria') ?? 'festa',
    dataInicio: formData.get('dataInicio'),
    horaInicio: formData.get('horaInicio'),
    dataFim: formData.get('dataFim'),
    horaFim: formData.get('horaFim'),
    capacidade: formData.get('capacidade'),
    classificacaoEtaria: formData.get('classificacaoEtaria') ?? 18,
    ingressoNominal: formData.get('ingressoNominal') === 'on',
    exigeDocumentoEntrada: formData.get('exigeDocumentoEntrada') === 'on',
  });
}

export async function criarEvento(
  tenantId: string,
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const dados = lerEvento(tenantId, formData);
  if (!dados.success) {
    return { erro: dados.error.issues[0]?.message ?? 'Confira os dados.' };
  }

  try {
    await contexto(tenantId);
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Sem permissão.' };
  }

  const d = dados.data;
  let eventId: string;

  try {
    eventId = await withTenant(tenantId, async (tx) => {
      const [espaco] = await tx
        .select({ capacidadeMaxima: venues.capacidadeMaxima })
        .from(venues)
        .where(eq(venues.id, d.venueId))
        .limit(1);

      if (!espaco) throw new Error('Espaço não encontrado.');

      // Teto rígido: alvará e AVCB não são sugestão.
      if (d.capacidade > espaco.capacidadeMaxima) {
        throw new Error(
          `A capacidade do evento (${d.capacidade}) passa da capacidade do espaço (${espaco.capacidadeMaxima}).`,
        );
      }

      // Slug único por produtor, com sufixo numérico quando repete.
      const base = slugify(d.titulo) || 'evento';
      let slug = base;
      for (let i = 2; i < 50; i++) {
        const [existe] = await tx
          .select({ id: events.id })
          .from(events)
          .where(eq(events.slug, slug))
          .limit(1);
        if (!existe) break;
        slug = `${base}-${i}`;
      }

      const [criado] = await tx
        .insert(events)
        .values({
          tenantId,
          venueId: d.venueId,
          slug,
          titulo: d.titulo,
          descricao: d.descricao || null,
          categoria: d.categoria,
          dataInicio: instante(d.dataInicio, d.horaInicio),
          dataFim: instante(d.dataFim, d.horaFim),
          capacidade: d.capacidade,
          classificacaoEtaria: d.classificacaoEtaria,
          ingressoNominal: d.ingressoNominal ?? true,
          exigeDocumentoEntrada: d.exigeDocumentoEntrada ?? false,
          status: 'rascunho',
        })
        .returning({ id: events.id });

      if (!criado) throw new Error('Não foi possível criar o evento.');
      return criado.id;
    });
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não foi possível criar o evento.' };
  }

  revalidatePath('/painel');
  redirect(`/painel/eventos/${eventId}`);
}

export async function atualizarEvento(
  tenantId: string,
  eventId: string,
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const dados = lerEvento(tenantId, formData);
  if (!dados.success) {
    return { erro: dados.error.issues[0]?.message ?? 'Confira os dados.' };
  }

  try {
    await contexto(tenantId);
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Sem permissão.' };
  }

  const d = dados.data;

  try {
    await withTenant(tenantId, async (tx) => {
      const [espaco] = await tx
        .select({ capacidadeMaxima: venues.capacidadeMaxima })
        .from(venues)
        .where(eq(venues.id, d.venueId))
        .limit(1);

      if (!espaco) throw new Error('Espaço não encontrado.');
      if (d.capacidade > espaco.capacidadeMaxima) {
        throw new Error(
          `A capacidade do evento (${d.capacidade}) passa da capacidade do espaço (${espaco.capacidadeMaxima}).`,
        );
      }

      /**
       * Reduzir capacidade abaixo do que já foi vendido é o caso de borda 7 do
       * plano. Recusar é a única saída honesta: o contrário seria prometer
       * lugar que não existe.
       */
      const [vendidos] = await tx
        .select({ total: sql<number>`coalesce(sum(${ticketTypes.quantidadeVendida}), 0)` })
        .from(ticketTypes)
        .where(eq(ticketTypes.eventId, eventId));

      const jaVendidos = Number(vendidos?.total ?? 0);
      if (d.capacidade < jaVendidos) {
        throw new Error(
          `Já foram vendidos ${jaVendidos} ingressos. A capacidade não pode ficar abaixo disso.`,
        );
      }

      await tx
        .update(events)
        .set({
          venueId: d.venueId,
          titulo: d.titulo,
          descricao: d.descricao || null,
          categoria: d.categoria,
          dataInicio: instante(d.dataInicio, d.horaInicio),
          dataFim: instante(d.dataFim, d.horaFim),
          capacidade: d.capacidade,
          classificacaoEtaria: d.classificacaoEtaria,
          ingressoNominal: d.ingressoNominal ?? true,
          exigeDocumentoEntrada: d.exigeDocumentoEntrada ?? false,
          atualizadoEm: new Date(),
        })
        .where(eq(events.id, eventId));
    });
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não foi possível salvar.' };
  }

  revalidatePath(`/painel/eventos/${eventId}`);
  revalidatePath('/painel');
  return { ok: true };
}

export async function mudarStatusDoEvento(
  tenantId: string,
  eventId: string,
  novo: 'publicado' | 'rascunho' | 'encerrado' | 'cancelado',
): Promise<EstadoFormulario> {
  try {
    await contexto(tenantId);
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Sem permissão.' };
  }

  try {
    await withTenant(tenantId, async (tx) => {
      if (novo === 'publicado') {
        const [lotes] = await tx
          .select({ n: sql<number>`count(*)` })
          .from(ticketTypes)
          .where(and(eq(ticketTypes.eventId, eventId), eq(ticketTypes.ativo, true)));

        if (Number(lotes?.n ?? 0) === 0) {
          throw new Error('Crie ao menos um lote de ingresso antes de publicar.');
        }
      }

      await tx
        .update(events)
        .set({
          status: novo,
          ...(novo === 'cancelado' ? { canceladoEm: new Date() } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(events.id, eventId));
    });
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não foi possível mudar a situação.' };
  }

  revalidatePath(`/painel/eventos/${eventId}`);
  revalidatePath('/painel');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lote de ingresso
// ---------------------------------------------------------------------------

const LoteSchema = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome do lote.').max(120),
    descricao: z.string().trim().max(300).optional(),
    preco: z.string().trim().min(1, 'Informe o preço.'),
    tipo: z.enum(['inteira', 'meia', 'cortesia', 'pcd', 'idoso']),
    quantidadeTotal: z.coerce.number().int().min(1, 'Informe a quantidade.').max(200_000),
    limitePorPedido: z.coerce.number().int().min(1).max(50),
    vendasInicioData: z.string().min(10, 'Informe quando as vendas começam.'),
    vendasInicioHora: z.string().min(4),
    vendasFimData: z.string().min(10, 'Informe quando as vendas terminam.'),
    vendasFimHora: z.string().min(4),
    exigeDocumento: z.coerce.boolean().optional(),
  })
  .refine(
    (d) =>
      instante(d.vendasFimData, d.vendasFimHora) >
      instante(d.vendasInicioData, d.vendasInicioHora),
    { message: 'O fim das vendas precisa ser depois do início.' },
  );

/** `meia` consome a cota legal; `pcd` e `idoso` são gratuidade e ficam fora. */
const CONSOME_COTA: Record<string, boolean> = {
  inteira: false,
  meia: true,
  cortesia: false,
  pcd: false,
  idoso: false,
};

export async function salvarLote(
  tenantId: string,
  eventId: string,
  ticketTypeId: string | null,
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const dados = LoteSchema.safeParse({
    nome: formData.get('nome'),
    descricao: formData.get('descricao') ?? undefined,
    preco: formData.get('preco'),
    tipo: formData.get('tipo') ?? 'inteira',
    quantidadeTotal: formData.get('quantidadeTotal'),
    limitePorPedido: formData.get('limitePorPedido') ?? 6,
    vendasInicioData: formData.get('vendasInicioData'),
    vendasInicioHora: formData.get('vendasInicioHora'),
    vendasFimData: formData.get('vendasFimData'),
    vendasFimHora: formData.get('vendasFimHora'),
    exigeDocumento: formData.get('exigeDocumento') === 'on',
  });

  if (!dados.success) {
    return { erro: dados.error.issues[0]?.message ?? 'Confira os dados do lote.' };
  }

  try {
    await contexto(tenantId);
  } catch (e) {
    return { erro: e instanceof AuthError ? e.message : 'Sem permissão.' };
  }

  const d = dados.data;

  let precoCentavos: number;
  try {
    precoCentavos = reaisParaCentavos(d.preco);
    if (precoCentavos < 0) throw new Error('Preço não pode ser negativo.');
  } catch {
    return { erro: 'Preço inválido. Use o formato 100,00.' };
  }

  try {
    await withTenant(tenantId, async (tx) => {
      const [evento] = await tx
        .select({ capacidade: events.capacidade, cotaMeiaBps: events.cotaMeiaBps })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!evento) throw new Error('Evento não encontrado.');

      const outros = await tx
        .select({
          quantidadeTotal: ticketTypes.quantidadeTotal,
          consomeCotaMeia: ticketTypes.consomeCotaMeia,
          vendida: ticketTypes.quantidadeVendida,
          reservada: ticketTypes.quantidadeReservada,
        })
        .from(ticketTypes)
        .where(
          ticketTypeId
            ? and(eq(ticketTypes.eventId, eventId), ne(ticketTypes.id, ticketTypeId))
            : eq(ticketTypes.eventId, eventId),
        );

      const consome = CONSOME_COTA[d.tipo] ?? false;

      // A soma dos lotes não pode passar da capacidade do evento.
      const todas = [...outros.map((o) => o.quantidadeTotal), d.quantidadeTotal];
      if (excedeCapacidade(todas, evento.capacidade)) {
        const usados = todas.reduce((a, b) => a + b, 0);
        throw new Error(
          `A soma dos lotes (${usados}) passa da capacidade do evento (${evento.capacidade}).`,
        );
      }

      // Cota de meia-entrada — Lei nº 12.933/2013.
      const meias = [
        ...outros.filter((o) => o.consomeCotaMeia).map((o) => o.quantidadeTotal),
        ...(consome ? [d.quantidadeTotal] : []),
      ];
      if (excedeCotaMeia(meias, evento.capacidade, evento.cotaMeiaBps)) {
        const teto = Math.floor((evento.capacidade * evento.cotaMeiaBps) / 10_000);
        throw new Error(
          `A meia-entrada é limitada a ${teto} ingressos (${evento.cotaMeiaBps / 100}% da capacidade).`,
        );
      }

      const valores = {
        nome: d.nome,
        descricao: d.descricao || null,
        precoCentavos,
        tipo: d.tipo,
        consomeCotaMeia: consome,
        quantidadeTotal: d.quantidadeTotal,
        limitePorPedido: d.limitePorPedido,
        vendasInicio: instante(d.vendasInicioData, d.vendasInicioHora),
        vendasFim: instante(d.vendasFimData, d.vendasFimHora),
        exigeDocumento: d.exigeDocumento ?? d.tipo === 'meia',
        atualizadoEm: new Date(),
      };

      if (ticketTypeId) {
        // Reduzir abaixo do já comprometido deixaria comprador sem lugar.
        const [atual] = await tx
          .select({
            vendida: ticketTypes.quantidadeVendida,
            reservada: ticketTypes.quantidadeReservada,
          })
          .from(ticketTypes)
          .where(eq(ticketTypes.id, ticketTypeId))
          .limit(1);

        const comprometidos = (atual?.vendida ?? 0) + (atual?.reservada ?? 0);
        if (d.quantidadeTotal < comprometidos) {
          throw new Error(
            `Já há ${comprometidos} ingressos vendidos ou reservados neste lote.`,
          );
        }

        await tx.update(ticketTypes).set(valores).where(eq(ticketTypes.id, ticketTypeId));
      } else {
        await tx.insert(ticketTypes).values({ ...valores, tenantId, eventId });
      }
    });
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não foi possível salvar o lote.' };
  }

  revalidatePath(`/painel/eventos/${eventId}`);
  return { ok: true };
}

export async function alternarLote(
  tenantId: string,
  eventId: string,
  ticketTypeId: string,
  ativo: boolean,
): Promise<void> {
  await contexto(tenantId);

  await withTenant(tenantId, async (tx) => {
    await tx
      .update(ticketTypes)
      .set({ ativo, atualizadoEm: new Date() })
      .where(and(eq(ticketTypes.id, ticketTypeId), eq(ticketTypes.eventId, eventId)));
  });

  revalidatePath(`/painel/eventos/${eventId}`);
}

// ---------------------------------------------------------------------------
// Cancelamento de evento
// ---------------------------------------------------------------------------

/**
 * Cancelar evento é irreversível e devolve dinheiro para todo mundo.
 *
 * Por isso três travas: papel de dono ou administrador, confirmação digitando
 * o título do evento, e justificativa obrigatória registrada no `audit_log`.
 * Um clique só não pode disparar isso.
 */
export async function cancelarEvento(
  tenantId: string,
  eventId: string,
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const justificativa = String(formData.get('justificativa') ?? '').trim();
  const confirmacao = String(formData.get('confirmacao') ?? '').trim();

  if (justificativa.length < 10) {
    return { erro: 'Explique o motivo do cancelamento em pelo menos 10 caracteres.' };
  }

  const auth = await getAuth();
  try {
    requireRole(auth, tenantId, 'admin');
  } catch (e) {
    return {
      erro:
        e instanceof AuthError
          ? 'Só o dono ou um administrador pode cancelar um evento.'
          : 'Sem permissão.',
    };
  }

  try {
    await withTenant(tenantId, async (tx) => {
      const [evento] = await tx
        .select({ titulo: events.titulo, status: events.status })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!evento) throw new Error('Evento não encontrado.');
      if (evento.status === 'cancelado') throw new Error('Este evento já está cancelado.');

      // Digitar o título é o que separa o clique acidental do deliberado.
      if (confirmacao !== evento.titulo) {
        throw new Error('Para confirmar, digite o título do evento exatamente como aparece.');
      }

      await tx
        .update(events)
        .set({
          status: 'cancelado',
          canceladoEm: new Date(),
          canceladoMotivo: justificativa,
          atualizadoEm: new Date(),
        })
        .where(eq(events.id, eventId));
    });
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não foi possível cancelar.' };
  }

  const db = serviceDb();

  await db.insert(auditLog).values({
    tenantId,
    userId: auth?.userId ?? null,
    acao: 'cancelar_evento',
    entidade: 'events',
    entidadeId: eventId,
    depois: { justificativa },
  });

  // O reembolso roda em lotes pela fila: um evento de mil pedidos não cabe
  // no tempo de uma requisição.
  await enfileirar(db, {
    nome: 'reembolso-automatico',
    tenantId,
    payload: { tenantId, eventId, solicitadoPor: auth?.userId },
    dedupeKey: `cancelamento:${eventId}`,
  });

  revalidatePath(`/painel/eventos/${eventId}`);
  revalidatePath('/painel');
  return { ok: true };
}

/** Reembolso avulso, a partir da tela do pedido. */
export async function reembolsarPedido(
  tenantId: string,
  orderId: string,
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const quantidade = Number.parseInt(String(formData.get('quantidade') ?? '0'), 10);
  const observacao = String(formData.get('observacao') ?? '').trim();
  const manual = formData.get('manual') === 'on';

  if (!Number.isInteger(quantidade) || quantidade < 1) {
    return { erro: 'Escolha quantos ingressos devolver.' };
  }

  const auth = await getAuth();
  try {
    requireRole(auth, tenantId, manual ? 'admin' : 'operador');
  } catch (e) {
    return {
      erro:
        e instanceof AuthError && manual
          ? 'Reembolso fora do prazo exige dono ou administrador.'
          : 'Sem permissão.',
    };
  }

  const { executarReembolso } = await import('@/lib/refunds');

  const r = await executarReembolso({
    tenantId,
    orderId,
    quantidade,
    motivo: 'buyer_request',
    manual,
    solicitadoPor: auth?.userId ?? null,
    observacao: observacao || undefined,
  });

  if (!r.ok) return { erro: r.erro };

  revalidatePath(`/painel/vendas/${orderId}`);
  return { ok: true };
}
