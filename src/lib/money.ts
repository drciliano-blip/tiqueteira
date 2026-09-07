/**
 * Aritmética monetária em centavos.
 *
 * Regra nº 4 do CLAUDE.md: nunca float. Este módulo existe para que não haja
 * desculpa — toda conta de dinheiro do sistema passa por aqui.
 */
import type { Cents } from '@/lib/payments/types';

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Falha alto se o valor não for centavo válido. */
export function assertCents(valor: number, campo = 'valor'): asserts valor is Cents {
  if (!Number.isInteger(valor)) {
    throw new MoneyError(`${campo} precisa ser inteiro em centavos, recebeu ${valor}`);
  }
  if (!Number.isSafeInteger(valor)) {
    throw new MoneyError(`${campo} fora do intervalo seguro de inteiros`);
  }
}

export function assertNaoNegativo(valor: number, campo = 'valor'): asserts valor is Cents {
  assertCents(valor, campo);
  if (valor < 0) throw new MoneyError(`${campo} não pode ser negativo, recebeu ${valor}`);
}

/**
 * Arredondamento "metade para longe do zero" — o mesmo do comércio e o que
 * `ROUND_HALF_UP` faz no Postgres.
 *
 * `Math.round` do JavaScript não serve: ele arredonda para +∞, então
 * `Math.round(-0.5)` dá `-0`. Em estorno e saldo a descoberto isso vira
 * centavo perdido.
 */
function arredondar(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * Aplica um percentual em basis points (ADR-006).
 * `aplicarBps(10000, 1000)` = 10% de R$ 100,00 = R$ 10,00 = 1000 centavos.
 */
export function aplicarBps(valor: Cents, bps: number): Cents {
  assertCents(valor, 'valor');
  if (!Number.isInteger(bps)) throw new MoneyError(`bps precisa ser inteiro, recebeu ${bps}`);
  if (bps < 0) throw new MoneyError(`bps não pode ser negativo, recebeu ${bps}`);
  return arredondar((valor * bps) / 10_000);
}

/**
 * Reparte `total` entre `pesos`, garantindo que a soma das partes seja
 * exatamente `total`. O resíduo do arredondamento é distribuído do maior
 * resto para o menor (método de Hare), e o desempate vai para o primeiro
 * índice — assim a operação é determinística e testável.
 *
 * Usado para ratear reembolso parcial entre ingressos e conveniência entre
 * itens do pedido. Sem isso, "some um centavo" na conciliação.
 */
export function repartir(total: Cents, pesos: readonly number[]): Cents[] {
  assertCents(total, 'total');
  if (pesos.length === 0) throw new MoneyError('repartir precisa de ao menos um peso');
  if (pesos.some((p) => p < 0)) throw new MoneyError('peso não pode ser negativo');

  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  if (somaPesos === 0) {
    // Sem peso, divide igualmente e joga o resto no primeiro.
    const base = Math.trunc(total / pesos.length);
    const partes = pesos.map(() => base);
    partes[0] = (partes[0] ?? 0) + (total - base * pesos.length);
    return partes;
  }

  const exatos = pesos.map((p) => (total * p) / somaPesos);
  const partes = exatos.map((x) => Math.trunc(x));
  let resto = total - partes.reduce((a, b) => a + b, 0);

  const ordem = exatos
    .map((x, i) => ({ i, frac: x - Math.trunc(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  let k = 0;
  const passo = resto >= 0 ? 1 : -1;
  while (resto !== 0 && ordem.length > 0) {
    const alvo = ordem[k % ordem.length]!;
    partes[alvo.i] = (partes[alvo.i] ?? 0) + passo;
    resto -= passo;
    k++;
  }

  return partes;
}

/** R$ 12,34 → 1234. Aceita string para não passar por float na entrada. */
export function reaisParaCentavos(entrada: string | number): Cents {
  const texto = typeof entrada === 'number' ? entrada.toFixed(2) : entrada.trim();
  const limpo = texto.replace(/[R$\s.]/g, '').replace(',', '.');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(limpo);
  if (!m) throw new MoneyError(`Valor monetário inválido: ${entrada}`);
  const sinal = m[1] === '-' ? -1 : 1;
  const inteiros = Number.parseInt(m[2]!, 10);
  const decimais = Number.parseInt((m[3] ?? '0').padEnd(2, '0'), 10);
  return sinal * (inteiros * 100 + decimais);
}

/** 1234 → "R$ 12,34". Exibição apenas; nunca use para cálculo. */
export function formatarBRL(valor: Cents): string {
  assertCents(valor, 'valor');
  const negativo = valor < 0;
  const abs = Math.abs(valor);
  const inteiros = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = (abs % 100).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}R$ ${inteiros},${centavos}`;
}
