/**
 * Motor de repasse — plano, seção 16, e ADR-021.
 *
 * Banco real e `FakeProvider`, que mantém saldo por recebedor: o que o teste
 * confere é o que a PSP liberou de fato, não só o que o banco acha.
 *
 * Os casos que o plano exige: reembolso, chargeback, por meio de pagamento,
 * com reserva, e chargeback posterior ao repasse principal.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';
import { FakeProvider } from '@/lib/payments/fake';
import { PaymentProviderError, type SplitRule } from '@/lib/payments/types';
import {
  agendarRepassesPendentes,
  executarRepasse,
  executarRepassesVencidos,
  MAX_TENTATIVAS_REPASSE,
} from '@/lib/payouts';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const conexao = postgres(DIRECT_URL, { max: 4, prepare: false });
const db = drizzle(conexao, { schema }) as unknown as PostgresJsDatabase<typeof schema>;

type Linha = Record<string, unknown>;
const linhas = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Linha[];

const DIA = 24 * 60 * 60 * 1000;
const muitoDepois = () => new Date(Date.now() + 400 * DIA);

let sufixo: string;
let instancia = 0;
let psp: FakeProvider;
let operador: string;
let produtor: string;
let tenantId: string;
let venueId: string;
let eventId: string;
let numero = 0;

beforeAll(() => {
  sufixo = Date.now().toString(36);
});

afterAll(async () => {
  await conexao.end();
});

/** Cada teste com tenant, recebedor e evento próprios: saldo não se mistura. */
beforeEach(async () => {
  instancia += 1;
  psp = new FakeProvider('segredo', `rp${sufixo}${instancia}`);
  operador = psp.criarRecebedorAtivo('op');
  produtor = psp.criarRecebedorAtivo('prod');

  const [t] = await linhas(sql`
    insert into tenants (slug, nome, email, provider_recipient_id,
                         reserva_pix_bps, reserva_cartao_bps,
                         dias_liberacao_evento, dias_liberacao_reserva)
    values (${`rp-${sufixo}-${instancia}`}, 'Repasse Teste', 'rp@teste.local', ${produtor},
            0, 2000, 2, 35)
    returning id
  `);
  tenantId = t!.id as string;

  const [v] = await linhas(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Casa Repasse', 1000) returning id
  `);
  venueId = v!.id as string;

  eventId = await novoEvento({ terminouHaDias: 1 });
});

async function novoEvento(opcoes: { terminouHaDias: number; status?: string }): Promise<string> {
  const [e] = await linhas(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status)
    values (${tenantId}, ${venueId}, ${`ev-rp-${sufixo}-${instancia}-${numero++}`}, 'Evento Repasse',
            now() - make_interval(days => ${opcoes.terminouHaDias}) - interval '6 hours',
            now() - make_interval(days => ${opcoes.terminouHaDias}),
            1000, ${opcoes.status ?? 'encerrado'})
    returning id
  `);
  return e!.id as string;
}

/**
 * Venda paga de R$ 110,00: R$ 100,00 do produtor (retido na PSP) e R$ 10,00
 * do operador. Passa pela PSP falsa de verdade, para o saldo existir.
 */
async function venda(
  metodo: 'pix' | 'credit_card' = 'credit_card',
  ev = eventId,
): Promise<{ orderId: string; tx: string }> {
  numero += 1;
  const splits: SplitRule[] = [
    {
      providerRecipientId: operador,
      amount: 1_000,
      liableForChargeback: false,
      absorbsProcessingFee: false,
    },
    {
      providerRecipientId: produtor,
      amount: 10_000,
      liableForChargeback: true,
      absorbsProcessingFee: true,
      holdUntil: new Date(Date.now() + 365 * DIA),
    },
  ];
  const chave = `rp_${sufixo}_${instancia}_${numero}`;
  const transacao = await psp.createTransaction({
    idempotencyKey: chave,
    orderId: chave,
    method: metodo,
    amount: 11_000,
    customer: {
      name: 'Comprador',
      email: 'c@teste.local',
      document: '52998224725',
      documentType: 'cpf',
    },
    ...(metodo === 'credit_card' ? { cardToken: 'tok_teste' } : {}),
    splits,
  });
  psp.simulatePayment(transacao.providerTransactionId);

  const [o] = await linhas(sql`
    insert into orders
      (tenant_id, event_id, numero, comprador_nome, comprador_email, comprador_cpf,
       subtotal_centavos, conveniencia_centavos, total_centavos,
       valor_produtor_centavos, valor_operador_centavos,
       taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
       status, idempotency_key, metodo, provider_transaction_id, pago_em)
    values (${tenantId}, ${ev}, ${numero}, 'Comprador', 'c@teste.local', '52998224725',
            10000, 1000, 11000, 10000, 1000, 1000, 0,
            'paid', ${chave}, ${metodo}, ${transacao.providerTransactionId}, now())
    returning id
  `);
  return { orderId: o!.id as string, tx: transacao.providerTransactionId };
}

async function chargeback(v: { orderId: string; tx: string }) {
  psp.simulateChargeback(v.tx);
  await db.execute(sql`update orders set status = 'chargeback' where id = ${v.orderId}`);
}

async function reembolso(v: { orderId: string; tx: string }, valor: number) {
  const r = await psp.refund({
    idempotencyKey: `rf_${v.orderId}_${valor}`,
    providerTransactionId: v.tx,
    amount: valor,
    reason: 'buyer_request',
  });
  await db.execute(sql`
    insert into refunds (tenant_id, order_id, motivo, valor_centavos, status,
                         provider_refund_id, idempotency_key)
    values (${tenantId}, ${v.orderId}, 'buyer_request', ${valor}, 'succeeded',
            ${r.providerRefundId}, ${`rf_${v.orderId}_${valor}`})
  `);
  await db.execute(sql`
    update orders set status = case when ${valor} >= total_centavos then 'refunded'::order_status
                                    else 'partially_refunded'::order_status end
     where id = ${v.orderId}
  `);
}

async function repasses(ev = eventId) {
  return linhas(sql`
    select id, tranche, metodo, status, data_prevista, retido_centavos, liberado_centavos,
           reembolsos_centavos, chargebacks_centavos, tentativas, ultimo_erro, provider_payout_id
      from payouts where event_id = ${ev}
  `).then((rs) =>
    // Ordem alfabética, não a do enum no Postgres.
    rs.sort((a, b) => `${a.metodo}${a.tranche}`.localeCompare(`${b.metodo}${b.tranche}`)),
  );
}

async function tranche(t: 'principal' | 'reserva', metodo = 'credit_card') {
  const todas = await repasses();
  const r = todas.find((x) => x.tranche === t && x.metodo === metodo);
  if (!r) throw new Error(`tranche ${t}/${metodo} não existe`);
  return r;
}

const opcoes = () => ({ db, provider: psp, eventId });

// ---------------------------------------------------------------------------

describe('agendamento', () => {
  it('cria principal e reserva por meio de pagamento, nas datas certas', async () => {
    await venda('pix');
    await venda('credit_card');

    const r = await agendarRepassesPendentes(opcoes());
    expect(r).toEqual({ eventos: 1, tranches: 4 });

    const todas = await repasses();
    expect(todas.map((x) => `${x.metodo}/${x.tranche}/${x.status}`)).toEqual([
      'credit_card/principal/scheduled',
      'credit_card/reserva/scheduled',
      'pix/principal/scheduled',
      'pix/reserva/scheduled',
    ]);

    const [fim] = await linhas(sql`select data_fim from events where id = ${eventId}`);
    const dataFim = new Date(fim!.data_fim as string).getTime();
    const principal = new Date(todas[0]!.data_prevista as string).getTime();
    const reserva = new Date(todas[1]!.data_prevista as string).getTime();
    expect(principal - dataFim).toBeGreaterThanOrEqual(2 * DIA);
    expect(principal - dataFim).toBeLessThanOrEqual(4 * DIA); // fim de semana no meio
    expect(reserva - dataFim).toBe(35 * DIA);
  });

  it('segunda passagem não duplica nada', async () => {
    await venda();
    await agendarRepassesPendentes(opcoes());
    const r = await agendarRepassesPendentes(opcoes());
    expect(r.tranches).toBe(0);
    expect(await repasses()).toHaveLength(2);
  });

  it('evento que não terminou não é agendado', async () => {
    const futuro = await novoEvento({
      terminouHaDias: -10,
      status: 'publicado',
    });
    await venda('pix', futuro);
    const r = await agendarRepassesPendentes({
      db,
      provider: psp,
      eventId: futuro,
    });
    expect(r.tranches).toBe(0);
  });

  it('evento cancelado não é agendado: o dinheiro volta aos compradores', async () => {
    const cancelado = await novoEvento({
      terminouHaDias: 1,
      status: 'cancelado',
    });
    await venda('pix', cancelado);
    const r = await agendarRepassesPendentes({
      db,
      provider: psp,
      eventId: cancelado,
    });
    expect(r.tranches).toBe(0);
  });

  it('venda de balcão não entra no repasse: nunca passou pela PSP', async () => {
    await db.execute(sql`
      insert into orders
        (tenant_id, event_id, numero, comprador_nome, subtotal_centavos, total_centavos,
         valor_produtor_centavos, valor_operador_centavos,
         taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
         status, idempotency_key, canal, metodo_externo, pago_em)
      values (${tenantId}, ${eventId}, ${++numero}, 'Balcão', 5000, 5000, 5000, 0, 0, 0,
              'paid', ${`balcao_${sufixo}_${numero}`}, 'pdv', 'dinheiro', now())
    `);
    const r = await agendarRepassesPendentes(opcoes());
    expect(r.tranches).toBe(0);
  });
});

describe('execução', () => {
  it('principal no cartão libera o líquido menos 20% de reserva, e a PSP confirma', async () => {
    await venda();
    await venda();
    await agendarRepassesPendentes(opcoes());

    expect(await psp.getBalance(produtor)).toEqual({
      available: 0,
      waitingFunds: 0,
      blocked: 20_000,
    });

    const r = await executarRepasse((await tranche('principal')).id as string, opcoes());
    expect(r).toMatchObject({ status: 'released', liberadoCentavos: 16_000 });

    const p = await tranche('principal');
    expect(p).toMatchObject({
      status: 'released',
      retido_centavos: 4_000,
      liberado_centavos: 16_000,
    });
    expect(p.provider_payout_id).toBeTruthy();
    expect(await psp.getBalance(produtor)).toEqual({
      available: 16_000,
      waitingFunds: 0,
      blocked: 4_000,
    });

    const [audit] = await linhas(sql`
      select acao from audit_log where entidade = 'payouts' and entidade_id = ${p.id as string}
    `);
    expect(audit?.acao).toBe('liberacao_repasse');
  });

  it('reserva só sai depois da principal, e libera o restante', async () => {
    await venda();
    await agendarRepassesPendentes(opcoes());
    const reserva = await tranche('reserva');

    // Direto na reserva, com a principal ainda agendada: a varredura não pega.
    await db.execute(sql`update payouts set data_prevista = now() - interval '1 day'
                          where id = ${reserva.id as string}`);
    await db.execute(sql`update payouts set data_prevista = now() + interval '1 day'
                          where event_id = ${eventId} and tranche = 'principal'`);
    expect(await executarRepassesVencidos(opcoes())).toEqual([]);

    const resultados = await executarRepassesVencidos({
      ...opcoes(),
      agora: muitoDepois(),
    });
    expect(resultados.map((r) => r.liberadoCentavos)).toEqual([8_000, 2_000]);
    expect(await psp.getBalance(produtor)).toEqual({
      available: 10_000,
      waitingFunds: 0,
      blocked: 0,
    });
  });

  it('Pix sem reserva libera tudo na principal; a reserva encerra sem chamar a PSP', async () => {
    await venda('pix');
    await agendarRepassesPendentes(opcoes());
    const resultados = await executarRepassesVencidos({
      ...opcoes(),
      agora: muitoDepois(),
    });

    expect(resultados.map((r) => [r.liberadoCentavos, r.detalhe])).toEqual([
      [10_000, 'liberado'],
      [0, 'nada a liberar'],
    ]);
    expect((await tranche('reserva', 'pix')).provider_payout_id).toBeNull();
  });

  it('rodar de novo não libera duas vezes', async () => {
    await venda();
    await agendarRepassesPendentes(opcoes());
    await executarRepassesVencidos({ ...opcoes(), agora: muitoDepois() });
    const saldo = await psp.getBalance(produtor);

    expect(await executarRepassesVencidos({ ...opcoes(), agora: muitoDepois() })).toEqual([]);
    expect(await psp.getBalance(produtor)).toEqual(saldo);
  });

  it('dois processos ao mesmo tempo: só um libera', async () => {
    await venda();
    await agendarRepassesPendentes(opcoes());
    const p = await tranche('principal');

    const resultados = await Promise.all(
      Array.from({ length: 6 }, () => executarRepasse(p.id as string, { db, provider: psp })),
    );
    expect(resultados.filter((r) => r !== null)).toHaveLength(1);
    expect((await psp.getBalance(produtor)).available).toBe(8_000);
  });
});

describe('estornos', () => {
  it('reembolso parcial antes da principal reduz o repasse', async () => {
    const v = await venda();
    await venda();
    await reembolso(v, 5_500); // metade do pedido: R$ 50,00 saem do produtor
    await agendarRepassesPendentes(opcoes());
    await executarRepasse((await tranche('principal')).id as string, opcoes());

    const p = await tranche('principal');
    expect(p.reembolsos_centavos).toBe(5_000);
    expect(p.liberado_centavos).toBe(12_000); // 15.000 líquido − 20%
    expect(await psp.getBalance(produtor)).toEqual({
      available: 12_000,
      waitingFunds: 0,
      blocked: 3_000,
    });
  });

  it('chargeback depois da principal sai da reserva', async () => {
    const vendas = [];
    for (let i = 0; i < 10; i++) vendas.push(await venda());
    await agendarRepassesPendentes(opcoes());

    await executarRepasse((await tranche('principal')).id as string, opcoes());
    expect((await psp.getBalance(produtor)).available).toBe(80_000);

    // Contestação chega entre a principal e a reserva.
    await chargeback(vendas[0]!);

    await executarRepasse((await tranche('reserva')).id as string, opcoes());
    const r = await tranche('reserva');
    expect(r.chargebacks_centavos).toBe(11_000);
    expect(r.liberado_centavos).toBe(20_000 - 11_000);

    // A PSP fecha com o banco: o produtor tem o líquido, e nada sobra retido.
    expect(await psp.getBalance(produtor)).toEqual({
      available: 89_000,
      waitingFunds: 0,
      blocked: 0,
    });
  });

  it('chargeback maior que a reserva: saldo a descoberto registrado, PSP não é chamada', async () => {
    const a = await venda();
    await venda();
    await agendarRepassesPendentes(opcoes());
    await executarRepasse((await tranche('principal')).id as string, opcoes()); // libera 16.000

    await chargeback(a);
    const r = await executarRepasse((await tranche('reserva')).id as string, opcoes());

    expect(r).toMatchObject({
      status: 'released',
      detalhe: 'saldo a descoberto',
    });
    const reserva = await tranche('reserva');
    // líquido 20.000 − 11.000 = 9.000; já saíram 16.000
    expect(reserva.liberado_centavos).toBe(-7_000);
    expect(reserva.provider_payout_id).toBeNull();

    const [audit] = await linhas(sql`
      select depois from audit_log
       where acao = 'repasse_a_descoberto' and entidade_id = ${reserva.id as string}
    `);
    expect(audit?.depois).toMatchObject({ saldoCentavos: -7_000 });
  });
});

describe('falhas da PSP', () => {
  it('erro temporário: falha, tenta de novo com o MESMO valor e a MESMA chave', async () => {
    const v = await venda();
    await venda();
    await agendarRepassesPendentes(opcoes());

    psp.failNext('releaseFunds', new PaymentProviderError('timeout', 'timeout', true));
    const [primeira] = await executarRepassesVencidos({
      ...opcoes(),
      agora: muitoDepois(),
    });
    expect(primeira).toMatchObject({
      status: 'failed',
      liberadoCentavos: 16_000,
    });

    // Um reembolso entre as tentativas não muda o valor: ele fica congelado,
    // senão o banco gravaria um valor diferente do que a PSP memorizou.
    await reembolso(v, 1_100);

    const [segunda] = await executarRepassesVencidos({
      ...opcoes(),
      agora: muitoDepois(),
    });
    expect(segunda).toMatchObject({
      status: 'released',
      liberadoCentavos: 16_000,
    });
    expect(await tranche('principal')).toMatchObject({
      tentativas: 2,
      ultimo_erro: null,
    });
  });

  it('erro definitivo: para no teto de tentativas e espera alguém olhar', async () => {
    await venda();
    await agendarRepassesPendentes(opcoes());

    psp.failNext('releaseFunds', new PaymentProviderError('conta bloqueada', 'blocked', false));
    await executarRepassesVencidos({ ...opcoes(), agora: muitoDepois() });

    expect(await tranche('principal')).toMatchObject({
      status: 'failed',
      tentativas: MAX_TENTATIVAS_REPASSE,
      ultimo_erro: 'conta bloqueada',
    });
    expect(await executarRepassesVencidos({ ...opcoes(), agora: muitoDepois() })).toEqual([]);
  });

  it('produtor sem recebedor na PSP: falha definitiva, nada liberado', async () => {
    await venda();
    await db.execute(sql`update tenants set provider_recipient_id = null where id = ${tenantId}`);
    await agendarRepassesPendentes(opcoes());
    const [r] = await executarRepassesVencidos({
      ...opcoes(),
      agora: muitoDepois(),
    });

    expect(r).toMatchObject({
      status: 'failed',
      detalhe: 'Produtor sem recebedor na PSP',
    });
    expect((await psp.getBalance(produtor)).available).toBe(0);
  });

  it('processamento abandonado é retomado com a mesma chave, sem liberar duas vezes', async () => {
    await venda();
    await agendarRepassesPendentes(opcoes());
    const p = await tranche('principal');

    // A PSP liberou, mas o processo morreu antes de gravar a resposta.
    await psp.releaseFunds({
      idempotencyKey: `payout:${eventId}:principal:credit_card`,
      providerRecipientId: produtor,
      amount: 8_000,
    });
    await db.execute(sql`
      update payouts set status = 'processing', tentativas = 1, liberado_centavos = 8000,
                         atualizado_em = now() - interval '1 hour'
       where id = ${p.id as string}
    `);

    const r = await executarRepasse(p.id as string, opcoes());
    expect(r).toMatchObject({ status: 'released', liberadoCentavos: 8_000 });
    // Liberou uma vez só: o retido continua com os 20% da reserva.
    expect(await psp.getBalance(produtor)).toEqual({
      available: 8_000,
      waitingFunds: 0,
      blocked: 2_000,
    });
  });
});
