/**
 * Lista de convidados — plano, seção 23.2, e ADR-012.
 *
 * O caminho inteiro da cortesia acontece na porta, numa transação só:
 * reserva o nome, consome o estoque, emite o ingresso, registra a entrada.
 * Emitir o ingresso e pedir para o segurança escaneá-lo em seguida seria
 * absurdo com fila atrás — a pessoa está ali, na frente dele, agora.
 *
 * Cortesia consome estoque como qualquer ingresso. É o que impede a lista de
 * furar a capacidade do espaço, que é limite de bombeiro, não de bilheteria.
 */
import 'server-only';

import { and, asc, eq, ilike, sql } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import { guestListEntries, guestLists, ticketTypes } from '@/db/schema';
import {
  avaliarConvidado,
  separarNomes,
  situacaoDaCota,
  type MotivoRecusaLista,
  type NomeRecusado,
  type SituacaoCota,
} from '@/domain/lista-convidados';
import { env } from '@/lib/env';
import { emitirTicket } from '@/lib/tickets';


export type ListaComUso = {
  id: string;
  nome: string;
  promoterNome: string | null;
  ticketTypeId: string | null;
  loteNome: string | null;
  validoAte: Date | null;
  ativo: boolean;
  cota: SituacaoCota;
  entraram: number;
};

export async function listasDoEvento(
  tenantId: string,
  eventId: string,
): Promise<ListaComUso[]> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({
        id: guestLists.id,
        nome: guestLists.nome,
        promoterNome: guestLists.promoterNome,
        ticketTypeId: guestLists.ticketTypeId,
        loteNome: ticketTypes.nome,
        validoAte: guestLists.validoAte,
        ativo: guestLists.ativo,
        cota: guestLists.cota,
        nomes: sql<number>`(
          select count(*) from guest_list_entries e where e.guest_list_id = ${guestLists.id}
        )`,
        entraram: sql<number>`(
          select count(*) from guest_list_entries e
           where e.guest_list_id = ${guestLists.id} and e.usado_em is not null
        )`,
      })
      .from(guestLists)
      .leftJoin(ticketTypes, eq(ticketTypes.id, guestLists.ticketTypeId))
      .where(eq(guestLists.eventId, eventId))
      .orderBy(asc(guestLists.nome));

    return linhas.map((l) => ({
      id: l.id,
      nome: l.nome,
      promoterNome: l.promoterNome,
      ticketTypeId: l.ticketTypeId,
      loteNome: l.loteNome,
      validoAte: l.validoAte,
      ativo: l.ativo,
      cota: situacaoDaCota(l.cota, Number(l.nomes)),
      entraram: Number(l.entraram),
    }));
  });
}

export type ConvidadoDaLista = {
  id: string;
  nome: string;
  cpf: string | null;
  tipo: string;
  usadoEm: Date | null;
};

export async function convidadosDaLista(
  tenantId: string,
  listaId: string,
): Promise<ConvidadoDaLista[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: guestListEntries.id,
        nome: guestListEntries.nome,
        cpf: guestListEntries.cpf,
        tipo: guestListEntries.tipo,
        usadoEm: guestListEntries.usadoEm,
      })
      .from(guestListEntries)
      .where(eq(guestListEntries.guestListId, listaId))
      .orderBy(asc(guestListEntries.nome)),
  );
}

export async function criarLista(
  tenantId: string,
  dados: {
    eventId: string;
    nome: string;
    promoterNome: string | null;
    cota: number;
    ticketTypeId: string;
    validoAte: Date | null;
  },
): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [criada] = await tx
      .insert(guestLists)
      .values({ tenantId, ...dados })
      .returning({ id: guestLists.id });

    return criada!.id;
  });
}

export async function alternarLista(
  tenantId: string,
  listaId: string,
  ativo: boolean,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(guestLists)
      .set({ ativo, atualizadoEm: new Date() })
      .where(eq(guestLists.id, listaId)),
  );
}

/** Só sai da lista quem ainda não entrou: histórico de porta não se apaga. */
export async function removerConvidado(tenantId: string, entradaId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const apagadas = await tx
      .delete(guestListEntries)
      .where(and(eq(guestListEntries.id, entradaId), sql`usado_em is null`))
      .returning({ id: guestListEntries.id });

    return apagadas.length > 0;
  });
}

export type ResultadoAdicao = { adicionados: number; recusados: NomeRecusado[] };

/**
 * Adiciona uma colagem de nomes.
 *
 * O promoter cola trinta nomes vindos do WhatsApp. Recusar o lote inteiro por
 * causa de dois repetidos faria ele voltar para o papel — então entra o que
 * cabe, e a tela diz nome por nome o que ficou de fora.
 */
export async function adicionarNomes(
  tenantId: string,
  listaId: string,
  texto: string,
  tipo: 'cortesia' | 'desconto' = 'cortesia',
): Promise<ResultadoAdicao> {
  return withTenant(tenantId, async (tx) => {
    const [lista] = await tx
      .select({ eventId: guestLists.eventId, cota: guestLists.cota })
      .from(guestLists)
      .where(eq(guestLists.id, listaId))
      .limit(1);

    if (!lista) return { adicionados: 0, recusados: [] };

    const existentes = await tx
      .select({ nome: guestListEntries.nome })
      .from(guestListEntries)
      .where(eq(guestListEntries.guestListId, listaId));

    const { vagas } = situacaoDaCota(lista.cota, existentes.length);

    const { aceitos, recusados } = separarNomes(
      texto.split(/[\n;]/),
      existentes.map((e) => e.nome),
      vagas,
    );

    if (aceitos.length > 0) {
      await tx.insert(guestListEntries).values(
        aceitos.map((nome) => ({
          tenantId,
          guestListId: listaId,
          eventId: lista.eventId,
          nome,
          tipo,
        })),
      );
    }

    return { adicionados: aceitos.length, recusados };
  });
}

// ---------------------------------------------------------------------------
// Porta
// ---------------------------------------------------------------------------

export type ConvidadoNaPorta = {
  id: string;
  nome: string;
  cpf: string | null;
  tipo: string;
  listaNome: string;
  promoterNome: string | null;
  usadoEm: Date | null;
  listaAtiva: boolean;
};

/** Busca por nome na porta, em todas as listas do evento. */
export async function buscarConvidados(
  termo: string,
  ctx: { tenantId: string; eventId: string },
): Promise<ConvidadoNaPorta[]> {
  const limpo = termo.trim();
  if (limpo.length < 3) return [];

  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: guestListEntries.id,
        nome: guestListEntries.nome,
        cpf: guestListEntries.cpf,
        tipo: guestListEntries.tipo,
        listaNome: guestLists.nome,
        promoterNome: guestLists.promoterNome,
        usadoEm: guestListEntries.usadoEm,
        listaAtiva: guestLists.ativo,
      })
      .from(guestListEntries)
      .innerJoin(guestLists, eq(guestLists.id, guestListEntries.guestListId))
      .where(
        and(
          eq(guestListEntries.eventId, ctx.eventId),
          ilike(guestListEntries.nome, `%${limpo}%`),
        ),
      )
      .orderBy(asc(guestListEntries.nome))
      .limit(20),
  );
}

export type ResultadoAdmissao =
  | {
      admitido: true;
      nome: string;
      codigo: string;
      listaNome: string;
      /** O ingresso já nasce usado: a pessoa está entrando agora. */
      ticketId: string;
    }
  | {
      admitido: false;
      motivo: MotivoRecusaLista | 'lote_esgotado' | 'sem_lote' | 'nao_encontrado';
      explicacao: string;
      nome: string | null;
    };

/**
 * Admite o convidado: emite o ingresso e registra a entrada, tudo junto.
 *
 * A garantia de uso único é o `UPDATE` condicional em `usado_em is null` — o
 * mesmo padrão da leitura de QR, pelo mesmo motivo: dois portões buscando o
 * mesmo nome ao mesmo tempo, e só um pode ganhar.
 */
export async function admitirConvidado(
  entradaId: string,
  ctx: { tenantId: string; eventId: string; userId: string; deviceId?: string | undefined },
): Promise<ResultadoAdmissao> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [dados] = await tx
      .select({
        nome: guestListEntries.nome,
        cpf: guestListEntries.cpf,
        tipo: guestListEntries.tipo,
        usadoEm: guestListEntries.usadoEm,
        listaId: guestLists.id,
        listaNome: guestLists.nome,
        listaAtiva: guestLists.ativo,
        cota: guestLists.cota,
        validoAte: guestLists.validoAte,
        ticketTypeId: guestLists.ticketTypeId,
      })
      .from(guestListEntries)
      .innerJoin(guestLists, eq(guestLists.id, guestListEntries.guestListId))
      .where(
        and(eq(guestListEntries.id, entradaId), eq(guestListEntries.eventId, ctx.eventId)),
      )
      .limit(1);

    if (!dados) {
      return {
        admitido: false as const,
        motivo: 'nao_encontrado' as const,
        explicacao: 'Este nome não está em nenhuma lista deste evento.',
        nome: null,
      };
    }

    const decisao = avaliarConvidado({
      lista: { ativo: dados.listaAtiva, cota: dados.cota, validoAte: dados.validoAte },
      entrada: { tipo: dados.tipo, usadoEm: dados.usadoEm },
      agora: new Date(),
    });

    if (!decisao.permitido) {
      return {
        admitido: false as const,
        motivo: decisao.motivo,
        explicacao: decisao.explicacao,
        nome: dados.nome,
      };
    }

    if (!dados.ticketTypeId) {
      return {
        admitido: false as const,
        motivo: 'sem_lote' as const,
        explicacao: 'Esta lista não tem lote definido. Avise o produtor.',
        nome: dados.nome,
      };
    }

    /**
     * Reserva o nome antes de qualquer outra coisa. Se outro portão chegou
     * primeiro, nada mais acontece — nenhum ingresso emitido, nenhum estoque
     * consumido, nenhum pedido órfão.
     */
    const reservadas = (await tx.execute(sql`
      update guest_list_entries
         set usado_em = now(), checked_in_by = ${ctx.userId}, atualizado_em = now()
       where id = ${entradaId} and usado_em is null
      returning id
    `)) as unknown as { id: string }[];

    if (reservadas.length === 0) {
      return {
        admitido: false as const,
        motivo: 'ja_entrou' as const,
        explicacao: 'Outro portão acabou de liberar este nome.',
        nome: dados.nome,
      };
    }

    /**
     * Cortesia consome estoque. A condição no `WHERE` é o que impede a lista
     * de furar a capacidade do espaço — que é limite de bombeiro, não de
     * bilheteria.
     */
    const consumidas = (await tx.execute(sql`
      update ticket_types
         set quantidade_vendida = quantidade_vendida + 1, atualizado_em = now()
       where id = ${dados.ticketTypeId}
         and quantidade_vendida + quantidade_reservada < quantidade_total
      returning id
    `)) as unknown as { id: string }[];

    if (consumidas.length === 0) {
      // Devolve o nome à lista: ele não entrou, e vai precisar dele de novo.
      await tx.execute(sql`
        update guest_list_entries set usado_em = null, checked_in_by = null
         where id = ${entradaId}
      `);

      return {
        admitido: false as const,
        motivo: 'lote_esgotado' as const,
        explicacao: 'O lote desta lista esgotou. A casa está na capacidade.',
        nome: dados.nome,
      };
    }

    const numero = (await tx.execute(sql`
      select coalesce(max(numero), 0) + 1 as proximo
        from orders where tenant_id = ${ctx.tenantId}
    `)) as unknown as { proximo: number }[];

    const pedidos = (await tx.execute(sql`
      insert into orders
        (tenant_id, event_id, numero, comprador_nome, comprador_cpf,
         subtotal_centavos, conveniencia_centavos, total_centavos,
         valor_produtor_centavos, valor_operador_centavos,
         taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
         canal, metodo_externo, status, pago_em, idempotency_key)
      values (${ctx.tenantId}, ${ctx.eventId}, ${numero[0]!.proximo},
              ${dados.nome}, ${dados.cpf},
              0, 0, 0, 0, 0, 0, 0,
              'lista', 'cortesia', 'paid', now(), ${'lista_' + entradaId})
      returning id
    `)) as unknown as { id: string }[];

    const orderId = pedidos[0]!.id;
    const emitido = emitirTicket(env().TICKET_HMAC_SECRET);

    /**
     * O ingresso nasce `usado` e dentro da casa: a pessoa está atravessando a
     * porta agora. Emitir válido e pedir para o segurança escaneá-lo em
     * seguida seria trabalho inventado, com fila atrás.
     */
    const ingressos = (await tx.execute(sql`
      insert into tickets
        (tenant_id, order_id, ticket_type_id, event_id, codigo, token_hash,
         titular_nome, titular_cpf, status, dentro, entradas_count,
         checked_in_em, ultima_entrada_em, checked_in_by, checked_in_device_id)
      values (${ctx.tenantId}, ${orderId}, ${dados.ticketTypeId}, ${ctx.eventId},
              ${emitido.codigo}, ${emitido.tokenHash}, ${dados.nome}, ${dados.cpf},
              'usado', true, 1, now(), now(), ${ctx.userId}, ${ctx.deviceId ?? null})
      returning id, ultima_entrada_em
    `)) as unknown as { id: string; ultima_entrada_em: string }[];

    const ticket = ingressos[0]!;

    await tx.execute(sql`
      insert into ticket_movimentos
        (tenant_id, event_id, ticket_id, tipo, em, operador_id, device_id, origem)
      values (${ctx.tenantId}, ${ctx.eventId}, ${ticket.id}, 'entrada',
              ${ticket.ultima_entrada_em}::timestamptz, ${ctx.userId},
              ${ctx.deviceId ?? null}, 'online')
      on conflict do nothing
    `);

    await tx.execute(sql`
      update guest_list_entries set ticket_id = ${ticket.id} where id = ${entradaId}
    `);

    return {
      admitido: true as const,
      nome: dados.nome,
      codigo: emitido.codigo,
      listaNome: dados.listaNome,
      ticketId: ticket.id,
    };
  });
}

/** Lotes disponíveis para vincular a uma lista. */
export async function lotesDoEvento(
  tenantId: string,
  eventId: string,
): Promise<{ id: string; nome: string }[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: ticketTypes.id, nome: ticketTypes.nome })
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, eventId))
      .orderBy(asc(ticketTypes.ordem)),
  );
}

