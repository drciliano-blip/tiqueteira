import { describe, expect, it } from 'vitest';

import {
  aplicarEvento,
  contaParaLimiteCpf,
  ehTerminal,
  ESTADOS_TERMINAIS,
  estadoAlvoDoEvento,
  foiPago,
  ocupaEstoque,
  ORDER_STATUSES,
  podeTransicionar,
  transicionar,
  transicoesPossiveis,
  type OrderStatus,
} from '@/domain/order';
import type { WebhookEventType } from '@/lib/payments/types';

/** Toda transição válida, declarada aqui de novo, de propósito. */
const VALIDAS: [OrderStatus, OrderStatus][] = [
  ['draft', 'awaiting_payment'],
  ['draft', 'canceled'],
  ['draft', 'expired'],
  ['awaiting_payment', 'paid'],
  ['awaiting_payment', 'expired'],
  ['awaiting_payment', 'canceled'],
  ['paid', 'partially_refunded'],
  ['paid', 'refunded'],
  ['paid', 'chargeback'],
  ['partially_refunded', 'refunded'],
  ['partially_refunded', 'chargeback'],
];

describe('transições válidas', () => {
  it.each(VALIDAS)('%s → %s é permitida', (de, para) => {
    expect(podeTransicionar(de, para)).toBe(true);
    expect(transicionar(de, para)).toEqual({ ok: true, de, para });
  });
});

describe('transições inválidas', () => {
  /**
   * Cobertura por complemento: tudo que não está em VALIDAS precisa ser
   * recusado. É a única forma de garantir que ninguém abriu uma transição
   * nova sem pensar — 64 pares, um a um.
   */
  it('todo par fora da tabela é recusado', () => {
    const permitidas = new Set(VALIDAS.map(([a, b]) => `${a}>${b}`));

    for (const de of ORDER_STATUSES) {
      for (const para of ORDER_STATUSES) {
        if (de === para) continue;
        const esperado = permitidas.has(`${de}>${para}`);
        expect(podeTransicionar(de, para), `${de} → ${para}`).toBe(esperado);
      }
    }
  });

  it('pedido não pago não pode virar reembolsado', () => {
    expect(transicionar('awaiting_payment', 'refunded')).toMatchObject({
      ok: false,
      motivo: 'nao_permitida',
    });
  });

  it('pedido expirado não ressuscita', () => {
    expect(transicionar('expired', 'paid')).toMatchObject({
      ok: false,
      motivo: 'estado_terminal',
    });
  });

  it('pedido reembolsado não volta a ser pago', () => {
    expect(transicionar('refunded', 'paid')).toMatchObject({
      ok: false,
      motivo: 'estado_terminal',
    });
  });

  it('chargeback é terminal', () => {
    expect(transicoesPossiveis('chargeback')).toEqual([]);
  });
});

describe('reentrega de webhook', () => {
  it('ir para o mesmo estado é recusado com motivo próprio, não como erro', () => {
    // Dois webhooks `paid` para a mesma transação — caso de borda 2.
    // Precisa ser distinguível de "transição proibida", senão o handler não
    // sabe se responde 200 e segue ou se registra como anomalia.
    expect(transicionar('paid', 'paid')).toEqual({
      ok: false,
      motivo: 'ja_esta_assim',
      de: 'paid',
      para: 'paid',
    });
  });
});

describe('estados terminais', () => {
  it('são exatamente estes quatro', () => {
    expect([...ESTADOS_TERMINAIS].sort()).toEqual([
      'canceled',
      'chargeback',
      'expired',
      'refunded',
    ]);
  });

  it('nenhum estado terminal tem saída', () => {
    for (const s of ESTADOS_TERMINAIS) {
      expect(ehTerminal(s)).toBe(true);
      expect(transicoesPossiveis(s)).toEqual([]);
    }
  });
});

describe('leituras de negócio', () => {
  it('foiPago cobre todo estado em que o dinheiro entrou', () => {
    expect(ORDER_STATUSES.filter(foiPago).sort()).toEqual([
      'chargeback',
      'paid',
      'partially_refunded',
      'refunded',
    ]);
  });

  it('ocupaEstoque inclui reembolso parcial', () => {
    // O reembolso parcial devolve dinheiro, mas os ingressos não
    // reembolsados continuam válidos e ocupando lugar.
    expect(ocupaEstoque('partially_refunded')).toBe(true);
    expect(ocupaEstoque('refunded')).toBe(false);
    expect(ocupaEstoque('expired')).toBe(false);
    expect(ocupaEstoque('chargeback')).toBe(false);
  });

  it('o limite por CPF conta pedido aguardando pagamento', () => {
    // Senão o comprador abre dez abas e fura o limite — caso de borda 16.
    expect(contaParaLimiteCpf('awaiting_payment')).toBe(true);
    expect(contaParaLimiteCpf('paid')).toBe(true);
    expect(contaParaLimiteCpf('expired')).toBe(false);
    expect(contaParaLimiteCpf('draft')).toBe(false);
  });
});

describe('evento da PSP → estado', () => {
  const mapa: [WebhookEventType, string | null][] = [
    ['transaction.paid', 'paid'],
    ['transaction.failed', 'canceled'],
    ['transaction.expired', 'expired'],
    ['transaction.refunded', 'refunded'],
    ['transaction.chargeback', 'chargeback'],
    ['recipient.status_changed', null],
    ['payout.completed', null],
    ['payout.failed', null],
    ['unknown', null],
  ];

  it.each(mapa)('%s → %s', (tipo, esperado) => {
    expect(estadoAlvoDoEvento(tipo)).toBe(esperado);
  });

  it('pagamento normal avança o pedido', () => {
    expect(aplicarEvento('awaiting_payment', 'transaction.paid')).toMatchObject({ ok: true });
  });

  it('webhook fora de ordem não força a transição', () => {
    // `refunded` antes de `paid` — caso de borda 3. O handler registra e
    // responde 200; devolver erro faria a PSP reentregar para sempre.
    expect(aplicarEvento('awaiting_payment', 'transaction.refunded')).toMatchObject({
      ok: false,
      motivo: 'nao_permitida',
    });
  });

  it('evento que não é do pedido é irrelevante, não inválido', () => {
    expect(aplicarEvento('paid', 'payout.completed')).toMatchObject({
      ok: false,
      motivo: 'evento_irrelevante',
    });
  });

  it('Pix pago depois da expiração não reabre o pedido', () => {
    // Caso de borda 1. O estoque já voltou para a venda; forçar `paid` aqui
    // venderia um ingresso que não existe mais. O pedido fica expirado e a
    // aplicação dispara reembolso automático.
    expect(aplicarEvento('expired', 'transaction.paid')).toMatchObject({
      ok: false,
      motivo: 'estado_terminal',
    });
  });
});
