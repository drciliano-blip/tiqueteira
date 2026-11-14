/**
 * Solicitações do comprador — ADR-023.
 *
 * O comprador relata, o produtor decide, os dois são avisados. O que se
 * confere aqui é a parte que não pode falhar: só o dono do pedido abre, uma
 * aberta por vez, resposta obrigatória na recusa, e produtor não vê a caixa
 * do outro.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';
import { avisarSolicitacao } from '@/jobs/avisar-solicitacao';
import {
  abrirSolicitacao,
  marcarSolicitacaoDevolvida,
  recusarSolicitacao,
  solicitacoesDoProdutor,
} from '@/lib/solicitacoes';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const conexao = postgres(DIRECT_URL, { max: 3, prepare: false });
const db = drizzle(conexao, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
type Linha = Record<string, unknown>;
const linhas = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Linha[];

const sufixo = Date.now().toString(36);
const EMAIL = `comprador.${sufixo}@teste.local`;
const RELATO = 'A atração principal não se apresentou e o show acabou cedo.';
let tenantId: string;
let outroTenant: string;
let eventId: string;
let numero = 0;

beforeAll(async () => {
  const [t] = await linhas(sql`
    insert into tenants (slug, nome, email) values (${`sol-${sufixo}`}, 'Casa', 'casa@t.local') returning id
  `);
  tenantId = t!.id as string;
  const [o] = await linhas(sql`
    insert into tenants (slug, nome, email) values (${`sol2-${sufixo}`}, 'Outra', 'outra@t.local') returning id
  `);
  outroTenant = o!.id as string;
  const [v] = await linhas(sql`
    insert into venues (tenant_id, nome, capacidade_maxima) values (${tenantId}, 'Casa', 100) returning id
  `);
  const [e] = await linhas(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim, capacidade, status)
    values (${tenantId}, ${v!.id as string}, ${`ev-sol-${sufixo}`}, 'Show', now() - interval '2 days',
            now() - interval '2 days' + interval '4 hours', 100, 'encerrado')
    returning id
  `);
  eventId = e!.id as string;
});

afterAll(async () => {
  await conexao.end();
});

async function pedido(status = 'paid'): Promise<string> {
  numero += 1;
  const [o] = await linhas(sql`
    insert into orders
      (tenant_id, event_id, numero, comprador_nome, comprador_email, comprador_cpf,
       subtotal_centavos, total_centavos, valor_produtor_centavos, valor_operador_centavos,
       taxa_conveniencia_bps_snapshot, comissao_bps_snapshot, status, idempotency_key, metodo, pago_em)
    values (${tenantId}, ${eventId}, ${numero}, 'Comprador', ${EMAIL.toUpperCase()}, '52998224725',
            10000, 10000, 10000, 0, 0, 0, ${status}::order_status, ${`sol_${sufixo}_${numero}`}, 'pix', now())
    returning id
  `);
  return o!.id as string;
}

describe('solicitações do comprador', () => {
  it('o dono do pedido abre; o produtor é avisado pela fila', async () => {
    const orderId = await pedido();
    const r = await abrirSolicitacao({ email: EMAIL, orderId, tipo: 'servico_diferente_do_ofertado', relato: RELATO });
    expect(r.ok).toBe(true);

    const fila = await linhas(sql`
      select payload from jobs where nome = 'avisar-solicitacao'
         and dedupe_key = ${`solicitacao-aberta:${(r as { id: string }).id}`}
    `);
    expect(fila).toHaveLength(1);
    expect(await avisarSolicitacao({ solicitacaoId: (r as { id: string }).id, evento: 'aberta' }, 'http://x'))
      .toMatch(/produtor/);
  });

  it('outro e-mail não abre solicitação no pedido de ninguém', async () => {
    const orderId = await pedido();
    const r = await abrirSolicitacao({ email: 'intruso@t.local', orderId, tipo: 'evento_nao_realizado', relato: RELATO });
    expect(r).toEqual({ ok: false, erro: 'Pedido não encontrado.' });
  });

  it('uma aberta por vez, relato obrigatório, motivo da lista', async () => {
    const orderId = await pedido();
    expect((await abrirSolicitacao({ email: EMAIL, orderId, tipo: 'evento_nao_realizado', relato: 'curto' })).ok).toBe(false);
    expect((await abrirSolicitacao({ email: EMAIL, orderId, tipo: 'xyz', relato: RELATO })).ok).toBe(false);
    expect((await abrirSolicitacao({ email: EMAIL, orderId, tipo: 'evento_nao_realizado', relato: RELATO })).ok).toBe(true);
    const segunda = await abrirSolicitacao({ email: EMAIL, orderId, tipo: 'evento_nao_realizado', relato: RELATO });
    expect(segunda).toMatchObject({ ok: false });
  });

  it('pedido já devolvido não aceita solicitação', async () => {
    const orderId = await pedido('refunded');
    const r = await abrirSolicitacao({ email: EMAIL, orderId, tipo: 'evento_nao_realizado', relato: RELATO });
    expect(r.ok).toBe(false);
  });

  it('recusa exige resposta, fecha a solicitação e avisa o comprador', async () => {
    const orderId = await pedido();
    const aberta = (await abrirSolicitacao({ email: EMAIL, orderId, tipo: 'reclamacao_procedente', relato: RELATO })) as { id: string };

    expect((await recusarSolicitacao({ tenantId, solicitacaoId: aberta.id, resposta: 'não', userId: null })).ok).toBe(false);
    const r = await recusarSolicitacao({
      tenantId,
      solicitacaoId: aberta.id,
      resposta: 'O show durou o tempo anunciado, conforme o contrato do artista.',
      userId: null,
    });
    expect(r.ok).toBe(true);
    expect((await recusarSolicitacao({ tenantId, solicitacaoId: aberta.id, resposta: 'De novo, outra resposta longa.', userId: null })).ok).toBe(false);

    expect(await avisarSolicitacao({ solicitacaoId: aberta.id, evento: 'respondida' }, 'http://x')).toMatch(/comprador/);
  });

  it('devolução feita pelo produtor fecha a solicitação aberta', async () => {
    const orderId = await pedido();
    const aberta = (await abrirSolicitacao({ email: EMAIL, orderId, tipo: 'evento_nao_realizado', relato: RELATO })) as { id: string };
    const [rf] = await linhas(sql`
      insert into refunds (tenant_id, order_id, motivo, valor_centavos, status, idempotency_key)
      values (${tenantId}, ${orderId}, 'event_canceled', 10000, 'succeeded', ${`rf_sol_${sufixo}_${numero}`}) returning id
    `);
    await marcarSolicitacaoDevolvida({ tenantId, orderId, refundId: rf!.id as string, userId: null, resposta: RELATO });

    const [s] = await linhas(sql`select status, refund_id from solicitacoes where id = ${aberta.id}`);
    expect(s).toMatchObject({ status: 'devolvida', refund_id: rf!.id });
  });

  it('produtor só vê a própria caixa', async () => {
    expect((await solicitacoesDoProdutor(tenantId)).length).toBeGreaterThan(0);
    expect(await solicitacoesDoProdutor(outroTenant)).toEqual([]);
  });
});
