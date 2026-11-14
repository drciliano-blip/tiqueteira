import { describe, expect, it } from 'vitest';

import {
  cnpjValido,
  cpfValido,
  formatarCnpj,
  formatarCpf,
  mascararCpf,
  normalizarCpf,
} from '@/domain/cpf';

describe('cpfValido', () => {
  it('aceita CPFs com dígitos verificadores corretos', () => {
    for (const cpf of ['52998224725', '11144477735', '529.982.247-25']) {
      expect(cpfValido(cpf), cpf).toBe(true);
    }
  });

  it('recusa dígito verificador errado', () => {
    expect(cpfValido('52998224726')).toBe(false);
    expect(cpfValido('11144477734')).toBe(false);
  });

  it('recusa sequência repetida, que passa no cálculo mas não é de ninguém', () => {
    for (let d = 0; d <= 9; d++) {
      expect(cpfValido(String(d).repeat(11)), String(d).repeat(11)).toBe(false);
    }
  });

  it('recusa tamanho errado', () => {
    expect(cpfValido('1234567890')).toBe(false);
    expect(cpfValido('123456789012')).toBe(false);
    expect(cpfValido('')).toBe(false);
  });
});

describe('normalizarCpf', () => {
  it('tira pontuação', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizarCpf(' 529 982 247 25 ')).toBe('52998224725');
  });
});

describe('exibição', () => {
  it('formata', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
  });

  it('mascara mantendo o miolo, para distinguir homônimos na porta', () => {
    expect(mascararCpf('52998224725')).toBe('***.982.247-**');
    expect(mascararCpf('123')).toBe('***');
  });
});

describe('cnpj', () => {
  it('confere os dígitos verificadores', () => {
    expect(cnpjValido('69.700.606/0001-36')).toBe(true);
    expect(cnpjValido('47.301.164/0001-12')).toBe(true);
    expect(cnpjValido('69.700.606/0001-37')).toBe(false);
    expect(cnpjValido('11.111.111/1111-11')).toBe(false);
    expect(cnpjValido('123')).toBe(false);
  });
  it('formata', () => {
    expect(formatarCnpj('69700606000136')).toBe('69.700.606/0001-36');
  });
});
