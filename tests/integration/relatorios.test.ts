/**
 * Relatórios do evento.
 *
 * São só leitura, mas erram calado — um relatório errado não quebra nada,
 * apenas leva o produtor a decidir errado a escala de bar e de segurança do
 * próximo evento. Por isso os testes montam uma noite com horário conhecido e
 * conferem a curva minuto a minuto.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  comparecimento,
  comparecimentoPorLote,
  curvaDaNoite,
  curvaDeVendas,
} from '@/lib/relatorios';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const donoSql = postgres(DIRECT_URL, { max: 2, prepare: false });
const dono = drizzle(donoSql);

let tenantId: string;
let venueId: string;
let eventId: string;
let orderId: string;
let pista: string;
let camarote: string;
let sufixo: string;

async function criarLote(nome: string, ordem: number): Promise<string> {
  const linhas = (await dono.execute(sql`
    insert into ticket_types (tenant_id, event_id, nome, preco_centavos, quantidade_total,
                              vendas_inicio, vendas_fim, ordem)
    values (${tenantId}, ${eventId}, ${nome}, 5000, 1000,
            now() - interval '30 days', now() + interval '30 days', ${ordem})
    returning id
  `)) as unknown as { id: string }[];
  return linhas[0]!.id;
}

/** Um ingresso, opcionalmente com entrada e saída em horários dados. */
async function criarIngresso(
  loteId: string,
  opcoes: { entrouEm?: string; saiuEm?: string } = {},
): Promise<string> {
  const entradas = opcoes.entrouEm ? 1 : 0;
  const dentro = Boolean(opcoes.entrouEm) && !opcoes.saiuEm;

  const linhas = (await dono.execute(sql`
    insert into tickets (tenant_id, order_id, ticket_type_id, event_id, codigo, token_hash,
                         titular_nome, status, dentro, entradas_count,
                         checked_in_em, ultima_entrada_em, ultima_saida_em)
    values (${tenantId}, ${orderId}, ${loteId}, ${eventId},
            ${'R' + Math.random().toString(36).slice(2, 10).toUpperCase()},
            ${'h' + Math.random().toString(36).slice(2)},
            'Pessoa', ${opcoes.entrouEm ? 'usado' : 'valido'},
            ${dentro}, ${entradas},
            ${opcoes.entrouEm ?? null}, ${opcoes.entrouEm ?? null}, ${opcoes.saiuEm ?? null})
    returning id
  `)) as unknown as { id: string }[];

  const ticketId = linhas[0]!.id;

  for (const [tipo, em] of [
    ['entrada', opcoes.entrouEm],
    ['saida', opcoes.saiuEm],
  ] as const) {
    if (!em) continue;
    await dono.execute(sql`
      insert into ticket_movimentos (tenant_id, event_id, ticket_id, tipo, em)
      values (${tenantId}, ${eventId}, ${ticketId}, ${tipo}, ${em}::timestamptz)
    `);
  }

  return ticketId;
}

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  const t = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'rel-' + sufixo}, 'Casa do Relatório', ${'rel-' + sufixo + '@teste.local'})
    returning id
  `)) as unknown as { id: string }[];
  tenantId = t[0]!.id;

  const v = (await dono.execute(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Casa', 1000) returning id
  `)) as unknown as { id: string }[];
  venueId = v[0]!.id;

  const e = (await dono.execute(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status, controla_saida)
    values (${tenantId}, ${venueId}, ${'rel-' + sufixo}, 'Noite do Relatório',
            now() - interval '1 day', now() - interval '18 hours', 1000, 'publicado', true)
    returning id
  `)) as unknown as { id: string }[];
  eventId = e[0]!.id;

  pista = await criarLote('Pista', 0);
  camarote = await criarLote('Camarote', 1);

  const o = (await dono.execute(sql`
    insert into orders (tenant_id, event_id, numero, comprador_nome, comprador_email,
                        comprador_cpf, subtotal_centavos, conveniencia_centavos,
                        total_centavos, valor_produtor_centavos, valor_operador_centavos,
                        taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
                        status, pago_em, idempotency_key)
    values (${tenantId}, ${eventId}, 1, 'Comprador', 'c@teste.local', '12345678901',
            10000, 1000, 11000, 9350, 1650, 1000, 500, 'paid',
            timestamptz '2026-09-01 15:00:00+00', ${'rel_' + sufixo})
    returning id
  `)) as unknown as { id: string }[];
  orderId = o[0]!.id;
});

afterAll(async () => {
  await dono.execute(sql`delete from ticket_movimentos where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tickets      where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from orders       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from ticket_types where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from events       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from venues       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tenants      where id = ${tenantId}`);
  await donoSql.end();
});

// ---------------------------------------------------------------------------

describe('curva da noite', () => {
  it('agrupa em faixas de quinze minutos e soma quem está dentro', async () => {
    // Três entram às 23h05, uma às 23h20, e uma das primeiras sai às 23h50.
    await criarIngresso(pista, { entrouEm: '2026-09-09T02:05:00Z' });
    await criarIngresso(pista, { entrouEm: '2026-09-09T02:07:00Z' });
    await criarIngresso(pista, {
      entrouEm: '2026-09-09T02:09:00Z',
      saiuEm: '2026-09-09T02:50:00Z',
    });
    await criarIngresso(camarote, { entrouEm: '2026-09-09T02:20:00Z' });

    const curva = await curvaDaNoite(tenantId, eventId);

    // 02:00–02:15 recebe as três primeiras; 02:15–02:30 a quarta.
    const primeira = curva[0]!;
    expect(primeira.entradas).toBe(3);
    expect(primeira.saidas).toBe(0);
    expect(primeira.dentro).toBe(3);

    const segunda = curva[1]!;
    expect(segunda.entradas).toBe(1);
    expect(segunda.dentro).toBe(4);

    // A faixa da saída derruba o acumulado — é o ponto do relatório.
    const comSaida = curva.find((p) => p.saidas > 0);
    expect(comSaida?.saidas).toBe(1);
    expect(comSaida?.dentro).toBe(3);
  });

  it('a soma corrida nunca anda para trás sem saída', async () => {
    const curva = await curvaDaNoite(tenantId, eventId);

    for (let i = 1; i < curva.length; i++) {
      const anterior = curva[i - 1]!;
      const atual = curva[i]!;
      if (atual.saidas === 0) {
        expect(atual.dentro).toBeGreaterThanOrEqual(anterior.dentro);
      }
    }
  });

  it('devolve vazio para evento sem movimento', async () => {
    const outro = (await dono.execute(sql`
      insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                          capacidade, status)
      values (${tenantId}, ${venueId}, ${'vazio-' + sufixo}, 'Sem ninguém',
              now() + interval '10 days', now() + interval '10 days 5 hours', 100, 'publicado')
      returning id
    `)) as unknown as { id: string }[];

    expect(await curvaDaNoite(tenantId, outro[0]!.id)).toEqual([]);
  });
});

describe('comparecimento', () => {
  it('conta quem apareceu e quem não', async () => {
    // Dois ingressos que ninguém usou.
    await criarIngresso(pista);
    await criarIngresso(camarote);

    const p = await comparecimento(tenantId, eventId);

    expect(p.emitidos).toBe(6);
    expect(p.compareceram).toBe(4);
    // 4 de 6 = 66,66%; arredondar para baixo é o que não esconde ausência.
    expect(p.taxaBps).toBe(6666);
  });

  it('registra a primeira e a última entrada', async () => {
    const p = await comparecimento(tenantId, eventId);

    expect(p.primeiraEntrada?.toISOString()).toBe('2026-09-09T02:05:00.000Z');
    expect(p.ultimaEntrada?.toISOString()).toBe('2026-09-09T02:20:00.000Z');
  });

  it('conta quem continua na casa', async () => {
    const p = await comparecimento(tenantId, eventId);
    // Quatro entraram, uma saiu.
    expect(p.dentroAgora).toBe(3);
  });

  it('não divide por zero em evento sem ingresso', async () => {
    const outro = (await dono.execute(sql`
      insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                          capacidade, status)
      values (${tenantId}, ${venueId}, ${'zero-' + sufixo}, 'Zero',
              now() + interval '20 days', now() + interval '20 days 5 hours', 100, 'publicado')
      returning id
    `)) as unknown as { id: string }[];

    expect(await comparecimento(tenantId, outro[0]!.id)).toMatchObject({
      emitidos: 0,
      compareceram: 0,
      taxaBps: 0,
    });
  });
});

describe('por lote', () => {
  it('separa presença por lote, na ordem do cadastro', async () => {
    const linhas = await comparecimentoPorLote(tenantId, eventId);

    expect(linhas.map((l) => l.nome)).toEqual(['Pista', 'Camarote']);
    expect(linhas[0]).toMatchObject({ emitidos: 4, compareceram: 3 });
    expect(linhas[1]).toMatchObject({ emitidos: 2, compareceram: 1 });
  });
});

describe('curva de vendas', () => {
  it('agrupa por dia de pagamento', async () => {
    const vendas = await curvaDeVendas(tenantId, eventId);

    expect(vendas).toHaveLength(1);
    expect(vendas[0]!.dia.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(vendas[0]!.pedidos).toBe(1);
    expect(vendas[0]!.brutoCentavos).toBe(11_000);
  });

  it('ignora pedido que não foi pago', async () => {
    await dono.execute(sql`
      insert into orders (tenant_id, event_id, numero, comprador_nome, comprador_email,
                          comprador_cpf, subtotal_centavos, conveniencia_centavos,
                          total_centavos, valor_produtor_centavos, valor_operador_centavos,
                          taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
                          status, idempotency_key)
      values (${tenantId}, ${eventId}, 99, 'Abandonou', 'a@teste.local', '12345678901',
              10000, 1000, 11000, 9350, 1650, 1000, 500, 'expired', ${'rel_x_' + sufixo})
    `);

    const vendas = await curvaDeVendas(tenantId, eventId);
    expect(vendas).toHaveLength(1);
  });
});
