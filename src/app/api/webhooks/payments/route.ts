import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getPaymentProvider } from '@/lib/payments/provider';
import { processarWebhook } from '@/lib/webhook-processor';

/**
 * Webhook de pagamento — plano, seção 11.
 *
 * O handler é fino de propósito: lê os bytes crus e delega. Toda a lógica dos
 * sete passos vive em `src/lib/webhook-processor.ts`, para ser testável sem
 * servidor HTTP.
 *
 * Runtime Node, não Edge: o processamento usa `node:crypto` e conexão direta
 * ao Postgres.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  // Passo 1: corpo cru ANTES de qualquer parse. A assinatura é sobre bytes;
  // `await request.json()` já teria destruído a evidência.
  const rawBody = await request.text();

  const headers: Record<string, string> = {};
  request.headers.forEach((valor, chave) => {
    headers[chave.toLowerCase()] = valor;
  });

  const resultado = await processarWebhook(rawBody, headers, {
    provider: getPaymentProvider(),
    ticketSecret: env().TICKET_HMAC_SECRET,
  });

  /**
   * O corpo da resposta é sempre genérico. A PSP só precisa saber se deve
   * reentregar; detalhe de erro em resposta pública ajuda quem está sondando.
   * O diagnóstico fica no `webhook_events` e no log.
   */
  if (resultado.status !== 200) {
    console.error('[webhook]', resultado.status, resultado.detalhe);
  }

  return NextResponse.json(
    { recebido: resultado.status === 200 },
    { status: resultado.status },
  );
}

/** Algumas PSPs fazem um GET de verificação ao cadastrar a URL. */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true });
}
