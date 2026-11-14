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
const dataLocal = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function fimDeSemana(d: Date): boolean {
  const dia = diaDaSemana.format(d);
  return dia === 'Sat' || dia === 'Sun';
}

/** Domingo de Páscoa (calendário gregoriano), pelo algoritmo de Meeus/Jones/Butcher. */
export function pascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

function deslocar(ano: number, mes: number, dia: number, dias: number): string {
  const t = new Date(Date.UTC(ano, mes - 1, dia) + dias * DIA_MS);
  return t.toISOString().slice(0, 10);
}

/**
 * Dias sem expediente bancário em todo o país, no formato `AAAA-MM-DD`.
 *
 * O que conta para o repasse é o dia em que a operadora de pagamento e os
 * bancos funcionam — por isso entram carnaval e Corpus Christi, que não
 * fecham todo o comércio, mas fecham a compensação bancária. Feriados
 * estaduais e municipais não entram. A lista e a base legal estão no
 * ADR-021 e precisam ser conferidas contra o calendário da PSP escolhida.
 */
export function feriadosBancarios(ano: number): Set<string> {
  const p = pascoa(ano);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
  return new Set([
    ...fixos.map((md) => `${ano}-${md}`),
    deslocar(ano, p.mes, p.dia, -48), // segunda de carnaval
    deslocar(ano, p.mes, p.dia, -47), // terça de carnaval
    deslocar(ano, p.mes, p.dia, -2), // sexta-feira santa
    deslocar(ano, p.mes, p.dia, 60), // Corpus Christi
  ]);
}

const cacheFeriados = new Map<number, Set<string>>();

function feriado(d: Date): boolean {
  const iso = dataLocal.format(d); // AAAA-MM-DD no fuso de São Paulo
  const ano = Number(iso.slice(0, 4));
  let lista = cacheFeriados.get(ano);
  if (!lista) {
    lista = feriadosBancarios(ano);
    cacheFeriados.set(ano, lista);
  }
  return lista.has(iso);
}

/**
 * Soma dias úteis no fuso de São Paulo. Sábado, domingo e dia sem expediente
 * bancário nacional não contam (`feriadosBancarios`).
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
    if (!fimDeSemana(d) && !feriado(d)) faltam -= 1;
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
