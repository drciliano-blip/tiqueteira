import { describe, expect, it } from 'vitest';

import {
  aplicarBps,
  assertCents,
  formatarBRL,
  MoneyError,
  reaisParaCentavos,
  repartir,
} from '@/lib/money';

describe('assertCents', () => {
  it('aceita inteiro', () => {
    expect(() => assertCents(0)).not.toThrow();
    expect(() => assertCents(-1)).not.toThrow();
  });

  it('recusa fracionário — é assim que float entra no sistema', () => {
    expect(() => assertCents(10.5)).toThrow(MoneyError);
    expect(() => assertCents(0.1 + 0.2)).toThrow(MoneyError);
  });

  it('recusa NaN e Infinity', () => {
    expect(() => assertCents(Number.NaN)).toThrow(MoneyError);
    expect(() => assertCents(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe('aplicarBps', () => {
  it('calcula percentuais conhecidos', () => {
    expect(aplicarBps(10_000, 1000)).toBe(1000); // 10% de R$ 100 = R$ 10
    expect(aplicarBps(10_000, 0)).toBe(0);
    expect(aplicarBps(10_000, 10_000)).toBe(10_000); // 100%
    expect(aplicarBps(5000, 1200)).toBe(600); // 12% de R$ 50 = R$ 6
  });

  it('arredonda metade para longe do zero, não para +infinito', () => {
    // 1 centavo a 50% = 0,5 → 1, e não 0.
    expect(aplicarBps(1, 5000)).toBe(1);
    // O caso que o Math.round do JavaScript erra:
    expect(aplicarBps(-1, 5000)).toBe(-1);
  });

  it('nunca devolve fracionário', () => {
    for (let v = 1; v <= 5000; v++) {
      for (const bps of [1, 33, 250, 1000, 1234, 9999]) {
        expect(Number.isInteger(aplicarBps(v, bps))).toBe(true);
      }
    }
  });

  it('recusa bps negativo', () => {
    expect(() => aplicarBps(100, -1)).toThrow(MoneyError);
  });
});

describe('repartir', () => {
  it('a soma das partes é sempre exatamente o total', () => {
    const casos: [number, number[]][] = [
      [100, [1, 1, 1]],
      [1, [1, 1, 1]],
      [7, [1, 1, 1]],
      [10_000, [3, 5, 7, 11]],
      [999, [1]],
      [0, [1, 2, 3]],
      [-100, [1, 1, 1]], // estorno
    ];
    for (const [total, pesos] of casos) {
      const partes = repartir(total, pesos);
      expect(partes.reduce((a, b) => a + b, 0), `total=${total} pesos=${pesos}`).toBe(total);
      expect(partes.every(Number.isInteger)).toBe(true);
    }
  });

  it('reparte de forma determinística', () => {
    expect(repartir(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(repartir(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
  });

  it('com pesos iguais a zero, divide igualmente', () => {
    expect(repartir(10, [0, 0, 0])).toEqual([4, 3, 3]);
  });

  it('varredura: soma bate para qualquer total até 2000 em 5 partes', () => {
    for (let total = 0; total <= 2000; total++) {
      const partes = repartir(total, [1, 2, 3, 4, 5]);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('reaisParaCentavos', () => {
  it('lê os formatos que aparecem na vida real', () => {
    expect(reaisParaCentavos('12,34')).toBe(1234);
    expect(reaisParaCentavos('R$ 12,34')).toBe(1234);
    expect(reaisParaCentavos('1.234,56')).toBe(123_456);
    expect(reaisParaCentavos('100')).toBe(10_000);
    expect(reaisParaCentavos('0,01')).toBe(1);
    expect(reaisParaCentavos('-5,00')).toBe(-500);
  });

  it('recusa entrada inválida em vez de adivinhar', () => {
    expect(() => reaisParaCentavos('abc')).toThrow(MoneyError);
    expect(() => reaisParaCentavos('12,345')).toThrow(MoneyError);
    expect(() => reaisParaCentavos('')).toThrow(MoneyError);
  });
});

describe('formatarBRL', () => {
  it('formata para exibição', () => {
    expect(formatarBRL(1234)).toBe('R$ 12,34');
    expect(formatarBRL(0)).toBe('R$ 0,00');
    expect(formatarBRL(5)).toBe('R$ 0,05');
    expect(formatarBRL(123_456_789)).toBe('R$ 1.234.567,89');
    expect(formatarBRL(-500)).toBe('-R$ 5,00');
  });
});
