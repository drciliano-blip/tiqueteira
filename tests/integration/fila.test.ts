/**
 * Fila virtual contra o banco.
 *
 * O que esta suíte protege é a promessa da fila: **a ordem de chegada vale**.
 * Uma fila que embaralha é pior que fila nenhuma — a pessoa aceita esperar,
 * não aceita ver alguém que chegou depois passar na frente. Por isso os
 * testes de concorrência aqui checam número distinto e ordem preservada, não
 * só "não deu erro".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  avancarFila,
  consultarFila,
  consumirVez,
  entrarNaFila,
  temVez,
} from '@/lib/fila';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const donoSql = postgres(DIRECT_URL, { max: 3, prepare: false });
const dono = drizzle(donoSql);

let tenantId: string;
let venueId: string;
let sufixo: string;

async function criarEvento(opcoes: {
  ativa?: boolean;
  capacidade?: number;
  janelaMinutos?: number;
}): Promise<string> {
  const linhas = (await dono.execute(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status, fila_ativa, fila_capacidade, fila_janela_minutos)
    values (${tenantId}, ${venueId},
            ${'fila-' + sufixo + '-' + Math.random().toString(36).slice(2, 8)},
            'Evento com Fila', now() + interval '5 days', now() + interval '5 days 6 hours',
            10000, 'publicado', ${opcoes.ativa ?? true}, ${opcoes.capacidade ?? 2},
            ${opcoes.janelaMinutos ?? 10})
    returning id
  `)) as unknown as { id: string }[];
  return linhas[0]!.id;
}

/** A fila só anda a cada poucos segundos. Nos testes, empurramos o relógio. */
async function liberarAvanco(eventId: string) {
  await dono.execute(sql`
    update events set fila_avancada_em = now() - interval '1 hour' where id = ${eventId}
  `);
}

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  const t = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'fila-' + sufixo}, 'Casa da Fila', ${'fila-' + sufixo + '@teste.local'})
    returning id
  `)) as unknown as { id: string }[];
  tenantId = t[0]!.id;

  const v = (await dono.execute(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Arena', 10000) returning id
  `)) as unknown as { id: string }[];
  venueId = v[0]!.id;
});

afterAll(async () => {
  await dono.execute(sql`delete from fila_virtual where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from events  where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from venues  where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tenants where id = ${tenantId}`);
  await donoSql.end();
});

// ---------------------------------------------------------------------------

describe('entrar na fila', () => {
  it('distribui números em ordem de chegada', async () => {
    const eventId = await criarEvento({ capacidade: 1 });

    const primeiro = await entrarNaFila(eventId, tenantId);
    const segundo = await entrarNaFila(eventId, tenantId);
    const terceiro = await entrarNaFila(eventId, tenantId);

    expect(primeiro?.numero).toBe(1);
    expect(segundo?.numero).toBe(2);
    expect(terceiro?.numero).toBe(3);
  });

  it('cinquenta chegadas simultâneas recebem cinquenta números distintos', async () => {
    /**
     * O teste que dá sentido à fila. Se dois recebessem o mesmo número, dois
     * ocupariam a mesma vaga — e a fila que existe para dar previsibilidade
     * viraria a fonte da confusão.
     */
    const eventId = await criarEvento({ capacidade: 5 });

    const lugares = await Promise.all(
      Array.from({ length: 50 }, () => entrarNaFila(eventId, tenantId)),
    );

    const numeros = lugares.map((l) => l?.numero).filter((n): n is number => n !== undefined);
    expect(numeros).toHaveLength(50);
    expect(new Set(numeros).size).toBe(50);
    expect(Math.min(...numeros)).toBe(1);
    expect(Math.max(...numeros)).toBe(50);
  });

  it('não distribui número quando a fila está desligada', async () => {
    const eventId = await criarEvento({ ativa: false });
    expect(await entrarNaFila(eventId, tenantId)).toBeNull();
  });
});

describe('andar da fila', () => {
  it('chama até a capacidade e deixa o resto esperando', async () => {
    const eventId = await criarEvento({ capacidade: 2 });

    const a = await entrarNaFila(eventId, tenantId);
    const b = await entrarNaFila(eventId, tenantId);
    const c = await entrarNaFila(eventId, tenantId);

    await liberarAvanco(eventId);
    await avancarFila(eventId);

    expect(await temVez(eventId, a!.token)).toBe(true);
    expect(await temVez(eventId, b!.token)).toBe(true);
    expect(await temVez(eventId, c!.token)).toBe(false);
  });

  it('quem espera sabe quantos tem na frente', async () => {
    const eventId = await criarEvento({ capacidade: 2 });

    await entrarNaFila(eventId, tenantId);
    await entrarNaFila(eventId, tenantId);
    const terceiro = await entrarNaFila(eventId, tenantId);
    const quarto = await entrarNaFila(eventId, tenantId);

    await liberarAvanco(eventId);

    const consulta = await consultarFila(eventId, quarto!.token);
    expect(consulta.situacao).toBe('aguardando');
    if (consulta.situacao !== 'aguardando') throw new Error('inesperado');

    // Chamados até 2; o quarto tem o terceiro na frente.
    expect(consulta.numero).toBe(4);
    expect(consulta.pessoasNaFrente).toBe(1);
    expect(consulta.proximaConsultaSegundos).toBeGreaterThan(0);
    expect(terceiro!.numero).toBe(3);
  });

  it('a vaga de quem some volta para a fila', async () => {
    /**
     * A janela precisa expirar de verdade. Sem isso a vaga fica presa a quem
     * fechou a aba, e a fila para de andar para todo mundo — que é o pior
     * defeito possível numa fila.
     */
    const eventId = await criarEvento({ capacidade: 1 });

    const primeiro = await entrarNaFila(eventId, tenantId);
    const segundo = await entrarNaFila(eventId, tenantId);

    await liberarAvanco(eventId);
    await avancarFila(eventId);
    expect(await temVez(eventId, primeiro!.token)).toBe(true);
    expect(await temVez(eventId, segundo!.token)).toBe(false);

    // O primeiro abandonou a compra.
    await dono.execute(sql`
      update fila_virtual set expira_em = now() - interval '1 minute'
       where event_id = ${eventId} and numero = 1
    `);

    await liberarAvanco(eventId);
    await avancarFila(eventId);

    expect(await temVez(eventId, segundo!.token)).toBe(true);
    // E quem perdeu a janela realmente perdeu.
    expect(await temVez(eventId, primeiro!.token)).toBe(false);
  });

  it('não chama além de quem chegou', async () => {
    // Se a marca d'água passasse do último número, quem entrasse depois já
    // entraria admitido — passando na frente de todo mundo que esperou.
    const eventId = await criarEvento({ capacidade: 100 });

    const so = await entrarNaFila(eventId, tenantId);
    await liberarAvanco(eventId);
    await avancarFila(eventId);

    const atrasado = await entrarNaFila(eventId, tenantId);

    expect(await temVez(eventId, so!.token)).toBe(true);
    expect(await temVez(eventId, atrasado!.token)).toBe(false);
  });
});

describe('a vez', () => {
  it('morre no uso', async () => {
    /**
     * Sem isto, quem foi chamado uma vez compraria a noite inteira sem voltar
     * para a fila — que é precisamente o cambista com script que a fila
     * existe para atrapalhar.
     */
    const eventId = await criarEvento({ capacidade: 5 });

    const pessoa = await entrarNaFila(eventId, tenantId);
    await liberarAvanco(eventId);
    await avancarFila(eventId);

    expect(await temVez(eventId, pessoa!.token)).toBe(true);

    await consumirVez(eventId, tenantId, pessoa!.token);

    expect(await temVez(eventId, pessoa!.token)).toBe(false);
  });

  it('a vez de um evento não vale no outro', async () => {
    const eventoA = await criarEvento({ capacidade: 5 });
    const eventoB = await criarEvento({ capacidade: 5 });

    const pessoa = await entrarNaFila(eventoA, tenantId);
    await liberarAvanco(eventoA);
    await avancarFila(eventoA);

    expect(await temVez(eventoA, pessoa!.token)).toBe(true);
    expect(await temVez(eventoB, pessoa!.token)).toBe(false);
  });

  it('sem fila ligada, todo mundo tem vez', async () => {
    // Evento pequeno não paga o preço de uma peça que existe para festival.
    const eventId = await criarEvento({ ativa: false });
    expect(await temVez(eventId, undefined)).toBe(true);
  });

  it('com fila ligada, quem não pegou senha não passa', async () => {
    const eventId = await criarEvento({ capacidade: 5 });
    expect(await temVez(eventId, undefined)).toBe(false);
    expect(await temVez(eventId, 'token-inventado')).toBe(false);
  });
});

describe('consulta', () => {
  it('diz que não há fila quando ela está desligada', async () => {
    const eventId = await criarEvento({ ativa: false });
    expect(await consultarFila(eventId, undefined)).toEqual({ situacao: 'sem_fila' });
  });

  it('manda pegar senha quem não tem', async () => {
    const eventId = await criarEvento({ capacidade: 5 });
    expect(await consultarFila(eventId, undefined)).toEqual({ situacao: 'sem_lugar' });
  });

  it('pergunta com mais calma quando a fila é grande', async () => {
    const eventId = await criarEvento({ capacidade: 1 });

    const lugares = [];
    for (let i = 0; i < 30; i++) lugares.push(await entrarNaFila(eventId, tenantId));

    await liberarAvanco(eventId);
    const ultimo = await consultarFila(eventId, lugares[29]!.token);

    if (ultimo.situacao !== 'aguardando') throw new Error('inesperado');
    expect(ultimo.pessoasNaFrente).toBe(28);
    expect(ultimo.proximaConsultaSegundos).toBeGreaterThanOrEqual(8);
  });
});
