/**
 * Seed de desenvolvimento.
 *
 *   pnpm db:seed
 *
 * Conecta pela URL DIRETA com o papel dono do schema, então ignora RLS de
 * propósito — é o único lugar do sistema onde isso é aceitável.
 *
 * Dados propositalmente feios: evento esgotado, evento cancelado, pedidos
 * expirados, reembolso parcial, chargeback. Seed bonito demais esconde bug.
 */
import { config } from 'dotenv';
import { eq, sql as sqlOp } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { hashPassword } from '@/lib/auth';
import * as schema from './schema';

config({ path: '.env.local' });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Defina DIRECT_URL em .env.local');

const sql = postgres(url, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

// ---------------------------------------------------------------------------
// Aleatoriedade determinística — mesmo seed, mesmo banco, sempre.
// ---------------------------------------------------------------------------

let semente = 20260907;
function rnd(): number {
  semente = (semente * 1103515245 + 12345) & 0x7fffffff;
  return semente / 0x7fffffff;
}
function inteiro(min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}
function escolher<T>(lista: readonly T[]): T {
  return lista[inteiro(0, lista.length - 1)]!;
}

const dias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

/**
 * Data a N dias, no horário civil de São Paulo (UTC-3).
 * Festa começa às 22h, não às 19h19 — e demonstração com horário torto faz
 * parecer que o fuso está errado quando não está.
 */
const noite = (n: number, horaLocal: number, minuto = 0) => {
  const d = dias(n);
  d.setUTCHours(horaLocal + 3, minuto, 0, 0);
  return d;
};

// ---------------------------------------------------------------------------

async function limpar() {
  // Ordem inversa da dependência.
  await sql`
    truncate table
      audit_log, jobs, webhook_events, chargebacks, refunds, payouts,
      tickets, reservations, order_items, orders, coupons, ticket_types,
      events, venues, memberships, sessions, users, tenants
    restart identity cascade
  `;
}

async function seed() {
  console.log('Limpando...');
  await limpar();

  // -------------------------------------------------------------------------
  // Tenants
  // -------------------------------------------------------------------------
  console.log('Tenants...');
  const [superFestas, heyHey] = await db
    .insert(schema.tenants)
    .values([
      {
        slug: 'super-festas',
        nome: 'Super Festas',
        razaoSocial: 'Super Festas Produções LTDA',
        cnpj: '11222333000181',
        email: 'contato@superfestas.com.br',
        telefone: '11987654321',
        kycStatus: 'aprovado',
        providerRecipientId: 'fake_rcpt_super',
        corAcento: '#FF3D68',
        taxaMinimaCentavos: 399,
        taxaConvenienciaBps: 1000, // 10,00%
        comissaoBps: 500, //  5,00%
        taxaFixaCentavos: 150, // R$ 1,50 por ingresso
        reservaPixBps: 0,
        reservaCartaoBps: 2000, // 20% retidos até D+35
      },
      {
        slug: 'hey-hey',
        nome: 'Hey Hey Club',
        razaoSocial: 'Hey Hey Entretenimento LTDA',
        cnpj: '44555666000199',
        email: 'financeiro@heyhey.com.br',
        telefone: '11912345678',
        kycStatus: 'em_analise', // ainda não pode receber repasse
        corAcento: '#22D3A6',
        taxaMinimaCentavos: 399,
        taxaConvenienciaBps: 1200,
        comissaoBps: 0,
        taxaFixaCentavos: 0,
        reservaPixBps: 500,
        reservaCartaoBps: 2500,
      },
    ])
    .returning();

  if (!superFestas || !heyHey) throw new Error('Falha ao criar tenants');

  // -------------------------------------------------------------------------
  // Usuários e vínculos
  // -------------------------------------------------------------------------
  console.log('Usuários...');
  const senha = await hashPassword('tiqueteira-dev-123');

  const [admin, produtorA, produtorB, portaria] = await db
    .insert(schema.users)
    .values([
      { email: 'admin@tiqueteira.local', nome: 'Operador da Plataforma', senhaHash: senha },
      { email: 'ana@superfestas.com.br', nome: 'Ana Ribeiro', senhaHash: senha },
      { email: 'bruno@heyhey.com.br', nome: 'Bruno Tavares', senhaHash: senha },
      { email: 'portaria@superfestas.com.br', nome: 'Equipe de Portaria', senhaHash: senha },
    ])
    .returning();

  if (!admin || !produtorA || !produtorB || !portaria) throw new Error('Falha ao criar usuários');

  // -------------------------------------------------------------------------
  // Venues
  // -------------------------------------------------------------------------
  console.log('Espaços...');
  const [jussara, solon, fabrique] = await db
    .insert(schema.venues)
    .values([
      {
        tenantId: superFestas.id,
        nome: 'Complexo Jussara',
        endereco: 'Rua Jussara, 100',
        cidade: 'São Paulo',
        uf: 'SP',
        capacidadeMaxima: 1200,
      },
      {
        tenantId: superFestas.id,
        nome: 'Espaço Solon',
        endereco: 'Rua Solon, 900',
        cidade: 'São Paulo',
        uf: 'SP',
        capacidadeMaxima: 600,
      },
      {
        tenantId: heyHey.id,
        nome: 'Fabrique',
        endereco: 'Av. Marquês de São Vicente, 1000',
        cidade: 'São Paulo',
        uf: 'SP',
        capacidadeMaxima: 800,
      },
    ])
    .returning();

  if (!jussara || !solon || !fabrique) throw new Error('Falha ao criar venues');

  await db.insert(schema.memberships).values([
    { userId: admin.id, tenantId: superFestas.id, role: 'admin' },
    { userId: admin.id, tenantId: heyHey.id, role: 'admin' },
    { userId: produtorA.id, tenantId: superFestas.id, role: 'owner' },
    { userId: produtorB.id, tenantId: heyHey.id, role: 'owner' },
  ]);

  // -------------------------------------------------------------------------
  // Eventos — quatro estados diferentes
  // -------------------------------------------------------------------------
  console.log('Eventos...');
  const [publicado, esgotado, encerrado, cancelado] = await db
    .insert(schema.events)
    .values([
      {
        tenantId: superFestas.id,
        venueId: jussara.id,
        slug: 'baile-do-jussara-2026',
        titulo: 'Baile do Jussara 2026',
        descricao:
          'A festa que abre a temporada no Complexo Jussara. Três ambientes, '
          + 'line-up de house e brasilidades até as 6h. Open bar de boas-vindas '
          + 'até a meia-noite para quem chegar cedo.',
        politicaReembolso:
          'Cancelamento em até 7 dias da compra, com devolução integral. ' +
          'Depois disso, até 48h antes do evento.',
        dataInicio: noite(30, 22),
        dataFim: noite(31, 5),
        capacidade: 1200,
        status: 'publicado',
        ingressoNominal: true,
        exigeDocumentoEntrada: true,
      },
      {
        tenantId: superFestas.id,
        venueId: solon.id,
        slug: 'solon-sunset',
        titulo: 'Solon Sunset',
        descricao: 'Pôr do sol no rooftop do Espaço Solon, com DJ residente.',
        dataInicio: noite(12, 17),
        dataFim: noite(12, 23),
        capacidade: 400,
        status: 'esgotado',
        ingressoNominal: true,
      },
      {
        tenantId: superFestas.id,
        venueId: jussara.id,
        slug: 'retro-jussara',
        titulo: 'Retrô Jussara',
        dataInicio: noite(-20, 23),
        dataFim: noite(-19, 6),
        capacidade: 900,
        status: 'encerrado',
        ingressoNominal: false,
      },
      {
        tenantId: heyHey.id,
        venueId: fabrique.id,
        slug: 'hey-hey-open-air',
        titulo: 'Hey Hey Open Air',
        dataInicio: noite(45, 21),
        dataFim: noite(46, 6),
        capacidade: 800,
        status: 'cancelado',
        canceladoEm: dias(-2),
        canceladoMotivo: 'Interdição do espaço pela prefeitura',
      },
    ])
    .returning();

  if (!publicado || !esgotado || !encerrado || !cancelado) {
    throw new Error('Falha ao criar eventos');
  }

  // -------------------------------------------------------------------------
  // Tipos de ingresso
  // -------------------------------------------------------------------------
  console.log('Tipos de ingresso...');
  const tipos = await db
    .insert(schema.ticketTypes)
    .values([
      // Baile do Jussara — três lotes, com meia-entrada e gratuidades
      {
        tenantId: superFestas.id,
        eventId: publicado.id,
        nome: '1º Lote — Inteira',
        precoCentavos: 8000,
        tipo: 'inteira',
        quantidadeTotal: 400,
        quantidadeVendida: 400,
        lote: 1,
        ordem: 1,
        vendasInicio: dias(-30),
        vendasFim: dias(-10),
        ativo: false,
      },
      {
        tenantId: superFestas.id,
        eventId: publicado.id,
        nome: '2º Lote — Inteira',
        precoCentavos: 10000,
        tipo: 'inteira',
        quantidadeTotal: 400,
        lote: 2,
        ordem: 2,
        vendasInicio: dias(-10),
        vendasFim: dias(29),
        limitePorCpf: 4,
      },
      {
        tenantId: superFestas.id,
        eventId: publicado.id,
        nome: '2º Lote — Meia-entrada',
        precoCentavos: 5000,
        tipo: 'meia',
        consomeCotaMeia: true,
        quantidadeTotal: 320, // dentro da cota de 40% de 1200
        lote: 2,
        ordem: 3,
        vendasInicio: dias(-10),
        vendasFim: dias(29),
        exigeDocumento: true,
        limitePorCpf: 2,
      },
      {
        tenantId: superFestas.id,
        eventId: publicado.id,
        nome: 'PCD + acompanhante',
        precoCentavos: 0,
        tipo: 'pcd',
        consomeCotaMeia: false, // gratuidade legal não consome a cota
        quantidadeTotal: 40,
        lote: 2,
        ordem: 4,
        vendasInicio: dias(-10),
        vendasFim: dias(29),
        exigeDocumento: true,
      },
      // Solon Sunset — esgotado
      {
        tenantId: superFestas.id,
        eventId: esgotado.id,
        nome: 'Único',
        precoCentavos: 12000,
        tipo: 'inteira',
        quantidadeTotal: 400,
        quantidadeVendida: 400,
        lote: 1,
        ordem: 1,
        vendasInicio: dias(-40),
        vendasFim: dias(11),
      },
      // Retrô — encerrado
      {
        tenantId: superFestas.id,
        eventId: encerrado.id,
        nome: 'Pista',
        precoCentavos: 6000,
        tipo: 'inteira',
        quantidadeTotal: 900,
        quantidadeVendida: 640,
        lote: 1,
        ordem: 1,
        vendasInicio: dias(-60),
        vendasFim: dias(-20),
        ativo: false,
      },
      // Hey Hey — cancelado
      {
        tenantId: heyHey.id,
        eventId: cancelado.id,
        nome: 'Pista Premium',
        precoCentavos: 18000,
        tipo: 'inteira',
        quantidadeTotal: 800,
        quantidadeVendida: 120,
        lote: 1,
        ordem: 1,
        vendasInicio: dias(-25),
        vendasFim: dias(44),
        ativo: false,
      },
    ])
    .returning();

  const tipoPor = (eventId: string) => tipos.filter((t) => t.eventId === eventId);

  // -------------------------------------------------------------------------
  // Cupom
  // -------------------------------------------------------------------------
  await db.insert(schema.coupons).values({
    tenantId: superFestas.id,
    eventId: publicado.id,
    codigo: 'AMIGO10',
    tipo: 'pct',
    valor: 1000, // 10,00% em basis points — ADR-006
    usosMaximos: 100,
    validoAte: dias(29),
  });

  // -------------------------------------------------------------------------
  // Pedidos — 200, distribuídos entre os status
  // -------------------------------------------------------------------------
  console.log('Pedidos...');

  const nomes = [
    'Carla Souza', 'Diego Martins', 'Elisa Prado', 'Fábio Nunes', 'Gabriela Lima',
    'Henrique Alves', 'Isabela Rocha', 'João Pedro Dias', 'Karina Melo', 'Lucas Ferraz',
    'Marina Costa', 'Nelson Braga', 'Olívia Campos', 'Paulo Mendes', 'Renata Vieira',
  ] as const;

  const distribuicao: { status: (typeof schema.orderStatusEnum.enumValues)[number]; qtd: number }[] =
    [
      { status: 'paid', qtd: 130 },
      { status: 'awaiting_payment', qtd: 20 },
      { status: 'expired', qtd: 30 },
      { status: 'canceled', qtd: 6 },
      { status: 'refunded', qtd: 8 },
      { status: 'partially_refunded', qtd: 4 },
      { status: 'chargeback', qtd: 2 },
    ];

  // Quanto já foi reservado por tipo nesta execução. O contador do banco tem
  // CHECK de estoque; sem controlar aqui, o seed tenta reservar em lote
  // esgotado e o banco recusa — corretamente.
  const reservadoLocal = new Map<string, number>();

  const contador = new Map<string, number>();
  const proximoNumero = (tenantId: string) => {
    const n = (contador.get(tenantId) ?? 0) + 1;
    contador.set(tenantId, n);
    return n;
  };

  let criados = 0;

  for (const { status, qtd } of distribuicao) {
    for (let i = 0; i < qtd; i++) {
      const evento = escolher([publicado, esgotado, encerrado, cancelado]);
      const tenant = evento.tenantId === superFestas.id ? superFestas : heyHey;
      const tiposDoEvento = tipoPor(evento.id);
      const tipo = escolher(tiposDoEvento);
      if (!tipo) continue;

      const quantidade = inteiro(1, 4);
      const subtotal = tipo.precoCentavos * quantidade;

      // Aritmética inteira em toda parte. Resíduo de arredondamento fica com
      // o operador, nunca some.
      const conveniencia = Math.round((subtotal * tenant.taxaConvenienciaBps) / 10000);
      const comissao = Math.round((subtotal * tenant.comissaoBps) / 10000);
      const fixa = tenant.taxaFixaCentavos * quantidade;
      const total = subtotal + conveniencia;
      const valorOperador = Math.min(conveniencia + comissao + fixa, total);
      const valorProdutor = total - valorOperador;

      const metodo = rnd() < 0.75 ? ('pix' as const) : ('credit_card' as const);

      // Cortesia e PCD custam zero. Não existe reembolso nem chargeback de
      // zero — e o CHECK `refunds_valor_ck` recusa, corretamente. Esse pedido
      // vira apenas `paid`.
      let statusEfetivo =
        total === 0 && ['refunded', 'partially_refunded', 'chargeback'].includes(status)
          ? ('paid' as const)
          : status;

      // Pedido aguardando pagamento segura estoque de verdade. Se o lote
      // sorteado já esgotou, este vira um pedido expirado — que é justamente
      // o que aconteceria na vida real.
      const jaReservado = reservadoLocal.get(tipo.id) ?? 0;
      const disponivelNoTipo = tipo.quantidadeTotal - tipo.quantidadeVendida - jaReservado;
      if (statusEfetivo === 'awaiting_payment' && quantidade > disponivelNoTipo) {
        statusEfetivo = 'expired';
      }

      const pago = ['paid', 'partially_refunded', 'refunded', 'chargeback'].includes(
        statusEfetivo,
      );

      const [pedido] = await db
        .insert(schema.orders)
        .values({
          tenantId: tenant.id,
          eventId: evento.id,
          numero: proximoNumero(tenant.id),
          compradorNome: escolher(nomes),
          compradorEmail: `comprador${criados}@exemplo.com.br`,
          compradorCpf: String(10000000000 + inteiro(0, 89999999999)).slice(0, 11),
          compradorTelefone: `1199${inteiro(1000000, 9999999)}`,
          subtotalCentavos: subtotal,
          convenienciaCentavos: conveniencia,
          descontoCentavos: 0,
          totalCentavos: total,
          valorProdutorCentavos: valorProdutor,
          valorOperadorCentavos: valorOperador,
          taxaConvenienciaBpsSnapshot: tenant.taxaConvenienciaBps,
          comissaoBpsSnapshot: tenant.comissaoBps,
          taxaFixaCentavosSnapshot: tenant.taxaFixaCentavos,
          metodo,
          parcelas: metodo === 'credit_card' ? inteiro(1, 6) : null,
          status: statusEfetivo,
          providerTransactionId: pago ? `fake_tx_${criados}` : null,
          idempotencyKey: `seed_${criados}`,
          expiresEm: statusEfetivo === 'awaiting_payment' ? dias(0.007) : dias(-1),
          pagoEm: pago ? dias(-inteiro(1, 25)) : null,
          canceladoEm: statusEfetivo === 'canceled' ? dias(-inteiro(1, 10)) : null,
        })
        .returning();

      if (!pedido) continue;

      await db.insert(schema.orderItems).values({
        tenantId: tenant.id,
        orderId: pedido.id,
        ticketTypeId: tipo.id,
        quantidade,
        precoUnitarioCentavosSnapshot: tipo.precoCentavos,
      });

      // Reserva viva só para pedido aguardando pagamento.
      if (statusEfetivo === 'awaiting_payment') {
        await db.insert(schema.reservations).values({
          tenantId: tenant.id,
          ticketTypeId: tipo.id,
          orderId: pedido.id,
          quantidade,
          expiresEm: dias(0.007),
        });
        // Reserva viva precisa aparecer no contador. Sem isto, o job de
        // expiração devolve estoque que nunca foi retirado e o contador vai a
        // negativo — o CHECK ticket_types_reservada_ck pegou isso em teste.
        await db
          .update(schema.ticketTypes)
          .set({ quantidadeReservada: sqlOp`quantidade_reservada + ${quantidade}` })
          .where(eq(schema.ticketTypes.id, tipo.id));
        reservadoLocal.set(tipo.id, jaReservado + quantidade);
      } else if (statusEfetivo === 'expired') {
        await db.insert(schema.reservations).values({
          tenantId: tenant.id,
          ticketTypeId: tipo.id,
          orderId: pedido.id,
          quantidade,
          expiresEm: dias(-1),
          liberada: true,
          liberadaEm: dias(-1),
          liberadaMotivo: 'expirada',
        });
      }

      // Ingressos para pedido pago.
      if (pago) {
        const cancelados = statusEfetivo === 'refunded' || statusEfetivo === 'chargeback';
        for (let t = 0; t < quantidade; t++) {
          const usado = evento.status === 'encerrado' && !cancelados && rnd() < 0.85;
          await db.insert(schema.tickets).values({
            tenantId: tenant.id,
            orderId: pedido.id,
            ticketTypeId: tipo.id,
            eventId: evento.id,
            codigo: `${criados.toString(36).toUpperCase().padStart(4, '0')}-${t}${inteiro(100, 999)}`,
            tokenHash: `seedhash_${criados}_${t}`,
            titularNome: pedido.compradorNome ?? 'Comprador',
            titularCpf: pedido.compradorCpf,
            titularEmail: pedido.compradorEmail,
            status: cancelados ? 'cancelado' : usado ? 'usado' : 'valido',
            checkedInEm: usado ? dias(-19.8) : null,
            checkedInBy: usado ? portaria.id : null,
            documentoConferido: usado,
            canceladoEm: cancelados ? dias(-inteiro(1, 5)) : null,
            canceladoMotivo: cancelados ? statusEfetivo : null,
          });
        }
      }

      // Reembolsos e chargebacks.
      if (statusEfetivo === 'refunded') {
        await db.insert(schema.refunds).values({
          tenantId: tenant.id,
          orderId: pedido.id,
          motivo: 'buyer_request',
          valorCentavos: total,
          status: 'succeeded',
          providerRefundId: `fake_rf_${criados}`,
          idempotencyKey: `seed_rf_${criados}`,
          concluidoEm: dias(-inteiro(1, 5)),
        });
      } else if (statusEfetivo === 'partially_refunded') {
        await db.insert(schema.refunds).values({
          tenantId: tenant.id,
          orderId: pedido.id,
          motivo: 'buyer_request',
          valorCentavos: Math.max(1, Math.round(total / 2)),
          status: 'succeeded',
          providerRefundId: `fake_rf_${criados}`,
          idempotencyKey: `seed_rf_${criados}`,
          concluidoEm: dias(-inteiro(1, 5)),
        });
      } else if (statusEfetivo === 'chargeback') {
        await db.insert(schema.chargebacks).values({
          tenantId: tenant.id,
          orderId: pedido.id,
          valorCentavos: total,
          status: 'aberto',
          providerDisputeId: `fake_dp_${criados}`,
        });
      }

      criados++;
    }
  }

  console.log(`  ${criados} pedidos.`);

  // -------------------------------------------------------------------------
  // Repasse do evento encerrado
  // -------------------------------------------------------------------------
  console.log('Repasses...');
  await db.insert(schema.payouts).values([
    {
      tenantId: superFestas.id,
      eventId: encerrado.id,
      tranche: 'principal',
      metodo: 'pix',
      brutoCentavos: 1_920_000,
      comissaoCentavos: 96_000,
      retidoCentavos: 0,
      liberadoCentavos: 1_824_000,
      status: 'released',
      dataPrevista: dias(-17),
      dataEfetiva: dias(-17),
      providerPayoutId: 'fake_po_1',
      idempotencyKey: 'seed_po_1',
    },
    {
      tenantId: superFestas.id,
      eventId: encerrado.id,
      tranche: 'principal',
      metodo: 'credit_card',
      brutoCentavos: 640_000,
      comissaoCentavos: 32_000,
      retidoCentavos: 121_600, // 20% de reserva até D+35
      liberadoCentavos: 486_400,
      status: 'released',
      dataPrevista: dias(-17),
      dataEfetiva: dias(-17),
      providerPayoutId: 'fake_po_2',
      idempotencyKey: 'seed_po_2',
    },
    {
      tenantId: superFestas.id,
      eventId: encerrado.id,
      tranche: 'reserva',
      metodo: 'credit_card',
      brutoCentavos: 121_600,
      chargebacksCentavos: 0,
      retidoCentavos: 0,
      liberadoCentavos: 121_600,
      status: 'scheduled',
      dataPrevista: dias(15),
      idempotencyKey: 'seed_po_3',
    },
  ]);

  console.log('\nPronto.');
  console.log('  Login: admin@tiqueteira.local / tiqueteira-dev-123');
  console.log('  Produtor A: ana@superfestas.com.br');
  console.log('  Produtor B: bruno@heyhey.com.br');
}

async function main() {
  try {
    await seed();
  } finally {
    await sql.end();
  }
}

void main();
