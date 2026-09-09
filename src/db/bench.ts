/**
 * Medição de capacidade — a porta e a abertura de vendas.
 *
 *   pnpm bench
 *   pnpm bench --ingressos 5000 --concorrentes 200 --lote 200 --compradores 500
 *
 * Existe porque "aguenta 5 mil pessoas?" não se responde com opinião. O
 * `scripts/teste-de-carga.mjs` mede quem **abre** a página; este mede quem
 * **passa pela porta** e quem **compra** — os dois caminhos que não são
 * cacheáveis por natureza, e onde o banco volta a ser o gargalo.
 *
 * Roda contra o banco de desenvolvimento e limpa o que criou. NÃO rode contra
 * produção durante venda real.
 *
 * Leitura honesta dos números: o banco de desenvolvimento está em us-east-1,
 * a uns 120 ms daqui. Produção nasce em sa-east-1 (ADR-009), então a latência
 * medida aqui é PIOR que a real. O que interessa é a forma da curva e onde
 * ela quebra, não o valor absoluto.
 */
import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { reservarEstoque } from '@/lib/inventory';
import { validarIngresso, type ContextoPortaria } from '@/lib/checkin';
import { sincronizarMovimentos } from '@/lib/portaria-sync';
import { emitirTicket } from '@/lib/tickets';
import * as schema from './schema';

config({ path: '.env.local' });

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
}

const INGRESSOS = Number(args.get('ingressos') ?? 5000);
const CONCORRENTES = Number(args.get('concorrentes') ?? 200);
const LOTE_COMPRA = Number(args.get('lote') ?? 200);
const COMPRADORES = Number(args.get('compradores') ?? 500);
const CONEXOES = Number(args.get('conexoes') ?? 50);

const DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const SEGREDO = process.env.TICKET_HMAC_SECRET;
if (!DIRECT_URL || !DATABASE_URL) throw new Error('Defina DIRECT_URL e DATABASE_URL');
if (!SEGREDO) throw new Error('Defina TICKET_HMAC_SECRET');

/** Dono do schema: monta e desmonta o cenário. */
const donoSql = postgres(DIRECT_URL, { max: 4, prepare: false });
const dono = drizzle(donoSql, { schema });

/**
 * Pool largo de propósito. Em produção cada instância serverless tem UMA
 * conexão (ver `src/db/client.ts`), e o teto é o pooler. Abrir N conexões
 * aqui é a forma de simular N instâncias atendendo ao mesmo tempo — que é o
 * que acontece na abertura de vendas.
 */
const appSql = postgres(DATABASE_URL, { max: CONEXOES, prepare: false });
const app = drizzle(appSql, { schema });

// ---------------------------------------------------------------------------

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const o = [...valores].sort((a, b) => a - b);
  return Math.round(o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))]!);
}

function relatar(nome: string, ms: number[], sucessos: number, total: number, duracao: number) {
  console.log(`  ${nome}`);
  console.log(
    `    ${sucessos}/${total} · p50 ${percentil(ms, 50)} ms · p95 ${percentil(ms, 95)} ms · ` +
      `p99 ${percentil(ms, 99)} ms · ${Math.round((total / duracao) * 1000)}/s`,
  );
}

async function cronometrar<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await fn();
  return [r, performance.now() - t];
}

// ---------------------------------------------------------------------------

let tenantId = '';
let eventId = '';
let orderId = '';
let userId = '';
let loteEntradaId = '';
let loteCompraId = '';
const tokens: string[] = [];
const sufixo = Date.now().toString(36);

async function montar() {
  console.log(`Montando: ${INGRESSOS} ingressos, ${CONCORRENTES} leituras simultâneas…`);

  const [tenant] = await dono
    .insert(schema.tenants)
    .values({ slug: `bench-${sufixo}`, nome: 'Bench', email: `bench-${sufixo}@teste.local` })
    .returning();
  tenantId = tenant!.id;

  const [operador] = await dono
    .insert(schema.users)
    .values({ nome: 'Portaria Bench', email: `bench-${sufixo}@teste.local`, senhaHash: 'x' })
    .returning();
  userId = operador!.id;

  const [venue] = await dono
    .insert(schema.venues)
    .values({ tenantId, nome: 'Arena Bench', capacidadeMaxima: 100000 })
    .returning();

  const [evento] = await dono
    .insert(schema.events)
    .values({
      tenantId,
      venueId: venue!.id,
      slug: `bench-${sufixo}`,
      titulo: 'Evento de Medição',
      dataInicio: new Date(Date.now() + 86_400_000),
      dataFim: new Date(Date.now() + 108_000_000),
      capacidade: 100000,
      status: 'publicado',
      controlaSaida: true,
      permiteReentrada: true,
    })
    .returning();
  eventId = evento!.id;

  const lotes = await dono
    .insert(schema.ticketTypes)
    .values([
      {
        tenantId,
        eventId,
        nome: 'Entrada',
        precoCentavos: 5000,
        quantidadeTotal: INGRESSOS + 100,
        vendasInicio: new Date(Date.now() - 86_400_000),
        vendasFim: new Date(Date.now() + 86_400_000),
      },
      {
        tenantId,
        eventId,
        nome: 'Lote disputado',
        precoCentavos: 5000,
        quantidadeTotal: LOTE_COMPRA,
        vendasInicio: new Date(Date.now() - 86_400_000),
        vendasFim: new Date(Date.now() + 86_400_000),
        limitePorPedido: 6,
      },
    ])
    .returning();
  loteEntradaId = lotes[0]!.id;
  loteCompraId = lotes[1]!.id;

  const [pedido] = await dono
    .insert(schema.orders)
    .values({
      tenantId,
      eventId,
      numero: 1,
      compradorNome: 'Comprador Bench',
      compradorEmail: 'bench@teste.local',
      compradorCpf: '12345678901',
      subtotalCentavos: 0,
      convenienciaCentavos: 0,
      totalCentavos: 0,
      valorProdutorCentavos: 0,
      valorOperadorCentavos: 0,
      taxaConvenienciaBpsSnapshot: 0,
      comissaoBpsSnapshot: 0,
      status: 'paid',
      idempotencyKey: `bench_${sufixo}`,
    })
    .returning();
  orderId = pedido!.id;

  /**
   * Ingressos com token assinado de verdade para as leituras da medição, e o
   * resto preenchido em massa pelo próprio Postgres — inserir 5 mil linhas uma
   * a uma daqui mediria a latência da minha rede, não a do banco.
   */
  const comToken = Math.min(CONCORRENTES + 200, INGRESSOS);

  for (let i = 0; i < comToken; i += 500) {
    const fatia = Array.from({ length: Math.min(500, comToken - i) }, (_, j) => {
      const emitido = emitirTicket(SEGREDO!);
      tokens.push(emitido.token);
      return {
        tenantId,
        orderId,
        ticketTypeId: loteEntradaId,
        eventId,
        codigo: emitido.codigo,
        tokenHash: emitido.tokenHash,
        titularNome: `Pessoa ${i + j}`,
        titularCpf: String(30000000000 + i + j).slice(0, 11),
        status: 'valido' as const,
      };
    });
    await dono.insert(schema.tickets).values(fatia);
  }

  const resto = INGRESSOS - comToken;
  if (resto > 0) {
    await dono.execute(sql`
      insert into tickets (tenant_id, order_id, ticket_type_id, event_id, codigo,
                           token_hash, titular_nome, titular_cpf, status)
      select ${tenantId}, ${orderId}, ${loteEntradaId}, ${eventId},
             'BX' || lpad(g::text, 8, '0'),
             md5(random()::text) || md5(random()::text),
             'Pessoa ' || g,
             lpad((40000000000 + g)::text, 11, '0'),
             'valido'
        from generate_series(1, ${resto}) g
    `);
  }
}

async function desmontar() {
  if (!tenantId) return;
  console.log('\nLimpando…');
  for (const t of [
    'ticket_movimentos',
    'tickets',
    'reservations',
    'order_items',
    'orders',
    'ticket_types',
    'events',
    'venues',
  ]) {
    await dono.execute(sql.raw(`delete from ${t} where tenant_id = '${tenantId}'`));
  }
  await dono.execute(sql`delete from tenants where id = ${tenantId}`);
  if (userId) await dono.execute(sql`delete from users where id = ${userId}`);
}

// ---------------------------------------------------------------------------
// 1. Manifesto da portaria
// ---------------------------------------------------------------------------

async function medirManifesto() {
  console.log('\n1. Manifesto da portaria (o que o celular baixa antes de abrir os portões)');

  const [linhas, ms] = await cronometrar(async () =>
    dono
      .select({
        h: schema.tickets.tokenHash,
        c: schema.tickets.codigo,
        n: schema.tickets.titularNome,
        d: schema.tickets.titularCpf,
        l: schema.ticketTypes.nome,
        s: schema.tickets.status,
        e: schema.tickets.checkedInEm,
        i: schema.tickets.dentro,
        q: schema.tickets.entradasCount,
        x: schema.tickets.ultimaSaidaEm,
      })
      .from(schema.tickets)
      .innerJoin(schema.ticketTypes, eq(schema.ticketTypes.id, schema.tickets.ticketTypeId))
      .where(eq(schema.tickets.eventId, eventId)),
  );

  const corpo = JSON.stringify({
    eventId,
    titulo: 'Evento de Medição',
    nominal: true,
    controlaSaida: true,
    permiteReentrada: true,
    geradoEm: new Date().toISOString(),
    total: linhas.length,
    ingressos: linhas.map((t) => ({
      h: t.h,
      c: t.c,
      n: t.n,
      d: t.d ? t.d.slice(3, 9) : null,
      l: t.l,
      s: t.s,
      e: null,
      i: t.i,
      q: t.q,
      x: null,
    })),
  });

  const bruto = Buffer.byteLength(corpo);
  const comprimido = gzipSync(corpo).length;

  console.log(`    ${linhas.length} ingressos · consulta ${Math.round(ms)} ms`);
  console.log(
    `    ${(bruto / 1024 / 1024).toFixed(2)} MB cru · ` +
      `${(comprimido / 1024).toFixed(0)} KB comprimido (é assim que trafega)`,
  );
  console.log(
    `    numa rede de 1 Mbps: ~${((comprimido * 8) / 1_000_000).toFixed(1)} s para baixar`,
  );
}

// ---------------------------------------------------------------------------
// 2. Check-in
// ---------------------------------------------------------------------------

/**
 * O mesmo `UPDATE` condicional de `src/lib/checkin.ts`, mais o registro no
 * livro da porta. Está reescrito aqui porque a função real usa o pool da
 * aplicação (uma conexão em produção), e o que se quer medir é o TETO do
 * banco quando muitas instâncias leem ao mesmo tempo.
 *
 * Se `checkin.ts` mudar, este trecho precisa mudar junto — e o teste de
 * integração continua sendo a fonte de verdade sobre o comportamento.
 */
async function lerUmQr(tokenHash: string): Promise<boolean> {
  return app.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    const linhas = (await tx.execute(sql`
      with passou as (
        update tickets
           set status = 'usado', dentro = true,
               checked_in_em = coalesce(checked_in_em, now()),
               ultima_entrada_em = now(),
               entradas_count = entradas_count + 1,
               atualizado_em = now()
         where token_hash = ${tokenHash} and event_id = ${eventId} and status = 'valido'
        returning id, ticket_type_id, ultima_entrada_em
      ),
      anotado as (
        insert into ticket_movimentos (tenant_id, event_id, ticket_id, tipo, em, origem)
        select ${tenantId}, ${eventId}, id, 'entrada', ultima_entrada_em, 'online'
          from passou
        on conflict do nothing
      )
      select p.id, tt.nome as lote
        from passou p join ticket_types tt on tt.id = p.ticket_type_id
    `)) as unknown as { id: string }[];

    return linhas.length > 0;
  });
}

const hashDe = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

async function medirCheckin() {
  console.log('\n2. Check-in online, uma leitura por vez (o custo real de cada pessoa)');

  const ctx: ContextoPortaria = {
    tenantId,
    eventId,
    userId,
    politica: { controlaSaida: true, permiteReentrada: true },
    nominal: false,
  };

  const ms: number[] = [];
  for (let i = 0; i < 20; i++) {
    // A função de verdade: verifica a assinatura do QR e passa pelo app inteiro.
    const [, t] = await cronometrar(() => validarIngresso(tokens[i]!, ctx, { atual: SEGREDO! }));
    ms.push(t);
  }
  console.log(
    `    p50 ${percentil(ms, 50)} ms · p95 ${percentil(ms, 95)} ms · ` +
      `teto de ${Math.round(1000 / percentil(ms, 50))} leituras/s por conexão`,
  );

  console.log(`\n3. Check-in com ${CONCORRENTES} portões lendo ao mesmo tempo`);

  const usados = tokens.slice(20, 20 + CONCORRENTES);
  const tempos: number[] = [];
  const inicio = performance.now();

  const resultados = await Promise.all(
    usados.map(async (token) => {
      const [ok, t] = await cronometrar(() => lerUmQr(hashDe(token)));
      tempos.push(t);
      return ok;
    }),
  );

  const duracao = performance.now() - inicio;
  relatar(
    'leituras simultâneas',
    tempos,
    resultados.filter(Boolean).length,
    usados.length,
    duracao,
  );
}

// ---------------------------------------------------------------------------
// 3. Compra
// ---------------------------------------------------------------------------

async function medirCompra() {
  console.log(
    `\n4. Abertura de vendas: ${COMPRADORES} compras simultâneas disputando ${LOTE_COMPRA} ingressos`,
  );

  // Pedidos criados antes: a corrida tem que ser pelo ESTOQUE, não pelo insert.
  const pedidos: string[] = [];
  for (let i = 0; i < COMPRADORES; i += 100) {
    const fatia = Array.from({ length: Math.min(100, COMPRADORES - i) }, (_, j) => ({
      tenantId,
      eventId,
      numero: 1000 + i + j,
      compradorNome: `Comprador ${i + j}`,
      compradorEmail: `c${i + j}@bench.local`,
      compradorCpf: String(50000000000 + i + j).slice(0, 11),
      subtotalCentavos: 5000,
      convenienciaCentavos: 500,
      totalCentavos: 5500,
      valorProdutorCentavos: 4675,
      valorOperadorCentavos: 825,
      taxaConvenienciaBpsSnapshot: 1000,
      comissaoBpsSnapshot: 500,
      status: 'draft' as const,
      idempotencyKey: `bench_${sufixo}_c${i + j}`,
    }));
    const criados = await dono.insert(schema.orders).values(fatia).returning({ id: schema.orders.id });
    pedidos.push(...criados.map((c) => c.id));
  }

  const tempos: number[] = [];
  const inicio = performance.now();

  const resultados = await Promise.allSettled(
    pedidos.map(async (pedidoId) => {
      const [r, t] = await cronometrar(() =>
        app.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
          return reservarEstoque(tx, {
            tenantId,
            orderId: pedidoId,
            itens: [{ ticketTypeId: loteCompraId, quantidade: 1 }],
            ttlSegundos: 600,
          });
        }),
      );
      tempos.push(t);
      return r;
    }),
  );

  const duracao = performance.now() - inicio;
  const ok = resultados.filter(
    (r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok,
  ).length;
  const erros = resultados.filter((r) => r.status === 'rejected').length;

  relatar('reservas', tempos, ok, pedidos.length, duracao);
  console.log(
    `    vendidos: ${ok} (esperado: exatamente ${LOTE_COMPRA}) · ` +
      `recusados por estoque: ${pedidos.length - ok - erros} · falhas de conexão: ${erros}`,
  );

  if (ok !== LOTE_COMPRA) {
    console.log(`    ATENÇÃO: vendeu ${ok} para um lote de ${LOTE_COMPRA}.`);
  }
}


// ---------------------------------------------------------------------------
// Portaria offline — o caminho que a porta usa de verdade
// ---------------------------------------------------------------------------

/**
 * Mede o que o celular faz ao ler um QR sem rede: calcular o SHA-256 do token
 * e procurar no índice do manifesto. É o caminho que sustenta a porta de um
 * festival, porque não toca no banco nem uma vez.
 *
 * O `crypto.subtle` do navegador e o `createHash` do Node usam a mesma
 * primitiva; a diferença de velocidade entre um celular e esta máquina é de
 * ordem de grandeza, não de natureza — e mesmo dez vezes mais lento continua
 * sendo tempo que ninguém percebe.
 */
async function medirOffline() {
  console.log('\n5. Portaria SEM REDE: validação no próprio aparelho');

  const linhas = (await dono.execute(sql`
    select token_hash, codigo, titular_nome from tickets where event_id = ${eventId}
  `)) as unknown as { token_hash: string; codigo: string; titular_nome: string }[];

  const indice = new Map(linhas.map((l) => [l.token_hash, l]));

  const amostra = tokens.slice(0, Math.min(tokens.length, 200));
  const repeticoes = 50;

  const inicio = performance.now();
  let achados = 0;
  for (let r = 0; r < repeticoes; r++) {
    for (const token of amostra) {
      const h = createHash('sha256').update(token, 'utf8').digest('hex');
      if (indice.get(h)) achados++;
    }
  }
  const duracao = performance.now() - inicio;
  const leituras = amostra.length * repeticoes;

  console.log(`    índice com ${indice.size} ingressos · ${achados}/${leituras} encontrados`);
  console.log(
    `    ${((duracao / leituras) * 1000).toFixed(0)} µs por leitura · ` +
      `${Math.round(leituras / (duracao / 1000)).toLocaleString('pt-BR')} leituras/s`,
  );
  console.log('    não toca no banco: a porta não depende da rede da casa');
}

async function medirSync(quantos: number) {
  console.log(`\n6. Subida da fila offline: ${quantos} passagens de uma vez`);

  const usados = tokens.slice(0, Math.min(quantos, tokens.length));
  const fila = usados.map((token, i) => ({
    tokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
    tipo: 'entrada' as const,
    em: new Date(Date.now() - 3_600_000 + i * 1000).toISOString(),
  }));

  const [resumo, ms] = await cronometrar(() =>
    sincronizarMovimentos({ tenantId, eventId, userId }, fila),
  );

  console.log(
    `    ${resumo.processadas} gravadas · ${Math.round(ms)} ms no total · ` +
      `${(ms / Math.max(1, fila.length)).toFixed(1)} ms por passagem`,
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const inicio = performance.now();
  try {
    await montar();
    await medirManifesto();
    await medirCheckin();
    await medirCompra();
    await medirOffline();
    await medirSync(300);
    console.log(`\nTotal: ${Math.round((performance.now() - inicio) / 1000)} s`);
  } finally {
    await desmontar();
    await donoSql.end();
    await appSql.end();
  }
}

void main();
