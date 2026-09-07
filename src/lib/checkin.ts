/**
 * Validação de ingresso na portaria — plano, seções 12 e 24.
 *
 * A regra que sustenta tudo: **a validação é idempotente e de uso único**.
 * O QR pode ser copiado — é uma imagem, e quem promete o contrário está
 * vendendo ilusão. O que impede a fraude é o primeiro a entrar entrar, e os
 * demais serem barrados com a hora e o nome de quem passou antes. É essa
 * informação que permite a conversa na porta.
 */
import 'server-only';

import { and, eq, ilike, or, sql } from 'drizzle-orm';

import { serviceDb, withTenant } from '@/db/client';
import { events, tickets, ticketTypes, users } from '@/db/schema';
import { normalizarCpf } from '@/domain/cpf';
import { hashToken, verificarToken } from '@/lib/tickets';

export type ResultadoCheckin =
  | {
      situacao: 'liberado';
      codigo: string;
      titular: string;
      titularCpf: string | null;
      lote: string;
      /** Evento nominal: a tela exige confirmação do documento. */
      exigeDocumento: boolean;
      ticketId: string;
    }
  | {
      situacao: 'duplicado';
      codigo: string;
      titular: string;
      /** Hora e operador da PRIMEIRA leitura — é o que resolve a discussão. */
      entrouEm: Date;
      entrouPor: string | null;
    }
  | { situacao: 'cancelado'; codigo: string; motivo: string | null }
  | { situacao: 'outro_evento'; codigo: string }
  | { situacao: 'invalido'; motivo: 'assinatura' | 'formato' | 'desconhecido' };

export type ContextoPortaria = {
  tenantId: string;
  eventId: string;
  userId: string;
  deviceId?: string | undefined;
};

/**
 * Lê o QR e libera a entrada.
 *
 * A ordem importa: primeiro a assinatura (barata, local, e derruba QR
 * fabricado sem tocar no banco), depois a consulta.
 */
export async function validarIngresso(
  token: string,
  ctx: ContextoPortaria,
  segredos: { atual: string; anterior?: string | undefined },
): Promise<ResultadoCheckin> {
  const verificacao = verificarToken(token, segredos);
  if (!verificacao.ok) {
    return { situacao: 'invalido', motivo: verificacao.motivo };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    /**
     * O UPDATE condicional é o coração da validação: só quem consegue mudar
     * `valido → usado` entrou. Duas leituras simultâneas em portões
     * diferentes disputam a mesma linha, e o Postgres garante que apenas uma
     * vence. Ler antes para depois decidir criaria a janela por onde os dois
     * passariam.
     */
    const liberados = (await tx.execute(sql`
      update tickets
         set status = 'usado',
             checked_in_em = now(),
             checked_in_by = ${ctx.userId},
             checked_in_device_id = ${ctx.deviceId ?? null},
             atualizado_em = now()
       where token_hash = ${verificacao.tokenHash}
         and event_id = ${ctx.eventId}
         and status = 'valido'
      returning id, codigo, titular_nome, titular_cpf, ticket_type_id
    `)) as unknown as {
      id: string;
      codigo: string;
      titular_nome: string;
      titular_cpf: string | null;
      ticket_type_id: string;
    }[];

    if (liberados.length > 0) {
      const t = liberados[0]!;

      const [detalhe] = await tx
        .select({ lote: ticketTypes.nome, nominal: events.ingressoNominal })
        .from(ticketTypes)
        .innerJoin(events, eq(events.id, ctx.eventId))
        .where(eq(ticketTypes.id, t.ticket_type_id))
        .limit(1);

      return {
        situacao: 'liberado' as const,
        ticketId: t.id,
        codigo: t.codigo,
        titular: t.titular_nome,
        titularCpf: t.titular_cpf,
        lote: detalhe?.lote ?? '—',
        exigeDocumento: detalhe?.nominal ?? false,
      };
    }

    // Não liberou: descobrir por quê, para a portaria saber o que dizer.
    const [existente] = await tx
      .select({
        codigo: tickets.codigo,
        titular: tickets.titularNome,
        status: tickets.status,
        eventId: tickets.eventId,
        checkedInEm: tickets.checkedInEm,
        checkedInBy: tickets.checkedInBy,
        motivo: tickets.canceladoMotivo,
      })
      .from(tickets)
      .where(eq(tickets.tokenHash, verificacao.tokenHash))
      .limit(1);

    if (!existente) return { situacao: 'invalido' as const, motivo: 'desconhecido' as const };

    if (existente.eventId !== ctx.eventId) {
      return { situacao: 'outro_evento' as const, codigo: existente.codigo };
    }

    if (existente.status === 'usado') {
      let operador: string | null = null;
      if (existente.checkedInBy) {
        const [u] = await serviceDb()
          .select({ nome: users.nome })
          .from(users)
          .where(eq(users.id, existente.checkedInBy))
          .limit(1);
        operador = u?.nome ?? null;
      }

      return {
        situacao: 'duplicado' as const,
        codigo: existente.codigo,
        titular: existente.titular,
        entrouEm: existente.checkedInEm ?? new Date(),
        entrouPor: operador,
      };
    }

    return {
      situacao: 'cancelado' as const,
      codigo: existente.codigo,
      motivo: existente.motivo,
    };
  });
}

/** Marca que o operador conferiu o documento — evento nominal. */
export async function confirmarDocumento(
  ticketId: string,
  ctx: ContextoPortaria,
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
  checkedInEm: Date | null;
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
        checkedInEm: tickets.checkedInEm,
      })
      .from(tickets)
      .where(and(eq(tickets.eventId, ctx.eventId), condicao))
      .orderBy(tickets.titularNome)
      .limit(20);
  });
}

/** Entrada manual pelo id, para quem foi encontrado na busca. */
export async function liberarPorId(
  ticketId: string,
  ctx: ContextoPortaria,
): Promise<ResultadoCheckin> {
  return withTenant(ctx.tenantId, async (tx) => {
    const linhas = (await tx.execute(sql`
      update tickets
         set status = 'usado', checked_in_em = now(),
             checked_in_by = ${ctx.userId},
             checked_in_device_id = ${ctx.deviceId ?? null},
             atualizado_em = now()
       where id = ${ticketId} and event_id = ${ctx.eventId} and status = 'valido'
      returning codigo, titular_nome, titular_cpf, ticket_type_id
    `)) as unknown as {
      codigo: string;
      titular_nome: string;
      titular_cpf: string | null;
      ticket_type_id: string;
    }[];

    if (linhas.length === 0) {
      return { situacao: 'invalido' as const, motivo: 'desconhecido' as const };
    }

    const t = linhas[0]!;
    const [detalhe] = await tx
      .select({ lote: ticketTypes.nome, nominal: events.ingressoNominal })
      .from(ticketTypes)
      .innerJoin(events, eq(events.id, ctx.eventId))
      .where(eq(ticketTypes.id, t.ticket_type_id))
      .limit(1);

    return {
      situacao: 'liberado' as const,
      ticketId,
      codigo: t.codigo,
      titular: t.titular_nome,
      titularCpf: t.titular_cpf,
      lote: detalhe?.lote ?? '—',
      exigeDocumento: detalhe?.nominal ?? false,
    };
  });
}

export type ContadorPortaria = { emitidos: number; presentes: number };

export async function contarPresentes(
  tenantId: string,
  eventId: string,
): Promise<ContadorPortaria> {
  return withTenant(tenantId, async (tx) => {
    const [linha] = await tx
      .select({
        emitidos: sql<number>`count(*) filter (where ${tickets.status} in ('valido','usado'))`,
        presentes: sql<number>`count(*) filter (where ${tickets.status} = 'usado')`,
      })
      .from(tickets)
      .where(eq(tickets.eventId, eventId));

    return {
      emitidos: Number(linha?.emitidos ?? 0),
      presentes: Number(linha?.presentes ?? 0),
    };
  });
}

/** Utilitário para o manifesto offline (Fase 3). */
export function hashDeToken(token: string): string {
  return hashToken(token);
}
