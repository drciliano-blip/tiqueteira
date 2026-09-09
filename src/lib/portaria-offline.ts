'use client';

/**
 * Portaria offline — plano, seções 12 e 24, e ADR-011.
 *
 * O aparelho baixa o manifesto antes de abrir os portões e valida no local.
 * Isso não é conforto: a rede de casa noturna é a primeira coisa a cair
 * quando enche, e é exatamente aí que a portaria mais precisa funcionar.
 *
 * Como a validação local é possível sem o segredo do servidor: o manifesto
 * traz o **hash** do token de cada ingresso. O aparelho calcula o SHA-256 do
 * QR lido e procura na lista. Confere a validade sem poder gerar ingresso —
 * celular perdido não vira máquina de falsificar.
 *
 * A decisão de deixar passar é a mesma função pura que o servidor usa
 * (`avaliarMovimento`). Duplicar a regra aqui seria garantir que um dia as
 * duas divergissem — e a divergência apareceria na porta, à uma da manhã.
 *
 * Limite honesto: offline, dois portões sem comunicação entre si deixam o
 * mesmo QR passar duas vezes. Nada resolve isso do lado do aparelho. O que a
 * sincronização faz é registrar que aconteceu, para a operação saber.
 */
import {
  avaliarMovimento,
  type MotivoRecusaPorta,
  type Movimento,
  type PoliticaPortaria,
} from '@/domain/portaria';

export type IngressoManifesto = {
  /** Hash do token. */
  h: string;
  /** Código curto. */
  c: string;
  /** Nome do titular. */
  n: string;
  /** Miolo do CPF, para distinguir homônimos. */
  d: string | null;
  /** Lote. */
  l: string;
  /** Situação no momento em que o manifesto foi gerado. */
  s: string;
  /** Entrada já registrada, se houver. */
  e: string | null;
  /** Estava na casa quando o manifesto foi gerado. */
  i: boolean;
  /** Quantas entradas já tinha. */
  q: number;
  /** Última saída registrada. */
  x: string | null;
};

export type Manifesto = {
  eventId: string;
  titulo: string;
  nominal: boolean;
  controlaSaida: boolean;
  permiteReentrada: boolean;
  geradoEm: string;
  total: number;
  ingressos: IngressoManifesto[];
};

export type MovimentoPendente = {
  tokenHash: string;
  tipo: Movimento;
  em: string;
  deviceId?: string;
};

/** O que este aparelho sabe sobre cada ingresso, depois do manifesto. */
type EstadoLocal = {
  /** Dentro. */
  d: boolean;
  /** Entradas. */
  q: number;
  /** Última entrada. */
  e: string | null;
  /** Última saída. */
  x: string | null;
};

const CHAVE_MANIFESTO = (eventId: string) => `portaria:manifesto:${eventId}`;
const CHAVE_FILA = (eventId: string) => `portaria:fila:${eventId}`;
const CHAVE_ESTADO = (eventId: string) => `portaria:estado:${eventId}`;

/** SHA-256 do token lido, no formato do manifesto. */
export async function hashDoToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function ler<T>(chave: string, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T) : padrao;
  } catch {
    // Navegador em aba privada, cota estourada, JSON corrompido. Nenhum deles
    // pode derrubar a portaria — segue com o valor padrão.
    return padrao;
  }
}

function gravar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // Cota cheia: o essencial (a fila) tem prioridade, e o manifesto pode ser
    // baixado de novo. Falhar em silêncio aqui é melhor que travar a fila.
  }
}

// ---------------------------------------------------------------------------
// Manifesto
// ---------------------------------------------------------------------------

export async function baixarManifesto(eventId: string): Promise<Manifesto | null> {
  const resposta = await fetch(`/api/portaria/manifest/${eventId}`, { cache: 'no-store' });
  if (!resposta.ok) return null;

  const manifesto = (await resposta.json()) as Manifesto;
  gravar(CHAVE_MANIFESTO(eventId), manifesto);
  return manifesto;
}

export function manifestoGuardado(eventId: string): Manifesto | null {
  return ler<Manifesto | null>(CHAVE_MANIFESTO(eventId), null);
}

/** Índice por hash, para busca instantânea com fila na porta. */
export function indexar(manifesto: Manifesto): Map<string, IngressoManifesto> {
  return new Map(manifesto.ingressos.map((i) => [i.h, i]));
}

// ---------------------------------------------------------------------------
// O que este aparelho registrou
// ---------------------------------------------------------------------------

function estados(eventId: string): Record<string, EstadoLocal> {
  return ler<Record<string, EstadoLocal>>(CHAVE_ESTADO(eventId), {});
}

/**
 * Estado corrente: o manifesto é o ponto de partida, e o que este aparelho
 * registrou depois se sobrepõe. Sem a sobreposição, o segundo print do mesmo
 * QR passaria enquanto a rede estivesse fora.
 */
function estadoAtual(eventId: string, ingresso: IngressoManifesto): EstadoLocal {
  const local = estados(eventId)[ingresso.h];
  if (local) return local;
  return { d: ingresso.i, q: ingresso.q, e: ingresso.e, x: ingresso.x };
}

function registrarLocal(
  eventId: string,
  hash: string,
  movimento: Movimento,
  em: string,
  anterior: EstadoLocal,
): void {
  const todos = estados(eventId);
  todos[hash] =
    movimento === 'entrada'
      ? { d: true, q: anterior.q + 1, e: em, x: anterior.x }
      : { d: false, q: anterior.q, e: anterior.e, x: em };
  gravar(CHAVE_ESTADO(eventId), todos);

  const fila = filaPendente(eventId);
  // Chave natural: o mesmo movimento não entra duas vezes na fila.
  if (!fila.some((m) => m.tokenHash === hash && m.tipo === movimento && m.em === em)) {
    fila.push({ tokenHash: hash, tipo: movimento, em });
    gravar(CHAVE_FILA(eventId), fila);
  }
}

export function filaPendente(eventId: string): MovimentoPendente[] {
  return ler<MovimentoPendente[]>(CHAVE_FILA(eventId), []);
}

export type ResultadoSincronizacao = {
  enviadas: number;
  duplicados: number;
  falhou: boolean;
};

/**
 * Envia os movimentos acumulados.
 *
 * Só limpa a fila quando o servidor confirma. Perder uma entrada por otimismo
 * significa alguém que entrou e não aparece no contador — e é justamente o
 * número que o produtor vai conferir depois.
 */
export async function sincronizar(eventId: string): Promise<ResultadoSincronizacao> {
  const fila = filaPendente(eventId);
  if (fila.length === 0) return { enviadas: 0, duplicados: 0, falhou: false };

  const lote = fila.slice(0, 500);

  try {
    const resposta = await fetch(`/api/portaria/sync/${eventId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ movimentos: lote }),
    });

    if (!resposta.ok) return { enviadas: 0, duplicados: 0, falhou: true };

    const dados = (await resposta.json()) as { processadas: number; duplicados: number };

    const enviados = new Set(lote.map((m) => `${m.tokenHash}:${m.tipo}:${m.em}`));
    gravar(
      CHAVE_FILA(eventId),
      filaPendente(eventId).filter((m) => !enviados.has(`${m.tokenHash}:${m.tipo}:${m.em}`)),
    );

    return { enviadas: dados.processadas, duplicados: dados.duplicados, falhou: false };
  } catch {
    return { enviadas: 0, duplicados: 0, falhou: true };
  }
}

// ---------------------------------------------------------------------------
// Validação local
// ---------------------------------------------------------------------------

export type ResultadoLocal =
  | {
      situacao: 'liberado';
      codigo: string;
      titular: string;
      cpfParcial: string | null;
      lote: string;
      reentrada: boolean;
      exigeDocumento: boolean;
    }
  | { situacao: 'saida'; codigo: string; titular: string; entrouEm: string | null }
  | {
      situacao: 'recusado';
      motivo: MotivoRecusaPorta;
      explicacao: string;
      codigo: string;
      titular: string;
    }
  | { situacao: 'desconhecido' };

export function politicaDoManifesto(m: Manifesto): PoliticaPortaria {
  return { controlaSaida: m.controlaSaida, permiteReentrada: m.permiteReentrada };
}

/**
 * Valida sem rede.
 *
 * "Desconhecido" aqui não prova que o ingresso é falso: pode ser um ingresso
 * emitido depois de o manifesto ser baixado. A tela precisa dizer isso, e
 * oferecer a leitura online como segunda tentativa.
 */
export async function validarLocalmente(
  eventId: string,
  token: string,
  manifesto: Manifesto,
  indice: Map<string, IngressoManifesto>,
  movimento: Movimento = 'entrada',
): Promise<ResultadoLocal> {
  const hash = await hashDoToken(token);
  const ingresso = indice.get(hash);

  if (!ingresso) return { situacao: 'desconhecido' };

  const anterior = estadoAtual(eventId, ingresso);

  const decisao = avaliarMovimento({
    movimento,
    politica: politicaDoManifesto(manifesto),
    estado: {
      status: ingresso.s,
      dentro: anterior.d,
      entradasCount: anterior.q,
      ultimaEntradaEm: anterior.e ? new Date(anterior.e) : null,
      ultimaSaidaEm: anterior.x ? new Date(anterior.x) : null,
    },
  });

  if (!decisao.permitido) {
    return {
      situacao: 'recusado',
      motivo: decisao.motivo,
      explicacao: decisao.explicacao,
      codigo: ingresso.c,
      titular: ingresso.n,
    };
  }

  const em = new Date().toISOString();
  registrarLocal(eventId, hash, movimento, em, anterior);

  if (movimento === 'saida') {
    return {
      situacao: 'saida',
      codigo: ingresso.c,
      titular: ingresso.n,
      entrouEm: anterior.e,
    };
  }

  return {
    situacao: 'liberado',
    codigo: ingresso.c,
    titular: ingresso.n,
    cpfParcial: ingresso.d,
    lote: ingresso.l,
    reentrada: decisao.reentrada,
    exigeDocumento: manifesto.nominal,
  };
}

/** Busca por nome ou código, sem rede. */
export function buscarNoManifesto(manifesto: Manifesto, termo: string): IngressoManifesto[] {
  const limpo = termo.trim().toLowerCase();
  if (limpo.length < 3) return [];

  const digitos = limpo.replace(/\D/g, '');

  return manifesto.ingressos
    .filter(
      (i) =>
        i.n.toLowerCase().includes(limpo) ||
        i.c.toLowerCase().includes(limpo) ||
        (digitos.length >= 3 && i.d?.includes(digitos)),
    )
    .slice(0, 20);
}
