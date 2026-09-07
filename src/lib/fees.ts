/**
 * Cálculo de taxas e montagem do split — plano, seções 2 e 9.2.
 *
 * Regra do adaptador: o provider TRADUZ, não decide. Toda a lógica de quanto
 * cada um recebe mora aqui, em função pura, para ser testável e portátil entre
 * PSPs.
 *
 * Nenhum percentual é constante neste arquivo: tudo vem de `FeeConfig`, que
 * vem da linha do tenant no banco. Taxa é dado, não arquitetura.
 */
import { aplicarBps, assertNaoNegativo, MoneyError } from '@/lib/money';
import type { Cents, SplitRule } from '@/lib/payments/types';

/** Vem de `tenants`. Percentuais em basis points — ADR-006. */
export type FeeConfig = {
  /** Somada ao preço, paga pelo comprador. Visível no checkout. */
  taxaConvenienciaBps: number;
  /** Descontada do produtor no split. Invisível ao comprador. */
  comissaoBps: number;
  /** Valor fixo por ingresso emitido. Viabiliza evento de ticket baixo. */
  taxaFixaCentavos: Cents;
};

export type FeeInput = {
  /** Soma dos itens, a preço de tabela. */
  subtotalCentavos: Cents;
  quantidadeIngressos: number;
  /** Cupom. Reduz a base antes da conveniência. */
  descontoCentavos?: Cents;
  config: FeeConfig;
};

export type FeeBreakdown = {
  subtotalCentavos: Cents;
  descontoCentavos: Cents;
  /** Subtotal menos desconto. Base de todo percentual. */
  baseCentavos: Cents;
  convenienciaCentavos: Cents;
  /** O que o comprador paga. */
  totalCentavos: Cents;

  comissaoCentavos: Cents;
  taxaFixaTotalCentavos: Cents;

  /** Parcela do operador no split. */
  valorOperadorCentavos: Cents;
  /** Parcela do produtor no split. */
  valorProdutorCentavos: Cents;
};

/**
 * A conveniência incide sobre o valor JÁ DESCONTADO.
 *
 * É a leitura mais defensável frente ao CDC: o cupom reduz o preço do produto,
 * e a taxa de serviço acompanha o preço efetivamente cobrado. Cobrar
 * conveniência sobre um preço que o comprador não pagou é o tipo de coisa que
 * o Procon autua.
 */
export function calcularTaxas(input: FeeInput): FeeBreakdown {
  const { subtotalCentavos, quantidadeIngressos, config } = input;
  const descontoCentavos = input.descontoCentavos ?? 0;

  assertNaoNegativo(subtotalCentavos, 'subtotalCentavos');
  assertNaoNegativo(descontoCentavos, 'descontoCentavos');
  assertNaoNegativo(config.taxaFixaCentavos, 'taxaFixaCentavos');

  if (!Number.isInteger(quantidadeIngressos) || quantidadeIngressos < 0) {
    throw new MoneyError(`quantidadeIngressos inválida: ${quantidadeIngressos}`);
  }
  if (descontoCentavos > subtotalCentavos) {
    throw new MoneyError(
      `Desconto (${descontoCentavos}) maior que o subtotal (${subtotalCentavos}). ` +
        'O cupom deve ser limitado antes de chegar aqui.',
    );
  }

  const baseCentavos = subtotalCentavos - descontoCentavos;
  const convenienciaCentavos = aplicarBps(baseCentavos, config.taxaConvenienciaBps);
  const totalCentavos = baseCentavos + convenienciaCentavos;

  const comissaoCentavos = aplicarBps(baseCentavos, config.comissaoBps);
  const taxaFixaTotalCentavos = config.taxaFixaCentavos * quantidadeIngressos;

  /**
   * O operador não pode receber mais do que entrou. Num ingresso barato com
   * taxa fixa alta — ou num pedido zerado por cupom — a soma das taxas
   * ultrapassaria o total, e o produtor ficaria com parcela negativa. A PSP
   * recusaria o split, mas o erro apareceria só na hora da venda.
   *
   * Aqui o teto é explícito: o operador leva no máximo o total, e o produtor
   * nunca fica negativo. Um evento configurado assim vende sem repasse — o
   * que é ruim para o produtor, mas é decisão de quem configurou, não bug.
   */
  const desejadoOperador = convenienciaCentavos + comissaoCentavos + taxaFixaTotalCentavos;
  const valorOperadorCentavos = Math.min(desejadoOperador, totalCentavos);
  const valorProdutorCentavos = totalCentavos - valorOperadorCentavos;

  const resultado: FeeBreakdown = {
    subtotalCentavos,
    descontoCentavos,
    baseCentavos,
    convenienciaCentavos,
    totalCentavos,
    comissaoCentavos,
    taxaFixaTotalCentavos,
    valorOperadorCentavos,
    valorProdutorCentavos,
  };

  conferirInvariantes(resultado);
  return resultado;
}

/**
 * As três coisas que não podem estar erradas nunca. Verificadas em toda
 * chamada, inclusive em produção: o custo é desprezível e o benefício é
 * descobrir na hora, e não na conciliação do mês seguinte.
 */
function conferirInvariantes(b: FeeBreakdown): void {
  if (b.valorOperadorCentavos + b.valorProdutorCentavos !== b.totalCentavos) {
    throw new MoneyError(
      `Split não fecha: operador ${b.valorOperadorCentavos} + produtor ` +
        `${b.valorProdutorCentavos} != total ${b.totalCentavos}`,
    );
  }
  if (b.valorOperadorCentavos < 0 || b.valorProdutorCentavos < 0) {
    throw new MoneyError('Parcela negativa no split');
  }
  if (b.totalCentavos !== b.baseCentavos + b.convenienciaCentavos) {
    throw new MoneyError('Total não bate com base + conveniência');
  }
}

export type SplitTargets = {
  /** Recebedor do operador da plataforma na PSP. */
  operadorRecipientId: string;
  /** Recebedor do produtor na PSP. */
  produtorRecipientId: string;
};

export type SplitOptions = {
  /**
   * Retenção do saldo do produtor até a data. Só tem efeito se o provider
   * declarar `conditionalRelease`.
   */
  holdUntil?: Date;
  /**
   * Quem arca com o chargeback da parcela do produtor. Padrão: o produtor.
   * O plano deixa isso como decisão de negócio em aberto (item 3 da seção 1);
   * até fechar, o padrão é o mais conservador para a plataforma.
   */
  produtorArcaChargeback?: boolean;
  /** Quem absorve a taxa de processamento da PSP. Padrão: o produtor. */
  produtorAbsorveTaxaPsp?: boolean;
};

/**
 * Monta as regras de split a partir do cálculo.
 *
 * Pedido de total zero (cortesia, ou cupom que zera) NÃO gera transação na
 * PSP — caso de borda 8 do plano. Aqui isso aparece como lista vazia, e o
 * chamador deve tratar o pedido como pago sem passar pelo provider.
 */
export function montarSplits(
  breakdown: FeeBreakdown,
  alvos: SplitTargets,
  opcoes: SplitOptions = {},
): SplitRule[] {
  conferirInvariantes(breakdown);

  if (breakdown.totalCentavos === 0) return [];

  if (!alvos.operadorRecipientId || !alvos.produtorRecipientId) {
    throw new MoneyError('Split exige recebedor do operador e do produtor');
  }

  const regras: SplitRule[] = [];

  if (breakdown.valorOperadorCentavos > 0) {
    regras.push({
      providerRecipientId: alvos.operadorRecipientId,
      amount: breakdown.valorOperadorCentavos,
      liableForChargeback: opcoes.produtorArcaChargeback === false,
      absorbsProcessingFee: opcoes.produtorAbsorveTaxaPsp === false,
    });
  }

  if (breakdown.valorProdutorCentavos > 0) {
    regras.push({
      providerRecipientId: alvos.produtorRecipientId,
      amount: breakdown.valorProdutorCentavos,
      liableForChargeback: opcoes.produtorArcaChargeback ?? true,
      absorbsProcessingFee: opcoes.produtorAbsorveTaxaPsp ?? true,
      ...(opcoes.holdUntil ? { holdUntil: opcoes.holdUntil } : {}),
    });
  }

  conferirSplits(regras, breakdown.totalCentavos);
  return regras;
}

/**
 * A soma das parcelas tem que ser exatamente o total da transação. Toda PSP
 * recusa split que não fecha, mas descobrir isso pelo erro dela é descobrir
 * tarde: já houve tentativa de cobrança do comprador.
 */
export function conferirSplits(regras: readonly SplitRule[], totalCentavos: Cents): void {
  const soma = regras.reduce((acc, r) => acc + r.amount, 0);
  if (soma !== totalCentavos) {
    throw new MoneyError(`Soma dos splits (${soma}) difere do total (${totalCentavos})`);
  }
  if (regras.some((r) => r.amount <= 0)) {
    throw new MoneyError('Split com parcela zerada ou negativa');
  }
}
