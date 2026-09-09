/**
 * A porta contra o banco de verdade — plano, seções 12 e 24, e ADR-011.
 *
 * O teste que dá sentido a esta suíte é o das leituras simultâneas do mesmo
 * QR. Ele é a razão de a passagem ser um `UPDATE` condicional e não um
 * `SELECT` seguido de `UPDATE`: com leitura prévia, dois seguranças em
 * portões diferentes liberam a mesma pessoa duas vezes, e o furo só aparece
 * na noite em que a casa lota.
 *
 * O resto da suíte existe porque o controle de saída criou uma porta nova
 * para a mesma fraude: se "sair" pudesse ser lido de quem nunca entrou, ou se
 * "voltar" não checasse que a pessoa está fora, bastaria alternar as leituras
 * para o mesmo ingresso servir a duas pessoas a noite inteira.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  contarPresentes,
  liberarPorId,
  validarIngresso,
  type ContextoPortaria,
} from '@/lib/checkin';
import { emitirTicket } from '@/lib/tickets';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const donoSql = postgres(DIRECT_URL, { max: 2, prepare: false });
const dono = drizzle(donoSql);

const SEGREDO = 'segredo-de-teste-da-portaria-0123456789';
const segredos = { atual: SEGREDO };

let tenantId: string;
let venueId: string;
let userId: string;
let orderId: string;
let tipoId: string;
let sufixo: string;

/** Um evento por cenário: a política é do evento, não da leitura. */
async function criarEvento(politica: {
  controlaSaida: boolean;
  permiteReentrada: boolean;
}): Promise<string> {
  const linhas = (await dono.execute(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status, ingresso_nominal,
                        controla_saida, permite_reentrada)
    values (${tenantId}, ${venueId}, ${'ev-' + sufixo + '-' + Math.random().toString(36).slice(2, 8)},
            'Evento da Porta', now() + interval '1 day', now() + interval '1 day 6 hours',
            1000, 'publicado', false,
            ${politica.controlaSaida}, ${politica.permiteReentrada})
    returning id
  `)) as unknown as { id: string }[];
  return linhas[0]!.id;
}

async function criarIngresso(
  eventId: string,
  nome = 'Marina Costa',
): Promise<{ id: string; token: string }> {
  const emitido = emitirTicket(SEGREDO);

  const linhas = (await dono.execute(sql`
    insert into tickets (tenant_id, order_id, ticket_type_id, event_id, codigo,
                         token_hash, titular_nome, status)
    values (${tenantId}, ${orderId}, ${tipoId}, ${eventId}, ${emitido.codigo},
            ${emitido.tokenHash}, ${nome}, 'valido')
    returning id
  `)) as unknown as { id: string }[];

  return { id: linhas[0]!.id, token: emitido.token };
}

function contexto(
  eventId: string,
  politica: { controlaSaida: boolean; permiteReentrada: boolean },
): ContextoPortaria {
  return { tenantId, eventId, userId, politica, nominal: false, deviceId: 'teste' };
}

async function estadoDe(ticketId: string) {
  const linhas = (await dono.execute(sql`
    select status, dentro, entradas_count, ultima_entrada_em, ultima_saida_em
      from tickets where id = ${ticketId}
  `)) as unknown as {
    status: string;
    dentro: boolean;
    entradas_count: number;
    ultima_entrada_em: Date | null;
    ultima_saida_em: Date | null;
  }[];
  return linhas[0]!;
}

async function movimentosDe(ticketId: string): Promise<string[]> {
  const linhas = (await dono.execute(sql`
    select tipo from ticket_movimentos where ticket_id = ${ticketId} order by em, criado_em
  `)) as unknown as { tipo: string }[];
  return linhas.map((l) => l.tipo);
}

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  const t = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'porta-' + sufixo}, 'Porta Teste', 'porta@teste.local')
    returning id
  `)) as unknown as { id: string }[];
  tenantId = t[0]!.id;

  const u = (await dono.execute(sql`
    insert into users (nome, email, senha_hash)
    values ('Segurança Teste', ${'porta-' + sufixo + '@teste.local'}, 'x')
    returning id
  `)) as unknown as { id: string }[];
  userId = u[0]!.id;

  const v = (await dono.execute(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Espaço Teste', 1000) returning id
  `)) as unknown as { id: string }[];
  venueId = v[0]!.id;

  // Um evento âncora só para pendurar o lote e o pedido dos ingressos.
  const ancora = await criarEvento({ controlaSaida: false, permiteReentrada: false });

  const tt = (await dono.execute(sql`
    insert into ticket_types (tenant_id, event_id, nome, preco_centavos, quantidade_total,
                              vendas_inicio, vendas_fim)
    values (${tenantId}, ${ancora}, 'Pista', 10000, 1000,
            now() - interval '1 day', now() + interval '30 days')
    returning id
  `)) as unknown as { id: string }[];
  tipoId = tt[0]!.id;

  const o = (await dono.execute(sql`
    insert into orders (tenant_id, event_id, numero, comprador_nome, comprador_email,
                        comprador_cpf, subtotal_centavos, conveniencia_centavos,
                        total_centavos, valor_produtor_centavos, valor_operador_centavos,
                        taxa_conveniencia_bps_snapshot, comissao_bps_snapshot,
                        status, idempotency_key)
    values (${tenantId}, ${ancora}, 1, 'Comprador Teste', 'compra@teste.local',
            '12345678901', 10000, 1000, 11000, 9350, 1650, 1000, 500,
            'paid', ${'porta_' + sufixo})
    returning id
  `)) as unknown as { id: string }[];
  orderId = o[0]!.id;
});

afterAll(async () => {
  await dono.execute(sql`delete from ticket_movimentos where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tickets       where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from orders        where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from ticket_types  where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from events        where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from venues        where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tenants       where id        = ${tenantId}`);
  await dono.execute(sql`delete from users         where id        = ${userId}`);
  await donoSql.end();
});

// ---------------------------------------------------------------------------

describe('entrada sob concorrência', () => {
  it('oito leituras simultâneas do mesmo QR → uma entrada só', async () => {
    const eventId = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const ctx = contexto(eventId, { controlaSaida: true, permiteReentrada: true });
    const ingresso = await criarIngresso(eventId);

    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => validarIngresso(ingresso.token, ctx, segredos)),
    );

    const liberados = resultados.filter((r) => r.situacao === 'liberado');
    expect(liberados).toHaveLength(1);

    // As outras sete precisam explicar, não só recusar.
    for (const r of resultados.filter((x) => x.situacao !== 'liberado')) {
      expect(r.situacao).toBe('recusado');
      if (r.situacao === 'recusado') expect(r.explicacao.length).toBeGreaterThan(10);
    }

    const estado = await estadoDe(ingresso.id);
    expect(estado.entradas_count).toBe(1);
    expect(estado.dentro).toBe(true);
    expect(await movimentosDe(ingresso.id)).toEqual(['entrada']);
  });

  it('saída e volta simultâneas não duplicam a pessoa', async () => {
    const eventId = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const ctx = contexto(eventId, { controlaSaida: true, permiteReentrada: true });
    const ingresso = await criarIngresso(eventId);

    await validarIngresso(ingresso.token, ctx, segredos, 'entrada');

    // Seis leituras de saída ao mesmo tempo: só uma pode valer.
    const saidas = await Promise.all(
      Array.from({ length: 6 }, () => validarIngresso(ingresso.token, ctx, segredos, 'saida')),
    );
    expect(saidas.filter((r) => r.situacao === 'saida')).toHaveLength(1);

    const depois = await estadoDe(ingresso.id);
    expect(depois.dentro).toBe(false);
    expect(depois.entradas_count).toBe(1);
  });
});

describe('reentrada', () => {
  it('quem saiu volta, e o histórico guarda os dois sentidos', async () => {
    const eventId = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const ctx = contexto(eventId, { controlaSaida: true, permiteReentrada: true });
    const ingresso = await criarIngresso(eventId);

    const entrou = await validarIngresso(ingresso.token, ctx, segredos, 'entrada');
    expect(entrou.situacao).toBe('liberado');
    if (entrou.situacao === 'liberado') expect(entrou.reentrada).toBe(false);

    expect((await validarIngresso(ingresso.token, ctx, segredos, 'saida')).situacao).toBe('saida');

    const voltou = await validarIngresso(ingresso.token, ctx, segredos, 'entrada');
    expect(voltou.situacao).toBe('liberado');
    if (voltou.situacao === 'liberado') expect(voltou.reentrada).toBe(true);

    const estado = await estadoDe(ingresso.id);
    expect(estado.entradas_count).toBe(2);
    expect(estado.dentro).toBe(true);
    expect(await movimentosDe(ingresso.id)).toEqual(['entrada', 'saida', 'entrada']);
  });

  it('com saída definitiva, quem saiu não volta', async () => {
    const eventId = await criarEvento({ controlaSaida: true, permiteReentrada: false });
    const ctx = contexto(eventId, { controlaSaida: true, permiteReentrada: false });
    const ingresso = await criarIngresso(eventId);

    await validarIngresso(ingresso.token, ctx, segredos, 'entrada');
    await validarIngresso(ingresso.token, ctx, segredos, 'saida');

    const volta = await validarIngresso(ingresso.token, ctx, segredos, 'entrada');
    expect(volta.situacao).toBe('recusado');
    if (volta.situacao === 'recusado') {
      expect(volta.motivo).toBe('reentrada_bloqueada');
      // A frase precisa dizer a hora da saída: é o que encerra a discussão.
      expect(volta.explicacao).toMatch(/\d{2}h\d{2}/);
    }

    expect((await estadoDe(ingresso.id)).entradas_count).toBe(1);
  });

  it('sem controle de saída, o evento se comporta como antes', async () => {
    const eventId = await criarEvento({ controlaSaida: false, permiteReentrada: true });
    const ctx = contexto(eventId, { controlaSaida: false, permiteReentrada: true });
    const ingresso = await criarIngresso(eventId);

    expect((await validarIngresso(ingresso.token, ctx, segredos)).situacao).toBe('liberado');

    const saida = await validarIngresso(ingresso.token, ctx, segredos, 'saida');
    expect(saida.situacao).toBe('recusado');
    if (saida.situacao === 'recusado') expect(saida.motivo).toBe('saida_nao_controlada');

    const denovo = await validarIngresso(ingresso.token, ctx, segredos);
    expect(denovo.situacao).toBe('recusado');
    if (denovo.situacao === 'recusado') expect(denovo.motivo).toBe('ja_entrou');
  });
});

describe('recusas que a porta precisa explicar', () => {
  it('saída de quem nunca entrou', async () => {
    const eventId = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const ctx = contexto(eventId, { controlaSaida: true, permiteReentrada: true });
    const ingresso = await criarIngresso(eventId);

    const r = await validarIngresso(ingresso.token, ctx, segredos, 'saida');
    expect(r.situacao).toBe('recusado');
    if (r.situacao === 'recusado') expect(r.motivo).toBe('nao_esta_dentro');
    expect(await movimentosDe(ingresso.id)).toEqual([]);
  });

  it('QR de outro evento', async () => {
    const casa = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const outra = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const ingresso = await criarIngresso(outra);

    const r = await validarIngresso(
      ingresso.token,
      contexto(casa, { controlaSaida: true, permiteReentrada: true }),
      segredos,
    );
    expect(r.situacao).toBe('outro_evento');
  });

  it('QR assinado com outro segredo', async () => {
    const eventId = await criarEvento({ controlaSaida: false, permiteReentrada: false });
    const forjado = emitirTicket('outro-segredo-qualquer-para-forjar-000');

    const r = await validarIngresso(
      forjado.token,
      contexto(eventId, { controlaSaida: false, permiteReentrada: false }),
      segredos,
    );
    expect(r.situacao).toBe('invalido');
    if (r.situacao === 'invalido') expect(r.motivo).toBe('assinatura');
  });

  it('cancelado durante a festa ainda consegue sair', async () => {
    // Reembolso ou chargeback às 23h não podem prender ninguém lá dentro.
    const eventId = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const ctx = contexto(eventId, { controlaSaida: true, permiteReentrada: true });
    const ingresso = await criarIngresso(eventId);

    await validarIngresso(ingresso.token, ctx, segredos, 'entrada');
    await dono.execute(sql`
      update tickets set status = 'cancelado', cancelado_em = now(),
             cancelado_motivo = 'refunded'
       where id = ${ingresso.id}
    `);

    const saiu = await validarIngresso(ingresso.token, ctx, segredos, 'saida');
    expect(saiu.situacao).toBe('saida');

    const volta = await validarIngresso(ingresso.token, ctx, segredos, 'entrada');
    expect(volta.situacao).toBe('recusado');
    if (volta.situacao === 'recusado') expect(volta.motivo).toBe('cancelado');
  });
});

describe('contador da casa', () => {
  it('conta quem está dentro, não quem já passou', async () => {
    const eventId = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const ctx = contexto(eventId, { controlaSaida: true, permiteReentrada: true });

    const pessoas = [];
    for (let i = 0; i < 5; i++) pessoas.push(await criarIngresso(eventId, `Pessoa ${i}`));

    for (const p of pessoas) await validarIngresso(p.token, ctx, segredos, 'entrada');
    await validarIngresso(pessoas[0]!.token, ctx, segredos, 'saida');
    await validarIngresso(pessoas[1]!.token, ctx, segredos, 'saida');

    expect(await contarPresentes(tenantId, eventId)).toEqual({
      emitidos: 5,
      entraram: 5,
      dentro: 3,
      sairam: 2,
    });
  });

  it('a liberação manual pela busca também registra o movimento', async () => {
    const eventId = await criarEvento({ controlaSaida: true, permiteReentrada: true });
    const ctx = contexto(eventId, { controlaSaida: true, permiteReentrada: true });
    const ingresso = await criarIngresso(eventId);

    expect((await liberarPorId(ingresso.id, ctx, 'entrada')).situacao).toBe('liberado');
    expect((await liberarPorId(ingresso.id, ctx, 'saida')).situacao).toBe('saida');
    expect(await movimentosDe(ingresso.id)).toEqual(['entrada', 'saida']);
  });
});
