/**
 * Cupom de desconto — plano, seção 7.
 *
 * Função pura. A tabela existia desde a Fase 0 e o cálculo de taxas já sabia
 * receber desconto (`src/lib/fees.ts`); o que faltava era a regra.
 *
 * Duas coisas que parecem detalhe e são dinheiro:
 *
 * 1. **O desconto nunca passa do subtotal.** Um cupom de R$ 50 num ingresso
 *    de R$ 30 desconta R$ 30, não R$ 50 — senão o total ficaria negativo e o
 *    split não fecharia com o total, que é invariante do banco.
 * 2. **A conveniência incide sobre o valor já descontado**, e isso mora em
 *    `fees.ts`. Cobrar taxa sobre um preço que o comprador não pagou é o tipo
 *    de coisa que o Procon autua.
 */
import { aplicarBps } from '@/lib/money';

export type EstadoCupom = {
  /** `pct` guarda basis points; `valor` guarda centavos. */
  tipo: 'pct' | 'valor';
  valor: number;
  ativo: boolean;
  validoAte: Date | null;
  usosMaximos: number | null;
  usosAtuais: number;
  /** Nulo = vale para todos os eventos do produtor. */
  eventId: string | null;
};

export type MotivoRecusaCupom = 'inativo' | 'expirado' | 'esgotado' | 'outro_evento';

export type AvaliacaoCupom =
  | { valido: true }
  | { valido: false; motivo: MotivoRecusaCupom; explicacao: string };

/**
 * A recusa é sempre a mesma frase para o comprador, de propósito.
 *
 * Dizer "este cupom esgotou" e "este cupom não vale para este evento" com
 * palavras diferentes ensina quem está tentando adivinhar código alheio. Quem
 * precisa da distinção é o produtor, no painel — e lá ela existe.
 */
const RECUSA = 'Cupom inválido ou expirado.';

export function avaliarCupom(ctx: {
  cupom: EstadoCupom;
  eventId: string;
  agora: Date;
}): AvaliacaoCupom {
  const { cupom } = ctx;

  if (!cupom.ativo) {
    return { valido: false, motivo: 'inativo', explicacao: RECUSA };
  }

  if (cupom.eventId !== null && cupom.eventId !== ctx.eventId) {
    return { valido: false, motivo: 'outro_evento', explicacao: RECUSA };
  }

  if (cupom.validoAte && ctx.agora > cupom.validoAte) {
    return { valido: false, motivo: 'expirado', explicacao: RECUSA };
  }

  if (cupom.usosMaximos !== null && cupom.usosAtuais >= cupom.usosMaximos) {
    return { valido: false, motivo: 'esgotado', explicacao: RECUSA };
  }

  return { valido: true };
}

/**
 * Quanto este cupom tira deste subtotal.
 *
 * Nunca mais que o subtotal: o desconto reduz o preço do ingresso, não vira
 * crédito nem paga a conveniência.
 */
export function descontoDoCupom(cupom: EstadoCupom, subtotalCentavos: number): number {
  if (subtotalCentavos <= 0) return 0;

  const bruto =
    cupom.tipo === 'pct' ? aplicarBps(subtotalCentavos, cupom.valor) : cupom.valor;

  return Math.min(bruto, subtotalCentavos);
}

/** Normaliza o código digitado: ninguém acerta caixa e espaço com o dedo no celular. */
export function normalizarCodigo(bruto: string): string {
  return bruto.trim().replace(/\s+/g, '').toUpperCase();
}

/** Como o desconto aparece na tela do comprador. */
export function descreverCupom(cupom: Pick<EstadoCupom, 'tipo' | 'valor'>): string {
  return cupom.tipo === 'pct'
    ? `${(cupom.valor / 100).toString().replace('.', ',')}% de desconto`
    : `R$ ${(cupom.valor / 100).toFixed(2).replace('.', ',')} de desconto`;
}
