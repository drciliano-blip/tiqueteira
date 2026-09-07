/**
 * Emissão e validação de ingresso — plano, seções 5 e 24.
 *
 * O que este módulo garante e o que NÃO garante, para não se construir sobre
 * premissa falsa:
 *
 *   Garante: ninguém fabrica um ingresso válido sem o segredo do servidor.
 *   A assinatura HMAC resolve FALSIFICAÇÃO.
 *
 *   Não garante: que o QR não seja copiado. É uma imagem — print, foto,
 *   encaminhamento. Quem promete QR incopiável está vendendo ilusão. O que
 *   resolve a cópia é a validação de uso único, que vive no banco, e o
 *   ingresso nominal com conferência de documento.
 *
 * O banco guarda apenas o SHA-256 do token. Vazamento de dump não vira
 * ingresso válido.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Alfabeto do código curto, sem os caracteres que se confundem quando alguém
 * lê em voz alta na porta ou digita na busca manual: 0/O, 1/I/L, 5/S, 2/Z.
 */
const ALFABETO = '34679ACDEFGHJKMNPQRTUVWXY';

export type TicketEmitido = {
  /** Curto e legível, para busca manual. Ex.: `7KQ2-4M9X`. */
  codigo: string;
  /** Vai dentro do QR. Só existe no momento da emissão. */
  token: string;
  /** É isto que o banco guarda. */
  tokenHash: string;
};

function sortear(n: number): string {
  const bytes = randomBytes(n);
  let saida = '';
  for (let i = 0; i < n; i++) {
    saida += ALFABETO[bytes[i]! % ALFABETO.length];
  }
  return saida;
}

/** `7KQ2-4M9X` — oito caracteres, ~1,5 milhão de combinações por bloco. */
export function gerarCodigo(): string {
  return `${sortear(4)}-${sortear(4)}`;
}

function assinar(payload: string, segredo: string): string {
  return createHmac('sha256', segredo).update(payload, 'utf8').digest('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Token do QR: `v1.<codigo>.<assinatura>`.
 *
 * O código vai em claro dentro do token de propósito: a portaria offline
 * precisa saber QUAL ingresso está lendo para procurar no manifesto, mesmo
 * antes de conferir a assinatura. O que protege não é o sigilo do código, é
 * a assinatura.
 */
export function emitirTicket(segredo: string, codigo = gerarCodigo()): TicketEmitido {
  if (!segredo || segredo.length < 32) {
    throw new Error('TICKET_HMAC_SECRET ausente ou curto demais (mínimo 32 caracteres)');
  }

  const payload = `v1.${codigo}`;
  const token = `${payload}.${assinar(payload, segredo)}`;
  return { codigo, token, tokenHash: hashToken(token) };
}

export type ResultadoVerificacao =
  | { ok: true; codigo: string; tokenHash: string }
  | { ok: false; motivo: 'formato' | 'assinatura' };

/**
 * Verifica a assinatura do QR lido.
 *
 * Aceita o segredo anterior além do atual, para que a rotação do segredo não
 * invalide ingresso já emitido — quem comprou em março tem de entrar em maio.
 */
export function verificarToken(
  token: string,
  segredos: { atual: string; anterior?: string | undefined },
): ResultadoVerificacao {
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== 'v1' || !partes[1] || !partes[2]) {
    return { ok: false, motivo: 'formato' };
  }

  const [versao, codigo, assinatura] = partes as [string, string, string];
  const payload = `${versao}.${codigo}`;

  const candidatos = [segredos.atual, segredos.anterior].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );

  for (const segredo of candidatos) {
    const esperada = assinar(payload, segredo);
    const a = Buffer.from(esperada, 'utf8');
    const b = Buffer.from(assinatura, 'utf8');
    // Comparação em tempo constante: comparar com `===` vaza, pelo tempo,
    // quantos caracteres iniciais o atacante já acertou.
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true, codigo, tokenHash: hashToken(token) };
    }
  }

  return { ok: false, motivo: 'assinatura' };
}
