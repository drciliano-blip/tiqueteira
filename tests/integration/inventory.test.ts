/**
 * Controle de estoque sob concorrência — plano, seção 10 e seção 16.
 *
 * O teste central desta suíte é o das 50 requisições simultâneas para 10
 * ingressos. Ele é a razão de a reserva ser um `UPDATE` condicional e não um
 * `SELECT` seguido de `UPDATE`: com leitura prévia, este teste vende 15, 20,
 * às vezes 50 ingressos — e o bug só aparece no evento que lota.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  confirmarEstoque,
  devolverEstoque,
  expirarReservasVencidas,
  ingressosDoCpf,
  reservarEstoque,
} from '@/lib/inventory';

const DIRECT_URL = process.env.DIRECT_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DIRECT_URL || !DATABASE_URL) throw new Error('DIRECT_URL e DATABASE_URL são obrigatórias');

/** Dono do schema: monta e confere o cenário. */
const donoSql = postgres(DIRECT_URL, { max: 2, prepare: false });
const dono = drizzle(donoSql);

/**
 * Papel da aplicação, com pool largo. A concorrência precisa ser real: com
 * uma conexão só, o Postgres serializa tudo e o teste passa mesmo com código
 * errado.
 */
const appSql = postgres(DATABASE_URL, { max: 25, prepare: false });
const app: PostgresJsDatabase = drizzle(appSql);

let tenantId: string;
let eventId: string;
let venueId: string;
let sufixo: string;

async function criarTipo(params: {
  total: number;
  limitePorPedido?: number;
  ativo?: boolean;
  janela?: 'aberta' | 'futura' | 'passada';
}): Promise<string> {
  const janela = params.janela ?? 'aberta';
  const inicio =
    janela === 'futura' ? sql`now() + interval '1 day'` : sql`now() - interval '1 day'`;
  const fim =
    janela === 'passada' ? sql`now() - interval '1 hour'` : sql`now() + interval '30 days'`;

  const linhas = (await dono.execute(sql`
    insert into ticket_types
      (tenant_id, event_id, nome, preco_centavos, quantidade_total,
       vendas_inicio, vendas_fim, limite_por_pedido, ativo)
    values (${tenantId}, ${eventId}, 'Lote de teste', 10000, ${params.total},
            ${inicio}, ${fim}, ${params.limitePorPedido ?? 6}, ${params.ativo ?? true})
    returning id
  `)) as unknown as { id: string }[];

  return linhas[0]!.id;
}

/** Cria um pedido mínimo que respeita os CHECKs de dinheiro. */
async function criarPedido(numero: number, cpf = '12345678901'): Promise<string> {
  const linhas = (await dono.execute(sql`
    insert into orders
      (tenant_id, event_id, numero, comprador_nome, comprador_email, comprador_cpf,
       subtotal_centavos, conveniencia_centavos, total_centavos,
       valor_produtor_centavos, valor_operador_centavos,
       taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
       status, idempotency_key)
    values (${tenantId}, ${eventId}, ${numero}, 'Comprador Teste',
            ${'c' + numero + '@teste.local'}, ${cpf},
            10000, 1000, 11000, 9350, 1650, 1000, 500,
            'draft', ${`inv_${sufixo}_${numero}`})
    returning id
  `)) as unknown as { id: string }[];

  return linhas[0]!.id;
}

async function estoque(ticketTypeId: string) {
  const linhas = (await dono.execute(sql`
    select quantidade_total, quantidade_vendida, quantidade_reservada
      from ticket_types where id = ${ticketTypeId}
  `)) as unknown as {
    quantidade_total: number;
    quantidade_vendida: number;
    quantidade_reservada: number;
  }[];
  return linhas[0]!;
}

/** Uma compra completa, como a aplicação faz: tudo numa transação. */
async function comprar(orderId: string, ticketTypeId: string, quantidade = 1) {
  return app.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    const r = await reservarEstoque(tx, {
      tenantId,
      orderId,
      itens: [{ ticketTypeId, quantidade }],
      ttlSegundos: 600,
    });

    if (!r.ok) throw new Error(r.motivo);

    await tx.execute(sql`
      update orders set status = 'awaiting_payment',
             expires_em = ${r.expiresEm.toISOString()}::timestamptz
       where id = ${orderId}
    `);
    return r;
  });
}

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  const t = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'inv-' + sufixo}, 'Estoque Teste', 'inv@teste.local')
    returning id
  `)) as unknown as { id: string }[];
  tenantId = t[0]!.id;

  const v = (await dono.execute(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Espaço Teste', 1000) returning id
  `)) as unknown as { id: string }[];
  venueId = v[0]!.id;

  const e = (await dono.execute(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status)
    values (${tenantId}, ${venueId}, ${'ev-' + sufixo}, 'Evento Teste',
            now() + interval '30 days', now() + interval '30 days 6 hours',
            1000, 'publicado')
    returning id
  `)) as unknown as { id: string }[];
  eventId = e[0]!.id;
});

afterAll(async () => {
  // Na ordem inversa da dependência: `orders.tenant_id` é RESTRICT de
  // propósito — apagar um produtor que tem pedidos precisa ser trabalhoso.
  await dono.execute(sql`delete from orders       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from ticket_types where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from events       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from venues       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tenants      where id        = ${tenantId}`);
  await donoSql.end();
  await appSql.end();
});

// ---------------------------------------------------------------------------

describe('reserva sob concorrência', () => {
  it('50 requisições simultâneas para 10 ingressos → exatamente 10 sucessos', async () => {
    const tipoId = await criarTipo({ total: 10 });

    // Os pedidos são criados antes, para que a corrida seja só pelo estoque.
    const pedidos: string[] = [];
    for (let i = 0; i < 50; i++) {
      pedidos.push(await criarPedido(1000 + i, String(10000000000 + i)));
    }

    const resultados = await Promise.allSettled(
      pedidos.map((orderId) => comprar(orderId, tipoId)),
    );

    const sucessos = resultados.filter((r) => r.status === 'fulfilled').length;
    const falhas = resultados.filter((r) => r.status === 'rejected').length;

    expect(sucessos).toBe(10);
    expect(falhas).toBe(40);

    const e = await estoque(tipoId);
    expect(e.quantidade_reservada).toBe(10);
    expect(e.quantidade_vendida).toBe(0);

    const reservas = (await dono.execute(sql`
      select count(*)::int as n from reservations where ticket_type_id = ${tipoId}
    `)) as unknown as { n: number }[];
    expect(reservas[0]!.n).toBe(10);
  }, 120_000);

  it('a soma vendida + reservada nunca ultrapassa o total', async () => {
    const tipoId = await criarTipo({ total: 7 });

    const pedidos: string[] = [];
    for (let i = 0; i < 30; i++) pedidos.push(await criarPedido(2000 + i, String(20000000000 + i)));

    await Promise.allSettled(pedidos.map((o) => comprar(o, tipoId)));

    const e = await estoque(tipoId);
    expect(e.quantidade_vendida + e.quantidade_reservada).toBeLessThanOrEqual(e.quantidade_total);
  }, 120_000);
});

describe('reserva — recusas', () => {
  let tipoId: string;

  beforeEach(async () => {
    tipoId = await criarTipo({ total: 5 });
  });

  it('recusa quando não há estoque, com motivo distinguível', async () => {
    const orderId = await criarPedido(3001);
    const r = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return reservarEstoque(tx, {
        tenantId,
        orderId,
        itens: [{ ticketTypeId: tipoId, quantidade: 99 }],
        ttlSegundos: 600,
      });
    });

    expect(r).toMatchObject({ ok: false, motivo: 'sem_estoque' });
  });

  it('recusa tipo inativo e diferencia de falta de estoque', async () => {
    const inativo = await criarTipo({ total: 100, ativo: false });
    const orderId = await criarPedido(3002);

    const r = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return reservarEstoque(tx, {
        tenantId,
        orderId,
        itens: [{ ticketTypeId: inativo, quantidade: 1 }],
        ttlSegundos: 600,
      });
    });

    expect(r).toMatchObject({ ok: false, motivo: 'fora_da_janela_ou_inativo' });
  });

  it('recusa venda encerrada', async () => {
    const passado = await criarTipo({ total: 100, janela: 'passada' });
    const orderId = await criarPedido(3003);

    const r = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return reservarEstoque(tx, {
        tenantId,
        orderId,
        itens: [{ ticketTypeId: passado, quantidade: 1 }],
        ttlSegundos: 600,
      });
    });

    expect(r).toMatchObject({ ok: false, motivo: 'fora_da_janela_ou_inativo' });
  });

  it('rollback da transação desfaz a reserva', async () => {
    // Falha na PSP depois de reservar não pode deixar estoque preso.
    const orderId = await criarPedido(3004);

    await expect(
      app.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        await reservarEstoque(tx, {
          tenantId,
          orderId,
          itens: [{ ticketTypeId: tipoId, quantidade: 2 }],
          ttlSegundos: 600,
        });
        throw new Error('PSP fora do ar');
      }),
    ).rejects.toThrow('PSP fora do ar');

    expect((await estoque(tipoId)).quantidade_reservada).toBe(0);
  });
});

describe('confirmação e devolução', () => {
  it('confirmar move de reservado para vendido', async () => {
    const tipoId = await criarTipo({ total: 5 });
    const orderId = await criarPedido(4001);
    await comprar(orderId, tipoId, 2);

    const r = await confirmarEstoque(dono, orderId);
    expect(r.confirmados).toBe(2);

    const e = await estoque(tipoId);
    expect(e.quantidade_reservada).toBe(0);
    expect(e.quantidade_vendida).toBe(2);
  });

  it('confirmar duas vezes não vende duas vezes', async () => {
    // Caso de borda 2: dois webhooks `paid` para a mesma transação.
    const tipoId = await criarTipo({ total: 5 });
    const orderId = await criarPedido(4002);
    await comprar(orderId, tipoId, 2);

    await confirmarEstoque(dono, orderId);
    const segunda = await confirmarEstoque(dono, orderId);

    expect(segunda.confirmados).toBe(0);
    const e = await estoque(tipoId);
    expect(e.quantidade_vendida).toBe(2);
    expect(e.quantidade_reservada).toBe(0);
  });

  it('devolver libera o estoque de volta para a venda', async () => {
    const tipoId = await criarTipo({ total: 5 });
    const orderId = await criarPedido(4003);
    await comprar(orderId, tipoId, 3);

    expect((await estoque(tipoId)).quantidade_reservada).toBe(3);
    await devolverEstoque(dono, orderId, 'cancelada');
    expect((await estoque(tipoId)).quantidade_reservada).toBe(0);
  });

  it('Pix pago depois da expiração NÃO deixa o contador negativo', async () => {
    /**
     * Caso de borda 1, e a razão de existir a ADR-003.
     *
     * A reserva expira, o job devolve o estoque, e só então o webhook de
     * pagamento chega. Com o SQL do rascunho do plano — decrementar o
     * contador direto — `quantidade_reservada` iria a -1 e o sistema passaria
     * a vender um ingresso que não existe.
     */
    const tipoId = await criarTipo({ total: 5 });
    const orderId = await criarPedido(4004);
    await comprar(orderId, tipoId, 1);

    await dono.execute(sql`
      update reservations set expires_em = now() - interval '1 minute'
       where order_id = ${orderId}
    `);
    await expirarReservasVencidas(dono, { tenantId });
    expect((await estoque(tipoId)).quantidade_reservada).toBe(0);

    // Agora o pagamento atrasado.
    const r = await confirmarEstoque(dono, orderId);

    expect(r.confirmados).toBe(0);
    const e = await estoque(tipoId);
    expect(e.quantidade_reservada).toBe(0);
    expect(e.quantidade_vendida).toBe(0);
  });
});

describe('expiração em lote', () => {
  it('devolve estoque e informa quais pedidos expiraram', async () => {
    const tipoId = await criarTipo({ total: 10 });
    const pedidos = [await criarPedido(5001), await criarPedido(5002)];
    for (const p of pedidos) await comprar(p, tipoId, 2);

    expect((await estoque(tipoId)).quantidade_reservada).toBe(4);

    await dono.execute(sql`
      update reservations set expires_em = now() - interval '1 minute'
       where order_id in (${pedidos[0]!}, ${pedidos[1]!})
    `);

    const r = await expirarReservasVencidas(dono, { tenantId });
    expect(r.devolvidos).toBe(4);
    expect(r.orderIds.sort()).toEqual([...pedidos].sort());
    expect((await estoque(tipoId)).quantidade_reservada).toBe(0);
  });

  it('rodar a varredura duas vezes não devolve estoque em dobro', async () => {
    const tipoId = await criarTipo({ total: 10 });
    const orderId = await criarPedido(5003);
    await comprar(orderId, tipoId, 3);

    await dono.execute(sql`
      update reservations set expires_em = now() - interval '1 minute'
       where order_id = ${orderId}
    `);

    await expirarReservasVencidas(dono, { tenantId });
    const segunda = await expirarReservasVencidas(dono, { tenantId });

    expect(segunda.devolvidos).toBe(0);
    expect((await estoque(tipoId)).quantidade_reservada).toBe(0);
  });
});

describe('limite por CPF', () => {
  it('conta pedido aguardando pagamento, não só o pago', async () => {
    // Caso de borda 16: sem isso, dez abas abertas furam o limite.
    const tipoId = await criarTipo({ total: 50 });
    const cpf = '98765432100';

    const orderId = await criarPedido(6001, cpf);
    await dono.execute(sql`
      insert into order_items (tenant_id, order_id, ticket_type_id, quantidade,
                               preco_unitario_centavos_snapshot)
      values (${tenantId}, ${orderId}, ${tipoId}, 3, 10000)
    `);
    await dono.execute(sql`update orders set status = 'awaiting_payment' where id = ${orderId}`);

    expect(await ingressosDoCpf(dono, { ticketTypeId: tipoId, cpf })).toBe(3);
  });

  it('pedido expirado não conta para o limite', async () => {
    const tipoId = await criarTipo({ total: 50 });
    const cpf = '11122233344';

    const orderId = await criarPedido(6002, cpf);
    await dono.execute(sql`
      insert into order_items (tenant_id, order_id, ticket_type_id, quantidade,
                               preco_unitario_centavos_snapshot)
      values (${tenantId}, ${orderId}, ${tipoId}, 3, 10000)
    `);
    await dono.execute(sql`update orders set status = 'expired' where id = ${orderId}`);

    expect(await ingressosDoCpf(dono, { ticketTypeId: tipoId, cpf })).toBe(0);
  });
});
