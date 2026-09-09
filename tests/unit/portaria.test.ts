import { describe, expect, it } from 'vitest';

import {
  avaliarMovimento,
  contarNaCasa,
  type EstadoNaPorta,
  type PoliticaPortaria,
} from '@/domain/portaria';

/**
 * A porta é o único lugar do sistema onde o erro acontece na frente da
 * pessoa, com fila atrás e sem chance de "corrigir depois". Por isso cada
 * recusa aqui tem motivo próprio: "não pode entrar" não resolve discussão
 * nenhuma na portaria — "saiu às 23h40 e este evento não permite voltar"
 * resolve.
 */

const SEM_SAIDA: PoliticaPortaria = { controlaSaida: false, permiteReentrada: false };
const COM_REENTRADA: PoliticaPortaria = { controlaSaida: true, permiteReentrada: true };
const SAIDA_DEFINITIVA: PoliticaPortaria = { controlaSaida: true, permiteReentrada: false };

const novo: EstadoNaPorta = {
  status: 'valido',
  dentro: false,
  entradasCount: 0,
  ultimaEntradaEm: null,
  ultimaSaidaEm: null,
};

const dentro: EstadoNaPorta = {
  status: 'usado',
  dentro: true,
  entradasCount: 1,
  ultimaEntradaEm: new Date('2026-09-10T01:00:00Z'),
  ultimaSaidaEm: null,
};

const saiu: EstadoNaPorta = {
  status: 'usado',
  dentro: false,
  entradasCount: 1,
  ultimaEntradaEm: new Date('2026-09-10T01:00:00Z'),
  ultimaSaidaEm: new Date('2026-09-10T02:40:00Z'),
};

describe('entrada', () => {
  it('libera quem nunca entrou', () => {
    const d = avaliarMovimento({ movimento: 'entrada', estado: novo, politica: SEM_SAIDA });
    expect(d).toEqual({ permitido: true, movimento: 'entrada', reentrada: false });
  });

  it('barra o segundo print do mesmo QR', () => {
    const d = avaliarMovimento({ movimento: 'entrada', estado: dentro, politica: SEM_SAIDA });
    expect(d).toMatchObject({ permitido: false, motivo: 'ja_entrou' });
  });

  it('barra quem já está dentro mesmo com reentrada ligada', () => {
    // Quem está lá dentro não pode entrar de novo: é print repetido, não
    // reentrada. Sem esta regra, dois amigos entram com o mesmo ingresso.
    const d = avaliarMovimento({ movimento: 'entrada', estado: dentro, politica: COM_REENTRADA });
    expect(d).toMatchObject({ permitido: false, motivo: 'ja_entrou' });
  });

  it('deixa voltar quem saiu, quando o evento permite', () => {
    const d = avaliarMovimento({ movimento: 'entrada', estado: saiu, politica: COM_REENTRADA });
    expect(d).toEqual({ permitido: true, movimento: 'entrada', reentrada: true });
  });

  it('barra a volta quando a saída é definitiva', () => {
    const d = avaliarMovimento({ movimento: 'entrada', estado: saiu, politica: SAIDA_DEFINITIVA });
    expect(d).toMatchObject({ permitido: false, motivo: 'reentrada_bloqueada' });
    if (d.permitido) throw new Error('inesperado');
    // A explicação precisa dizer a HORA da saída: é o que encerra a discussão.
    expect(d.explicacao).toContain('23h40');
  });

  it('barra ingresso cancelado antes de qualquer outra regra', () => {
    const d = avaliarMovimento({
      movimento: 'entrada',
      estado: { ...saiu, status: 'cancelado' },
      politica: COM_REENTRADA,
    });
    expect(d).toMatchObject({ permitido: false, motivo: 'cancelado' });
  });

  it('barra o QR antigo de um ingresso transferido', () => {
    const d = avaliarMovimento({
      movimento: 'entrada',
      estado: { ...novo, status: 'transferido' },
      politica: SEM_SAIDA,
    });
    expect(d).toMatchObject({ permitido: false, motivo: 'transferido' });
  });
});

describe('saída', () => {
  it('registra a saída de quem está dentro', () => {
    const d = avaliarMovimento({ movimento: 'saida', estado: dentro, politica: COM_REENTRADA });
    expect(d).toEqual({ permitido: true, movimento: 'saida', reentrada: false });
  });

  it('recusa saída de quem não entrou', () => {
    const d = avaliarMovimento({ movimento: 'saida', estado: novo, politica: COM_REENTRADA });
    expect(d).toMatchObject({ permitido: false, motivo: 'nao_esta_dentro' });
  });

  it('recusa saída repetida', () => {
    const d = avaliarMovimento({ movimento: 'saida', estado: saiu, politica: COM_REENTRADA });
    expect(d).toMatchObject({ permitido: false, motivo: 'nao_esta_dentro' });
  });

  it('recusa saída em evento que não controla saída', () => {
    const d = avaliarMovimento({ movimento: 'saida', estado: dentro, politica: SEM_SAIDA });
    expect(d).toMatchObject({ permitido: false, motivo: 'saida_nao_controlada' });
  });

  it('deixa sair quem está dentro mesmo com ingresso cancelado depois da entrada', () => {
    // Reembolso ou chargeback durante a festa não pode prender a pessoa lá
    // dentro. Sair é sempre permitido a quem está dentro.
    const d = avaliarMovimento({
      movimento: 'saida',
      estado: { ...dentro, status: 'cancelado' },
      politica: COM_REENTRADA,
    });
    expect(d).toMatchObject({ permitido: true, movimento: 'saida' });
  });
});

describe('contarNaCasa', () => {
  it('conta quem está dentro, não quem já passou', () => {
    expect(contarNaCasa({ emitidos: 400, entraram: 350, dentro: 312 })).toEqual({
      emitidos: 400,
      entraram: 350,
      dentro: 312,
      sairam: 38,
    });
  });

  it('nunca devolve saída negativa', () => {
    // Sincronização fora de ordem pode registrar entrada antes da saída.
    // O número da porta não pode ficar absurdo por causa disso.
    expect(contarNaCasa({ emitidos: 10, entraram: 3, dentro: 5 }).sairam).toBe(0);
  });
});
