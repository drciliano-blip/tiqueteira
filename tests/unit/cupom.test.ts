import { describe, expect, it } from 'vitest';

import {
  avaliarCupom,
  descontoDoCupom,
  descreverCupom,
  normalizarCodigo,
  type EstadoCupom,
} from '@/domain/cupom';

const AGORA = new Date('2026-09-10T12:00:00Z');

const base: EstadoCupom = {
  tipo: 'pct',
  valor: 1000, // 10%
  ativo: true,
  validoAte: null,
  usosMaximos: null,
  usosAtuais: 0,
  eventId: null,
};

const avaliar = (cupom: Partial<EstadoCupom>, eventId = 'evento-1') =>
  avaliarCupom({ cupom: { ...base, ...cupom }, eventId, agora: AGORA });

describe('avaliarCupom', () => {
  it('aceita cupom aberto', () => {
    expect(avaliar({})).toEqual({ valido: true });
  });

  it('recusa cupom desativado', () => {
    expect(avaliar({ ativo: false })).toMatchObject({ valido: false, motivo: 'inativo' });
  });

  it('recusa cupom vencido', () => {
    expect(avaliar({ validoAte: new Date('2026-09-09T12:00:00Z') })).toMatchObject({
      motivo: 'expirado',
    });
  });

  it('aceita no último instante de validade', () => {
    expect(avaliar({ validoAte: AGORA })).toEqual({ valido: true });
  });

  it('recusa cupom que estourou os usos', () => {
    expect(avaliar({ usosMaximos: 100, usosAtuais: 100 })).toMatchObject({
      motivo: 'esgotado',
    });
  });

  it('aceita no penúltimo uso', () => {
    expect(avaliar({ usosMaximos: 100, usosAtuais: 99 })).toEqual({ valido: true });
  });

  it('recusa cupom de outro evento', () => {
    expect(avaliar({ eventId: 'evento-2' })).toMatchObject({ motivo: 'outro_evento' });
  });

  it('aceita cupom da casa inteira em qualquer evento', () => {
    expect(avaliar({ eventId: null }, 'qualquer-evento')).toEqual({ valido: true });
  });

  it('dá sempre a mesma frase ao comprador', () => {
    // Distinguir "esgotou" de "não vale aqui" ensina quem está adivinhando
    // código alheio. Quem precisa da distinção é o produtor, no painel.
    const recusas = [
      avaliar({ ativo: false }),
      avaliar({ validoAte: new Date('2026-01-01') }),
      avaliar({ usosMaximos: 1, usosAtuais: 1 }),
      avaliar({ eventId: 'outro' }),
    ];

    const frases = new Set(
      recusas.map((r) => (r.valido ? 'ok' : r.explicacao)),
    );
    expect(frases.size).toBe(1);
  });
});

describe('descontoDoCupom', () => {
  it('aplica percentual em basis points', () => {
    expect(descontoDoCupom({ ...base, tipo: 'pct', valor: 1500 }, 10_000)).toBe(1500);
  });

  it('aplica valor fixo em centavos', () => {
    expect(descontoDoCupom({ ...base, tipo: 'valor', valor: 2500 }, 10_000)).toBe(2500);
  });

  it('nunca desconta mais que o subtotal', () => {
    // Total negativo quebraria o invariante de que o split fecha com o total.
    expect(descontoDoCupom({ ...base, tipo: 'valor', valor: 5000 }, 3000)).toBe(3000);
  });

  it('cem por cento zera o subtotal e para aí', () => {
    expect(descontoDoCupom({ ...base, tipo: 'pct', valor: 10_000 }, 7300)).toBe(7300);
  });

  it('não inventa desconto sobre subtotal zero', () => {
    expect(descontoDoCupom({ ...base, tipo: 'valor', valor: 5000 }, 0)).toBe(0);
  });

  it('devolve inteiro, sempre', () => {
    // Centavo fracionado é o começo de todo bug de dinheiro.
    const d = descontoDoCupom({ ...base, tipo: 'pct', valor: 3333 }, 999);
    expect(Number.isInteger(d)).toBe(true);
  });
});

describe('normalizarCodigo', () => {
  it('tira espaço e sobe a caixa', () => {
    expect(normalizarCodigo('  meu cupom ')).toBe('MEUCUPOM');
  });

  it('aguenta o dedo no celular', () => {
    expect(normalizarCodigo('Verao 2026')).toBe('VERAO2026');
  });
});

describe('descreverCupom', () => {
  it('descreve percentual com vírgula', () => {
    expect(descreverCupom({ tipo: 'pct', valor: 1550 })).toBe('15,5% de desconto');
  });

  it('descreve valor em reais', () => {
    expect(descreverCupom({ tipo: 'valor', valor: 2500 })).toBe('R$ 25,00 de desconto');
  });
});
