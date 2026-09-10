/**
 * Fila virtual — plano, seção 10, e ADR-014.
 *
 * O problema que ela resolve foi medido, não imaginado: numa abertura de
 * festival não são 5 mil pessoas comprando 5 mil ingressos, são 20 mil
 * tentando. As 15 mil que não vão conseguir **também entram na fila do banco**,
 * porque a tentativa que falha por falta de estoque ainda precisa examinar a
 * mesma linha travada do lote. Sem fila, todo mundo espera por todo mundo, e
 * quem estava em primeiro também estoura o tempo limite.
 *
 * A fila inverte isso: um número fixo de pessoas compra por vez, e as demais
 * esperam **sabendo onde estão**. O sistema não fica mais rápido; fica
 * previsível — e previsível é o que impede a pessoa de recarregar a página
 * dez vezes, que é o que transforma lentidão em queda.
 *
 * Função pura. Quem guarda o estado é `src/lib/fila.ts`.
 */

export type ConfiguracaoFila = {
  ativa: boolean;
  /** Quantas pessoas podem estar comprando ao mesmo tempo. */
  capacidade: number;
  /** Quanto tempo cada admitido tem para concluir a compra. */
  janelaMinutos: number;
};

export type LugarNaFila = {
  /** Número de chegada, imutável. */
  numero: number;
  /** Até onde a fila já foi chamada. */
  chamadosAte: number;
};

export type SituacaoFila =
  | { situacao: 'admitido' }
  | {
      situacao: 'aguardando';
      /** Quantas pessoas ainda serão chamadas antes desta. */
      pessoasNaFrente: number;
      /** Minutos estimados. `null` quando ainda não há ritmo observado. */
      esperaMinutos: number | null;
    };

/**
 * Onde a pessoa está.
 *
 * `chamadosAte` é uma marca d'água: todo número menor ou igual a ela já foi
 * chamado. Comparar dois inteiros é o que torna a consulta barata o bastante
 * para 20 mil pessoas perguntando a cada poucos segundos — contar linhas a
 * cada pergunta faria a própria fila virar o gargalo que ela existe para
 * evitar.
 */
export function situacaoNaFila(
  lugar: LugarNaFila,
  ritmoPorMinuto: number | null,
): SituacaoFila {
  if (lugar.numero <= lugar.chamadosAte) return { situacao: 'admitido' };

  const pessoasNaFrente = lugar.numero - lugar.chamadosAte - 1;

  return {
    situacao: 'aguardando',
    pessoasNaFrente,
    esperaMinutos: estimarEspera(pessoasNaFrente, ritmoPorMinuto),
  };
}

/**
 * Estimativa a partir do ritmo **observado**, não do teórico.
 *
 * O teórico erra sempre para pior: supõe que todo admitido usa a janela
 * inteira, quando a maioria compra em dois minutos. Uma fila que promete
 * quarenta minutos e anda em cinco perde a pessoa antes de andar.
 *
 * Devolve `null` enquanto não houver ritmo medido — dizer "não sei ainda" é
 * melhor que inventar um número que a pessoa vai usar para decidir se fica.
 */
export function estimarEspera(
  pessoasNaFrente: number,
  ritmoPorMinuto: number | null,
): number | null {
  if (ritmoPorMinuto === null || ritmoPorMinuto <= 0) return null;
  if (pessoasNaFrente <= 0) return 0;

  return Math.max(1, Math.ceil(pessoasNaFrente / ritmoPorMinuto));
}

/**
 * Quantos chamar agora.
 *
 * A conta é sobre quem está **ocupando lugar**, não sobre quem já entrou
 * alguma vez: a janela de quem não comprou expira e devolve a vaga. Nunca
 * chama além de quem está na fila, senão a marca d'água passaria à frente das
 * pessoas e daria vaga a quem ainda nem chegou.
 */
export function quantosChamar(params: {
  capacidade: number;
  comprandoAgora: number;
  ultimoNumero: number;
  chamadosAte: number;
}): number {
  const vagas = Math.max(0, params.capacidade - params.comprandoAgora);
  const esperando = Math.max(0, params.ultimoNumero - params.chamadosAte);

  return Math.min(vagas, esperando);
}

/** Ritmo observado entre duas leituras da marca d'água. */
export function ritmoObservado(params: {
  chamadosAte: number;
  marcaAnterior: number;
  segundosDesdeAnterior: number;
}): number | null {
  if (params.segundosDesdeAnterior <= 0) return null;

  const avanco = params.chamadosAte - params.marcaAnterior;
  if (avanco <= 0) return null;

  return (avanco / params.segundosDesdeAnterior) * 60;
}

/**
 * De quanto em quanto tempo a página da fila deve perguntar de novo.
 *
 * Quem está em segundo lugar precisa saber logo; quem está em dez mil não
 * ganha nada perguntando a cada três segundos, e vinte mil pessoas fazendo
 * isso derrubariam justamente o sistema que a fila protege.
 */
export function intervaloDeConsultaSegundos(pessoasNaFrente: number): number {
  if (pessoasNaFrente <= 20) return 3;
  if (pessoasNaFrente <= 200) return 8;
  if (pessoasNaFrente <= 2000) return 20;
  return 45;
}
