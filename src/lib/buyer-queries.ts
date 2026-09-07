/**
 * Ingressos do comprador.
 *
 * Consulta cross-tenant pela conexão de serviço: o mesmo e-mail compra de
 * vários produtores, e a área do comprador mostra tudo junto. O filtro é o
 * e-mail da sessão assinada — nunca um parâmetro vindo da URL.
 */
import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events, orders, tenants, tickets, ticketTypes, venues } from '@/db/schema';

export type IngressoDoComprador = {
  id: string;
  codigo: string;
  status: string;
  titular: string;
  lote: string;
  checkedInEm: Date | null;
  eventoId: string;
  eventoTitulo: string;
  eventoSlug: string;
  eventoInicio: Date;
  eventoNominal: boolean;
  eventoTransferivel: boolean;
  transferenciaAteHoras: number;
  venueNome: string;
  cidade: string | null;
  tenantSlug: string;
  tenantNome: string;
  pedidoNumero: number;
};

export async function ingressosPorEmail(email: string): Promise<IngressoDoComprador[]> {
  return serviceDb()
    .select({
      id: tickets.id,
      codigo: tickets.codigo,
      status: tickets.status,
      titular: tickets.titularNome,
      lote: ticketTypes.nome,
      checkedInEm: tickets.checkedInEm,
      eventoId: events.id,
      eventoTitulo: events.titulo,
      eventoSlug: events.slug,
      eventoInicio: events.dataInicio,
      eventoNominal: events.ingressoNominal,
      eventoTransferivel: events.permiteTransferencia,
      transferenciaAteHoras: events.transferenciaAteHoras,
      venueNome: venues.nome,
      cidade: venues.cidade,
      tenantSlug: tenants.slug,
      tenantNome: tenants.nome,
      pedidoNumero: orders.numero,
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(tenants, eq(tenants.id, tickets.tenantId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(
      and(
        // O e-mail do PEDIDO, não o do titular: quem comprou para o grupo
        // continua vendo todos os ingressos que pagou, mesmo os já
        // transferidos para o nome de outra pessoa.
        sql`lower(${orders.compradorEmail}) = lower(${email})`,
        eq(orders.status, 'paid'),
      ),
    )
    .orderBy(desc(events.dataInicio), tickets.codigo);
}

/** Um ingresso específico, para a tela de exibição do QR. */
export async function ingressoPorCodigo(codigo: string) {
  const [linha] = await serviceDb()
    .select({
      id: tickets.id,
      codigo: tickets.codigo,
      status: tickets.status,
      titular: tickets.titularNome,
      lote: ticketTypes.nome,
      checkedInEm: tickets.checkedInEm,
      compradorEmail: orders.compradorEmail,
      eventoTitulo: events.titulo,
      eventoInicio: events.dataInicio,
      eventoNominal: events.ingressoNominal,
      eventoDocumento: events.exigeDocumentoEntrada,
      venueNome: venues.nome,
      venueEndereco: venues.endereco,
      cidade: venues.cidade,
      tenantNome: tenants.nome,
      corAcento: tenants.corAcento,
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(tenants, eq(tenants.id, tickets.tenantId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(eq(tickets.codigo, codigo.toUpperCase()))
    .limit(1);

  return linha ?? null;
}
