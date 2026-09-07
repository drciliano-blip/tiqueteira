import { describe, expect, it } from 'vitest';

import { emitirTicket, gerarCodigo, hashToken, verificarToken } from '@/lib/tickets';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const OUTRO = 'outro-segredo-com-mais-de-32-caracteres-aqui';

describe('gerarCodigo', () => {
  it('tem formato curto e legível', () => {
    for (let i = 0; i < 200; i++) {
      expect(gerarCodigo()).toMatch(/^[34679ACDEFGHJKMNPQRTUVWXY]{4}-[34679ACDEFGHJKMNPQRTUVWXY]{4}$/);
    }
  });

  it('não usa caracteres que se confundem lendo em voz alta na porta', () => {
    // 0/O, 1/I/L, 5/S, 2/Z, 8/B
    const proibidos = /[01258BILOSZ]/;
    for (let i = 0; i < 500; i++) {
      expect(proibidos.test(gerarCodigo())).toBe(false);
    }
  });

  it('não repete em volume', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 5000; i++) vistos.add(gerarCodigo());
    expect(vistos.size).toBe(5000);
  });
});

describe('emitirTicket', () => {
  it('devolve código, token e o hash que vai para o banco', () => {
    const t = emitirTicket(SEGREDO);
    expect(t.token).toContain(t.codigo);
    expect(t.tokenHash).toBe(hashToken(t.token));
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('recusa segredo curto — falha na emissão, não na portaria', () => {
    expect(() => emitirTicket('curto')).toThrow(/32/);
    expect(() => emitirTicket('')).toThrow();
  });

  it('dois ingressos nunca compartilham token', () => {
    const a = emitirTicket(SEGREDO);
    const b = emitirTicket(SEGREDO);
    expect(a.token).not.toBe(b.token);
  });
});

describe('verificarToken', () => {
  it('aceita token legítimo', () => {
    const t = emitirTicket(SEGREDO);
    const r = verificarToken(t.token, { atual: SEGREDO });
    expect(r).toEqual({ ok: true, codigo: t.codigo, tokenHash: t.tokenHash });
  });

  it('recusa token assinado com outro segredo', () => {
    const t = emitirTicket(OUTRO);
    expect(verificarToken(t.token, { atual: SEGREDO })).toEqual({
      ok: false,
      motivo: 'assinatura',
    });
  });

  it('recusa token adulterado', () => {
    const t = emitirTicket(SEGREDO);
    // Trocar o código mantendo a assinatura é a tentativa mais óbvia.
    const partes = t.token.split('.');
    const forjado = `v1.AAAA-BBBB.${partes[2]}`;
    expect(verificarToken(forjado, { atual: SEGREDO }).ok).toBe(false);
  });

  it('recusa formato inválido em vez de estourar', () => {
    for (const lixo of ['', 'abc', 'v1.só-duas-partes', 'v2.AAAA-BBBB.xxx', '...']) {
      expect(verificarToken(lixo, { atual: SEGREDO }).ok).toBe(false);
    }
  });

  it('a rotação do segredo não invalida ingresso já emitido', () => {
    // Quem comprou em março precisa entrar em maio, mesmo que o segredo
    // tenha sido trocado no meio.
    const antigo = emitirTicket(OUTRO);
    const r = verificarToken(antigo.token, { atual: SEGREDO, anterior: OUTRO });
    expect(r.ok).toBe(true);
  });

  it('depois que o segredo anterior sai do ar, o ingresso antigo cai', () => {
    const antigo = emitirTicket(OUTRO);
    expect(verificarToken(antigo.token, { atual: SEGREDO, anterior: undefined }).ok).toBe(false);
  });
});
