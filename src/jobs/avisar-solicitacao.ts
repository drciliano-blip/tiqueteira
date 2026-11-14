/**
 * Avisos de solicitação do comprador — ADR-023.
 *
 * `aberta`: o produtor fica sabendo que tem um comprador esperando resposta.
 * `respondida`: o comprador fica sabendo o que foi decidido, com a resposta.
 */
import 'server-only';

import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events, orders, refunds, solicitacoes, tenants } from '@/db/schema';
import { enviarEmail, esc, moldura } from '@/lib/email';
import { formatarBRL } from '@/lib/money';
import { ROTULO_SOLICITACAO } from '@/lib/solicitacoes';

export type PayloadAvisoSolicitacao = { solicitacaoId: string; evento: 'aberta' | 'respondida' };

export async function avisarSolicitacao(
  payload: PayloadAvisoSolicitacao,
  appUrl: string,
): Promise<string> {
  const [s] = await serviceDb()
    .select({
      tipo: solicitacoes.tipo,
      relato: solicitacoes.relato,
      status: solicitacoes.status,
      resposta: solicitacoes.resposta,
      orderId: solicitacoes.orderId,
      numero: orders.numero,
      compradorEmail: orders.compradorEmail,
      compradorNome: orders.compradorNome,
      evento: events.titulo,
      tenantNome: tenants.nome,
      tenantEmail: tenants.email,
      valorDevolvido: refunds.valorCentavos,
    })
    .from(solicitacoes)
    .innerJoin(orders, eq(orders.id, solicitacoes.orderId))
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(tenants, eq(tenants.id, solicitacoes.tenantId))
    .leftJoin(refunds, eq(refunds.id, solicitacoes.refundId))
    .where(eq(solicitacoes.id, payload.solicitacaoId))
    .limit(1);

  if (!s) return `solicitação ${payload.solicitacaoId} não existe`;
  const motivo = ROTULO_SOLICITACAO[s.tipo];

  if (payload.evento === 'aberta') {
    const html = moldura(
      `
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#f5a524;">Solicitação de comprador</div>
<h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">${esc(s.evento)}</h1>
<p style="margin-top:8px;color:#8a8b99;">Pedido nº ${s.numero} · ${esc(s.compradorNome ?? '')} · ${esc(motivo)}</p>
<p style="margin-top:12px;white-space:pre-wrap;">${esc(s.relato)}</p>
<div style="margin-top:24px;">
  <a href="${appUrl}/painel/vendas/${s.orderId}" style="display:inline-block;background:#5b4bff;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;">
    Responder
  </a>
</div>`,
      'Responder rápido evita reclamação no Procon e contestação no cartão.',
    );
    const r = await enviarEmail({
      para: s.tenantEmail,
      assunto: `Solicitação do pedido nº ${s.numero} — ${s.evento}`,
      html,
      texto: `${motivo}\n\n${s.relato}\n\n${appUrl}/painel/vendas/${s.orderId}`,
    });
    if (!r.ok) throw new Error(r.erro);
    return `aviso de solicitação enviado ao produtor${r.simulado ? ' (simulado)' : ''}`;
  }

  if (!s.compradorEmail || s.status === 'aberta') return 'nada a avisar';

  const devolvida = s.status === 'devolvida';
  const titulo = devolvida
    ? `Devolução de ${formatarBRL(s.valorDevolvido ?? 0)} aprovada`
    : 'Sua solicitação foi respondida';

  const html = moldura(
    `
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${devolvida ? '#30a46c' : '#8a8b99'};">${esc(s.tenantNome)}</div>
<h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">${esc(titulo)}</h1>
<p style="margin-top:8px;color:#8a8b99;">${esc(s.evento)} · pedido nº ${s.numero}</p>
${s.resposta ? `<p style="margin-top:12px;white-space:pre-wrap;">${esc(s.resposta)}</p>` : ''}
${
  devolvida
    ? '<p style="margin-top:12px;color:#8a8b99;">O valor volta pelo mesmo meio de pagamento, no prazo da operadora.</p>'
    : ''
}
<div style="margin-top:24px;">
  <a href="${appUrl}/meus-ingressos/pedido/${s.orderId}" style="display:inline-block;background:#5b4bff;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;">
    Ver o pedido
  </a>
</div>`,
  );

  const r = await enviarEmail({
    para: s.compradorEmail,
    assunto: `${titulo} — ${s.evento}`,
    html,
    texto: `${titulo}\n${s.resposta ?? ''}\n${appUrl}/meus-ingressos/pedido/${s.orderId}`,
  });
  if (!r.ok) throw new Error(r.erro);
  return `resposta enviada ao comprador${r.simulado ? ' (simulado)' : ''}`;
}
