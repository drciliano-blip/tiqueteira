import { beforeEach, describe, expect, it } from 'vitest';

import { calcularTaxas, montarSplits } from '@/lib/fees';
import { FakeProvider } from '@/lib/payments/fake';
import {
  conferirCapacidades,
  criarProvider,
  ProviderCapabilityError,
} from '@/lib/payments/provider';
import { PaymentProviderError, type CreateTransactionInput } from '@/lib/payments/types';

let psp: FakeProvider;
let operador: string;
let produtor: string;

beforeEach(() => {
  psp = new FakeProvider('segredo-de-teste');
  operador = psp.criarRecebedorAtivo('op');
  produtor = psp.criarRecebedorAtivo('prod');
});

function pedido(
  overrides: Partial<CreateTransactionInput> = {},
): CreateTransactionInput {
  const breakdown = calcularTaxas({
    subtotalCentavos: 10_000,
    quantidadeIngressos: 1,
    config: { taxaConvenienciaBps: 1000, comissaoBps: 500, taxaFixaCentavos: 150 },
  });
  const splits = montarSplits(breakdown, {
    operadorRecipientId: operador,
    produtorRecipientId: produtor,
  });

  return {
    idempotencyKey: 'ord-1',
    orderId: 'ord-1',
    method: 'pix',
    amount: breakdown.totalCentavos,
    customer: {
      name: 'Carla Souza',
      email: 'carla@exemplo.com.br',
      document: '12345678901',
      documentType: 'cpf',
    },
    splits,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('fábrica e capacidades', () => {
  it('o FakeProvider atende ao que o produto exige', () => {
    expect(() => conferirCapacidades(psp)).not.toThrow();
  });

  it('recusa PSP sem liberação condicional — sem ela não há reserva de garantia', () => {
    const capenga = {
      name: 'capenga',
      capabilities: { ...psp.capabilities, conditionalRelease: false },
    } as unknown as FakeProvider;

    expect(() => conferirCapacidades(capenga)).toThrow(ProviderCapabilityError);
  });

  it('recusa PAYMENT_PROVIDER=fake em produção', () => {
    expect(() => criarProvider('fake', { producao: true })).toThrow(/proibido em produção/i);
  });

  it('recusa PSP desconhecida em vez de cair no fake silenciosamente', () => {
    expect(() => criarProvider('psp-que-nao-existe')).toThrow(/desconhecida/i);
  });
});

describe('createTransaction', () => {
  it('cria cobrança Pix com QR e expiração', async () => {
    const tx = await psp.createTransaction(pedido());
    expect(tx.status).toBe('pending');
    expect(tx.amount).toBe(11_000);
    expect(tx.pix?.qrCode).toContain('FAKE');
    expect(tx.pix?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('é idempotente: a mesma chave devolve a mesma transação', async () => {
    const a = await psp.createTransaction(pedido());
    const b = await psp.createTransaction(pedido());
    expect(b.providerTransactionId).toBe(a.providerTransactionId);
  });

  it('recusa split que não fecha com o total', async () => {
    const p = pedido();
    p.splits = [{ ...p.splits[0]!, amount: p.amount - 1 }];
    await expect(psp.createTransaction(p)).rejects.toThrow(/splits/i);
  });

  it('recusa recebedor inexistente', async () => {
    const p = pedido();
    p.splits = [{ ...p.splits[0]!, providerRecipientId: 'rcpt_fantasma', amount: p.amount }];
    await expect(psp.createTransaction(p)).rejects.toThrow(/não existe/i);
  });

  it('recusa cartão sem token — o PAN nunca trafega pelo servidor', async () => {
    await expect(
      psp.createTransaction(pedido({ method: 'credit_card', installments: 3 })),
    ).rejects.toThrow(/cardToken/);
  });

  it('recusa parcelamento acima do permitido', async () => {
    await expect(
      psp.createTransaction(
        pedido({ method: 'credit_card', cardToken: 'tok_1', installments: 24 }),
      ),
    ).rejects.toThrow(/Parcelamento/);
  });

  it('recusa idempotencyKey vazia', async () => {
    await expect(psp.createTransaction(pedido({ idempotencyKey: '' }))).rejects.toThrow(
      /idempotencyKey/,
    );
  });
});

describe('pagamento e distribuição do split', () => {
  it('crédito vai para o saldo de cada recebedor', async () => {
    const tx = await psp.createTransaction(pedido());
    psp.simulatePayment(tx.providerTransactionId);

    expect((await psp.getBalance(operador)).available).toBe(1650);
    expect((await psp.getBalance(produtor)).available).toBe(9350);
    expect((await psp.getTransaction(tx.providerTransactionId)).status).toBe('paid');
  });

  it('parcela com retenção entra como bloqueada, não disponível', async () => {
    const breakdown = calcularTaxas({
      subtotalCentavos: 10_000,
      quantidadeIngressos: 1,
      config: { taxaConvenienciaBps: 1000, comissaoBps: 500, taxaFixaCentavos: 150 },
    });
    const splits = montarSplits(
      breakdown,
      { operadorRecipientId: operador, produtorRecipientId: produtor },
      { holdUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    );

    const tx = await psp.createTransaction(pedido({ splits }));
    psp.simulatePayment(tx.providerTransactionId);

    const saldoProdutor = await psp.getBalance(produtor);
    expect(saldoProdutor.blocked).toBe(9350);
    expect(saldoProdutor.available).toBe(0);

    // O operador recebe na hora — a retenção é só do produtor.
    expect((await psp.getBalance(operador)).available).toBe(1650);
  });

  it('não paga transação que não está pendente', async () => {
    const tx = await psp.createTransaction(pedido());
    psp.simulatePayment(tx.providerTransactionId);
    expect(() => psp.simulatePayment(tx.providerTransactionId)).toThrow(PaymentProviderError);
  });
});

describe('liberação de saldo retido', () => {
  async function pagarComRetencao() {
    const breakdown = calcularTaxas({
      subtotalCentavos: 10_000,
      quantidadeIngressos: 1,
      config: { taxaConvenienciaBps: 1000, comissaoBps: 500, taxaFixaCentavos: 150 },
    });
    const splits = montarSplits(
      breakdown,
      { operadorRecipientId: operador, produtorRecipientId: produtor },
      { holdUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    );
    const tx = await psp.createTransaction(pedido({ splits }));
    psp.simulatePayment(tx.providerTransactionId);
    return tx;
  }

  it('move do bloqueado para o disponível', async () => {
    await pagarComRetencao();
    await psp.releaseFunds({
      idempotencyKey: 'po-1',
      providerRecipientId: produtor,
      amount: 5000,
    });

    const s = await psp.getBalance(produtor);
    expect(s.blocked).toBe(4350);
    expect(s.available).toBe(5000);
  });

  it('é idempotente: repetir a chave não libera duas vezes', async () => {
    await pagarComRetencao();
    const entrada = { idempotencyKey: 'po-1', providerRecipientId: produtor, amount: 5000 };

    const a = await psp.releaseFunds(entrada);
    const b = await psp.releaseFunds(entrada);

    expect(b.providerPayoutId).toBe(a.providerPayoutId);
    expect((await psp.getBalance(produtor)).available).toBe(5000);
  });

  it('recusa liberar mais do que está retido', async () => {
    await pagarComRetencao();
    await expect(
      psp.releaseFunds({ idempotencyKey: 'po-x', providerRecipientId: produtor, amount: 99_999 }),
    ).rejects.toThrow(/excede o retido/i);
  });
});

describe('reembolso', () => {
  it('parcial e depois total, debitando na proporção do split', async () => {
    const tx = await psp.createTransaction(pedido());
    psp.simulatePayment(tx.providerTransactionId);

    await psp.refund({
      idempotencyKey: 'rf-1',
      providerTransactionId: tx.providerTransactionId,
      amount: 5500,
      reason: 'buyer_request',
    });

    expect((await psp.getTransaction(tx.providerTransactionId)).status).toBe('partially_refunded');
    // Metade de cada parcela: 1650/2 = 825 e 9350/2 = 4675
    expect((await psp.getBalance(operador)).available).toBe(1650 - 825);
    expect((await psp.getBalance(produtor)).available).toBe(9350 - 4675);

    await psp.refund({
      idempotencyKey: 'rf-2',
      providerTransactionId: tx.providerTransactionId,
      amount: 5500,
      reason: 'buyer_request',
    });

    expect((await psp.getTransaction(tx.providerTransactionId)).status).toBe('refunded');
    expect((await psp.getBalance(produtor)).available).toBe(0);
  });

  it('é idempotente: reentrega não debita duas vezes', async () => {
    const tx = await psp.createTransaction(pedido());
    psp.simulatePayment(tx.providerTransactionId);

    const entrada = {
      idempotencyKey: 'rf-1',
      providerTransactionId: tx.providerTransactionId,
      amount: 5500,
      reason: 'buyer_request' as const,
    };
    const a = await psp.refund(entrada);
    const b = await psp.refund(entrada);

    expect(b.providerRefundId).toBe(a.providerRefundId);
    expect((await psp.getBalance(produtor)).available).toBe(9350 - 4675);
  });

  it('recusa reembolso maior que o restante', async () => {
    const tx = await psp.createTransaction(pedido());
    psp.simulatePayment(tx.providerTransactionId);

    await expect(
      psp.refund({
        idempotencyKey: 'rf-1',
        providerTransactionId: tx.providerTransactionId,
        amount: 20_000,
        reason: 'buyer_request',
      }),
    ).rejects.toThrow(/excede/i);
  });

  it('recusa reembolso de transação não paga', async () => {
    const tx = await psp.createTransaction(pedido());
    await expect(
      psp.refund({
        idempotencyKey: 'rf-1',
        providerTransactionId: tx.providerTransactionId,
        amount: 100,
        reason: 'buyer_request',
      }),
    ).rejects.toThrow(/paga/i);
  });
});

describe('chargeback', () => {
  it('debita quem foi marcado como responsável no split', async () => {
    const tx = await psp.createTransaction(pedido());
    psp.simulatePayment(tx.providerTransactionId);

    psp.simulateChargeback(tx.providerTransactionId);

    // Por padrão o produtor arca: perde o valor cheio da transação.
    expect((await psp.getBalance(produtor)).available).toBe(9350 - 11_000);
    // O operador não é tocado.
    expect((await psp.getBalance(operador)).available).toBe(1650);
  });

  it('produz saldo a descoberto, sem esconder o prejuízo', async () => {
    // Caso de borda 5 do plano: chargeback depois do repasse liberado.
    const tx = await psp.createTransaction(pedido());
    psp.simulatePayment(tx.providerTransactionId);
    psp.simulateChargeback(tx.providerTransactionId);

    expect((await psp.getBalance(produtor)).available).toBeLessThan(0);
  });
});

describe('webhook', () => {
  it('aceita assinatura válida', () => {
    const evento = { providerEventId: 'evt_1', type: 'transaction.paid' as const, occurredAt: new Date(), raw: {} };
    const { body, headers } = psp.envelope(evento);
    expect(psp.verifyWebhook(body, headers)).toBe(true);
  });

  it('recusa corpo adulterado — a assinatura é sobre bytes', () => {
    const evento = { providerEventId: 'evt_1', type: 'transaction.paid' as const, occurredAt: new Date(), raw: {} };
    const { body, headers } = psp.envelope(evento);
    expect(psp.verifyWebhook(body.replace('evt_1', 'evt_2'), headers)).toBe(false);
  });

  it('recusa requisição sem assinatura', () => {
    expect(psp.verifyWebhook('{}', {})).toBe(false);
  });

  it('recusa assinatura de outro segredo', () => {
    const outra = new FakeProvider('outro-segredo');
    const evento = { providerEventId: 'evt_1', type: 'transaction.paid' as const, occurredAt: new Date(), raw: {} };
    const { body, headers } = outra.envelope(evento);
    expect(psp.verifyWebhook(body, headers)).toBe(false);
  });

  it('normaliza o evento', async () => {
    const tx = await psp.createTransaction(pedido());
    const evento = psp.simulatePayment(tx.providerTransactionId);
    const { body } = psp.envelope(evento);

    const normalizado = psp.parseWebhook(body);
    expect(normalizado.providerEventId).toBe(evento.providerEventId);
    expect(normalizado.type).toBe('transaction.paid');
    expect(normalizado.providerTransactionId).toBe(tx.providerTransactionId);
    expect(normalizado.amount).toBe(11_000);
  });

  it('recusa corpo que não é JSON', () => {
    expect(() => psp.parseWebhook('<html>502 Bad Gateway</html>')).toThrow(PaymentProviderError);
  });
});

describe('controles de cenário', () => {
  it('failNext força erro só na próxima chamada', async () => {
    psp.failNext(
      'createTransaction',
      new PaymentProviderError('PSP fora do ar', 'unavailable', true),
    );

    await expect(psp.createTransaction(pedido())).rejects.toThrow('PSP fora do ar');
    // Caso de borda 14: a retentativa precisa funcionar.
    await expect(psp.createTransaction(pedido())).resolves.toMatchObject({ status: 'pending' });
  });

  it('o erro carrega se é retryable', async () => {
    psp.failNext('refund', new PaymentProviderError('timeout', 'network', true));
    await expect(
      psp.refund({
        idempotencyKey: 'rf',
        providerTransactionId: 'x',
        amount: 1,
        reason: 'other',
      }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('setLatency atrasa de verdade', async () => {
    psp.setLatency(60);
    const inicio = Date.now();
    await psp.getBalance(produtor);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(50);
  });

  it('reset limpa tudo', async () => {
    const tx = await psp.createTransaction(pedido());
    psp.reset();
    await expect(psp.getTransaction(tx.providerTransactionId)).rejects.toThrow(/não existe/i);
  });

  it('recebedor criado por API nasce pendente, e só depois é aprovado', async () => {
    const r = await psp.createRecipient({
      tenantId: 't1',
      legalName: 'Produtora LTDA',
      document: '11222333000181',
      documentType: 'cnpj',
      email: 'p@exemplo.com',
      phone: '11999999999',
      address: {
        street: 'Rua A', number: '1', neighborhood: 'Centro',
        city: 'São Paulo', state: 'SP', zipCode: '01000000',
      },
      bankAccount: {
        bankCode: '001', branch: '1234', account: '56789', accountDigit: '0',
        accountType: 'checking', holderName: 'Produtora LTDA',
        holderDocument: '11222333000181',
      },
    });

    expect(r.status).toBe('pending');
    psp.simulateRecipientApproval(r.providerRecipientId);
    expect((await psp.getRecipient(r.providerRecipientId)).status).toBe('active');
  });
});
