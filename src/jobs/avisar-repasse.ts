/**
 * Aviso ao produtor quando uma tranche de repasse se encerra — ADR-021.
 *
 * Entra na fila no mesmo instante em que o repasse é concluído, e sai pelo
 * worker: a liberação não pode ficar esperando o provedor de e-mail.
 *
 * Dois casos:
 * - liberou dinheiro: quanto, de qual evento, e de qual parte;
 * - saldo a descoberto: o produtor precisa saber antes de a cobrança chegar.
 */
import 'server-only';

import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events, payouts, tenants } from '@/db/schema';
import { dataCurta } from '@/lib/datas';
import { enviarEmail, esc, moldura } from '@/lib/email';
import { formatarBRL } from '@/lib/money';

export type PayloadAvisoRepasse = { payoutId: string };

const METODO: Record<string, string> = { pix: 'Pix', credit_card: 'cartão' };

export async function avisarRepasse(payload: PayloadAvisoRepasse, appUrl: string): Promise<string> {
  const db = serviceDb();
  const [r] = await db
    .select({
      status: payouts.status,
      tranche: payouts.tranche,
      metodo: payouts.metodo,
      liberado: payouts.liberadoCentavos,
      dataEfetiva: payouts.dataEfetiva,
      evento: events.titulo,
      email: tenants.email,
      tenantNome: tenants.nome,
    })
    .from(payouts)
    .innerJoin(events, eq(events.id, payouts.eventId))
    .innerJoin(tenants, eq(tenants.id, payouts.tenantId))
    .where(eq(payouts.id, payload.payoutId))
    .limit(1);

  if (!r) return `repasse ${payload.payoutId} não existe`;
  if (r.status !== 'released' || r.liberado === 0) return 'nada a avisar';

  const parte = r.tranche === 'principal' ? 'parte principal' : 'reserva de garantia';
  const meio = METODO[r.metodo] ?? r.metodo;
  const descoberto = r.liberado < 0;

  const assunto = descoberto
    ? `Atenção: saldo a descoberto em ${r.evento}`
    : `Repasse liberado: ${formatarBRL(r.liberado)} de ${r.evento}`;

  const corpo = descoberto
    ? `
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#e5484d;">Saldo a descoberto</div>
<h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">${esc(r.evento)}</h1>
<p style="margin-top:12px;">
  As contestações de cartão e os reembolsos que chegaram depois do primeiro repasse
  passaram do valor que estava retido como garantia. A diferença é de
  <strong>${esc(formatarBRL(-r.liberado))}</strong>, e a operadora de pagamento pode
  descontá-la do seu saldo.
</p>
<p style="color:#8a8b99;">Responda este e-mail ou fale com o suporte para combinarmos.</p>`
    : `
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#30a46c;">Repasse liberado</div>
<h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">${esc(formatarBRL(r.liberado))}</h1>
<p style="margin-top:8px;color:#8a8b99;">${esc(r.evento)} · ${esc(parte)} · ${esc(meio)}</p>
<p style="margin-top:12px;">
  O valor foi liberado na operadora de pagamento${
    r.dataEfetiva ? ` em ${esc(dataCurta(r.dataEfetiva))}` : ''
  } e já pode ser sacado para a sua conta.
</p>`;

  const html = moldura(
    `${corpo}
<div style="margin-top:24px;">
  <a href="${appUrl}/painel/financeiro" style="display:inline-block;background:#5b4bff;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;">
    Ver o financeiro
  </a>
</div>`,
    esc(r.tenantNome),
  );

  const texto = descoberto
    ? `Saldo a descoberto em ${r.evento}: ${formatarBRL(-r.liberado)}.\n${appUrl}/painel/financeiro`
    : `Repasse liberado: ${formatarBRL(r.liberado)} — ${r.evento}, ${parte}, ${meio}.\n${appUrl}/painel/financeiro`;

  const resultado = await enviarEmail({ para: r.email, assunto, html, texto });
  if (!resultado.ok) throw new Error(resultado.erro);

  return `aviso de repasse enviado para ${r.email}${resultado.simulado ? ' (simulado)' : ''}`;
}
