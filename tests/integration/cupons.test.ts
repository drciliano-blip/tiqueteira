/**
 * Cupons contra o banco.
 *
 * O teste central é o dos usos simultâneos. Um cupom de dez usos precisa
 * parar em dez, e dez pessoas clicando ao mesmo tempo é exatamente o cenário
 * em que ler-para-depois-decidir passa de dez. A diferença para o estoque é
 * que este furo não some no relatório: ele aparece como desconto que o
 * produtor não autorizou.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { conferirCupom, consumirCupom, criarCupom, devolverCupom } from '@/lib/cupons';

const DIRECT_URL = process.env.DIRECT_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DIRECT_URL || !DATABASE_URL) throw new Error('DIRECT_URL e DATABASE_URL são obrigatórias');

const donoSql = postgres(DIRECT_URL, { max: 2, prepare: false });
const dono = drizzle(donoSql);

/** Pool largo: a concorrência precisa ser real. */
const appSql = postgres(DATABASE_URL, { max: 25, prepare: false });
const app: PostgresJsDatabase = drizzle(appSql);

let tenantId: string;
let venueId: string;
let eventId: string;
let outroEventoId: string;
let sufixo: string;

async function usos(codigo: string): Promise<number> {
  const linhas = (await dono.execute(sql`
    select usos_atuais from coupons where tenant_id = ${tenantId} and upper(codigo) = ${codigo}
  `)) as unknown as { usos_atuais: number }[];
  return Number(linhas[0]?.usos_atuais ?? -1);
}

async function idDe(codigo: string): Promise<string> {
  const linhas = (await dono.execute(sql`
    select id from coupons where tenant_id = ${tenantId} and upper(codigo) = ${codigo}
  `)) as unknown as { id: string }[];
  return linhas[0]!.id;
}

/** Consome pelo papel da aplicação, numa transação, como o pedido faz. */
async function consumir(codigo: string, subtotal = 10_000, evento = eventId) {
  return app.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return consumirCupom(tx, { tenantId, eventId: evento, codigo, subtotalCentavos: subtotal });
  });
}

beforeAll(async () => {
  sufixo = Date.now().toString(36).toUpperCase();

  const t = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'cupom-' + sufixo.toLowerCase()}, 'Casa do Cupom',
            ${'cupom-' + sufixo.toLowerCase() + '@teste.local'})
    returning id
  `)) as unknown as { id: string }[];
  tenantId = t[0]!.id;

  const v = (await dono.execute(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Casa', 1000) returning id
  `)) as unknown as { id: string }[];
  venueId = v[0]!.id;

  const criarEvento = async (slug: string) => {
    const e = (await dono.execute(sql`
      insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                          capacidade, status)
      values (${tenantId}, ${venueId}, ${slug}, 'Evento', now() + interval '3 days',
              now() + interval '3 days 5 hours', 1000, 'publicado')
      returning id
    `)) as unknown as { id: string }[];
    return e[0]!.id;
  };

  eventId = await criarEvento('cup-a-' + sufixo.toLowerCase());
  outroEventoId = await criarEvento('cup-b-' + sufixo.toLowerCase());
});

afterAll(async () => {
  await dono.execute(sql`delete from coupons where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from events  where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from venues  where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tenants where id = ${tenantId}`);
  await donoSql.end();
  await appSql.end();
});

async function novo(codigo: string, extras: Partial<Parameters<typeof criarCupom>[0]> = {}) {
  const r = await criarCupom({
    tenantId,
    eventId: null,
    codigo,
    tipo: 'pct',
    valor: 1000,
    usosMaximos: null,
    validoAte: null,
    ...extras,
  });
  if (!r.ok) throw new Error(r.erro);
  return r;
}

// ---------------------------------------------------------------------------

describe('uso sob concorrência', () => {
  it('cupom de dez usos para em dez, com cinquenta tentando junto', async () => {
    const codigo = 'DEZ' + sufixo;
    await novo(codigo, { usosMaximos: 10 });

    const resultados = await Promise.all(
      Array.from({ length: 50 }, () => consumir(codigo)),
    );

    expect(resultados.filter((r) => r.ok)).toHaveLength(10);
    expect(await usos(codigo)).toBe(10);
  });

  it('cupom sem limite aceita todo mundo', async () => {
    const codigo = 'LIVRE' + sufixo;
    await novo(codigo);

    const resultados = await Promise.all(Array.from({ length: 20 }, () => consumir(codigo)));

    expect(resultados.filter((r) => r.ok)).toHaveLength(20);
    expect(await usos(codigo)).toBe(20);
  });
});

describe('recusas', () => {
  it('recusa cupom desativado', async () => {
    const codigo = 'OFF' + sufixo;
    await novo(codigo);
    await dono.execute(sql`
      update coupons set ativo = false where tenant_id = ${tenantId} and upper(codigo) = ${codigo}
    `);

    expect((await consumir(codigo)).ok).toBe(false);
    expect(await usos(codigo)).toBe(0);
  });

  it('recusa cupom vencido', async () => {
    const codigo = 'VELHO' + sufixo;
    await novo(codigo, { validoAte: new Date(Date.now() - 60_000) });

    expect((await consumir(codigo)).ok).toBe(false);
  });

  it('cupom preso a um evento não vale no outro', async () => {
    const codigo = 'SOAQUI' + sufixo;
    await novo(codigo, { eventId });

    expect((await consumir(codigo, 10_000, outroEventoId)).ok).toBe(false);
    expect((await consumir(codigo, 10_000, eventId)).ok).toBe(true);
  });

  it('recusa código que não existe, sem dizer que não existe', async () => {
    const r = await consumir('NAOEXISTE' + sufixo);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inesperado');
    // A mesma frase de sempre: distinguir ensina quem está adivinhando.
    expect(r.explicacao).toBe('Cupom inválido ou expirado.');
  });
});

describe('valor do desconto', () => {
  it('percentual sai em centavos fechados', async () => {
    const codigo = 'PCT' + sufixo;
    await novo(codigo, { tipo: 'pct', valor: 1500 });

    const r = await consumir(codigo, 10_000);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inesperado');
    expect(r.cupom.descontoCentavos).toBe(1500);
  });

  it('valor fixo nunca passa do subtotal', async () => {
    // Total negativo quebraria o invariante de que o split fecha com o total.
    const codigo = 'FIXO' + sufixo;
    await novo(codigo, { tipo: 'valor', valor: 5000 });

    const r = await consumir(codigo, 3000);
    if (!r.ok) throw new Error('inesperado');
    expect(r.cupom.descontoCentavos).toBe(3000);
  });
});

describe('devolução', () => {
  it('carrinho abandonado devolve o uso', async () => {
    const codigo = 'VOLTA' + sufixo;
    await novo(codigo, { usosMaximos: 1 });

    expect((await consumir(codigo)).ok).toBe(true);
    expect((await consumir(codigo)).ok).toBe(false);

    await devolverCupom(dono, await idDe(codigo));

    expect(await usos(codigo)).toBe(0);
    expect((await consumir(codigo)).ok).toBe(true);
  });

  it('devolver demais não deixa o contador negativo', async () => {
    const codigo = 'ZERO' + sufixo;
    await novo(codigo);

    const id = await idDe(codigo);
    await devolverCupom(dono, id);
    await devolverCupom(dono, id);

    expect(await usos(codigo)).toBe(0);
  });
});

describe('conferência sem consumir', () => {
  it('mostra o desconto sem gastar uso', async () => {
    const codigo = 'ESPIA' + sufixo;
    await novo(codigo, { tipo: 'valor', valor: 1234, usosMaximos: 1 });

    const r = await conferirCupom({
      tenantId,
      eventId,
      codigo: codigo.toLowerCase(),
      subtotalCentavos: 10_000,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inesperado');
    expect(r.cupom.descontoCentavos).toBe(1234);
    // O uso continua disponível para quem realmente comprar.
    expect(await usos(codigo)).toBe(0);
  });
});
