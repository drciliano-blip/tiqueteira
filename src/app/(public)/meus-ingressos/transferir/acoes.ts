'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { auditLog, events, orders, tickets, ticketTypes } from '@/db/schema';
import { cpfValido, normalizarCpf } from '@/domain/cpf';
import { avaliarTransferencia } from '@/domain/transferencia';
import { COOKIE_COMPRADOR, lerSessaoComprador } from '@/lib/buyer-session';
import { enviarEmail, esc, moldura } from '@/lib/email';
import { env } from '@/lib/env';
import { emitirTicket } from '@/lib/tickets';

/**
 * Transferência de titularidade — plano, seção 23.3.
 *
 * A mecânica é sempre a mesma: cancela o original, emite um novo. O QR antigo
 * morre no ato, e é o que faz a transferência valer alguma coisa — mudar só o
 * nome deixaria o print anterior funcionando na porta.
 *
 * O pedido continua vinculado a quem comprou. Reembolso posterior volta para
 * quem pagou, nunca para o titular novo: sem isso, bastaria transferir para si
 * mesmo e pedir devolução.
 */

const Destinatario = z.object({
  nome: z
    .string()
    .trim()
    .min(3, 'Informe o nome completo de quem vai receber.')
    .max(120)
    .refine((n) => n.includes(' '), 'Informe nome e sobrenome.'),
  email: z.email('Informe um e-mail válido.').max(160),
  cpf: z.string().transform(normalizarCpf).refine(cpfValido, 'CPF inválido.'),
});

export type EstadoTransferencia = { erro?: string; ok?: boolean; codigoNovo?: string };

export async function transferirIngresso(
  ticketId: string,
  _anterior: EstadoTransferencia,
  formData: FormData,
): Promise<EstadoTransferencia> {
  const dados = Destinatario.safeParse({
    nome: formData.get('nome'),
    email: formData.get('email'),
    cpf: formData.get('cpf'),
  });

  if (!dados.success) {
    return { erro: dados.error.issues[0]?.message ?? 'Confira os dados.' };
  }

  const store = await cookies();
  const emailSessao = lerSessaoComprador(store.get(COOKIE_COMPRADOR)?.value, env().AUTH_SECRET);
  if (!emailSessao) return { erro: 'Sua sessão expirou. Entre de novo.' };

  const db = serviceDb();

  const [linha] = await db
    .select({
      id: tickets.id,
      tenantId: tickets.tenantId,
      orderId: tickets.orderId,
      eventId: tickets.eventId,
      ticketTypeId: tickets.ticketTypeId,
      codigo: tickets.codigo,
      status: tickets.status,
      transferenciasCount: tickets.transferenciasCount,
      tipo: ticketTypes.tipo,
      compradorEmail: orders.compradorEmail,
      eventoTitulo: events.titulo,
      eventoInicio: events.dataInicio,
      eventoStatus: events.status,
      permiteTransferencia: events.permiteTransferencia,
      transferenciaAteHoras: events.transferenciaAteHoras,
      maxTransferencias: events.maxTransferenciasPorIngresso,
      transferenciaPermiteMeia: events.transferenciaPermiteMeia,
      corAcento: events.corAcento,
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(eq(tickets.id, ticketId))
    .limit(1);

  if (!linha) return { erro: 'Ingresso não encontrado.' };

  /**
   * Só quem comprou transfere — não o titular atual. Se o titular pudesse
   * repassar adiante, o comprador perderia o controle do que pagou.
   */
  if (linha.compradorEmail?.toLowerCase() !== emailSessao.toLowerCase()) {
    return { erro: 'Este ingresso não está na sua conta.' };
  }

  const avaliacao = avaliarTransferencia({
    configuracao: {
      permiteTransferencia: linha.permiteTransferencia,
      transferenciaAteHoras: linha.transferenciaAteHoras,
      maxTransferenciasPorIngresso: linha.maxTransferencias,
      transferenciaPermiteMeia: linha.transferenciaPermiteMeia,
    },
    ingresso: {
      status: linha.status,
      transferenciasCount: linha.transferenciasCount,
      tipo: linha.tipo,
    },
    eventoInicio: linha.eventoInicio,
    eventoStatus: linha.eventoStatus,
    agora: new Date(),
  });

  if (!avaliacao.permitido) return { erro: avaliacao.explicacao };

  const novo = emitirTicket(env().TICKET_HMAC_SECRET);

  try {
    await db.transaction(async (tx) => {
      /**
       * O UPDATE condicional é a trava: se o ingresso mudou de estado entre a
       * leitura e agora — outra aba transferiu, ou a portaria validou —, não
       * atualiza nada e a transação inteira é desfeita.
       */
      const cancelados = (await tx.execute(sql`
        update tickets
           set status = 'transferido', atualizado_em = now()
         where id = ${ticketId} and status = 'valido'
        returning id
      `)) as unknown as { id: string }[];

      if (cancelados.length === 0) {
        throw new Error('Este ingresso mudou de situação. Recarregue a página.');
      }

      await tx.insert(tickets).values({
        tenantId: linha.tenantId,
        orderId: linha.orderId,
        ticketTypeId: linha.ticketTypeId,
        eventId: linha.eventId,
        codigo: novo.codigo,
        tokenHash: novo.tokenHash,
        titularNome: dados.data.nome,
        titularCpf: dados.data.cpf,
        titularEmail: dados.data.email,
        transferidoDeTicketId: ticketId,
        transferenciasCount: linha.transferenciasCount + 1,
      });

      await tx.insert(auditLog).values({
        tenantId: linha.tenantId,
        acao: 'transferencia',
        entidade: 'tickets',
        entidadeId: ticketId,
        antes: { codigo: linha.codigo, titular: linha.compradorEmail },
        depois: { codigo: novo.codigo, titular: dados.data.email },
      });
    });
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não foi possível transferir.' };
  }

  // Aviso ao novo titular. Se o e-mail falhar, a transferência continua
  // valendo — o ingresso está na área do comprador de qualquer forma.
  const url = `${env().NEXT_PUBLIC_APP_URL}/ingresso/${novo.codigo}`;
  await enviarEmail({
    para: dados.data.email,
    assunto: `Você recebeu um ingresso para ${linha.eventoTitulo}`,
    html: moldura(
      `<h1 style="margin:0;font-size:20px;">${esc(linha.eventoTitulo)}</h1>
<p style="margin-top:12px;color:#8a8b99;">
  ${esc(dados.data.nome.split(' ')[0] ?? 'Olá')}, um ingresso foi transferido para o seu nome.
  O código é <strong style="color:#f2f0eb;">${esc(novo.codigo)}</strong>.
</p>
<p style="margin-top:12px;color:#8a8b99;">
  Para ver o QR, acesse a área de ingressos com o e-mail de quem comprou — é quem continua
  responsável pelo pedido.
</p>
<div style="margin-top:24px;">
  <a href="${esc(url)}" style="display:inline-block;background:#5b4bff;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;">
    Ver o ingresso
  </a>
</div>`,
      'O ingresso anterior foi cancelado e não vale mais na entrada.',
    ),
    texto: `Você recebeu um ingresso para ${linha.eventoTitulo}. Código ${novo.codigo}. ${url}`,
  });

  revalidatePath('/meus-ingressos');
  return { ok: true, codigoNovo: novo.codigo };
}
