import { describe, expect, it } from 'vitest';

import {
  avaliarTransferencia,
  prazoDeTransferencia,
  type ContextoTransferencia,
} from '@/domain/transferencia';

const HORA = 60 * 60 * 1000;
const agora = new Date('2026-09-08T12:00:00Z');

function contexto(over: Partial<ContextoTransferencia> = {}): ContextoTransferencia {
  return {
    configuracao: {
      permiteTransferencia: true,
      transferenciaAteHoras: 24,
      maxTransferenciasPorIngresso: 1,
      transferenciaPermiteMeia: false,
    },
    ingresso: { status: 'valido', transferenciasCount: 0, tipo: 'inteira' },
    eventoInicio: new Date(agora.getTime() + 10 * 24 * HORA),
    eventoStatus: 'publicado',
    agora,
    ...over,
  };
}

describe('permitido', () => {
  it('ingresso válido, dentro do prazo e sem transferência anterior', () => {
    const a = avaliarTransferencia(contexto());
    expect(a).toMatchObject({ permitido: true, transferenciasRestantes: 1 });
  });

  it('o prazo é o início do evento menos as horas configuradas', () => {
    const ctx = contexto();
    expect(prazoDeTransferencia(ctx).getTime()).toBe(ctx.eventoInicio.getTime() - 24 * HORA);
  });

  it('vale até o último instante do prazo', () => {
    const ctx = contexto();
    const noLimite = avaliarTransferencia({ ...ctx, agora: prazoDeTransferencia(ctx) });
    expect(noLimite.permitido).toBe(true);
  });
});

describe('recusado', () => {
  it('quando o produtor desativou', () => {
    const a = avaliarTransferencia(
      contexto({
        configuracao: {
          permiteTransferencia: false,
          transferenciaAteHoras: 24,
          maxTransferenciasPorIngresso: 1,
          transferenciaPermiteMeia: false,
        },
      }),
    );
    expect(a).toMatchObject({ permitido: false, motivo: 'desativada' });
  });

  it('depois do prazo', () => {
    const ctx = contexto();
    const a = avaliarTransferencia({
      ...ctx,
      agora: new Date(prazoDeTransferencia(ctx).getTime() + 1000),
    });
    expect(a).toMatchObject({ permitido: false, motivo: 'fora_do_prazo' });
  });

  it('quando o ingresso já entrou', () => {
    const a = avaliarTransferencia(
      contexto({ ingresso: { status: 'usado', transferenciasCount: 0, tipo: 'inteira' } }),
    );
    expect(a).toMatchObject({ permitido: false, motivo: 'ja_usado' });
  });

  it('quando o ingresso foi cancelado', () => {
    const a = avaliarTransferencia(
      contexto({ ingresso: { status: 'cancelado', transferenciasCount: 0, tipo: 'inteira' } }),
    );
    expect(a).toMatchObject({ permitido: false, motivo: 'ingresso_invalido' });
  });

  it('quando o limite de transferências foi atingido', () => {
    const a = avaliarTransferencia(
      contexto({ ingresso: { status: 'valido', transferenciasCount: 1, tipo: 'inteira' } }),
    );
    expect(a).toMatchObject({ permitido: false, motivo: 'limite_atingido' });
  });

  it('meia-entrada não se transfere por padrão', () => {
    // O direito é da pessoa, não do ingresso. Transferir sem comprovação
    // transformaria a cota legal em desconto negociável.
    for (const tipo of ['meia', 'pcd', 'idoso']) {
      const a = avaliarTransferencia(
        contexto({ ingresso: { status: 'valido', transferenciasCount: 0, tipo } }),
      );
      expect(a, tipo).toMatchObject({ permitido: false, motivo: 'meia_nao_transferivel' });
    }
  });

  it('meia-entrada se transfere quando o produtor permite', () => {
    const a = avaliarTransferencia(
      contexto({
        ingresso: { status: 'valido', transferenciasCount: 0, tipo: 'meia' },
        configuracao: {
          permiteTransferencia: true,
          transferenciaAteHoras: 24,
          maxTransferenciasPorIngresso: 1,
          transferenciaPermiteMeia: true,
        },
      }),
    );
    expect(a.permitido).toBe(true);
  });

  it('evento cancelado ou encerrado bloqueia', () => {
    for (const status of ['cancelado', 'encerrado']) {
      const a = avaliarTransferencia(contexto({ eventoStatus: status }));
      expect(a, status).toMatchObject({ permitido: false, motivo: 'evento_encerrado' });
    }
  });
});

describe('limite maior que um', () => {
  it('conta quantas ainda restam', () => {
    const a = avaliarTransferencia(
      contexto({
        ingresso: { status: 'valido', transferenciasCount: 1, tipo: 'inteira' },
        configuracao: {
          permiteTransferencia: true,
          transferenciaAteHoras: 24,
          maxTransferenciasPorIngresso: 3,
          transferenciaPermiteMeia: false,
        },
      }),
    );
    expect(a).toMatchObject({ permitido: true, transferenciasRestantes: 2 });
  });
});
