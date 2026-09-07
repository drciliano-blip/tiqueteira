/**
 * Webhook de pagamento — plano, seções 11 e 16.
 *
 * É o componente mais crítico do sistema: é ele que decide que o dinheiro
 * entrou. Os casos aqui não são hipóteses — reentrega, evento fora de ordem e
 * pagamento após a expiração acontecem em produção toda semana.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';
import { calcularTaxas, montarSplits } from '@/lib/fees';
import { reservarEstoque } from '@/lib/inventory';
import { FakeProvider } from '@/lib/payments/fake';
import { processarWebhook } from '@/lib/webhook-processor';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const conexao = postgres(DIRECT_URL, { max: 3, prepare: false });
const db = drizzle(conexao, { schema }) as unknown as PostgresJsDatabase<typeof schema>;

const SEGREDO_WEBHOOK = 'segredo-webhook-de-teste';
const SEGREDO_TICKET = 'segredo-ticket-de-teste-com-mais-de-32-chars';

let psp: FakeProvider;
let operador: string;
let produtor: string;

let tenantId: string;
let eventId: string;
let venueId: string;
let tipoId: string;
let sufixo: string;
let numero = 0;
let instancia = 0;

type Linha = Record<string, unknown>;
const linhas = async (q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Linha[];

/** Monta um pedido pronto para pagar: reserva feita e transação criada na PSP. */
async function pedidoAguardandoPagamento(quantidade = 2) {
  numero += 1;

  const [pedido] = await linhas(sql`
    insert into orders
      (tenant_id, event_id, numero, comprador_nome, comprador_email, comprador_cpf,
       subtotal_centavos, conveniencia_centavos, total_centavos,
       valor_produtor_centavos, valor_operador_centavos,
       taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
       status, idempotency_key, metodo)
    values (${tenantId}, ${eventId}, ${numero}, 'Comprador Teste',
            ${`c${numero}@teste.local`}, '52998224725',
            ${10000 * quantidade}, ${1000 * quantidade}, ${11000 * quantidade},
            ${9350 * quantidade}, ${1650 * quantidade}, 1000, 500,
            'draft', ${`wh_${sufixo}_${numero}`}, 'pix')
    returning id
  `);
  const orderId = pedido!.id as string;

  await db.execute(sql`
    insert into order_items (tenant_id, order_id, ticket_type_id, quantidade,
                             preco_unitario_centavos_snapshot)
    values (${tenantId}, ${orderId}, ${tipoId}, ${quantidade}, 10000)
  `);

  const reserva = await reservarEstoque(db, {
    tenantId,
    orderId,
    itens: [{ ticketTypeId: tipoId, quantidade }],
    ttlSegundos: 600,
  });
  if (!reserva.ok) throw new Error(`reserva falhou: ${reserva.motivo}`);

  const taxas = calcularTaxas({
    subtotalCentavos: 11000 * quantidade,
    quantidadeIngressos: quantidade,
    config: { taxaConvenienciaBps: 0, comissaoBps: 0, taxaFixaCentavos: 0 },
  });
  const splits = montarSplits(taxas, {
    operadorRecipientId: operador,
    produtorRecipientId: produtor,
  });

  const tx = await psp.createTransaction({
    idempotencyKey: orderId,
    orderId,
    method: 'pix',
    amount: 11000 * quantidade,
    customer: {
      name: 'Comprador Teste',
      email: 'c@teste.local',
      document: '52998224725',
      documentType: 'cpf',
    },
    splits,
  });

  await db.execute(sql`
    update orders
       set status = 'awaiting_payment', provider_transaction_id = ${tx.providerTransactionId},
           expires_em = ${reserva.expiresEm.toISOString()}::timestamptz
     where id = ${orderId}
  `);

  return { orderId, providerTransactionId: tx.providerTransactionId, total: 11000 * quantidade };
}

async function entregar(evento: ReturnType<FakeProvider['simulatePayment']>) {
  const { body, headers } = psp.envelope(evento);
  return processarWebhook(body, headers, {
    provider: psp,
    db,
    ticketSecret: SEGREDO_TICKET,
  });
}

async function pedido(orderId: string) {
  const [linha] = await linhas(
    sql`select status, pago_em from orders where id = ${orderId}`,
  );
  return linha as { status: string; pago_em: Date | null };
}

async function contarIngressos(orderId: string, status?: string) {
  const cond = status ? sql`and status = ${status}` : sql``;
  const [linha] = await linhas(
    sql`select count(*)::int as n from tickets where order_id = ${orderId} ${cond}`,
  );
  return Number((linha as { n: number }).n);
}

async function estoque() {
  const [linha] = await linhas(sql`
    select quantidade_vendida, quantidade_reservada from ticket_types where id = ${tipoId}
  `);
  return linha as { quantidade_vendida: number; quantidade_reservada: number };
}

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  const [t] = await linhas(sql`
    insert into tenants (slug, nome, email)
    values (${'wh-' + sufixo}, 'Webhook Teste', 'wh@teste.local') returning id
  `);
  tenantId = t!.id as string;

  const [v] = await linhas(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Espaço Webhook', 1000) returning id
  `);
  venueId = v!.id as string;

  const [e] = await linhas(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status, ingresso_nominal)
    values (${tenantId}, ${venueId}, ${'ev-wh-' + sufixo}, 'Evento Webhook',
            now() + interval '30 days', now() + interval '30 days 6 hours',
            1000, 'publicado', true)
    returning id
  `);
  eventId = e!.id as string;
});

beforeEach(async () => {
  instancia += 1;
  psp = new FakeProvider(SEGREDO_WEBHOOK, `${sufixo}${instancia}`);
  operador = psp.criarRecebedorAtivo('op');
  produtor = psp.criarRecebedorAtivo('prod');

  const [tt] = await linhas(sql`
    insert into ticket_types
      (tenant_id, event_id, nome, preco_centavos, quantidade_total,
       vendas_inicio, vendas_fim)
    values (${tenantId}, ${eventId}, 'Lote Webhook', 10000, 100,
            now() - interval '1 day', now() + interval '30 days')
    returning id
  `);
  tipoId = tt!.id as string;
});

afterAll(async () => {
  await db.execute(sql`delete from webhook_events where payload_raw like ${'%fake_%'}`);
  await db.execute(sql`delete from tickets       where tenant_id = ${tenantId}`);
  await db.execute(sql`delete from orders        where tenant_id = ${tenantId}`);
  await db.execute(sql`delete from ticket_types  where tenant_id = ${tenantId}`);
  await db.execute(sql`delete from events        where tenant_id = ${tenantId}`);
  await db.execute(sql`delete from venues        where tenant_id = ${tenantId}`);
  await db.execute(sql`delete from tenants       where id        = ${tenantId}`);
  await conexao.end();
});

// ---------------------------------------------------------------------------

describe('pagamento confirmado', () => {
  it('marca o pedido como pago, confirma o estoque e emite os ingressos', async () => {
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(2);
    const antes = await estoque();

    const r = await entregar(psp.simulatePayment(providerTransactionId));

    expect(r.status).toBe(200);
    expect((await pedido(orderId)).status).toBe('paid');
    expect((await pedido(orderId)).pago_em).not.toBeNull();
    expect(await contarIngressos(orderId)).toBe(2);

    const depois = await estoque();
    expect(depois.quantidade_vendida).toBe(antes.quantidade_vendida + 2);
    expect(depois.quantidade_reservada).toBe(antes.quantidade_reservada - 2);
  });

  it('cada ingresso tem código e token únicos', async () => {
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(3);
    await entregar(psp.simulatePayment(providerTransactionId));

    const emitidos = await linhas(
      sql`select codigo, token_hash from tickets where order_id = ${orderId}`,
    );
    const codigos = new Set(emitidos.map((t) => t.codigo));
    const hashes = new Set(emitidos.map((t) => t.token_hash));

    expect(codigos.size).toBe(3);
    expect(hashes.size).toBe(3);
  });
});

describe('idempotência', () => {
  it('o mesmo evento entregue duas vezes gera um único pedido pago', async () => {
    // Caso de borda 2. É a unique em provider_event_id que segura isto.
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(2);
    const evento = psp.simulatePayment(providerTransactionId);

    const primeira = await entregar(evento);
    const segunda = await entregar(evento);

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(segunda.detalhe).toContain('reentrega');
    expect(await contarIngressos(orderId)).toBe(2);
  });

  it('dois eventos `paid` distintos para a mesma transação não emitem em dobro', async () => {
    // A PSP pode mandar dois eventos com ids diferentes. Aqui quem segura não
    // é a unique, é a máquina de estado: `paid → paid` não é transição.
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(2);

    await entregar(psp.simulatePayment(providerTransactionId));

    const evento2 = {
      providerEventId: `fake_evt_repetido_${sufixo}${instancia}`,
      type: 'transaction.paid' as const,
      occurredAt: new Date(),
      providerTransactionId,
      amount: 22000,
      raw: {},
    };
    const r = await entregar(evento2);

    expect(r.status).toBe(200);
    expect(r.detalhe).toContain('ja_esta_assim');
    expect(await contarIngressos(orderId)).toBe(2);
  });
});

describe('assinatura', () => {
  it('recusa corpo adulterado com 401 e não processa', async () => {
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(1);
    const evento = psp.simulatePayment(providerTransactionId);
    const { body, headers } = psp.envelope(evento);

    const r = await processarWebhook(body.replace('paid', 'refunded'), headers, {
      provider: psp,
      db,
      ticketSecret: SEGREDO_TICKET,
    });

    expect(r.status).toBe(401);
    expect((await pedido(orderId)).status).toBe('awaiting_payment');
    expect(await contarIngressos(orderId)).toBe(0);
  });

  it('recusa requisição sem assinatura', async () => {
    const r = await processarWebhook('{"id":"x"}', {}, {
      provider: psp,
      db,
      ticketSecret: SEGREDO_TICKET,
    });
    expect(r.status).toBe(401);
  });

  it('registra a tentativa recusada, para dar o que investigar depois', async () => {
    await processarWebhook('{"id":"x"}', {}, {
      provider: psp,
      db,
      ticketSecret: SEGREDO_TICKET,
    });

    const [linha] = await linhas(sql`
      select count(*)::int as n from webhook_events
       where assinatura_valida = false and recebido_em > now() - interval '1 minute'
    `);
    expect(Number((linha as { n: number }).n)).toBeGreaterThan(0);
  });
});

describe('eventos fora de ordem', () => {
  it('`refunded` antes de `paid` é registrado e ignorado, não é erro', async () => {
    // Caso de borda 3. Devolver erro faria a PSP reentregar para sempre.
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(1);

    const r = await entregar({
      providerEventId: `fake_evt_fora_de_ordem_${sufixo}${instancia}`,
      type: 'transaction.refunded',
      occurredAt: new Date(),
      providerTransactionId,
      raw: {},
    });

    expect(r.status).toBe(200);
    expect(r.detalhe).toContain('recusada');
    expect((await pedido(orderId)).status).toBe('awaiting_payment');
  });

  it('evento de repasse não mexe no pedido', async () => {
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(1);

    const r = await entregar({
      providerEventId: `fake_evt_payout_${sufixo}${instancia}`,
      type: 'payout.completed',
      occurredAt: new Date(),
      providerTransactionId,
      raw: {},
    });

    expect(r.status).toBe(200);
    expect((await pedido(orderId)).status).toBe('awaiting_payment');
  });
});

describe('divergência de valor', () => {
  it('não marca como pago se o valor do webhook não bate com o pedido', async () => {
    // Marcar pago aqui seria entregar ingresso sem ter recebido.
    const { orderId, providerTransactionId, total } = await pedidoAguardandoPagamento(2);

    const r = await entregar({
      providerEventId: `fake_evt_divergente_${sufixo}${instancia}`,
      type: 'transaction.paid',
      occurredAt: new Date(),
      providerTransactionId,
      amount: Math.round(total / 2),
      raw: {},
    });

    expect(r.status).toBe(500);
    expect(r.detalhe).toContain('Divergência');
    expect((await pedido(orderId)).status).toBe('awaiting_payment');
    expect(await contarIngressos(orderId)).toBe(0);
  });

  it('o evento com erro é apagado, para a reentrega poder tentar de novo', async () => {
    const { providerTransactionId } = await pedidoAguardandoPagamento(1);

    await entregar({
      providerEventId: `fake_evt_retentativa_${sufixo}${instancia}`,
      type: 'transaction.paid',
      occurredAt: new Date(),
      providerTransactionId,
      amount: 1,
      raw: {},
    });

    const [linha] = await linhas(sql`
      select count(*)::int as n from webhook_events
       where provider_event_id = ${`fake_evt_retentativa_${sufixo}${instancia}`}
    `);
    expect(Number((linha as { n: number }).n)).toBe(0);
  });
});

describe('Pix pago depois da expiração', () => {
  it('não emite ingresso e sinaliza reembolso devido', async () => {
    /**
     * Caso de borda 1, e o motivo de a ADR-003 existir. O estoque já voltou
     * para a venda; emitir ingresso aqui seria vender lugar inexistente.
     */
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(1);

    await db.execute(sql`
      update reservations
         set liberada = true, liberada_em = now(), liberada_motivo = 'expirada'
       where order_id = ${orderId}
    `);
    await db.execute(sql`
      update ticket_types set quantidade_reservada = quantidade_reservada - 1
       where id = ${tipoId}
    `);

    const r = await entregar(psp.simulatePayment(providerTransactionId));

    expect(r.status).toBe(200);
    expect(r.detalhe).toContain('reembolso devido');
    expect(await contarIngressos(orderId)).toBe(0);
    expect((await estoque()).quantidade_vendida).toBe(0);
  });
});

describe('reembolso e chargeback', () => {
  it('reembolso total cancela os ingressos', async () => {
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(2);
    await entregar(psp.simulatePayment(providerTransactionId));
    expect(await contarIngressos(orderId, 'valido')).toBe(2);

    await entregar({
      providerEventId: `fake_evt_reembolso_${sufixo}${instancia}`,
      type: 'transaction.refunded',
      occurredAt: new Date(),
      providerTransactionId,
      raw: {},
    });

    expect((await pedido(orderId)).status).toBe('refunded');
    expect(await contarIngressos(orderId, 'cancelado')).toBe(2);
    expect(await contarIngressos(orderId, 'valido')).toBe(0);
  });

  it('chargeback cancela os ingressos', async () => {
    const { orderId, providerTransactionId } = await pedidoAguardandoPagamento(1);
    await entregar(psp.simulatePayment(providerTransactionId));

    await entregar(psp.simulateChargeback(providerTransactionId));

    expect((await pedido(orderId)).status).toBe('chargeback');
    expect(await contarIngressos(orderId, 'cancelado')).toBe(1);
  });
});
