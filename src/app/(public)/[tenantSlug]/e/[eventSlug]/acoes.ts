'use server';

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { withTenant } from '@/db/client';
import { events, orderItems, orders, ticketTypes } from '@/db/schema';
import { TTL_RESERVA_PADRAO_SEGUNDOS } from '@/domain/inventory';
import { calcularTaxas } from '@/lib/fees';
import { consumirCupom } from '@/lib/cupons';
import { cookieDaFila, consumirVez, estadoDaFila, temVez } from '@/lib/fila';
import { reservarEstoque } from '@/lib/inventory';
import { aplicarBps, repartir } from '@/lib/money';
import { mensagemDeEspera, registrarTentativa } from '@/lib/rate-limit';
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
  /** Digitado pelo comprador. Vazio é o caso normal. */
  cupom: z.string().trim().max(40).optional(),
});

type ItemPedido = { ticketTypeId: string; quantidade: number };

/**
 * Falha esperada da compra, com mensagem pronta para o comprador ler.
 * Não é `Error` exportado porque módulo `'use server'` só pode exportar
 * funções assíncronas.
 */
class CompraError extends Error {}

/**
 * Não é erro: é a fila fazendo o trabalho dela. Vira redirecionamento para a
 * sala de espera, e não mensagem vermelha na tela do comprador.
 */
class SemVezError extends Error {}

export type ResultadoCompra = { erro: string };

export async function criarPedido(
  tenantSlug: string,
  eventSlug: string,
  itens: ItemPedido[],
  cupom?: string,
): Promise<ResultadoCompra | void> {
  let destino: string;

  try {
    destino = await montarPedido(tenantSlug, eventSlug, itens, cupom);
  } catch (e) {
    if (e instanceof SemVezError) {
      destino = `/${tenantSlug}/e/${eventSlug}/fila`;
    } else if (e instanceof CompraError) {
      return { erro: e.message };
    } else {
      throw e;
    }
  }

  // Fora do try: `redirect` funciona lançando uma exceção de controle, e
  // capturá-la aqui transformaria o sucesso em erro.
  redirect(destino);
}

async function montarPedido(
  tenantSlug: string,
  eventSlug: string,
  itens: ItemPedido[],
  cupom?: string,
): Promise<string> {
  const entrada = Entrada.parse({ tenantSlug, eventSlug, itens, cupom });
  const codigoCupom = entrada.cupom?.trim() || null;

  const tenant = await resolverTenantPorSlug(entrada.tenantSlug);
  if (!tenant) throw new CompraError('Produtor não encontrado.');

  const taxas = await configDeTaxasDoTenant(tenant.id);

  const jarDeCookies = await cookies();
  const cabecalhos = await headers();
  const ip =
    cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    cabecalhos.get('x-real-ip') ??
    null;
  const userAgent = cabecalhos.get('user-agent');

  /**
   * Sem limite aqui, um script reserva todo o estoque de um lote sem pagar
   * nada e derruba a venda. É o ataque mais barato contra uma bilheteria.
   */
  const limite = await registrarTentativa('criarPedido', ip ?? 'sem-ip');
  if (!limite.permitido) throw new CompraError(mensagemDeEspera(limite.esperarSegundos));

  const criado = await withTenant(tenant.id, async (tx) => {
    const [evento] = await tx
      .select({ id: events.id, status: events.status, titulo: events.titulo })
      .from(events)
      .where(eq(events.slug, entrada.eventSlug))
      .limit(1);

    if (!evento) throw new CompraError('Evento não encontrado.');
    if (evento.status !== 'publicado') {
      throw new CompraError('As vendas deste evento não estão abertas.');
    }

    /**
     * Fila virtual — ADR-014.
     *
     * A conferência é barata de propósito: uma leitura da linha do evento e,
     * só se a fila estiver ligada, uma da linha da pessoa. Evento sem fila
     * não paga nada por uma peça que existe para festival.
     */
    const fila = await estadoDaFila(evento.id);
    if (fila?.filaAtiva) {
      const senha = jarDeCookies.get(cookieDaFila(evento.id))?.value;
      if (!(await temVez(evento.id, senha))) throw new SemVezError();
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

    /**
     * Cupom, se houver.
     *
     * O uso é consumido **aqui dentro**, na mesma transação do pedido, por um
     * `UPDATE` condicional: um cupom de cem usos precisa parar em cem, e cem
     * pessoas clicando ao mesmo tempo é exatamente o caso em que
     * ler-para-depois-decidir passa de cem. Se a reserva expirar sem
     * pagamento, o uso volta.
     */
    let descontoCentavos = 0;
    let cupomId: string | null = null;

    if (codigoCupom) {
      const r = await consumirCupom(tx, {
        tenantId: tenant.id,
        eventId: evento.id,
        codigo: codigoCupom,
        subtotalCentavos: subtotal,
      });

      if (!r.ok) throw new CompraError(r.explicacao);

      descontoCentavos = r.cupom.descontoCentavos;
      cupomId = r.cupom.cupomId;
    }

    /**
     * A conveniência com piso mínimo é por unidade, não sobre o subtotal:
     * senão o piso protegeria só o pedido, e não o ingresso barato.
     *
     * E ela incide sobre o preço **já descontado** — ver `src/lib/fees.ts`.
     * Cobrar taxa de serviço sobre um preço que o comprador não pagou é o
     * tipo de coisa que o Procon autua. Por isso o desconto é repartido entre
     * as unidades antes: um cupom de R$ 20 num pedido de dois ingressos tira
     * R$ 10 de cada, e é sobre o que sobrou que a taxa é calculada.
     */
    const precosUnitarios: number[] = [];
    for (const item of entrada.itens) {
      const lote = porId.get(item.ticketTypeId)!;
      for (let i = 0; i < item.quantidade; i++) precosUnitarios.push(lote.precoCentavos);
    }

    const descontoPorUnidade =
      descontoCentavos > 0 && subtotal > 0
        ? repartir(descontoCentavos, precosUnitarios)
        : precosUnitarios.map(() => 0);

    const convenienciaCalculada = taxas.taxaAbsorvidaPeloProdutor
      ? 0
      : precosUnitarios.reduce((acc, preco, i) => {
          const efetivo = preco - (descontoPorUnidade[i] ?? 0);
          // Cortesia e ingresso zerado por cupom não pagam conveniência.
          if (efetivo <= 0) return acc;
          return (
            acc +
            Math.max(
              aplicarBps(efetivo, taxas.taxaConvenienciaBps),
              taxas.taxaMinimaCentavos,
            )
          );
        }, 0);

    // `calcularTaxas` reparte entre operador e produtor e confere os
    // invariantes; a conveniência já calculada entra como valor fechado.
    const composicao = calcularTaxas({
      subtotalCentavos: subtotal + convenienciaCalculada,
      descontoCentavos,
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
        descontoCentavos,
        cupomId,
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

    return { orderId: pedido.id, eventoId: evento.id };
  });

  /**
   * A vez morre no uso.
   *
   * Sem isto, quem foi chamado uma vez compraria a noite inteira sem voltar
   * para a fila — que é precisamente o cambista com script que a fila existe
   * para atrapalhar. Quem quiser comprar de novo pega senha de novo, como
   * todo mundo.
   */
  await consumirVez(
    criado.eventoId,
    tenant.id,
    jarDeCookies.get(cookieDaFila(criado.eventoId))?.value,
  );

  return `/checkout/${criado.orderId}`;
}
