/**
 * Bilheteria física contra o banco.
 *
 * O que esta suíte protege é a capacidade do espaço. A bilheteria é o caminho
 * mais fácil de furar a lotação: o balconista está com fila na frente, e a
 * tentação de "deixa passar mais um" é constante. Quem tem que dizer não é o
 * `UPDATE` condicional, não a pessoa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { fechamentoDeCaixa, lotesDeBalcao, venderNaBilheteria } from '@/lib/pdv';
import { verificarToken } from '@/lib/tickets';

const DIRECT_URL = process.env.DIRECT_URL;
const SEGREDO = process.env.TICKET_HMAC_SECRET;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');
if (!SEGREDO) throw new Error('TICKET_HMAC_SECRET é obrigatória');

const donoSql = postgres(DIRECT_URL, { max: 3, prepare: false });
const dono = drizzle(donoSql) as PostgresJsDatabase;

let tenantId: string;
let venueId: string;
let eventId: string;
let userId: string;
let sufixo: string;

async function criarLote(total: number, preco = 5000, nome = 'Pista'): Promise<string> {
  const linhas = (await dono.execute(sql`
    insert into ticket_types (tenant_id, event_id, nome, preco_centavos, quantidade_total,
                              vendas_inicio, vendas_fim)
    values (${tenantId}, ${eventId}, ${nome}, ${preco}, ${total},
            now() - interval '1 day', now() + interval '30 days')
    returning id
  `)) as unknown as { id: string }[];
  return linhas[0]!.id;
}

async function vender(ticketTypeId: string, extras: Record<string, unknown> = {}) {
  return venderNaBilheteria({
    tenantId,
    eventId,
    ticketTypeId,
    quantidade: 1,
    metodo: 'dinheiro',
    compradorNome: 'Cliente do Balcão',
    compradorCpf: null,
    jaEntrou: false,
    userId,
    ...extras,
  } as Parameters<typeof venderNaBilheteria>[0]);
}

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  const t = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'pdv-' + sufixo}, 'Casa do Balcão', ${'pdv-' + sufixo + '@teste.local'})
    returning id
  `)) as unknown as { id: string }[];
  tenantId = t[0]!.id;

  const u = (await dono.execute(sql`
    insert into users (nome, email, senha_hash)
    values ('Balconista', ${'balcao-' + sufixo + '@teste.local'}, 'x') returning id
  `)) as unknown as { id: string }[];
  userId = u[0]!.id;

  const v = (await dono.execute(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Casa', 1000) returning id
  `)) as unknown as { id: string }[];
  venueId = v[0]!.id;

  const e = (await dono.execute(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status, controla_saida)
    values (${tenantId}, ${venueId}, ${'pdv-' + sufixo}, 'Evento de Balcão',
            now() + interval '1 day', now() + interval '1 day 6 hours', 1000, 'publicado', true)
    returning id
  `)) as unknown as { id: string }[];
  eventId = e[0]!.id;
});

afterAll(async () => {
  await dono.execute(sql`delete from ticket_movimentos where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tickets      where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from order_items  where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from orders       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from ticket_types where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from events       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from venues       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tenants      where id = ${tenantId}`);
  await dono.execute(sql`delete from users        where id = ${userId}`);
  await donoSql.end();
});

// ---------------------------------------------------------------------------

describe('venda de balcão', () => {
  it('emite ingresso com QR que a portaria consegue validar', async () => {
    // Ingresso de bilheteria com QR inválido seria descoberto na porta, com a
    // pessoa já dentro da casa e sem como provar que pagou.
    const tipoId = await criarLote(100);
    const r = await vender(tipoId, { quantidade: 2 });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inesperado');
    expect(r.ingressos).toHaveLength(2);

    for (const ingresso of r.ingressos) {
      const v = verificarToken(ingresso.token, { atual: SEGREDO! });
      expect(v.ok).toBe(true);
    }

    expect(r.totalCentavos).toBe(10_000);
  });

  it('consome estoque como qualquer venda', async () => {
    const tipoId = await criarLote(10);
    await vender(tipoId, { quantidade: 3 });

    const [lote] = await lotesDeBalcao(tenantId, eventId).then((ls) =>
      ls.filter((l) => l.id === tipoId),
    );
    expect(lote?.disponivel).toBe(7);
  });

  it('não vende além da capacidade do lote', async () => {
    const tipoId = await criarLote(2);

    expect((await vender(tipoId, { quantidade: 2 })).ok).toBe(true);
    const estourou = await vender(tipoId, { quantidade: 1 });

    expect(estourou.ok).toBe(false);
  });

  it('recusa o pedido inteiro quando não cabe tudo', async () => {
    // Vender três quando só há dois deixaria a bilheteria explicando na porta
    // o que o sistema deveria ter impedido no balcão.
    const tipoId = await criarLote(2);
    const r = await vender(tipoId, { quantidade: 3 });

    expect(r.ok).toBe(false);
    const [lote] = await lotesDeBalcao(tenantId, eventId).then((ls) =>
      ls.filter((l) => l.id === tipoId),
    );
    expect(lote?.disponivel).toBe(2);
  });

  it('cortesia sai por zero e ainda ocupa lugar', async () => {
    const tipoId = await criarLote(10, 8000, 'Camarote');
    const r = await vender(tipoId, { metodo: 'cortesia', quantidade: 2 });

    if (!r.ok) throw new Error('inesperado');
    expect(r.totalCentavos).toBe(0);

    const [lote] = await lotesDeBalcao(tenantId, eventId).then((ls) =>
      ls.filter((l) => l.id === tipoId),
    );
    // A capacidade do espaço não distingue quem pagou.
    expect(lote?.disponivel).toBe(8);
  });

  it('a venda inteira vai para o produtor', async () => {
    // A plataforma não tocou neste dinheiro e não tem o que reter dele.
    const tipoId = await criarLote(10);
    const r = await vender(tipoId);
    if (!r.ok) throw new Error('inesperado');

    const pedidos = (await dono.execute(sql`
      select canal, metodo_externo, status, valor_produtor_centavos, valor_operador_centavos,
             total_centavos, vendido_por
        from orders where id = ${r.orderId}
    `)) as unknown as {
      canal: string;
      metodo_externo: string;
      status: string;
      valor_produtor_centavos: number;
      valor_operador_centavos: number;
      total_centavos: number;
      vendido_por: string;
    }[];

    expect(pedidos[0]).toMatchObject({
      canal: 'pdv',
      metodo_externo: 'dinheiro',
      status: 'paid',
      valor_operador_centavos: 0,
      vendido_por: userId,
    });
    expect(pedidos[0]!.valor_produtor_centavos).toBe(pedidos[0]!.total_centavos);
  });
});

describe('já entrando', () => {
  it('marca a entrada junto com a venda', async () => {
    const tipoId = await criarLote(10);
    const r = await vender(tipoId, { jaEntrou: true });
    if (!r.ok) throw new Error('inesperado');

    const ingressos = (await dono.execute(sql`
      select status, dentro, entradas_count from tickets where id = ${r.ingressos[0]!.id}
    `)) as unknown as { status: string; dentro: boolean; entradas_count: number }[];

    expect(ingressos[0]).toMatchObject({ status: 'usado', dentro: true, entradas_count: 1 });

    const movimentos = (await dono.execute(sql`
      select tipo from ticket_movimentos where ticket_id = ${r.ingressos[0]!.id}
    `)) as unknown as { tipo: string }[];
    expect(movimentos.map((m) => m.tipo)).toEqual(['entrada']);
  });

  it('sem marcar, o ingresso sai válido para a porta ler', async () => {
    const tipoId = await criarLote(10);
    const r = await vender(tipoId);
    if (!r.ok) throw new Error('inesperado');

    const ingressos = (await dono.execute(sql`
      select status, dentro from tickets where id = ${r.ingressos[0]!.id}
    `)) as unknown as { status: string; dentro: boolean }[];

    expect(ingressos[0]).toMatchObject({ status: 'valido', dentro: false });
  });
});

describe('fechamento de caixa', () => {
  it('separa por forma de pagamento', async () => {
    const tipoId = await criarLote(50, 3000, 'Fechamento');

    await vender(tipoId, { metodo: 'dinheiro', quantidade: 2 });
    await vender(tipoId, { metodo: 'debito', quantidade: 1 });
    await vender(tipoId, { metodo: 'debito', quantidade: 3 });

    const caixa = await fechamentoDeCaixa(tenantId, eventId);
    const debito = caixa.find((l) => l.metodo === 'debito');

    expect(debito).toMatchObject({ pedidos: 2, ingressos: 4, totalCentavos: 12_000 });
    expect(caixa.some((l) => l.metodo === 'dinheiro')).toBe(true);
  });
});
