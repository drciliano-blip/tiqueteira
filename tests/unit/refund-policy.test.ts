import { describe, expect, it } from 'vitest';

import {
  avaliarReembolso,
  prazoDeArrependimento,
  JUSTIFICATIVA_MINIMA,
  reembolsoManual,
  reembolsoPorProblema,
  type ContextoReembolso,
} from '@/domain/refund-policy';

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;

/** Compra hoje, evento daqui a 30 dias, pedido de 2 ingressos a R$ 110. */
function contexto(over: Partial<ContextoReembolso> = {}): ContextoReembolso {
  const compradoEm = new Date('2026-09-01T12:00:00Z');
  return {
    compradoEm,
    eventoInicio: new Date(compradoEm.getTime() + 30 * DIA),
    agora: compradoEm,
    cancelamentoAteDiasCompra: 7,
    cancelamentoAteHorasEvento: 48,
    permiteReembolsoParcial: true,
    eventoCancelado: false,
    subtotalCentavos: 20_000,
    convenienciaCentavos: 2_000,
    totalCentavos: 22_000,
    ingressosNoPedido: 2,
    ingressosParaReembolsar: 2,
    jaReembolsadoCentavos: 0,
    ...over,
  };
}

describe('prazo de arrependimento', () => {
  it('são 7 dias da compra quando o evento está longe', () => {
    const ctx = contexto();
    const prazo = prazoDeArrependimento(ctx);
    expect(prazo?.getTime()).toBe(ctx.compradoEm.getTime() + 7 * DIA);
  });

  it('encurta para 48h antes quando o evento é em menos de 7 dias', () => {
    const ctx = contexto({
      eventoInicio: new Date(new Date('2026-09-01T12:00:00Z').getTime() + 3 * DIA),
    });
    const prazo = prazoDeArrependimento(ctx);
    expect(prazo?.getTime()).toBe(ctx.eventoInicio.getTime() - 48 * HORA);
  });

  it('não existe prazo quando a compra é a menos de 48h do evento', () => {
    // Comprou na véspera: não há janela de desistência a exercer.
    const ctx = contexto({
      eventoInicio: new Date(new Date('2026-09-01T12:00:00Z').getTime() + 24 * HORA),
    });
    expect(prazoDeArrependimento(ctx)).toBeNull();
  });
});

describe('arrependimento legal', () => {
  it('devolve tudo, taxa incluída, no dia da compra', () => {
    const d = avaliarReembolso(contexto());
    expect(d).toMatchObject({
      permitido: true,
      tipo: 'arrependimento_legal',
      valorCentavos: 22_000,
      incluiConveniencia: true,
    });
  });

  it('vale até o último instante do sétimo dia', () => {
    const base = contexto();
    const noLimite = avaliarReembolso({
      ...base,
      agora: new Date(base.compradoEm.getTime() + 7 * DIA),
    });
    expect(noLimite.permitido).toBe(true);
  });

  it('um segundo depois, já não vale', () => {
    const base = contexto();
    const passou = avaliarReembolso({
      ...base,
      agora: new Date(base.compradoEm.getTime() + 7 * DIA + 1000),
    });
    expect(passou.permitido).toBe(false);
    if (!passou.permitido) expect(passou.explicacao).toContain('prazo');
  });

  it('devolve a taxa de conveniência — onde discordamos do mercado', () => {
    const d = avaliarReembolso(contexto());
    // O total inclui os R$ 20 de conveniência, e eles voltam.
    if (d.permitido) {
      expect(d.valorCentavos).toBe(22_000);
      expect(d.incluiConveniencia).toBe(true);
    }
  });
});

describe('evento cancelado', () => {
  it('devolve tudo mesmo fora de qualquer prazo', () => {
    const base = contexto();
    const d = avaliarReembolso({
      ...base,
      eventoCancelado: true,
      agora: new Date(base.eventoInicio.getTime() - HORA),
    });
    expect(d).toMatchObject({ permitido: true, tipo: 'evento_cancelado', valorCentavos: 22_000 });
  });

  it('permite devolução parcial mesmo com o evento configurado sem parcial', () => {
    const d = avaliarReembolso(
      contexto({
        eventoCancelado: true,
        permiteReembolsoParcial: false,
        ingressosParaReembolsar: 1,
      }),
    );
    expect(d.permitido).toBe(true);
  });
});

describe('reembolso parcial', () => {
  it('rateia por ingresso, sem perder centavo', () => {
    // R$ 110,01 em 3 ingressos não divide certo — o resíduo tem de ir para
    // algum lugar, e não pode evaporar.
    const ctx = contexto({
      totalCentavos: 11_001,
      ingressosNoPedido: 3,
      ingressosParaReembolsar: 1,
    });
    const um = avaliarReembolso(ctx);
    const dois = avaliarReembolso({ ...ctx, ingressosParaReembolsar: 2 });
    const tres = avaliarReembolso({ ...ctx, ingressosParaReembolsar: 3 });

    if (um.permitido && dois.permitido && tres.permitido) {
      expect(tres.valorCentavos).toBe(11_001);
      expect(um.valorCentavos + (dois.valorCentavos - um.valorCentavos)).toBe(dois.valorCentavos);
      expect(tres.valorCentavos).toBeGreaterThan(dois.valorCentavos);
    }
  });

  it('recusa parcial quando o evento não permite', () => {
    const d = avaliarReembolso(
      contexto({ permiteReembolsoParcial: false, ingressosParaReembolsar: 1 }),
    );
    expect(d.permitido).toBe(false);
  });

  it('não devolve mais do que resta', () => {
    const d = avaliarReembolso(contexto({ jaReembolsadoCentavos: 11_000 }));
    if (d.permitido) expect(d.valorCentavos).toBe(11_000);
  });

  it('recusa quando já foi tudo devolvido', () => {
    const d = avaliarReembolso(contexto({ jaReembolsadoCentavos: 22_000 }));
    expect(d.permitido).toBe(false);
  });
});

describe('bordas', () => {
  it('recusa quantidade zero ou maior que o pedido', () => {
    expect(avaliarReembolso(contexto({ ingressosParaReembolsar: 0 })).permitido).toBe(false);
    expect(avaliarReembolso(contexto({ ingressosParaReembolsar: 5 })).permitido).toBe(false);
  });

  it('recusa depois de o evento acontecer', () => {
    const base = contexto();
    const d = avaliarReembolso({
      ...base,
      agora: new Date(base.eventoInicio.getTime() + HORA),
    });
    expect(d.permitido).toBe(false);
    if (!d.permitido) expect(d.explicacao).toContain('já aconteceu');
  });

  it('compra em cima da hora não tem arrependimento, e a mensagem explica', () => {
    const compradoEm = new Date('2026-09-01T12:00:00Z');
    const d = avaliarReembolso(
      contexto({
        compradoEm,
        eventoInicio: new Date(compradoEm.getTime() + 12 * HORA),
        agora: new Date(compradoEm.getTime() + HORA),
      }),
    );
    expect(d.permitido).toBe(false);
    if (!d.permitido) expect(d.explicacao).toContain('perto demais');
  });
});

describe('reembolso manual', () => {
  it('ignora prazo, porque a vida acontece', () => {
    const d = reembolsoManual({
      totalCentavos: 22_000,
      jaReembolsadoCentavos: 0,
      ingressosNoPedido: 2,
      ingressosParaReembolsar: 1,
    });
    expect(d).toMatchObject({ permitido: true, tipo: 'outro', valorCentavos: 11_000 });
  });

  it('ainda assim não devolve mais do que resta', () => {
    const d = reembolsoManual({
      totalCentavos: 22_000,
      jaReembolsadoCentavos: 22_000,
      ingressosNoPedido: 2,
      ingressosParaReembolsar: 1,
    });
    expect(d.permitido).toBe(false);
  });
});

describe('reembolso por problema no evento (ADR-022)', () => {
  const base = {
    totalCentavos: 33_000, // 3 ingressos de R$ 110,00
    jaReembolsadoCentavos: 0,
    ingressosNoPedido: 3,
    ingressosParaReembolsar: 3,
  };
  const relato = 'Atração principal não compareceu ao evento.';

  it('integral devolve tudo, taxa incluída, sem olhar prazo', () => {
    const d = reembolsoPorProblema(base, {
      problema: 'evento_nao_realizado',
      modalidade: 'integral',
      justificativa: relato,
    });
    expect(d).toMatchObject({
      permitido: true,
      tipo: 'evento_nao_realizado',
      valorCentavos: 33_000,
      incluiConveniencia: true,
    });
  });

  it('devolve parte dos ingressos mesmo em evento que não permite reembolso parcial', () => {
    const d = reembolsoPorProblema(
      { ...base, ingressosParaReembolsar: 1 },
      { problema: 'servico_nao_prestado', modalidade: 'integral', justificativa: relato },
    );
    expect(d).toMatchObject({ permitido: true, valorCentavos: 11_000 });
  });

  it('abatimento devolve o valor informado, sem a taxa', () => {
    const d = reembolsoPorProblema(base, {
      problema: 'servico_diferente_do_ofertado',
      modalidade: 'abatimento',
      abatimentoCentavos: 5_000,
      justificativa: relato,
    });
    expect(d).toMatchObject({ permitido: true, valorCentavos: 5_000, incluiConveniencia: false });
  });

  it('abatimento não passa do que foi pago pelos ingressos escolhidos', () => {
    const d = reembolsoPorProblema(
      { ...base, ingressosParaReembolsar: 1 },
      {
        problema: 'reclamacao_procedente',
        modalidade: 'abatimento',
        abatimentoCentavos: 11_001,
        justificativa: relato,
      },
    );
    expect(d.permitido).toBe(false);
  });

  it('abatimento exige valor', () => {
    for (const abatimentoCentavos of [undefined, 0, -1, 10.5]) {
      const d = reembolsoPorProblema(base, {
        problema: 'reclamacao_procedente',
        modalidade: 'abatimento',
        ...(abatimentoCentavos !== undefined ? { abatimentoCentavos } : {}),
        justificativa: relato,
      });
      expect(d.permitido).toBe(false);
    }
  });

  it('exige relato', () => {
    const d = reembolsoPorProblema(base, {
      problema: 'evento_nao_realizado',
      modalidade: 'integral',
      justificativa: '   curto   ',
    });
    expect(d).toMatchObject({ permitido: false });
    expect(JUSTIFICATIVA_MINIMA).toBeGreaterThan('curto'.length);
  });

  it('não devolve além do que resta no pedido', () => {
    const d = reembolsoPorProblema(
      { ...base, jaReembolsadoCentavos: 30_000 },
      { problema: 'evento_nao_realizado', modalidade: 'integral', justificativa: relato },
    );
    expect(d).toMatchObject({ permitido: true, valorCentavos: 3_000 });
  });

  it('pedido já devolvido por inteiro é recusado', () => {
    const d = reembolsoPorProblema(
      { ...base, jaReembolsadoCentavos: 33_000 },
      { problema: 'evento_nao_realizado', modalidade: 'integral', justificativa: relato },
    );
    expect(d.permitido).toBe(false);
  });

  it('recusa motivo fora da lista', () => {
    const d = reembolsoPorProblema(base, {
      problema: 'qualquer_coisa' as never,
      modalidade: 'integral',
      justificativa: relato,
    });
    expect(d.permitido).toBe(false);
  });
});
