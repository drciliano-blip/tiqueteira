/**
 * Lista de convidados contra o banco — ADR-012.
 *
 * O que esta suíte protege é dinheiro que não entrou. Cortesia é ingresso que
 * deixou de ser vendido, então cada furo aqui é receita perdida sem ninguém
 * perceber: o mesmo nome entrando duas vezes, a lista furando a capacidade do
 * espaço, ou um convidado de desconto saindo com cortesia na mão.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  adicionarNomes,
  admitirConvidado,
  alternarLista,
  buscarConvidados,
  convidadosDaLista,
  criarLista,
  listasDoEvento,
} from '@/lib/listas';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const donoSql = postgres(DIRECT_URL, { max: 2, prepare: false });
const dono = drizzle(donoSql);

let tenantId: string;
let venueId: string;
let userId: string;
let eventId: string;
let sufixo: string;

async function criarLote(total: number): Promise<string> {
  const linhas = (await dono.execute(sql`
    insert into ticket_types (tenant_id, event_id, nome, preco_centavos, quantidade_total,
                              vendas_inicio, vendas_fim)
    values (${tenantId}, ${eventId}, 'Pista', 10000, ${total},
            now() - interval '1 day', now() + interval '30 days')
    returning id
  `)) as unknown as { id: string }[];
  return linhas[0]!.id;
}

async function loteDe(ticketTypeId: string) {
  const linhas = (await dono.execute(sql`
    select quantidade_total, quantidade_vendida from ticket_types where id = ${ticketTypeId}
  `)) as unknown as { quantidade_total: number; quantidade_vendida: number }[];
  return linhas[0]!;
}

const ctx = () => ({ tenantId, eventId, userId, deviceId: 'teste' });

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  const t = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'lista-' + sufixo}, 'Lista Teste', 'lista@teste.local') returning id
  `)) as unknown as { id: string }[];
  tenantId = t[0]!.id;

  const u = (await dono.execute(sql`
    insert into users (nome, email, senha_hash)
    values ('Portaria Teste', ${'lista-' + sufixo + '@teste.local'}, 'x') returning id
  `)) as unknown as { id: string }[];
  userId = u[0]!.id;

  const v = (await dono.execute(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Espaço Teste', 1000) returning id
  `)) as unknown as { id: string }[];
  venueId = v[0]!.id;

  const e = (await dono.execute(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status)
    values (${tenantId}, ${venueId}, ${'ev-' + sufixo}, 'Festa da Lista',
            now() + interval '1 day', now() + interval '1 day 6 hours', 1000, 'publicado')
    returning id
  `)) as unknown as { id: string }[];
  eventId = e[0]!.id;
});

afterAll(async () => {
  await dono.execute(sql`delete from ticket_movimentos   where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from guest_list_entries  where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from guest_lists         where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tickets             where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from orders              where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from ticket_types        where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from events              where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from venues              where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tenants             where id        = ${tenantId}`);
  await dono.execute(sql`delete from users               where id        = ${userId}`);
  await donoSql.end();
});

async function listaCom(nomes: string, cota = 10, total = 100) {
  const ticketTypeId = await criarLote(total);
  const listaId = await criarLista(tenantId, {
    eventId,
    nome: 'Lista ' + Math.random().toString(36).slice(2, 7),
    promoterNome: 'Rafael',
    cota,
    ticketTypeId,
    validoAte: null,
  });
  const adicao = await adicionarNomes(tenantId, listaId, nomes);
  return { listaId, ticketTypeId, adicao };
}

// ---------------------------------------------------------------------------

describe('cota da lista', () => {
  it('aceita o que cabe e recusa o que passa da cota', async () => {
    const { adicao } = await listaCom('Ana Lima\nBruno Sá\nCaio Reis', 2);

    expect(adicao.adicionados).toBe(2);
    expect(adicao.recusados).toEqual([{ nome: 'Caio Reis', motivo: 'sem_cota' }]);
  });

  it('não deixa o mesmo nome entrar duas vezes na lista', async () => {
    const { listaId } = await listaCom('Ana Lima', 10);
    const segunda = await adicionarNomes(tenantId, listaId, 'ana   lima');

    expect(segunda.adicionados).toBe(0);
    expect(segunda.recusados[0]).toMatchObject({ motivo: 'duplicado' });
  });
});

describe('admissão na porta', () => {
  it('emite ingresso, consome estoque e já registra a entrada', async () => {
    const { listaId, ticketTypeId } = await listaCom('Marina Costa');
    const [convidado] = await convidadosDaLista(tenantId, listaId);

    const antes = await loteDe(ticketTypeId);
    const r = await admitirConvidado(convidado!.id, ctx());

    expect(r.admitido).toBe(true);
    if (!r.admitido) throw new Error('inesperado');
    expect(r.nome).toBe('Marina Costa');

    // O ingresso nasce usado e dentro da casa: a pessoa está atravessando a
    // porta agora, não vai escanear o próprio QR em seguida.
    const ingresso = (await dono.execute(sql`
      select status, dentro, entradas_count, titular_nome, order_id
        from tickets where id = ${r.ticketId}
    `)) as unknown as {
      status: string;
      dentro: boolean;
      entradas_count: number;
      titular_nome: string;
      order_id: string;
    }[];

    expect(ingresso[0]).toMatchObject({
      status: 'usado',
      dentro: true,
      entradas_count: 1,
      titular_nome: 'Marina Costa',
    });

    // Cortesia é pedido de valor zero pelo canal `lista`. Sem isso, ela não
    // aparece em relatório nenhum e o produtor nunca sabe quantas deu.
    const pedido = (await dono.execute(sql`
      select canal, metodo_externo, total_centavos, status
        from orders where id = ${ingresso[0]!.order_id}
    `)) as unknown as {
      canal: string;
      metodo_externo: string;
      total_centavos: number;
      status: string;
    }[];

    expect(pedido[0]).toMatchObject({
      canal: 'lista',
      metodo_externo: 'cortesia',
      total_centavos: 0,
      status: 'paid',
    });

    const movimentos = (await dono.execute(sql`
      select tipo from ticket_movimentos where ticket_id = ${r.ticketId}
    `)) as unknown as { tipo: string }[];
    expect(movimentos.map((m) => m.tipo)).toEqual(['entrada']);

    const depois = await loteDe(ticketTypeId);
    expect(depois.quantidade_vendida).toBe(antes.quantidade_vendida + 1);
  });

  it('seis portões buscando o mesmo nome → uma cortesia só', async () => {
    const { listaId, ticketTypeId } = await listaCom('João Pedro');
    const [convidado] = await convidadosDaLista(tenantId, listaId);

    const antes = await loteDe(ticketTypeId);
    const tentativas = await Promise.all(
      Array.from({ length: 6 }, () => admitirConvidado(convidado!.id, ctx())),
    );

    expect(tentativas.filter((r) => r.admitido)).toHaveLength(1);

    // O estoque não pode ter sido consumido seis vezes.
    const depois = await loteDe(ticketTypeId);
    expect(depois.quantidade_vendida).toBe(antes.quantidade_vendida + 1);
  });

  it('lista desativada não libera ninguém', async () => {
    const { listaId } = await listaCom('Clara Dias');
    await alternarLista(tenantId, listaId, false);
    const [convidado] = await convidadosDaLista(tenantId, listaId);

    const r = await admitirConvidado(convidado!.id, ctx());
    expect(r).toMatchObject({ admitido: false, motivo: 'lista_desativada' });
  });

  it('convidado de desconto não sai com cortesia', async () => {
    const ticketTypeId = await criarLote(100);
    const listaId = await criarLista(tenantId, {
      eventId,
      nome: 'Lista desconto ' + sufixo,
      promoterNome: null,
      cota: 10,
      ticketTypeId,
      validoAte: null,
    });
    await adicionarNomes(tenantId, listaId, 'Tiago Melo', 'desconto');
    const [convidado] = await convidadosDaLista(tenantId, listaId);

    const r = await admitirConvidado(convidado!.id, ctx());
    expect(r).toMatchObject({ admitido: false, motivo: 'nao_e_cortesia' });
  });

  it('lote esgotado barra a cortesia e devolve o nome à lista', async () => {
    // A capacidade do espaço é limite de bombeiro. A lista não fura.
    const ticketTypeId = await criarLote(1);
    const listaId = await criarLista(tenantId, {
      eventId,
      nome: 'Lista cheia ' + sufixo,
      promoterNome: null,
      cota: 10,
      ticketTypeId,
      validoAte: null,
    });
    await adicionarNomes(tenantId, listaId, 'Primeiro Nome\nSegundo Nome');

    const convidados = await convidadosDaLista(tenantId, listaId);
    expect((await admitirConvidado(convidados[0]!.id, ctx())).admitido).toBe(true);

    const segundo = await admitirConvidado(convidados[1]!.id, ctx());
    expect(segundo).toMatchObject({ admitido: false, motivo: 'lote_esgotado' });

    // Quem não entrou continua disponível: o nome não pode se perder porque a
    // casa estava cheia num momento.
    const depois = await convidadosDaLista(tenantId, listaId);
    expect(depois.find((c) => c.id === convidados[1]!.id)?.usadoEm).toBeNull();
  });

  it('a lista também expira por horário', async () => {
    const ticketTypeId = await criarLote(50);
    const listaId = await criarLista(tenantId, {
      eventId,
      nome: 'Lista até meia-noite ' + sufixo,
      promoterNome: null,
      cota: 5,
      ticketTypeId,
      validoAte: new Date(Date.now() - 60_000),
    });
    await adicionarNomes(tenantId, listaId, 'Atrasado Silva');
    const [convidado] = await convidadosDaLista(tenantId, listaId);

    const r = await admitirConvidado(convidado!.id, ctx());
    expect(r).toMatchObject({ admitido: false, motivo: 'lista_encerrada' });
  });
});

describe('busca na porta', () => {
  it('acha por parte do nome e mostra de qual lista veio', async () => {
    await listaCom('Fernanda Prado');

    const achados = await buscarConvidados('fernanda', { tenantId, eventId });
    expect(achados).toHaveLength(1);
    expect(achados[0]).toMatchObject({ nome: 'Fernanda Prado', promoterNome: 'Rafael' });
  });

  it('ignora termo curto, para não varrer a base a cada tecla', async () => {
    expect(await buscarConvidados('fe', { tenantId, eventId })).toEqual([]);
  });
});

describe('painel do produtor', () => {
  it('mostra cota usada e quantos apareceram', async () => {
    const { listaId } = await listaCom('Único Nome', 4);
    const [convidado] = await convidadosDaLista(tenantId, listaId);
    await admitirConvidado(convidado!.id, ctx());

    const listas = await listasDoEvento(tenantId, eventId);
    const alvo = listas.find((l) => l.id === listaId);

    expect(alvo?.cota).toMatchObject({ cota: 4, nomes: 1, vagas: 3, cheia: false });
    expect(alvo?.entraram).toBe(1);
  });
});
