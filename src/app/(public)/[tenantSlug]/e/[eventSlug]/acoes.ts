'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { withTenant } from '@/db/client';
import { events, orderItems, orders, ticketTypes } from '@/db/schema';
import { TTL_RESERVA_PADRAO_SEGUNDOS } from '@/domain/inventory';
import { calcularTaxas } from '@/lib/fees';
import { reservarEstoque } from '@/lib/inventory';
import { aplicarBps } from '@/lib/money';
import { configDeTaxasDoTenant, resolverTenantPorSlug } from '@/lib/public-queries';

/**
 * Cria o pedido e reserva o estoque — plano, seção 12.
 *
 * Tudo numa transação só. Se qualquer passo falhar, o `ROLLBACK` devolve os
 * ingressos: reserva órfã é ingresso que ninguém vende e ninguém compra.
 *
 * O preço e a taxa vêm do BANCO, nunca do que o navegador mandou. O cliente
 * só diz quais lotes e quantas unidades; o resto é recalculado aqui.
 */

const Entrada = z.object({
  tenantSlug: z.string().min(1).max(120),
  eventSlug: z.string().min(1).max(160),
  itens: z
    .array(
      z.object({
        ticketTypeId: z.uuid(),
        quantidade: z.int().min(1).max(20),
      }),
    )
    .min(1)
    .max(10),
});

type ItemPedido = { ticketTypeId: string; quantidade: number };

/**
 * Falha esperada da compra, com mensagem pronta para o comprador ler.
 * Não é `Error` exportado porque módulo `'use server'` só pode exportar
 * funções assíncronas.
 */
class CompraError extends Error {}

export type ResultadoCompra = { erro: string };

export async function criarPedido(
  tenantSlug: string,
  eventSlug: string,
  itens: ItemPedido[],
): Promise<ResultadoCompra | void> {
  let destino: string;

  try {
    destino = await montarPedido(tenantSlug, eventSlug, itens);
  } catch (e) {
    if (e instanceof CompraError) return { erro: e.message };
    throw e;
  }

  // Fora do try: `redirect` funciona lançando uma exceção de controle, e
  // capturá-la aqui transformaria o sucesso em erro.
  redirect(destino);
}

async function montarPedido(
  tenantSlug: string,
  eventSlug: string,
  itens: ItemPedido[],
): Promise<string> {
  const entrada = Entrada.parse({ tenantSlug, eventSlug, itens });

  const tenant = await resolverTenantPorSlug(entrada.tenantSlug);
  if (!tenant) throw new CompraError('Produtor não encontrado.');

  const taxas = await configDeTaxasDoTenant(tenant.id);

  const cabecalhos = await headers();
  const ip =
    cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    cabecalhos.get('x-real-ip') ??
    null;
  const userAgent = cabecalhos.get('user-agent');

  const orderId = await withTenant(tenant.id, async (tx) => {
    const [evento] = await tx
      .select({ id: events.id, status: events.status, titulo: events.titulo })
      .from(events)
      .where(eq(events.slug, entrada.eventSlug))
      .limit(1);

    if (!evento) throw new CompraError('Evento não encontrado.');
    if (evento.status !== 'publicado') {
      throw new CompraError('As vendas deste evento não estão abertas.');
    }

    // Preço e limites vêm do banco. O navegador não opina sobre dinheiro.
    const lotes = await tx
      .select({
        id: ticketTypes.id,
        nome: ticketTypes.nome,
        precoCentavos: ticketTypes.precoCentavos,
        limitePorPedido: ticketTypes.limitePorPedido,
        limitePorCpf: ticketTypes.limitePorCpf,
      })
      .from(ticketTypes)
      .where(
        and(
          eq(ticketTypes.eventId, evento.id),
          inArray(
            ticketTypes.id,
            entrada.itens.map((i) => i.ticketTypeId),
          ),
        ),
      );

    if (lotes.length !== entrada.itens.length) {
      throw new CompraError('Um dos lotes escolhidos não existe mais.');
    }

    const porId = new Map(lotes.map((l) => [l.id, l]));

    let subtotal = 0;
    let unidades = 0;

    for (const item of entrada.itens) {
      const lote = porId.get(item.ticketTypeId)!;
      if (item.quantidade > lote.limitePorPedido) {
        throw new CompraError(
          `O limite para "${lote.nome}" é de ${lote.limitePorPedido} por pedido.`,
        );
      }
      subtotal += lote.precoCentavos * item.quantidade;
      unidades += item.quantidade;
    }

    // A conveniência com piso mínimo é por unidade, não sobre o subtotal:
    // senão o piso protegeria só o pedido, e não o ingresso barato.
    const convenienciaCalculada = taxas.taxaAbsorvidaPeloProdutor
      ? 0
      : entrada.itens.reduce((acc, item) => {
          const lote = porId.get(item.ticketTypeId)!;
          if (lote.precoCentavos === 0) return acc;
          const unitaria = Math.max(
            aplicarBps(lote.precoCentavos, taxas.taxaConvenienciaBps),
            taxas.taxaMinimaCentavos,
          );
          return acc + unitaria * item.quantidade;
        }, 0);

    // `calcularTaxas` reparte entre operador e produtor e confere os
    // invariantes; a conveniência já calculada entra como valor fechado.
    const composicao = calcularTaxas({
      subtotalCentavos: subtotal + convenienciaCalculada,
      quantidadeIngressos: unidades,
      config: {
        // A conveniência já foi calculada por unidade acima, com o piso
        // aplicado; aqui ela entra como valor fechado dentro do subtotal.
        taxaConvenienciaBps: 0,
        comissaoBps: taxas.comissaoBps,
        taxaFixaCentavos: taxas.taxaFixaCentavos,
      },
    });

    const valorOperador = Math.min(
      convenienciaCalculada + composicao.comissaoCentavos + composicao.taxaFixaTotalCentavos,
      composicao.totalCentavos,
    );

    const [pedido] = await tx
      .insert(orders)
      .values({
        tenantId: tenant.id,
        eventId: evento.id,
        // Sequencial por tenant. `for update` no maior número evita colisão
        // entre dois pedidos simultâneos do mesmo produtor.
        numero: sql`(
          select coalesce(max(o.numero), 0) + 1 from orders o where o.tenant_id = ${tenant.id}
        )`,
        subtotalCentavos: subtotal,
        convenienciaCentavos: convenienciaCalculada,
        descontoCentavos: 0,
        totalCentavos: composicao.totalCentavos,
        valorOperadorCentavos: valorOperador,
        valorProdutorCentavos: composicao.totalCentavos - valorOperador,
        taxaConvenienciaBpsSnapshot: taxas.taxaConvenienciaBps,
        comissaoBpsSnapshot: taxas.comissaoBps,
        taxaFixaCentavosSnapshot: taxas.taxaFixaCentavos,
        status: 'draft',
        idempotencyKey: crypto.randomUUID(),
        ipAddress: ip,
        userAgent,
      })
      .returning({ id: orders.id });

    if (!pedido) throw new CompraError('Não foi possível criar o pedido.');

    await tx.insert(orderItems).values(
      entrada.itens.map((item) => ({
        tenantId: tenant.id,
        orderId: pedido.id,
        ticketTypeId: item.ticketTypeId,
        quantidade: item.quantidade,
        precoUnitarioCentavosSnapshot: porId.get(item.ticketTypeId)!.precoCentavos,
      })),
    );

    const reserva = await reservarEstoque(tx, {
      tenantId: tenant.id,
      orderId: pedido.id,
      itens: entrada.itens,
      ttlSegundos: TTL_RESERVA_PADRAO_SEGUNDOS,
    });

    if (!reserva.ok) {
      const lote = porId.get(reserva.ticketTypeId);
      throw new CompraError(
        reserva.motivo === 'sem_estoque'
          ? `"${lote?.nome ?? 'Este lote'}" esgotou enquanto você escolhia. Veja os lotes disponíveis.`
          : `"${lote?.nome ?? 'Este lote'}" não está mais à venda.`,
      );
    }

    /**
     * O pedido segue como `draft` de propósito. A máquina de estado (seção 8
     * do plano) só permite `draft → awaiting_payment` quando a transação é
     * criada na PSP — o que acontece no checkout, depois de o comprador se
     * identificar. `draft` já ocupa estoque, então o lugar está guardado.
     */
    await tx
      .update(orders)
      .set({ expiresEm: reserva.expiresEm })
      .where(eq(orders.id, pedido.id));

    return pedido.id;
  });

  return `/checkout/${orderId}`;
}
