/**
 * Envio de e-mail transacional.
 *
 * Duas saídas, escolhidas pelo ambiente:
 *
 * - Com `RESEND_API_KEY`, envia de verdade.
 * - Sem a chave, escreve no log e devolve sucesso. Isso permite que todo o
 *   fluxo seja construído e testado antes de existir domínio e conta de
 *   e-mail — e evita o pior dos mundos, que é o código de envio só rodar pela
 *   primeira vez no dia do evento.
 *
 * O envio NUNCA acontece dentro do webhook. Vai para a fila (`jobs`), porque
 * função serverless tem tempo limite e a operadora reentrega o webhook se a
 * resposta demorar.
 */
import 'server-only';

export type Mensagem = {
  para: string;
  assunto: string;
  html: string;
  texto: string;
  /** Nome do remetente e endereço. Vem de MAIL_FROM. */
  de?: string;
  anexos?: { nome: string; conteudo: Buffer; tipo: string }[];
};

export type ResultadoEnvio =
  | { ok: true; id: string; simulado: boolean }
  | { ok: false; erro: string; retryable: boolean };

const REMETENTE_PADRAO = 'Tiqueteira <onboarding@resend.dev>';

export async function enviarEmail(mensagem: Mensagem): Promise<ResultadoEnvio> {
  const chave = process.env.RESEND_API_KEY;
  const de = mensagem.de ?? process.env.MAIL_FROM ?? REMETENTE_PADRAO;

  if (!chave) {
    console.info(
      `[email:simulado] para=${mensagem.para} assunto="${mensagem.assunto}" ` +
        `(defina RESEND_API_KEY para enviar de verdade)`,
    );
    return { ok: true, id: `simulado_${Date.now()}`, simulado: true };
  }

  try {
    const resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: de,
        to: [mensagem.para],
        subject: mensagem.assunto,
        html: mensagem.html,
        text: mensagem.texto,
        ...(mensagem.anexos?.length
          ? {
              attachments: mensagem.anexos.map((a) => ({
                filename: a.nome,
                content: a.conteudo.toString('base64'),
                content_type: a.tipo,
              })),
            }
          : {}),
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return {
        ok: false,
        erro: `Resend ${resposta.status}: ${corpo.slice(0, 300)}`,
        // 4xx é erro nosso e não adianta repetir; 5xx e 429 valem retentativa.
        retryable: resposta.status >= 500 || resposta.status === 429,
      };
    }

    const dados = (await resposta.json()) as { id?: string };
    return { ok: true, id: dados.id ?? 'sem-id', simulado: false };
  } catch (e) {
    return {
      ok: false,
      erro: e instanceof Error ? e.message : String(e),
      // Falha de rede é sempre retentável.
      retryable: true,
    };
  }
}

/**
 * Envelope visual dos e-mails.
 *
 * Tabela e estilo em linha de propósito: cliente de e-mail não é navegador.
 * Gmail remove `<style>`, Outlook ignora flexbox, e metade do público abre no
 * app do celular. O que funciona em todos é tabela com largura fixa.
 */
export function moldura(conteudo: string, rodape = ''): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#12131a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#12131a;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#1c1e28;border-radius:12px;">
<tr><td style="padding:28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#f2f0eb;font-size:15px;line-height:1.6;">
${conteudo}
</td></tr></table>
${
  rodape
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:16px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#63667a;font-size:12px;line-height:1.5;">
${rodape}</td></tr></table>`
    : ''
}
</td></tr></table></body></html>`;
}

/** Escapa texto vindo do banco antes de entrar no HTML do e-mail. */
export function esc(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
