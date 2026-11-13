/**
 * Repasse ao produtor — plano, seções 3.4, 3.5, 8 e 12. ADR-021.
 *
 * Função pura, sem I/O. Três coisas moram aqui:
 *
 * 1. A máquina de estado de `payouts.status`. Toda mudança passa por aqui.
 * 2. O cálculo de cada tranche, separado por meio de pagamento.
 * 3. As datas: principal em dias ÚTEIS depois do fim do evento, reserva em
 *    dias corridos.
 *
 * O modelo: na venda, a PSP aplica o split e RETÉM a parcela do produtor. O
 * dinheiro nunca passa pela conta do operador. O motor só decide QUANTO do
 * saldo retido liberar e QUANDO — e manda a PSP liberar.
 *
 * A reserva não é calculada por percentual na segunda tranche, e isso é de
 * propósito. Ela é "tudo o que sobrou": o líquido recalculado na data dela,
 * menos o que a principal já liberou. Chargeback que chega entre as duas
 * datas sai automaticamente da reserva — que é exatamente para isso que ela
 * existe. Se o chargeback for maior que a reserva, o resultado é negativo:
 * saldo a descoberto (caso de borda 5), que precisa aparecer, não sumir.
 */
import { aplicarBps, assertCents, MoneyError } from '@/lib/money';

type Cents = number;

// ---------------------------------------------------------------------------
// Máquina de estado
// ---------------------------------------------------------------------------

export const PAYOUT_STATUSES = [
  'scheduled',
  'processing',
  'released',
  'failed',
  'canceled',
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** "De X, pode ir para". O que não está aqui não acontece. */
const TRANSICOES: Record<PayoutStatus, readonly PayoutStatus[]> = {
  // Cancelado quando o evento é cancelado antes da data do repasse.
  scheduled: ['processing', 'canceled'],
  // `processing` → `processing` não é transição: é a retomada de um repasse
  // cujo processo morreu no meio, com a MESMA chave de idempotência.
  processing: ['released', 'failed'],
  // Falha volta a ser tentada, ou é cancelada à mão.
  failed: ['processing', 'canceled'],
  released: [],
  canceled: [],
};

export type TransicaoPayout =
  | { ok: true; de: PayoutStatus; para: PayoutStatus }
  | {
      ok: false;
      motivo: 'ja_esta_assim' | 'estado_terminal' | 'nao_permitida';
      de: PayoutStatus;
      para: PayoutStatus;
    };

export function transicionarPayout(de: PayoutStatus, para: PayoutStatus): TransicaoPayout {
  if (de === para) return { ok: false, motivo: 'ja_esta_assim', de, para };
  if (TRANSICOES[de].length === 0) return { ok: false, motivo: 'estado_terminal', de, para };
  if (!TRANSICOES[de].includes(para)) return { ok: false, motivo: 'nao_permitida', de, para };
  return { ok: true, de, para };
}

/** Estados dos quais o executor pode tirar um repasse para processar. */
export function statusDeOrigemPara(para: PayoutStatus): PayoutStatus[] {
  return PAYOUT_STATUSES.filter((de) => TRANSICOES[de].includes(para));
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

/** Um pedido pago online, como entra no repasse. */
export type PedidoParaRepasse = {
  totalCentavos: Cents;
  valorProdutorCentavos: Cents;
  valorOperadorCentavos: Cents;
  /** Soma dos reembolsos concluídos deste pedido, no valor devolvido ao comprador. */
  reembolsadoCentavos: Cents;
  /** Pedido terminou em chargeback. */
  chargeback: boolean;
};

export type TotaisRepasse = {
  /** O que os compradores pagaram. */
  brutoCentavos: Cents;
  /** Parcela do operador (conveniência + comissão + taxa fixa), já separada no split. */
  comissaoCentavos: Cents;
  /** Parcela do produtor no split, antes de qualquer estorno. */
  produtorCentavos: Cents;
  /** Quanto dos reembolsos saiu do saldo do produtor. */
  reembolsosCentavos: Cents;
  /** Quanto dos chargebacks saiu do saldo do produtor. */
  chargebacksCentavos: Cents;
  /** produtor − reembolsos − chargebacks. Pode ser negativo. */
  liquidoCentavos: Cents;
};

/**
 * Soma os pedidos de UM evento e UM meio de pagamento.
 *
 * Reembolso: a PSP debita cada recebedor na proporção da parcela dele no
 * split. Reproduzimos a mesma conta, com o mesmo arredondamento, para que o
 * que o motor acha que está retido bata com o que a PSP de fato retém.
 *
 * Chargeback: o produtor é o responsável no split (`liableForChargeback`), e
 * a PSP debita dele o valor contestado inteiro — inclusive a parte que foi
 * do operador. O contestado é o que ainda não tinha sido reembolsado.
 *
 * As duas regras precisam ser conferidas contra a PSP escolhida; ver ADR-021.
 */
export function somarPedidos(pedidos: readonly PedidoParaRepasse[]): TotaisRepasse {
  let bruto = 0;
  let comissao = 0;
  let produtor = 0;
  let reembolsos = 0;
  let chargebacks = 0;

  for (const p of pedidos) {
    assertCents(p.totalCentavos, 'totalCentavos');
    assertCents(p.valorProdutorCentavos, 'valorProdutorCentavos');
    assertCents(p.valorOperadorCentavos, 'valorOperadorCentavos');
    assertCents(p.reembolsadoCentavos, 'reembolsadoCentavos');

    if (p.valorProdutorCentavos + p.valorOperadorCentavos !== p.totalCentavos) {
      throw new MoneyError('Pedido com split que não fecha não pode entrar no repasse');
    }
    if (p.reembolsadoCentavos > p.totalCentavos) {
      throw new MoneyError('Reembolso maior que o total do pedido');
    }

    bruto += p.totalCentavos;
    comissao += p.valorOperadorCentavos;
    produtor += p.valorProdutorCentavos;

    if (p.totalCentavos > 0 && p.reembolsadoCentavos > 0) {
      reembolsos += Math.round(
        (p.reembolsadoCentavos * p.valorProdutorCentavos) / p.totalCentavos,
      );
    }
    if (p.chargeback) {
      chargebacks += p.totalCentavos - p.reembolsadoCentavos;
    }
  }

  return {
    brutoCentavos: bruto,
    comissaoCentavos: comissao,
    produtorCentavos: produtor,
    reembolsosCentavos: reembolsos,
    chargebacksCentavos: chargebacks,
    liquidoCentavos: produtor - reembolsos - chargebacks,
  };
}

export type Tranche = {
  /** Fica segurado na PSP depois desta tranche. */
  retidoCentavos: Cents;
  /**
   * O que esta tranche libera. Negativo = saldo a descoberto: o produtor
   * deve à PSP. Nada é liberado nesse caso.
   */
  liberadoCentavos: Cents;
};

/**
 * Tranche principal: libera o líquido menos a reserva de garantia do meio de
 * pagamento (`reserva_pix_bps` ou `reserva_cartao_bps`).
 *
 * Líquido negativo ou zero não libera nada e não retém nada: não há o que
 * segurar.
 */
export function calcularPrincipal(totais: TotaisRepasse, reservaBps: number): Tranche {
  const liquido = totais.liquidoCentavos;
  if (liquido <= 0) return { retidoCentavos: 0, liberadoCentavos: liquido };

  const retido = aplicarBps(liquido, reservaBps);
  return { retidoCentavos: retido, liberadoCentavos: liquido - retido };
}

/**
 * Tranche reserva: tudo o que sobrou.
 *
 * `liberadoPrincipal` é o que a principal REALMENTE liberou. Se ela não
 * liberou nada (líquido negativo naquela data), conta zero.
 */
export function calcularReserva(totais: TotaisRepasse, liberadoPrincipal: Cents): Tranche {
  const jaSaiu = Math.max(liberadoPrincipal, 0);
  return { retidoCentavos: 0, liberadoCentavos: totais.liquidoCentavos - jaSaiu };
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

const FUSO = 'America/Sao_Paulo';
const DIA_MS = 24 * 60 * 60 * 1000;

const diaDaSemana = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' });

function fimDeSemana(d: Date): boolean {
  const dia = diaDaSemana.format(d);
  return dia === 'Sat' || dia === 'Sun';
}

/**
 * Soma dias úteis no fuso de São Paulo. Sábado e domingo não contam.
 *
 * Feriado não entra na conta, por enquanto: o efeito é liberar um dia antes
 * do que a PSP liberaria — e quem decide de fato é ela. Ver ADR-021.
 *
 * O Brasil não tem horário de verão desde 2019, então somar 24 h é somar um
 * dia de calendário local.
 */
export function adicionarDiasUteis(inicio: Date, dias: number): Date {
  if (!Number.isInteger(dias) || dias < 0) throw new Error(`dias inválido: ${dias}`);
  let d = new Date(inicio.getTime());
  let faltam = dias;
  while (faltam > 0) {
    d = new Date(d.getTime() + DIA_MS);
    if (!fimDeSemana(d)) faltam -= 1;
  }
  return d;
}

export function adicionarDias(inicio: Date, dias: number): Date {
  if (!Number.isInteger(dias) || dias < 0) throw new Error(`dias inválido: ${dias}`);
  return new Date(inicio.getTime() + dias * DIA_MS);
}

export type ConfigCronograma = {
  diasLiberacaoEvento: number;
  diasLiberacaoReserva: number;
};

export function datasDoRepasse(
  fimDoEvento: Date,
  config: ConfigCronograma,
): { principal: Date; reserva: Date } {
  return {
    principal: adicionarDiasUteis(fimDoEvento, config.diasLiberacaoEvento),
    reserva: adicionarDias(fimDoEvento, config.diasLiberacaoReserva),
  };
}

/**
 * Até quando a PSP deve segurar a parcela do produtor, pedida na venda.
 *
 * É um TETO de segurança, não a data do repasse: quem libera é o motor, por
 * comando. A folga existe para que um motor parado não deixe a PSP soltar a
 * reserva sozinha antes da janela de contestação — e para que um motor
 * parado também não prenda o dinheiro do produtor para sempre.
 */
export const FOLGA_RETENCAO_DIAS = 30;

export function retencaoAte(fimDoEvento: Date, config: ConfigCronograma): Date {
  return adicionarDias(fimDoEvento, config.diasLiberacaoReserva + FOLGA_RETENCAO_DIAS);
}

/** Chave de idempotência estável: a mesma tranche nunca é liberada duas vezes. */
export function chaveDoRepasse(
  eventId: string,
  tranche: 'principal' | 'reserva',
  metodo: 'pix' | 'credit_card',
): string {
  return `payout:${eventId}:${tranche}:${metodo}`;
}
