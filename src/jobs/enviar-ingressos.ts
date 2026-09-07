/**
 * Entrega do ingresso ao comprador.
 *
 * Roda pela fila, nunca dentro do webhook. Se o e-mail falhar, o pagamento
 * continua confirmado e o ingresso continua válido — a tarefa apenas tenta de
 * novo. Amarrar a emissão ao envio faria uma falha do provedor de e-mail
 * virar falha de venda.
 */
import 'server-only';

import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';

import { serviceDb } from '@/db/client';
import { events, orders, tenants, tickets, ticketTypes, venues } from '@/db/schema';
import { dataLonga, hora } from '@/lib/datas';
import { enviarEmail, esc, moldura } from '@/lib/email';
import { emitirTicket } from '@/lib/tickets';

export type PayloadEnvio = { orderId: string };

/**
 * O banco guarda só o hash do token — vazamento de dump não vira ingresso
 * válido. Mas a assinatura é determinística: o mesmo código com o mesmo
 * segredo produz sempre o mesmo token.
 *
 * Isso é o que permite regerar o QR quantas vezes for preciso — no e-mail, na
 * área do comprador, num reenvio de suporte — sem que o ingresso mude e sem
 * invalidar o que já foi entregue.
 */
function tokenDoIngresso(codigo: string, segredo: string): string {
  return emitirTicket(segredo, codigo).token;
}

export async function enviarIngressos(
  payload: PayloadEnvio,
  segredoTicket: string,
  appUrl: string,
): Promise<string> {
  const db = serviceDb();

  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      status: orders.status,
      compradorNome: orders.compradorNome,
      compradorEmail: orders.compradorEmail,
      eventoTitulo: events.titulo,
      eventoInicio: events.dataInicio,
      eventoNominal: events.ingressoNominal,
      eventoDocumento: events.exigeDocumentoEntrada,
      venueNome: venues.nome,
      venueEndereco: venues.endereco,
      venueCidade: venues.cidade,
      tenantNome: tenants.nome,
      corAcento: tenants.corAcento,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(eq(orders.id, payload.orderId))
    .limit(1);

  if (!pedido) return `pedido ${payload.orderId} não existe`;
  if (pedido.status !== 'paid') return `pedido ${payload.orderId} não está pago`;
  if (!pedido.compradorEmail) return `pedido ${payload.orderId} sem e-mail`;

  const emitidos = await db
    .select({
      codigo: tickets.codigo,
      titular: tickets.titularNome,
      status: tickets.status,
      lote: ticketTypes.nome,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(eq(tickets.orderId, pedido.id));

  const validos = emitidos.filter((t) => t.status === 'valido');
  if (validos.length === 0) return `pedido ${payload.orderId} sem ingresso válido`;

  const blocos: string[] = [];
  const anexos: { nome: string; conteudo: Buffer; tipo: string }[] = [];

  for (const ingresso of validos) {
    const token = tokenDoIngresso(ingresso.codigo, segredoTicket);

    /**
     * O QR vai como ANEXO com `cid`, e não como imagem externa: Gmail e
     * Outlook bloqueiam imagem remota por padrão, e o comprador chegaria na
     * porta com um retângulo vazio no lugar do ingresso.
     */
    const png = await QRCode.toBuffer(token, { margin: 1, width: 600 });
    const nomeArquivo = `ingresso-${ingresso.codigo}.png`;
    anexos.push({ nome: nomeArquivo, conteudo: png, tipo: 'image/png' });

    blocos.push(`
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#12131a;border-radius:10px;">
<tr><td align="center" style="padding:20px;">
  <div style="background:#ffffff;border-radius:8px;padding:10px;display:inline-block;">
    <img src="cid:${nomeArquivo}" alt="QR do ingresso ${esc(ingresso.codigo)}" width="200" height="200" style="display:block;width:200px;height:200px;">
  </div>
  <div style="margin-top:14px;font-size:20px;font-weight:700;letter-spacing:1px;">${esc(ingresso.codigo)}</div>
  <div style="margin-top:4px;color:#8a8b99;font-size:13px;">${esc(ingresso.titular)} · ${esc(ingresso.lote)}</div>
</td></tr></table>`);
  }

  const local = [pedido.venueNome, pedido.venueCidade].filter(Boolean).join(' · ');
  const quando = `${dataLonga(pedido.eventoInicio)}, às ${hora(pedido.eventoInicio)}`;

  const html = moldura(
    `
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${esc(pedido.corAcento)};">
  Ingresso confirmado
</div>
<h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">${esc(pedido.eventoTitulo)}</h1>
<div style="margin-top:8px;color:#8a8b99;">${esc(quando)}</div>
<div style="color:#8a8b99;">${esc(local)}</div>
${pedido.venueEndereco ? `<div style="color:#63667a;font-size:13px;">${esc(pedido.venueEndereco)}</div>` : ''}

${blocos.join('')}

<div style="margin-top:8px;font-size:14px;color:#8a8b99;">
  Apresente este QR na entrada. ${
    pedido.eventoNominal
      ? pedido.eventoDocumento
        ? '<strong style="color:#f2f0eb;">Leve documento com foto</strong> — a portaria confere o nome do titular.'
        : 'O ingresso é nominal: o nome do titular fica registrado.'
      : ''
  }
</div>

<div style="margin-top:24px;">
  <a href="${appUrl}/meus-ingressos" style="display:inline-block;background:${esc(pedido.corAcento)};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;">
    Ver meus ingressos
  </a>
</div>

<div style="margin-top:20px;font-size:13px;color:#63667a;">
  Precisa repassar? Use a transferência na área de ingressos: o QR antigo é cancelado
  na hora e um novo é emitido no nome de quem vai.
</div>`,
    `Pedido nº ${pedido.numero} · ${esc(pedido.tenantNome)}<br>
     Você tem 7 dias para desistir da compra e receber tudo de volta, taxa incluída.`,
  );

  const texto = [
    `${pedido.eventoTitulo}`,
    quando,
    local,
    '',
    ...validos.map((t) => `${t.codigo} — ${t.titular} (${t.lote})`),
    '',
    `Seus ingressos: ${appUrl}/meus-ingressos`,
  ].join('\n');

  const resultado = await enviarEmail({
    para: pedido.compradorEmail,
    assunto: `Seu ingresso para ${pedido.eventoTitulo}`,
    html,
    texto,
    anexos,
  });

  if (!resultado.ok) throw new Error(resultado.erro);

  return `${validos.length} ingressos enviados para ${pedido.compradorEmail}${
    resultado.simulado ? ' (simulado)' : ''
  }`;
}
