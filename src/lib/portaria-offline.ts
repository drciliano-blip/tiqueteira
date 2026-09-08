'use client';

/**
 * Portaria offline — plano, seções 12 e 24.
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
 * Limite honesto: offline, dois portões sem comunicação entre si deixam o
 * mesmo QR passar duas vezes. Nada resolve isso do lado do aparelho. O que a
 * sincronização faz é registrar que aconteceu, para a operação saber.
 */

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
};

export type Manifesto = {
  eventId: string;
  titulo: string;
  nominal: boolean;
  geradoEm: string;
  total: number;
  ingressos: IngressoManifesto[];
};

export type EntradaPendente = { tokenHash: string; em: string; deviceId?: string };

const CHAVE_MANIFESTO = (eventId: string) => `portaria:manifesto:${eventId}`;
const CHAVE_FILA = (eventId: string) => `portaria:fila:${eventId}`;
const CHAVE_USADOS = (eventId: string) => `portaria:usados:${eventId}`;

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
// Entradas registradas no aparelho
// ---------------------------------------------------------------------------

/** Quem este aparelho já deixou entrar, mesmo antes de sincronizar. */
export function usadosLocais(eventId: string): Record<string, string> {
  return ler<Record<string, string>>(CHAVE_USADOS(eventId), {});
}

export function registrarEntradaLocal(eventId: string, tokenHash: string, em: string): void {
  const usados = usadosLocais(eventId);
  // Primeira leitura vence, também no aparelho.
  if (!usados[tokenHash]) {
    usados[tokenHash] = em;
    gravar(CHAVE_USADOS(eventId), usados);
  }

  const fila = filaPendente(eventId);
  if (!fila.some((e) => e.tokenHash === tokenHash)) {
    fila.push({ tokenHash, em });
    gravar(CHAVE_FILA(eventId), fila);
  }
}

export function filaPendente(eventId: string): EntradaPendente[] {
  return ler<EntradaPendente[]>(CHAVE_FILA(eventId), []);
}

export type ResultadoSincronizacao = {
  enviadas: number;
  duplicados: number;
  falhou: boolean;
};

/**
 * Envia as entradas acumuladas.
 *
 * Só limpa a fila quando o servidor confirma. Perder uma entrada por otimismo
 * significa alguém que entrou e não aparece no contador — e é justamente o
 * número que o produtor vai conferir depois.
 */
export async function sincronizar(eventId: string): Promise<ResultadoSincronizacao> {
  const fila = filaPendente(eventId);
  if (fila.length === 0) return { enviadas: 0, duplicados: 0, falhou: false };

  try {
    const resposta = await fetch(`/api/portaria/sync/${eventId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entradas: fila.slice(0, 500) }),
    });

    if (!resposta.ok) return { enviadas: 0, duplicados: 0, falhou: true };

    const dados = (await resposta.json()) as { processadas: number; duplicados: number };

    const enviados = new Set(fila.slice(0, 500).map((e) => e.tokenHash));
    gravar(
      CHAVE_FILA(eventId),
      fila.filter((e) => !enviados.has(e.tokenHash)),
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
      exigeDocumento: boolean;
    }
  | { situacao: 'duplicado'; codigo: string; titular: string; entrouEm: string }
  | { situacao: 'cancelado'; codigo: string }
  | { situacao: 'desconhecido' };

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
): Promise<ResultadoLocal> {
  const hash = await hashDoToken(token);
  const ingresso = indice.get(hash);

  if (!ingresso) return { situacao: 'desconhecido' };
  if (ingresso.s === 'cancelado' || ingresso.s === 'transferido') {
    return { situacao: 'cancelado', codigo: ingresso.c };
  }

  const usados = usadosLocais(eventId);
  const jaEntrou = usados[hash] ?? (ingresso.s === 'usado' ? (ingresso.e ?? '') : null);

  if (jaEntrou) {
    return {
      situacao: 'duplicado',
      codigo: ingresso.c,
      titular: ingresso.n,
      entrouEm: jaEntrou,
    };
  }

  registrarEntradaLocal(eventId, hash, new Date().toISOString());

  return {
    situacao: 'liberado',
    codigo: ingresso.c,
    titular: ingresso.n,
    cpfParcial: ingresso.d,
    lote: ingresso.l,
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
