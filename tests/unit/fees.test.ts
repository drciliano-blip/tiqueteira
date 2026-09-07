import { describe, expect, it } from 'vitest';

import {
  calcularTaxas,
  conferirSplits,
  montarSplits,
  type FeeConfig,
} from '@/lib/fees';
import { MoneyError } from '@/lib/money';

const ALVOS = { operadorRecipientId: 'rcpt_op', produtorRecipientId: 'rcpt_prod' };

/** Configurações que representam cenários reais de tenant. */
const CONFIGS: Record<string, FeeConfig> = {
  padrao: { taxaConvenienciaBps: 1000, comissaoBps: 500, taxaFixaCentavos: 150 },
  soConveniencia: { taxaConvenienciaBps: 1200, comissaoBps: 0, taxaFixaCentavos: 0 },
  soComissao: { taxaConvenienciaBps: 0, comissaoBps: 1500, taxaFixaCentavos: 0 },
  semTaxa: { taxaConvenienciaBps: 0, comissaoBps: 0, taxaFixaCentavos: 0 },
  fixaAlta: { taxaConvenienciaBps: 800, comissaoBps: 0, taxaFixaCentavos: 500 },
  quebrada: { taxaConvenienciaBps: 833, comissaoBps: 377, taxaFixaCentavos: 99 },
};

describe('calcularTaxas — casos conhecidos', () => {
  it('R$ 100,00 com 10% de conveniência e 5% de comissão', () => {
    const b = calcularTaxas({
      subtotalCentavos: 10_000,
      quantidadeIngressos: 1,
      config: CONFIGS.padrao!,
    });

    expect(b.convenienciaCentavos).toBe(1000); // R$ 10,00
    expect(b.totalCentavos).toBe(11_000); // comprador paga R$ 110,00
    expect(b.comissaoCentavos).toBe(500); // R$ 5,00
    expect(b.taxaFixaTotalCentavos).toBe(150); // R$ 1,50
    expect(b.valorOperadorCentavos).toBe(1650); // 1000 + 500 + 150
    expect(b.valorProdutorCentavos).toBe(9350); // 11000 - 1650
  });

  it('sem taxa nenhuma, tudo vai para o produtor', () => {
    const b = calcularTaxas({
      subtotalCentavos: 5000,
      quantidadeIngressos: 2,
      config: CONFIGS.semTaxa!,
    });
    expect(b.totalCentavos).toBe(5000);
    expect(b.valorOperadorCentavos).toBe(0);
    expect(b.valorProdutorCentavos).toBe(5000);
  });

  it('a conveniência incide sobre o valor já descontado', () => {
    // R$ 100 - R$ 20 de cupom = R$ 80. 10% de 80 = R$ 8, não R$ 10.
    const b = calcularTaxas({
      subtotalCentavos: 10_000,
      descontoCentavos: 2000,
      quantidadeIngressos: 1,
      config: CONFIGS.soConveniencia!,
    });
    expect(b.baseCentavos).toBe(8000);
    expect(b.convenienciaCentavos).toBe(960); // 12% de 8000
    expect(b.totalCentavos).toBe(8960);
  });
});

describe('calcularTaxas — o invariante que não pode quebrar', () => {
  it('operador + produtor = total, em toda faixa de R$ 0,01 a R$ 10.000,00', () => {
    // Varredura exaustiva na faixa onde os arredondamentos mais mordem,
    // depois amostragem até o teto.
    const valores: number[] = [];
    for (let v = 1; v <= 5000; v++) valores.push(v);
    for (let v = 5001; v <= 1_000_000; v += 997) valores.push(v);

    for (const config of Object.values(CONFIGS)) {
      for (const subtotal of valores) {
        for (const qtd of [1, 3]) {
          const b = calcularTaxas({
            subtotalCentavos: subtotal,
            quantidadeIngressos: qtd,
            config,
          });

          expect(
            b.valorOperadorCentavos + b.valorProdutorCentavos,
            `subtotal=${subtotal} qtd=${qtd} config=${JSON.stringify(config)}`,
          ).toBe(b.totalCentavos);

          expect(Number.isInteger(b.totalCentavos)).toBe(true);
          expect(b.valorOperadorCentavos).toBeGreaterThanOrEqual(0);
          expect(b.valorProdutorCentavos).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('o total é sempre base + conveniência, sem centavo perdido', () => {
    for (let subtotal = 1; subtotal <= 3000; subtotal++) {
      const b = calcularTaxas({
        subtotalCentavos: subtotal,
        quantidadeIngressos: 1,
        config: CONFIGS.quebrada!,
      });
      expect(b.totalCentavos).toBe(b.baseCentavos + b.convenienciaCentavos);
    }
  });

  it('o centavo residual do arredondamento fica com o operador, nunca some', () => {
    // 1 centavo com 8,33% de conveniência arredonda para 0: o comprador paga
    // 1 centavo e o produtor recebe tudo. Nada evapora.
    const b = calcularTaxas({
      subtotalCentavos: 1,
      quantidadeIngressos: 1,
      config: { taxaConvenienciaBps: 833, comissaoBps: 0, taxaFixaCentavos: 0 },
    });
    expect(b.convenienciaCentavos).toBe(0);
    expect(b.totalCentavos).toBe(1);
    expect(b.valorOperadorCentavos + b.valorProdutorCentavos).toBe(1);
  });
});

describe('calcularTaxas — bordas', () => {
  it('pedido zerado (cortesia) não quebra', () => {
    const b = calcularTaxas({
      subtotalCentavos: 0,
      quantidadeIngressos: 2,
      config: CONFIGS.padrao!,
    });
    expect(b.totalCentavos).toBe(0);
    expect(b.valorOperadorCentavos).toBe(0);
    expect(b.valorProdutorCentavos).toBe(0);
  });

  it('cupom que zera o total não gera parcela negativa', () => {
    const b = calcularTaxas({
      subtotalCentavos: 10_000,
      descontoCentavos: 10_000,
      quantidadeIngressos: 1,
      config: CONFIGS.padrao!,
    });
    expect(b.totalCentavos).toBe(0);
    expect(b.valorProdutorCentavos).toBe(0);
  });

  it('taxa fixa maior que o ingresso: o produtor fica em zero, nunca negativo', () => {
    // Ingresso de R$ 1,00 com taxa fixa de R$ 5,00.
    const b = calcularTaxas({
      subtotalCentavos: 100,
      quantidadeIngressos: 1,
      config: CONFIGS.fixaAlta!,
    });
    expect(b.valorProdutorCentavos).toBe(0);
    expect(b.valorOperadorCentavos).toBe(b.totalCentavos);
  });

  it('desconto maior que o subtotal é recusado, não silenciado', () => {
    expect(() =>
      calcularTaxas({
        subtotalCentavos: 1000,
        descontoCentavos: 2000,
        quantidadeIngressos: 1,
        config: CONFIGS.padrao!,
      }),
    ).toThrow(MoneyError);
  });

  it('valor fracionário na entrada é recusado', () => {
    expect(() =>
      calcularTaxas({
        subtotalCentavos: 10.5,
        quantidadeIngressos: 1,
        config: CONFIGS.padrao!,
      }),
    ).toThrow(MoneyError);
  });
});

describe('montarSplits', () => {
  it('a soma das parcelas é exatamente o total', () => {
    for (const config of Object.values(CONFIGS)) {
      for (let subtotal = 1; subtotal <= 2000; subtotal++) {
        const b = calcularTaxas({ subtotalCentavos: subtotal, quantidadeIngressos: 2, config });
        const splits = montarSplits(b, ALVOS);
        const soma = splits.reduce((a, r) => a + r.amount, 0);
        expect(soma, `subtotal=${subtotal}`).toBe(b.totalCentavos);
      }
    }
  });

  it('por padrão o produtor arca com chargeback e taxa da PSP', () => {
    const b = calcularTaxas({
      subtotalCentavos: 10_000,
      quantidadeIngressos: 1,
      config: CONFIGS.padrao!,
    });
    const splits = montarSplits(b, ALVOS);

    const operador = splits.find((s) => s.providerRecipientId === 'rcpt_op');
    const produtor = splits.find((s) => s.providerRecipientId === 'rcpt_prod');

    expect(operador?.liableForChargeback).toBe(false);
    expect(operador?.absorbsProcessingFee).toBe(false);
    expect(produtor?.liableForChargeback).toBe(true);
    expect(produtor?.absorbsProcessingFee).toBe(true);
  });

  it('a retenção vai só para a parcela do produtor', () => {
    const holdUntil = new Date('2026-12-01T00:00:00Z');
    const b = calcularTaxas({
      subtotalCentavos: 10_000,
      quantidadeIngressos: 1,
      config: CONFIGS.padrao!,
    });
    const splits = montarSplits(b, ALVOS, { holdUntil });

    expect(splits.find((s) => s.providerRecipientId === 'rcpt_prod')?.holdUntil).toEqual(holdUntil);
    expect(splits.find((s) => s.providerRecipientId === 'rcpt_op')?.holdUntil).toBeUndefined();
  });

  it('pedido de total zero não gera split — não há transação na PSP', () => {
    // Caso de borda 8 do plano.
    const b = calcularTaxas({
      subtotalCentavos: 0,
      quantidadeIngressos: 1,
      config: CONFIGS.padrao!,
    });
    expect(montarSplits(b, ALVOS)).toEqual([]);
  });

  it('nunca emite parcela de valor zero', () => {
    const b = calcularTaxas({
      subtotalCentavos: 5000,
      quantidadeIngressos: 1,
      config: CONFIGS.semTaxa!,
    });
    const splits = montarSplits(b, ALVOS);
    expect(splits).toHaveLength(1);
    expect(splits[0]!.providerRecipientId).toBe('rcpt_prod');
  });

  it('recusa recebedor faltando', () => {
    const b = calcularTaxas({
      subtotalCentavos: 5000,
      quantidadeIngressos: 1,
      config: CONFIGS.padrao!,
    });
    expect(() => montarSplits(b, { ...ALVOS, produtorRecipientId: '' })).toThrow(MoneyError);
  });
});

describe('conferirSplits', () => {
  it('acusa split que não fecha antes de chegar na PSP', () => {
    expect(() =>
      conferirSplits(
        [
          { providerRecipientId: 'a', amount: 100, liableForChargeback: false, absorbsProcessingFee: false },
          { providerRecipientId: 'b', amount: 100, liableForChargeback: true, absorbsProcessingFee: true },
        ],
        250,
      ),
    ).toThrow(MoneyError);
  });
});
