'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  assinarSessaoComprador,
  consumirLinkDeAcesso,
  COOKIE_COMPRADOR,
  criarLinkDeAcesso,
  VALIDADE_LINK_MINUTOS,
  VALIDADE_SESSAO_DIAS,
} from '@/lib/buyer-session';
import { enviarEmail, esc, moldura } from '@/lib/email';
import { env } from '@/lib/env';
import { mensagemDeEspera, registrarTentativa } from '@/lib/rate-limit';

export type EstadoAcesso = { enviado?: boolean; erro?: string };

const Email = z.email('Informe um e-mail válido.');

/**
 * Envia o link de acesso.
 *
 * Responde SEMPRE que enviou, mesmo quando não existe compra com aquele
 * e-mail. Dizer "não encontramos" transformaria esta tela em consulta de quem
 * comprou ingresso — e isso é dado pessoal de terceiro.
 */
export async function pedirLink(
  _anterior: EstadoAcesso,
  formData: FormData,
): Promise<EstadoAcesso> {
  const dados = Email.safeParse(formData.get('email'));
  if (!dados.success) return { erro: dados.error.issues[0]?.message ?? 'E-mail inválido.' };

  const cabecalhos = await headers();
  const ip =
    cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    cabecalhos.get('x-real-ip') ??
    'sem-ip';

  // Sem limite, esta tela vira ferramenta de envio em massa contra endereços
  // de terceiros — o e-mail sai do nosso domínio e a reputação é nossa.
  for (const alvo of [dados.data, ip]) {
    const limite = await registrarTentativa('linkAcesso', alvo);
    if (!limite.permitido) return { erro: mensagemDeEspera(limite.esperarSegundos) };
  }

  const { token } = await criarLinkDeAcesso(dados.data, {
    ip,
    userAgent: cabecalhos.get('user-agent'),
  });

  const url = `${env().NEXT_PUBLIC_APP_URL}/meus-ingressos/entrar?t=${encodeURIComponent(token)}`;

  const resultado = await enviarEmail({
    para: dados.data,
    assunto: 'Acesse seus ingressos',
    html: moldura(
      `<h1 style="margin:0;font-size:20px;">Seus ingressos</h1>
<p style="margin-top:12px;color:#8a8b99;">
  Clique no botão para abrir a área de ingressos. O link vale por
  ${VALIDADE_LINK_MINUTOS} minutos e só funciona uma vez.
</p>
<div style="margin-top:24px;">
  <a href="${esc(url)}" style="display:inline-block;background:#5b4bff;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;">
    Ver meus ingressos
  </a>
</div>
<p style="margin-top:20px;font-size:13px;color:#63667a;">
  Se você não pediu este acesso, ignore esta mensagem — nada acontece.
</p>`,
      'Não compartilhe este link: quem tiver ele consegue ver seus ingressos.',
    ),
    texto: `Acesse seus ingressos: ${url}\nO link vale por ${VALIDADE_LINK_MINUTOS} minutos.`,
  });

  if (!resultado.ok) return { erro: 'Não consegui enviar o e-mail. Tente de novo.' };

  // Sem chave de e-mail configurada, o link vai para o log do servidor — é o
  // que permite testar o fluxo antes de existir domínio e conta de envio.
  if (resultado.simulado) console.info(`[acesso:simulado] ${url}`);

  return { enviado: true };
}

export async function entrarComLink(token: string): Promise<never> {
  const r = await consumirLinkDeAcesso(token);

  if (!r.ok) redirect(`/meus-ingressos?erro=${r.motivo}`);

  const store = await cookies();
  store.set(COOKIE_COMPRADOR, assinarSessaoComprador(r.email, env().AUTH_SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: VALIDADE_SESSAO_DIAS * 24 * 3600,
  });

  redirect('/meus-ingressos');
}

export async function sairDaAreaDoComprador(): Promise<never> {
  const store = await cookies();
  store.delete(COOKIE_COMPRADOR);
  redirect('/');
}
