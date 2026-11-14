/**
 * Reembolso por falha na prestação do serviço — ADR-022.
 *
 * Caminho inteiro: PSP falsa, banco, ingressos e auditoria. Usa o provider
 * da aplicação (`getPaymentProvider`), porque é ele que `executarReembolso`
 * chama.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';
import type { FakeProvider } from '@/lib/payments/fake';
import { getPaymentProvider } from '@/lib/payments/provider';
import { executarReembolso } from '@/lib/refunds';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const conexao = postgres(DIRECT_URL, { max: 3, prepare: false });
const db = drizzle(conexao, { schema }) as unknown as PostgresJsDatabase<typeof schema>;

type Linha = Record<string, unknown>;
const linhas = async (q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Linha[];

const psp = getPaymentProvider() as FakeProvider;
const sufixo = Date.now().toString(36);
let tenantId: string;
let eventId: string;
let tipoId: string;
let produtor: string;
let operador: string;
let numero = 0;

beforeAll(async () => {
  // O provider da aplicação numera as transações do zero a cada processo.
  // Solta os números usados por execuções anteriores deste arquivo.
  await db.execute(sql`
    update orders set provider_transaction_id = null
     where idempotency_key like 'pb_%' and provider_transaction_id is not null
  `);

  operador = psp.criarRecebedorAtivo('op');
  produtor = psp.criarRecebedorAtivo('prod');

  const [t] = await linhas(sql`
    insert into tenants (slug, nome, email, provider_recipient_id)
    values (${`pb-${sufixo}`}, 'Problema Teste', 'pb@teste.local', ${produtor}) returning id
  `);
  tenantId = t!.id as string;
  const [v] = await linhas(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Casa', 500) returning id
  `);
  // O evento JÁ ACONTECEU, e não permite reembolso parcial: nada disso pode
  // impedir a devolução por falha na prestação do serviço.
  const [e] = await linhas(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status, permite_reembolso_parcial)
    values (${tenantId}, ${v!.id as string}, ${`ev-pb-${sufixo}`}, 'Show',
            now() - interval '3 days', now() - interval '3 days' + interval '5 hours',
            500, 'encerrado', false)
    returning id
  `);
  eventId = e!.id as string;
  const [tt] = await linhas(sql`
    insert into ticket_types (tenant_id, event_id, nome, preco_centavos, quantidade_total,
                              vendas_inicio, vendas_fim)
    values (${tenantId}, ${eventId}, 'Pista', 10000, 100,
            now() - interval '30 days', now() - interval '4 days')
    returning id
  `);
  tipoId = tt!.id as string;
});

afterAll(async () => {
  await conexao.end();
});

/** Pedido pago de 3 ingressos de R$ 110,00, um deles já usado na porta. */
async function pedidoPago(): Promise<string> {
  numero += 1;
  const tx = await psp.createTransaction({
    idempotencyKey: `pb_${sufixo}_${numero}`,
    orderId: `pb_${sufixo}_${numero}`,
    method: 'pix',
    amount: 33_000,
    customer: { name: 'C', email: 'c@t.local', document: '52998224725', documentType: 'cpf' },
    splits: [
      { providerRecipientId: operador, amount: 3_000, liableForChargeback: false, absorbsProcessingFee: false },
      { providerRecipientId: produtor, amount: 30_000, liableForChargeback: true, absorbsProcessingFee: true },
    ],
  });
  psp.simulatePayment(tx.providerTransactionId);

  const [o] = await linhas(sql`
    insert into orders
      (tenant_id, event_id, numero, comprador_nome, comprador_email, comprador_cpf,
       subtotal_centavos, conveniencia_centavos, total_centavos,
       valor_produtor_centavos, valor_operador_centavos,
       taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
       status, idempotency_key, metodo, provider_transaction_id, pago_em, criado_em)
    values (${tenantId}, ${eventId}, ${numero}, 'Comprador', 'c@t.local', '52998224725',
            30000, 3000, 33000, 30000, 3000, 1000, 0,
            'paid', ${`pb_${sufixo}_${numero}`}, 'pix', ${tx.providerTransactionId},
            now() - interval '20 days', now() - interval '20 days')
    returning id
  `);
  const orderId = o!.id as string;

  for (let i = 0; i < 3; i++) {
    await db.execute(sql`
      insert into tickets (tenant_id, event_id, order_id, ticket_type_id, codigo, token_hash,
                           titular_nome, status, checked_in_em)
      values (${tenantId}, ${eventId}, ${orderId}, ${tipoId},
              ${`PB${sufixo}${numero}${i}`.toUpperCase()}, ${`hash_${sufixo}_${numero}_${i}`},
              'Titular', ${i === 0 ? 'usado' : 'valido'},
              ${i === 0 ? sql`now() - interval '3 days'` : sql`null`})
    `);
  }
  return orderId;
}

async function situacao(orderId: string) {
  const [o] = await linhas(sql`select status from orders where id = ${orderId}`);
  const ingressos = await linhas(sql`
    select status from tickets where order_id = ${orderId} order by codigo
  `);
  const devolucoes = await linhas(sql`
    select tipo, valor_centavos, inclui_conveniencia, observacao, status
      from refunds where order_id = ${orderId}
  `);
  const [audit] = await linhas(sql`
    select depois from audit_log
     where acao = 'reembolso' and entidade_id = ${orderId}
     order by criado_em desc limit 1
  `);
  return {
    pedido: o!.status,
    ingressos: ingressos.map((t) => t.status),
    devolucoes,
    audit: audit?.depois as Record<string, unknown> | undefined,
  };
}

const RELATO = 'Atração principal anunciada não se apresentou.';

describe('reembolso por problema no evento', () => {
  it('sem o motivo, o evento encerrado recusa a devolução comum', async () => {
    const orderId = await pedidoPago();
    const r = await executarReembolso({ tenantId, orderId, quantidade: 3, motivo: 'buyer_request' });
    expect(r.ok).toBe(false);
  });

  it('integral depois do evento: devolve tudo, taxa incluída, e cancela só o que ainda valia', async () => {
    const orderId = await pedidoPago();
    const r = await executarReembolso({
      tenantId,
      orderId,
      quantidade: 3,
      motivo: 'other',
      problema: {
        problema: 'servico_diferente_do_ofertado',
        modalidade: 'integral',
        justificativa: RELATO,
      },
    });
    expect(r).toMatchObject({ ok: true, valorCentavos: 33_000, tipo: 'servico_diferente_do_ofertado' });

    const s = await situacao(orderId);
    expect(s.pedido).toBe('refunded');
    // O usado continua usado: a entrada aconteceu, e o histórico da porta não muda.
    expect(s.ingressos.sort()).toEqual(['cancelado', 'cancelado', 'usado']);
    expect(s.devolucoes[0]).toMatchObject({
      tipo: 'servico_diferente_do_ofertado',
      inclui_conveniencia: true,
      observacao: RELATO,
      status: 'succeeded',
    });
    expect(s.audit).toMatchObject({
      problema: 'servico_diferente_do_ofertado',
      modalidade: 'integral',
      justificativa: RELATO,
    });
  });

  it('um ingresso só, mesmo com o evento proibindo reembolso parcial', async () => {
    const orderId = await pedidoPago();
    const r = await executarReembolso({
      tenantId,
      orderId,
      quantidade: 1,
      motivo: 'other',
      problema: { problema: 'servico_nao_prestado', modalidade: 'integral', justificativa: RELATO },
    });
    expect(r).toMatchObject({ ok: true, valorCentavos: 11_000 });
    expect((await situacao(orderId)).pedido).toBe('partially_refunded');
  });

  it('abatimento devolve parte e mantém os ingressos valendo', async () => {
    const orderId = await pedidoPago();
    const r = await executarReembolso({
      tenantId,
      orderId,
      quantidade: 3,
      motivo: 'other',
      problema: {
        problema: 'servico_diferente_do_ofertado',
        modalidade: 'abatimento',
        abatimentoCentavos: 9_000,
        justificativa: RELATO,
      },
    });
    expect(r).toMatchObject({ ok: true, valorCentavos: 9_000 });

    const s = await situacao(orderId);
    expect(s.pedido).toBe('partially_refunded');
    expect(s.ingressos.sort()).toEqual(['usado', 'valido', 'valido']);
    expect(s.devolucoes[0]).toMatchObject({ inclui_conveniencia: false });
  });

  it('o estorno chega na PSP e sai do saldo do produtor', async () => {
    const antes = await psp.getBalance(produtor);
    const orderId = await pedidoPago();
    await executarReembolso({
      tenantId,
      orderId,
      quantidade: 3,
      motivo: 'event_canceled',
      problema: { problema: 'evento_nao_realizado', modalidade: 'integral', justificativa: RELATO },
    });
    const depois = await psp.getBalance(produtor);
    // Entrou 30.000 com a venda e saiu 30.000 com o estorno.
    expect(depois.available + depois.blocked).toBe(antes.available + antes.blocked);
  });
});
