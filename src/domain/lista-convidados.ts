/**
 * Lista de convidados — plano, seção 23.2, e ADR-012.
 *
 * Em casa noturna a lista VIP é parte do negócio, não um favor: o promoter
 * coloca nomes, a pessoa chega e entra. Sem isso no sistema, a lista continua
 * no papel ou no WhatsApp — e é exatamente aí que o controle de portaria
 * falha, porque ninguém consegue conferir cota, ninguém sabe quem já entrou, e
 * o mesmo nome passa duas vezes em portões diferentes.
 *
 * Função pura: decide se um nome da lista pode entrar agora, e por quê não
 * quando não pode. A recusa precisa dar uma frase ao segurança — "a lista do
 * Rafael fechou às 23h" resolve na porta; "não autorizado" não resolve nada.
 */
import { hora } from '@/lib/datas';

export type ConfiguracaoLista = {
  ativo: boolean;
  /** Teto de nomes da lista. Não pode furar a capacidade do evento. */
  cota: number;
  /** Depois deste horário a lista não vale mais. */
  validoAte: Date | null;
};

export type EntradaConvidado = {
  /** `cortesia` entra de graça; `desconto` paga na bilheteria. */
  tipo: string;
  usadoEm: Date | null;
};

export type MotivoRecusaLista =
  | 'lista_desativada'
  | 'lista_encerrada'
  | 'ja_entrou'
  | 'nao_e_cortesia';

export type DecisaoLista =
  | { permitido: true }
  | { permitido: false; motivo: MotivoRecusaLista; explicacao: string };

export function avaliarConvidado(ctx: {
  lista: ConfiguracaoLista;
  entrada: EntradaConvidado;
  agora: Date;
}): DecisaoLista {
  const { lista, entrada } = ctx;

  if (!lista.ativo) {
    return {
      permitido: false,
      motivo: 'lista_desativada',
      explicacao: 'Esta lista foi desativada pelo produtor.',
    };
  }

  if (lista.validoAte && ctx.agora > lista.validoAte) {
    return {
      permitido: false,
      motivo: 'lista_encerrada',
      explicacao: `Esta lista valia até as ${hora(lista.validoAte)}.`,
    };
  }

  if (entrada.usadoEm) {
    return {
      permitido: false,
      motivo: 'ja_entrou',
      explicacao: `Este nome já entrou às ${hora(entrada.usadoEm)}.`,
    };
  }

  /**
   * Convidado de desconto não entra pela lista: ele tem preço menor, e preço
   * menor ainda é venda. Emitir cortesia para quem deveria pagar seria furar
   * a bilheteria pelo caminho mais silencioso possível.
   */
  if (entrada.tipo !== 'cortesia') {
    return {
      permitido: false,
      motivo: 'nao_e_cortesia',
      explicacao: 'Este nome tem desconto, não cortesia. Compre na bilheteria.',
    };
  }

  return { permitido: true };
}

export type SituacaoCota = {
  cota: number;
  nomes: number;
  vagas: number;
  cheia: boolean;
};

/**
 * A cota é sobre **nomes na lista**, não sobre quem já entrou. É o único
 * jeito de o produtor saber, antes da festa, quantas cortesias ele deu — que
 * é a conta que ele quer fazer, porque cada cortesia é um ingresso que não
 * foi vendido.
 */
export function situacaoDaCota(cota: number, nomes: number): SituacaoCota {
  const vagas = Math.max(0, cota - nomes);
  return { cota, nomes, vagas, cheia: vagas === 0 };
}

export type NomeRecusado = { nome: string; motivo: 'duplicado' | 'sem_cota' | 'vazio' };

export type Separacao = { aceitos: string[]; recusados: NomeRecusado[] };

/**
 * Separa uma colagem de nomes no que cabe e no que não cabe.
 *
 * O promoter cola trinta nomes de uma vez, vindos do WhatsApp. Recusar o lote
 * inteiro porque dois estavam repetidos faria ele desistir do sistema e voltar
 * para o papel — então aceita o que dá, e diz nome por nome o que ficou fora.
 */
export function separarNomes(
  brutos: string[],
  jaNaLista: string[],
  vagas: number,
): Separacao {
  const normalizar = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

  const existentes = new Set(jaNaLista.map(normalizar));
  const aceitos: string[] = [];
  const recusados: NomeRecusado[] = [];

  for (const bruto of brutos) {
    const nome = bruto.trim().replace(/\s+/g, ' ');

    if (nome.length < 2) {
      if (bruto.trim().length > 0) recusados.push({ nome: bruto, motivo: 'vazio' });
      continue;
    }

    const chave = normalizar(nome);
    if (existentes.has(chave)) {
      recusados.push({ nome, motivo: 'duplicado' });
      continue;
    }

    if (aceitos.length >= vagas) {
      recusados.push({ nome, motivo: 'sem_cota' });
      continue;
    }

    existentes.add(chave);
    aceitos.push(nome);
  }

  return { aceitos, recusados };
}
