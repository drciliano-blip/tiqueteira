import { describe, expect, it } from 'vitest';

import { excedeLimitePorCpf, mensagemDeLimitePorCpf } from '@/domain/inventory';

/**
 * O limite por pedido não segura cambista: quem quer cinquenta ingressos faz
 * cinquenta pedidos de um. Estes testes guardam a única defesa que segura.
 */
describe('excedeLimitePorCpf', () => {
  it('deixa passar quando não há limite no lote', () => {
    expect(excedeLimitePorCpf({ jaTem: 90, pedindo: 10, limite: null })).toBe(false);
  });

  it('deixa passar quando cabe exatamente no limite', () => {
    expect(excedeLimitePorCpf({ jaTem: 2, pedindo: 2, limite: 4 })).toBe(false);
  });

  it('barra quando passa por um', () => {
    expect(excedeLimitePorCpf({ jaTem: 2, pedindo: 3, limite: 4 })).toBe(true);
  });

  it('barra quem já está no limite e tenta mais um', () => {
    expect(excedeLimitePorCpf({ jaTem: 4, pedindo: 1, limite: 4 })).toBe(true);
  });

  it('conta o que já existe, não só o pedido de agora', () => {
    // É a diferença entre limite por CPF e limite por pedido. Sem somar o que
    // já existe, dez pedidos de quatro passam por um limite de quatro.
    expect(excedeLimitePorCpf({ jaTem: 4, pedindo: 4, limite: 4 })).toBe(true);
  });
});

describe('mensagemDeLimitePorCpf', () => {
  it('diz quantos faltam quando ainda cabe alguma coisa', () => {
    const m = mensagemDeLimitePorCpf({ lote: 'Pista', jaTem: 1, limite: 4 });
    expect(m).toContain('já tem 1');
    expect(m).toContain('mais 3');
  });

  it('diz que estourou quando já está no limite', () => {
    const m = mensagemDeLimitePorCpf({ lote: 'Pista', jaTem: 4, limite: 4 });
    expect(m).toContain('limite por pessoa');
    expect(m).not.toContain('pode levar mais');
  });

  it('escreve ingresso no singular quando é um só', () => {
    expect(mensagemDeLimitePorCpf({ lote: 'Camarote', jaTem: 1, limite: 1 })).toContain(
      '1 ingresso de',
    );
  });
});
