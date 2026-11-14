import { describe, expect, it } from 'vitest';

import {
  adicionarDiasUteis,
  calcularPrincipal,
  calcularReserva,
  chaveDoRepasse,
  datasDoRepasse,
  feriadosBancarios,
  pascoa,
  PAYOUT_STATUSES,
  retencaoAte,
  somarPedidos,
  statusDeOrigemPara,
  transicionarPayout,
  type PedidoParaRepasse,
} from '@/domain/payout';
import { MoneyError } from '@/lib/money';

/** Pedido de R$ 110,00: R$ 100,00 do produtor, R$ 10,00 de conveniência. */
function pedido(extra: Partial<PedidoParaRepasse> = {}): PedidoParaRepasse {
  return {
    totalCentavos: 11_000,
    valorProdutorCentavos: 10_000,
    valorOperadorCentavos: 1_000,
    reembolsadoCentavos: 0,
    chargeback: false,
    ...extra,
  };
}

describe('máquina de estado do repasse', () => {
  it('segue o caminho feliz scheduled → processing → released', () => {
    expect(transicionarPayout('scheduled', 'processing').ok).toBe(true);
    expect(transicionarPayout('processing', 'released').ok).toBe(true);
  });

  it('falha pode ser tentada de novo ou cancelada', () => {
    expect(transicionarPayout('processing', 'failed').ok).toBe(true);
    expect(transicionarPayout('failed', 'processing').ok).toBe(true);
    expect(transicionarPayout('failed', 'canceled').ok).toBe(true);
  });

  it('repasse liberado é terminal: não volta, não cancela', () => {
    for (const para of PAYOUT_STATUSES) {
      const r = transicionarPayout('released', para);
      expect(r.ok).toBe(false);
    }
    expect(transicionarPayout('released', 'canceled')).toMatchObject({
      ok: false,
      motivo: 'estado_terminal',
    });
  });

  it('não libera sem passar por processing', () => {
    expect(transicionarPayout('scheduled', 'released')).toMatchObject({
      ok: false,
      motivo: 'nao_permitida',
    });
    expect(transicionarPayout('failed', 'released').ok).toBe(false);
  });

  it('em processamento não pode ser cancelado: a PSP pode já ter liberado', () => {
    expect(transicionarPayout('processing', 'canceled').ok).toBe(false);
  });

  it('mesmo estado não é transição', () => {
    expect(transicionarPayout('scheduled', 'scheduled')).toMatchObject({
      ok: false,
      motivo: 'ja_esta_assim',
    });
  });

  it('só scheduled e failed entram em processamento', () => {
    expect(statusDeOrigemPara('processing').sort()).toEqual(['failed', 'scheduled']);
  });
});

describe('somarPedidos', () => {
  it('sem estorno, líquido é a parcela do produtor', () => {
    const t = somarPedidos([pedido(), pedido()]);
    expect(t).toEqual({
      brutoCentavos: 22_000,
      comissaoCentavos: 2_000,
      produtorCentavos: 20_000,
      reembolsosCentavos: 0,
      chargebacksCentavos: 0,
      liquidoCentavos: 20_000,
    });
  });

  it('reembolso sai do produtor na proporção do split, como a PSP debita', () => {
    // Devolveu R$ 55,00 de R$ 110,00: metade de cada parcela.
    const t = somarPedidos([pedido({ reembolsadoCentavos: 5_500 })]);
    expect(t.reembolsosCentavos).toBe(5_000);
    expect(t.liquidoCentavos).toBe(5_000);
  });

  it('reembolso total zera a contribuição do pedido', () => {
    const t = somarPedidos([pedido({ reembolsadoCentavos: 11_000 })]);
    expect(t.liquidoCentavos).toBe(0);
  });

  it('chargeback debita do produtor o valor contestado inteiro', () => {
    const t = somarPedidos([pedido(), pedido({ chargeback: true })]);
    // O contestado é R$ 110,00 — inclusive a parte que foi do operador.
    expect(t.chargebacksCentavos).toBe(11_000);
    expect(t.liquidoCentavos).toBe(20_000 - 11_000);
  });

  it('chargeback de pedido parcialmente reembolsado contesta só o restante', () => {
    const t = somarPedidos([pedido({ reembolsadoCentavos: 5_500, chargeback: true })]);
    expect(t.reembolsosCentavos).toBe(5_000);
    expect(t.chargebacksCentavos).toBe(5_500);
    expect(t.liquidoCentavos).toBe(10_000 - 5_000 - 5_500);
  });

  it('chargeback sozinho deixa o líquido negativo — saldo a descoberto', () => {
    const t = somarPedidos([pedido({ chargeback: true })]);
    expect(t.liquidoCentavos).toBe(-1_000);
  });

  it('recusa pedido cujo split não fecha', () => {
    expect(() => somarPedidos([pedido({ valorOperadorCentavos: 999 })])).toThrow(MoneyError);
  });

  it('recusa valor que não é centavo inteiro', () => {
    expect(() => somarPedidos([pedido({ totalCentavos: 110.5 })])).toThrow(MoneyError);
  });

  it('recusa reembolso maior que o pedido', () => {
    expect(() => somarPedidos([pedido({ reembolsadoCentavos: 11_001 })])).toThrow(MoneyError);
  });

  it('nunca produz centavo fracionado, em nenhuma combinação', () => {
    for (let total = 1; total <= 400; total += 7) {
      for (let produtor = 0; produtor <= total; produtor += 13) {
        for (const reembolso of [0, 1, Math.floor(total / 3), total]) {
          const t = somarPedidos([
            {
              totalCentavos: total,
              valorProdutorCentavos: produtor,
              valorOperadorCentavos: total - produtor,
              reembolsadoCentavos: reembolso,
              chargeback: false,
            },
          ]);
          expect(Number.isInteger(t.liquidoCentavos)).toBe(true);
          expect(t.reembolsosCentavos).toBeLessThanOrEqual(produtor);
        }
      }
    }
  });
});

describe('tranches', () => {
  it('principal libera o líquido menos a reserva', () => {
    const t = somarPedidos([pedido()]);
    // 20% de reserva no cartão.
    expect(calcularPrincipal(t, 2_000)).toEqual({ retidoCentavos: 2_000, liberadoCentavos: 8_000 });
  });

  it('Pix sem reserva libera tudo na principal', () => {
    const t = somarPedidos([pedido()]);
    expect(calcularPrincipal(t, 0)).toEqual({ retidoCentavos: 0, liberadoCentavos: 10_000 });
  });

  it('principal mais reserva somam exatamente o líquido final', () => {
    for (const reservaBps of [0, 1, 333, 1_500, 2_000, 9_999, 10_000]) {
      const t = somarPedidos([pedido(), pedido({ totalCentavos: 3_337, valorProdutorCentavos: 3_001, valorOperadorCentavos: 336 })]);
      const p = calcularPrincipal(t, reservaBps);
      const r = calcularReserva(t, p.liberadoCentavos);
      expect(p.liberadoCentavos + r.liberadoCentavos).toBe(t.liquidoCentavos);
      expect(p.retidoCentavos).toBe(r.liberadoCentavos);
    }
  });

  it('chargeback depois da principal sai da reserva', () => {
    const naPrincipal = somarPedidos([pedido(), pedido()]);
    const p = calcularPrincipal(naPrincipal, 2_000); // libera 16.000, retém 4.000

    // Um dos dois pedidos é contestado depois da principal.
    const naReserva = somarPedidos([pedido(), pedido({ chargeback: true })]);
    const r = calcularReserva(naReserva, p.liberadoCentavos);

    expect(p.liberadoCentavos).toBe(16_000);
    // líquido final 9.000 − 16.000 já liberados
    expect(r.liberadoCentavos).toBe(-7_000);
  });

  it('chargeback menor que a reserva só reduz a reserva', () => {
    const muitos = Array.from({ length: 10 }, () => pedido());
    const p = calcularPrincipal(somarPedidos(muitos), 2_000); // libera 80.000, retém 20.000

    const depois = [...muitos.slice(1), pedido({ chargeback: true })];
    const r = calcularReserva(somarPedidos(depois), p.liberadoCentavos);

    expect(r.liberadoCentavos).toBe(20_000 - 11_000);
  });

  it('principal com líquido negativo não libera nem retém', () => {
    const t = somarPedidos([pedido({ chargeback: true })]);
    expect(calcularPrincipal(t, 2_000)).toEqual({ retidoCentavos: 0, liberadoCentavos: -1_000 });
  });

  it('reserva não desconta principal negativa como se tivesse saído dinheiro', () => {
    const t = somarPedidos([pedido({ chargeback: true }), pedido(), pedido()]);
    expect(calcularReserva(t, -1_000).liberadoCentavos).toBe(t.liquidoCentavos);
  });
});

describe('datas', () => {
  // 2026-11-13 é sexta-feira. 23h em São Paulo = 02h UTC do dia seguinte.
  const sextaANoite = new Date('2026-11-14T02:00:00Z');

  it('dois dias úteis depois de sexta caem na terça', () => {
    const d = adicionarDiasUteis(sextaANoite, 2);
    expect(d.toISOString()).toBe('2026-11-18T02:00:00.000Z'); // terça, 23h em SP
  });

  it('usa o fuso de São Paulo, não o de UTC', () => {
    // Em UTC já é sábado; em São Paulo ainda é sexta. Um dia útil = segunda.
    const d = adicionarDiasUteis(sextaANoite, 1);
    expect(d.toISOString()).toBe('2026-11-17T02:00:00.000Z');
  });

  it('zero dia útil é a própria data', () => {
    expect(adicionarDiasUteis(sextaANoite, 0)).toEqual(sextaANoite);
  });

  it('reserva conta dias corridos', () => {
    const { reserva } = datasDoRepasse(sextaANoite, {
      diasLiberacaoEvento: 2,
      diasLiberacaoReserva: 35,
    });
    expect(reserva.toISOString()).toBe('2026-12-19T02:00:00.000Z');
  });

  it('retenção pedida à PSP vai além da data da reserva', () => {
    const config = { diasLiberacaoEvento: 2, diasLiberacaoReserva: 35 };
    const { reserva } = datasDoRepasse(sextaANoite, config);
    expect(retencaoAte(sextaANoite, config).getTime()).toBeGreaterThan(reserva.getTime());
  });
});

describe('chave de idempotência', () => {
  it('é estável e distingue tranche e meio de pagamento', () => {
    const a = chaveDoRepasse('ev1', 'principal', 'pix');
    expect(a).toBe(chaveDoRepasse('ev1', 'principal', 'pix'));
    expect(a).not.toBe(chaveDoRepasse('ev1', 'reserva', 'pix'));
    expect(a).not.toBe(chaveDoRepasse('ev1', 'principal', 'credit_card'));
  });
});

describe('feriados bancários', () => {
  it('calcula a Páscoa de anos conhecidos', () => {
    expect(pascoa(2024)).toEqual({ mes: 3, dia: 31 });
    expect(pascoa(2025)).toEqual({ mes: 4, dia: 20 });
    expect(pascoa(2026)).toEqual({ mes: 4, dia: 5 });
    expect(pascoa(2027)).toEqual({ mes: 3, dia: 28 });
  });

  it('inclui os móveis de 2027: carnaval, sexta-feira santa e Corpus Christi', () => {
    const f = feriadosBancarios(2027);
    for (const d of ['2027-02-08', '2027-02-09', '2027-03-26', '2027-05-27']) {
      expect(f.has(d)).toBe(true);
    }
    expect(f.size).toBe(13);
  });

  it('pula o feriado: evento na quinta antes da sexta-feira santa', () => {
    // Quinta, 25/03/2027, 23h em SP. Sexta é feriado; 2 dias úteis = seg e ter.
    const quinta = new Date('2027-03-26T02:00:00Z');
    expect(adicionarDiasUteis(quinta, 2).toISOString()).toBe('2027-03-31T02:00:00.000Z');
  });

  it('pula o carnaval inteiro', () => {
    // Sexta, 05/02/2027, 23h em SP. Seg e ter de carnaval não contam.
    const sexta = new Date('2027-02-06T02:00:00Z');
    expect(adicionarDiasUteis(sexta, 1).toISOString()).toBe('2027-02-11T02:00:00.000Z'); // quarta
  });

  it('20 de novembro não conta como dia útil', () => {
    // Quinta, 19/11/2026, 23h em SP. Sexta (20) é feriado; 1 dia útil = segunda.
    const quinta = new Date('2026-11-20T02:00:00Z');
    expect(adicionarDiasUteis(quinta, 1).toISOString()).toBe('2026-11-24T02:00:00.000Z');
  });
});
