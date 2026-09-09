/**
 * Validação de ingresso na portaria — plano, seções 12 e 24, e ADR-011.
 *
 * A regra que sustenta tudo: **a passagem é decidida por um UPDATE
 * condicional**, nunca por ler-e-depois-decidir. O QR pode ser copiado — é
 * uma imagem, e quem promete o contrário está vendendo ilusão. O que impede a
 * fraude é só uma leitura conseguir mudar a linha; as demais são barradas com
 * a hora e o nome de quem passou antes, que é a informação que resolve a
 * discussão na porta.
 *
 * Com controle de saída ligado, a mesma mecânica vale nos dois sentidos: só
 * um portão consegue marcar a saída, e só quem está fora consegue voltar.
 */
import 'server-only';

import { and, eq, ilike, or, sql } from 'drizzle-orm';

import { serviceDb, withTenant } from '@/db/client';
import { events, tickets, ticketTypes, users } from '@/db/schema';
import { normalizarCpf } from '@/domain/cpf';
import {
  avaliarMovimento,
  contarNaCasa,
  type MotivoRecusaPorta,
  type Movimento,
  type NumerosDaCasa,
  type PoliticaPortaria,
} from '@/domain/portaria';
import { hashToken, verificarToken } from '@/lib/tickets';

export type { Movimento } from '@/domain/portaria';

export type ResultadoCheckin =
  | {
      situacao: 'liberado';
      codigo: string;
      titular: string;
      titularCpf: string | null;
      lote: string;
      /** Voltou depois de ter saído. A tela diz isso ao segurança. */
      reentrada: boolean;
      /** Evento nominal: a tela exige confirmação do documento. */
      exigeDocumento: boolean;
      ticketId: string;
    }
  | {
      situacao: 'saida';
      codigo: string;
      titular: string;
      ticketId: string;
      /** A que horas entrou. Responde "faz quanto tempo que ela está aqui". */
      entrouEm: Date | null;
    }
  | {
      situacao: 'recusado';
      motivo: MotivoRecusaPorta;
      /** Frase pronta para a tela: já traz hora e circunstância. */
      explicacao: string;
      codigo: string;
      titular: string | null;
      /** Operador da primeira entrada, quando houver. */
      entrouPor: string | null;
    }
  | { situacao: 'outro_evento'; codigo: string }
  | { situacao: 'invalido'; motivo: 'assinatura' | 'formato' | 'desconhecido' };

export type ContextoPortaria = {
  tenantId: string;
  eventId: string;
  userId: string;
  deviceId?: string | undefined;
  politica: PoliticaPortaria;
  /** Evento nominal exige conferência de documento na entrada. */
  nominal: boolean;
};

/** Política e modo do evento, para a tela e para as ações. */
export async function politicaDoEvento(eventId: string): Promise<{
  tenantId: string;
  titulo: string;
  politica: PoliticaPortaria;
  nominal: boolean;
} | null> {
  const [e] = await serviceDb()
    .select({
      tenantId: events.tenantId,
      titulo: events.titulo,
      controlaSaida: events.controlaSaida,
      permiteReentrada: events.permiteReentrada,
      nominal: events.ingressoNominal,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!e) return null;

  return {
    tenantId: e.tenantId,
    titulo: e.titulo,
    politica: { controlaSaida: e.controlaSaida, permiteReentrada: e.permiteReentrada },
    nominal: e.nominal,
  };
}

type LinhaEntrada = {
  id: string;
  codigo: string;
  titular_nome: string;
  titular_cpf: string | null;
  ticket_type_id: string;
  entradas_count: number;
  ultima_entrada_em: string;
};

type LinhaSaida = {
  id: string;
  codigo: string;
  titular_nome: string;
  ultima_entrada_em: string | null;
  ultima_saida_em: string;
};

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Registra a passagem no livro da porta.
 *
 * `on conflict do nothing` sobre a chave natural (ingresso, tipo, hora): a
 * fila offline pode ser reenviada quantas vezes for preciso sem inflar o
 * histórico nem a curva de público.
 */
async function anotarMovimento(
  tx: Tx,
  ctx: ContextoPortaria,
  ticketId: string,
  tipo: Movimento,
  em: string,
  origem: 'online' | 'offline' = 'online',
): Promise<void> {
  await tx.execute(sql`
    insert into ticket_movimentos
      (tenant_id, event_id, ticket_id, tipo, em, operador_id, device_id, origem)
    values (${ctx.tenantId}, ${ctx.eventId}, ${ticketId}, ${tipo}, ${em}::timestamptz,
            ${ctx.userId}, ${ctx.deviceId ?? null}, ${origem})
    on conflict do nothing
  `);
}

/** Descobre por que a passagem não aconteceu, para a tela ter o que dizer. */
async function explicarRecusa(
  tx: Tx,
  ctx: ContextoPortaria,
  movimento: Movimento,
  onde: { tokenHash?: string; ticketId?: string },
): Promise<ResultadoCheckin> {
  const [existente] = await tx
    .select({
      codigo: tickets.codigo,
      titular: tickets.titularNome,
      status: tickets.status,
      eventId: tickets.eventId,
      dentro: tickets.dentro,
      entradasCount: tickets.entradasCount,
      ultimaEntradaEm: tickets.ultimaEntradaEm,
      ultimaSaidaEm: tickets.ultimaSaidaEm,
      checkedInEm: tickets.checkedInEm,
      checkedInBy: tickets.checkedInBy,
    })
    .from(tickets)
    .where(
      onde.ticketId ? eq(tickets.id, onde.ticketId) : eq(tickets.tokenHash, onde.tokenHash ?? ''),
    )
    .limit(1);

  if (!existente) return { situacao: 'invalido', motivo: 'desconhecido' };

  if (existente.eventId !== ctx.eventId) {
    return { situacao: 'outro_evento', codigo: existente.codigo };
  }

  const decisao = avaliarMovimento({
    movimento,
    politica: ctx.politica,
    estado: {
      status: existente.status,
      dentro: existente.dentro,
      entradasCount: existente.entradasCount,
      ultimaEntradaEm: existente.ultimaEntradaEm ?? existente.checkedInEm,
      ultimaSaidaEm: existente.ultimaSaidaEm,
    },
  });

  let entrouPor: string | null = null;
  if (existente.checkedInBy) {
    const [u] = await serviceDb()
      .select({ nome: users.nome })
      .from(users)
      .where(eq(users.id, existente.checkedInBy))
      .limit(1);
    entrouPor = u?.nome ?? null;
  }

  if (decisao.permitido) {
    /**
     * A máquina de estado aprova, mas o banco não deixou passar: outro portão
     * ganhou a corrida entre a tentativa e esta consulta. É exatamente o caso
     * que o UPDATE condicional existe para resolver, e a resposta honesta é
     * que este aparelho perdeu.
     */
    return {
      situacao: 'recusado',
      motivo: movimento === 'entrada' ? 'ja_entrou' : 'nao_esta_dentro',
      explicacao: 'Outro portão registrou esta passagem primeiro.',
      codigo: existente.codigo,
      titular: existente.titular,
      entrouPor,
    };
  }

  return {
    situacao: 'recusado',
    motivo: decisao.motivo,
    explicacao: decisao.explicacao,
    codigo: existente.codigo,
    titular: existente.titular,
    entrouPor,
  };
}

async function detalhe(
  tx: Tx,
  eventId: string,
  ticketTypeId: string,
): Promise<{ lote: string; nominal: boolean }> {
  const [d] = await tx
    .select({ lote: ticketTypes.nome, nominal: events.ingressoNominal })
    .from(ticketTypes)
    .innerJoin(events, eq(events.id, eventId))
    .where(eq(ticketTypes.id, ticketTypeId))
    .limit(1);

  return { lote: d?.lote ?? '—', nominal: d?.nominal ?? false };
}

/**
 * Lê o QR e registra a passagem no sentido pedido.
 *
 * A ordem importa: primeiro a assinatura (barata, local, e derruba QR
 * fabricado sem tocar no banco), depois o banco.
 */
export async function validarIngresso(
  token: string,
  ctx: ContextoPortaria,
  segredos: { atual: string; anterior?: string | undefined },
  movimento: Movimento = 'entrada',
): Promise<ResultadoCheckin> {
  const verificacao = verificarToken(token, segredos);
  if (!verificacao.ok) {
    return { situacao: 'invalido', motivo: verificacao.motivo };
  }

  return withTenant(ctx.tenantId, (tx) =>
    passar(tx, ctx, movimento, { tokenHash: verificacao.tokenHash }),
  );
}

/** Entrada ou saída manual pelo id, para quem foi encontrado na busca. */
export async function liberarPorId(
  ticketId: string,
  ctx: ContextoPortaria,
  movimento: Movimento = 'entrada',
): Promise<ResultadoCheckin> {
  return withTenant(ctx.tenantId, (tx) => passar(tx, ctx, movimento, { ticketId }));
}

async function passar(
  tx: Tx,
  ctx: ContextoPortaria,
  movimento: Movimento,
  onde: { tokenHash?: string; ticketId?: string },
): Promise<ResultadoCheckin> {
  const alvo = onde.ticketId
    ? sql`id = ${onde.ticketId}`
    : sql`token_hash = ${onde.tokenHash ?? ''}`;

  if (movimento === 'saida') {
    if (!ctx.politica.controlaSaida) {
      return explicarRecusa(tx, ctx, movimento, onde);
    }

    /**
     * `dentro = true` na cláusula: só sai quem está dentro, e apenas um
     * portão consegue. Duas leituras simultâneas na saída disputam a linha e
     * o Postgres decide — a segunda vira recusa explicada, não saída dupla.
     */
    const linhas = (await tx.execute(sql`
      update tickets
         set dentro = false,
             ultima_saida_em = now(),
             atualizado_em = now()
       where ${alvo}
         and event_id = ${ctx.eventId}
         and dentro = true
      returning id, codigo, titular_nome, ultima_entrada_em, ultima_saida_em
    `)) as unknown as LinhaSaida[];

    const t = linhas[0];
    if (!t) return explicarRecusa(tx, ctx, movimento, onde);

    await anotarMovimento(tx, ctx, t.id, 'saida', t.ultima_saida_em);

    return {
      situacao: 'saida',
      ticketId: t.id,
      codigo: t.codigo,
      titular: t.titular_nome,
      entrouEm: t.ultima_entrada_em ? new Date(t.ultima_entrada_em) : null,
    };
  }

  /**
   * Entrada. A condição carrega a política inteira:
   *
   * - `status = 'valido'` — primeira entrada, sempre permitida;
   * - reentrada — só com controle de saída ligado, reentrada permitida, e a
   *   pessoa comprovadamente FORA (`dentro = false`).
   *
   * Quem está dentro nunca passa por aqui. É a regra que impede o controle de
   * saída de virar a brecha que o controle de entrada fecha.
   */
  const podeReentrar = ctx.politica.controlaSaida && ctx.politica.permiteReentrada;

  const linhas = (await tx.execute(sql`
    update tickets
       set status = 'usado',
           dentro = true,
           checked_in_em = coalesce(checked_in_em, now()),
           checked_in_by = coalesce(checked_in_by, ${ctx.userId}),
           checked_in_device_id = coalesce(checked_in_device_id, ${ctx.deviceId ?? null}),
           ultima_entrada_em = now(),
           entradas_count = entradas_count + 1,
           atualizado_em = now()
     where ${alvo}
       and event_id = ${ctx.eventId}
       and (
         status = 'valido'
         or (${podeReentrar} and status = 'usado' and dentro = false)
       )
    returning id, codigo, titular_nome, titular_cpf, ticket_type_id,
              entradas_count, ultima_entrada_em
  `)) as unknown as LinhaEntrada[];

  const t = linhas[0];
  if (!t) return explicarRecusa(tx, ctx, movimento, onde);

  await anotarMovimento(tx, ctx, t.id, 'entrada', t.ultima_entrada_em);

  const d = await detalhe(tx, ctx.eventId, t.ticket_type_id);

  return {
    situacao: 'liberado',
    ticketId: t.id,
    codigo: t.codigo,
    titular: t.titular_nome,
    titularCpf: t.titular_cpf,
    lote: d.lote,
    reentrada: Number(t.entradas_count) > 1,
    exigeDocumento: d.nominal,
  };
}

/** Marca que o operador conferiu o documento — evento nominal. */
export async function confirmarDocumento(
  ticketId: string,
  ctx: Pick<ContextoPortaria, 'tenantId' | 'eventId'>,
): Promise<void> {
  await withTenant(ctx.tenantId, async (tx) => {
    await tx
      .update(tickets)
      .set({ documentoConferido: true, atualizadoEm: new Date() })
      .where(and(eq(tickets.id, ticketId), eq(tickets.eventId, ctx.eventId)));
  });
}

export type LinhaBusca = {
  id: string;
  codigo: string;
  titular: string;
  titularCpf: string | null;
  status: string;
  dentro: boolean;
  entradasCount: number;
  checkedInEm: Date | null;
  ultimaSaidaEm: Date | null;
};

/**
 * Busca manual por nome, CPF ou código.
 *
 * Existe para quem chegou sem bateria no celular, e é usada com fila atrás —
 * por isso devolve poucos resultados e ordena por nome.
 */
export async function buscarIngressos(
  termo: string,
  ctx: Pick<ContextoPortaria, 'tenantId' | 'eventId'>,
): Promise<LinhaBusca[]> {
  const limpo = termo.trim();
  if (limpo.length < 3) return [];

  const cpf = normalizarCpf(limpo);
  const like = `%${limpo}%`;

  return withTenant(ctx.tenantId, async (tx) => {
    const condicao = or(
      ilike(tickets.titularNome, like),
      ilike(tickets.codigo, `%${limpo.toUpperCase()}%`),
      ...(cpf.length >= 3 ? [ilike(tickets.titularCpf, `%${cpf}%`)] : []),
    );

    return tx
      .select({
        id: tickets.id,
        codigo: tickets.codigo,
        titular: tickets.titularNome,
        titularCpf: tickets.titularCpf,
        status: tickets.status,
        dentro: tickets.dentro,
        entradasCount: tickets.entradasCount,
        checkedInEm: tickets.checkedInEm,
        ultimaSaidaEm: tickets.ultimaSaidaEm,
      })
      .from(tickets)
      .where(and(eq(tickets.eventId, ctx.eventId), condicao))
      .orderBy(tickets.titularNome)
      .limit(20);
  });
}

export type ContadorPortaria = NumerosDaCasa;

export async function contarPresentes(
  tenantId: string,
  eventId: string,
): Promise<ContadorPortaria> {
  return withTenant(tenantId, async (tx) => {
    const [linha] = await tx
      .select({
        emitidos: sql<number>`count(*) filter (where ${tickets.status} in ('valido','usado'))`,
        entraram: sql<number>`count(*) filter (where ${tickets.entradasCount} > 0)`,
        dentro: sql<number>`count(*) filter (where ${tickets.dentro})`,
      })
      .from(tickets)
      .where(eq(tickets.eventId, eventId));

    return contarNaCasa({
      emitidos: Number(linha?.emitidos ?? 0),
      entraram: Number(linha?.entraram ?? 0),
      dentro: Number(linha?.dentro ?? 0),
    });
  });
}

/** Utilitário para o manifesto offline (Fase 3). */
export function hashDeToken(token: string): string {
  return hashToken(token);
}
