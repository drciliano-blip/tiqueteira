/**
 * Regras de estoque que não precisam de banco — plano, seção 10.
 *
 * O travamento em si é do Postgres (src/lib/inventory.ts). O que mora aqui é
 * a política: janela de vendas, limites e o cálculo de disponível.
 */
import type { PaymentMethod } from '@/lib/payments/types';

/**
 * TTL da reserva por meio de pagamento.
 *
 * Pix tem prazo maior porque o comprador sai do site, abre o banco, autentica
 * e volta. Cartão é preenchido na própria tela. Reserva longa demais deixa
 * estoque parado; curta demais derruba compra legítima no meio.
 */
export const TTL_RESERVA_SEGUNDOS: Record<PaymentMethod, number> = {
  pix: 600,
  credit_card: 300,
};

/** Enquanto o comprador ainda não escolheu o meio de pagamento. */
export const TTL_RESERVA_PADRAO_SEGUNDOS = TTL_RESERVA_SEGUNDOS.pix;

export type EstoqueTipo = {
  quantidadeTotal: number;
  quantidadeVendida: number;
  quantidadeReservada: number;
};

export function disponivel(t: EstoqueTipo): number {
  return t.quantidadeTotal - t.quantidadeVendida - t.quantidadeReservada;
}

export function esgotado(t: EstoqueTipo): boolean {
  return disponivel(t) <= 0;
}

export function dentroDaJanela(agora: Date, inicio: Date, fim: Date): boolean {
  const t = agora.getTime();
  return t >= inicio.getTime() && t <= fim.getTime();
}

export type MotivoIndisponivel =
  | 'inativo'
  | 'fora_da_janela'
  | 'sem_estoque'
  | 'acima_do_limite_por_pedido'
  | 'quantidade_invalida';

export type ChecagemTipo = {
  ativo: boolean;
  vendasInicio: Date;
  vendasFim: Date;
  limitePorPedido: number;
} & EstoqueTipo;

/**
 * Checagem otimista, para a tela: diz por que não dá, antes de tentar.
 *
 * NÃO substitui o `UPDATE` atômico. Entre esta checagem e a reserva, outro
 * comprador pode levar o último ingresso — é justamente por isso que a reserva
 * não faz `SELECT` antes de gravar. Isto aqui serve para a mensagem de erro
 * ser boa, não para decidir a venda.
 */
export function checarDisponibilidade(
  tipo: ChecagemTipo,
  quantidade: number,
  agora = new Date(),
): { ok: true } | { ok: false; motivo: MotivoIndisponivel } {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return { ok: false, motivo: 'quantidade_invalida' };
  }
  if (!tipo.ativo) return { ok: false, motivo: 'inativo' };
  if (!dentroDaJanela(agora, tipo.vendasInicio, tipo.vendasFim)) {
    return { ok: false, motivo: 'fora_da_janela' };
  }
  if (quantidade > tipo.limitePorPedido) {
    return { ok: false, motivo: 'acima_do_limite_por_pedido' };
  }
  if (disponivel(tipo) < quantidade) return { ok: false, motivo: 'sem_estoque' };
  return { ok: true };
}

/**
 * Teto agregado do espaço (plano, seção 10): a soma dos tipos ativos não pode
 * ultrapassar a capacidade. Validado no CADASTRO do evento, não na venda —
 * checar na venda seria caro e tarde demais.
 */
export function excedeCapacidade(
  quantidadesDosTipos: readonly number[],
  capacidade: number,
): boolean {
  return quantidadesDosTipos.reduce((a, b) => a + b, 0) > capacidade;
}

/**
 * Cota de meia-entrada — ADR-004 e Lei nº 12.933/2013.
 * Só contam os tipos marcados como consumidores da cota: gratuidade legal
 * (idoso, PCD) fica de fora.
 */
export function excedeCotaMeia(
  quantidadesQueConsomemCota: readonly number[],
  capacidade: number,
  cotaBps: number,
): boolean {
  const cota = Math.floor((capacidade * cotaBps) / 10_000);
  return quantidadesQueConsomemCota.reduce((a, b) => a + b, 0) > cota;
}
