import { describe, expect, it } from 'vitest';

import {
  estimarEspera,
  intervaloDeConsultaSegundos,
  quantosChamar,
  ritmoObservado,
  situacaoNaFila,
} from '@/domain/fila';

/**
 * A fila não deixa o sistema mais rápido — deixa previsível. Estes testes
 * guardam a previsibilidade: posição que não anda para trás, estimativa que
 * não inventa número, e chamada que nunca dá vaga a quem ainda não chegou.
 */

describe('situacaoNaFila', () => {
  it('admite quem já foi chamado', () => {
    expect(situacaoNaFila({ numero: 40, chamadosAte: 200 }, 100)).toEqual({
      situacao: 'admitido',
    });
  });

  it('admite quem está exatamente na marca', () => {
    expect(situacaoNaFila({ numero: 200, chamadosAte: 200 }, null)).toEqual({
      situacao: 'admitido',
    });
  });

  it('conta quem está na frente sem contar a própria pessoa', () => {
    // Quem é o 201 com 200 chamados é o próximo: ninguém na frente.
    expect(situacaoNaFila({ numero: 201, chamadosAte: 200 }, null)).toMatchObject({
      situacao: 'aguardando',
      pessoasNaFrente: 0,
    });
  });

  it('mede a distância corretamente no meio da fila', () => {
    expect(situacaoNaFila({ numero: 1000, chamadosAte: 200 }, null)).toMatchObject({
      pessoasNaFrente: 799,
    });
  });
});

describe('estimarEspera', () => {
  it('não inventa número enquanto não há ritmo medido', () => {
    // Dizer "não sei ainda" é melhor que um número que a pessoa vai usar para
    // decidir se fica ou desiste.
    expect(estimarEspera(5000, null)).toBeNull();
    expect(estimarEspera(5000, 0)).toBeNull();
  });

  it('divide a fila pelo ritmo observado', () => {
    expect(estimarEspera(600, 200)).toBe(3);
  });

  it('arredonda para cima: prometer menos do que entrega é pior', () => {
    expect(estimarEspera(601, 200)).toBe(4);
  });

  it('nunca promete zero para quem ainda tem gente na frente', () => {
    expect(estimarEspera(1, 500)).toBe(1);
  });

  it('devolve zero para quem não tem ninguém na frente', () => {
    expect(estimarEspera(0, 200)).toBe(0);
  });
});

describe('quantosChamar', () => {
  it('chama até encher a capacidade', () => {
    expect(
      quantosChamar({ capacidade: 200, comprandoAgora: 50, ultimoNumero: 9000, chamadosAte: 300 }),
    ).toBe(150);
  });

  it('não chama ninguém com a capacidade cheia', () => {
    expect(
      quantosChamar({ capacidade: 200, comprandoAgora: 200, ultimoNumero: 9000, chamadosAte: 300 }),
    ).toBe(0);
  });

  it('nunca passa à frente de quem ainda não chegou', () => {
    // Se a marca d'água ultrapassasse o último número, a fila daria vaga a
    // quem entrar depois — e essa pessoa passaria na frente de todo mundo.
    expect(
      quantosChamar({ capacidade: 200, comprandoAgora: 0, ultimoNumero: 310, chamadosAte: 300 }),
    ).toBe(10);
  });

  it('aguenta capacidade menor que o que já está comprando', () => {
    // O produtor pode reduzir a capacidade no meio da venda.
    expect(
      quantosChamar({ capacidade: 50, comprandoAgora: 200, ultimoNumero: 9000, chamadosAte: 300 }),
    ).toBe(0);
  });
});

describe('ritmoObservado', () => {
  it('converte avanço por segundo em pessoas por minuto', () => {
    expect(
      ritmoObservado({ chamadosAte: 400, marcaAnterior: 200, segundosDesdeAnterior: 60 }),
    ).toBe(200);
  });

  it('devolve nulo quando a fila não andou', () => {
    expect(
      ritmoObservado({ chamadosAte: 200, marcaAnterior: 200, segundosDesdeAnterior: 60 }),
    ).toBeNull();
  });

  it('devolve nulo sem tempo decorrido, em vez de dividir por zero', () => {
    expect(
      ritmoObservado({ chamadosAte: 400, marcaAnterior: 200, segundosDesdeAnterior: 0 }),
    ).toBeNull();
  });
});

describe('intervaloDeConsultaSegundos', () => {
  it('pergunta rápido para quem está quase entrando', () => {
    expect(intervaloDeConsultaSegundos(3)).toBe(3);
  });

  it('espaça para quem está longe', () => {
    // Vinte mil pessoas perguntando a cada três segundos derrubariam
    // justamente o sistema que a fila protege.
    expect(intervaloDeConsultaSegundos(15_000)).toBe(45);
  });

  it('cresce sem voltar atrás', () => {
    const pontos = [0, 20, 21, 200, 201, 2000, 2001, 100_000];
    const valores = pontos.map(intervaloDeConsultaSegundos);

    for (let i = 1; i < valores.length; i++) {
      expect(valores[i]!).toBeGreaterThanOrEqual(valores[i - 1]!);
    }
  });
});
