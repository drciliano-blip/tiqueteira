/**
 * Área administrativa — ADR-025. Toda escrita deixa rastro no audit_log.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';
import {
  alterarKyc,
  alterarTaxas,
  buscarPedidos,
  cancelarRepasse,
  reabrirRepasse,
  visaoGeral,
} from '@/lib/admin';
import type { AuthContext } from '@/lib/auth';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');
const conexao = postgres(DIRECT_URL, { max: 3, prepare: false });
const db = drizzle(conexao, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
type Linha = Record<string, unknown>;
const linhas = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Linha[];

const sufixo = Date.now().toString(36);
let auth: AuthContext;
let tenantId: string;
let eventId: string;

beforeAll(async () => {
  const [u] = await linhas(sql`
    insert into users (email, nome, admin_plataforma) values (${`adm-${sufixo}@t.local`}, 'Adm', true) returning id
  `);
  auth = {
    userId: u!.id as string, nome: 'Adm', email: 'adm', sessionId: 's', tenantId: null,
    scopeEventId: null, expiraEm: new Date(), papeis: [], adminPlataforma: true,
  };
  const [t] = await linhas(sql`insert into tenants (slug, nome, email) values (${`adm-${sufixo}`}, 'Casa Adm', 'a@t.local') returning id`);
  tenantId = t!.id as string;
  const [v] = await linhas(sql`insert into venues (tenant_id, nome, capacidade_maxima) values (${tenantId}, 'V', 10) returning id`);
  const [e] = await linhas(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim, capacidade, status)
    values (${tenantId}, ${v!.id as string}, ${`ev-adm-${sufixo}`}, 'Evento Adm', now(), now() + interval '1 hour', 10, 'publicado')
    returning id
  `);
  eventId = e!.id as string;
});

afterAll(async () => {
  await conexao.end();
});

const NOVAS = {
  taxaConvenienciaBps: 850, comissaoBps: 200, taxaFixaCentavos: 100, taxaMinimaCentavos: 300,
  taxaAbsorvidaPeloProdutor: false, reservaPixBps: 0, reservaCartaoBps: 1500,
  diasLiberacaoEvento: 2, diasLiberacaoReserva: 40,
};

describe('administração', () => {
  it('mudança de taxa grava o antes, o depois e quem fez', async () => {
    await alterarTaxas(auth, tenantId, NOVAS, 'Contrato renegociado em reunião.');
    const [t] = await linhas(sql`select taxa_conveniencia_bps, reserva_cartao_bps from tenants where id = ${tenantId}`);
    expect(t).toMatchObject({ taxa_conveniencia_bps: 850, reserva_cartao_bps: 1500 });

    const [a] = await linhas(sql`
      select user_id, antes, depois from audit_log where acao = 'mudanca_taxa' and entidade_id = ${tenantId}
    `);
    expect(a?.user_id).toBe(auth.userId);
    expect(a?.antes).toMatchObject({ taxaConvenienciaBps: 1000 });
    expect(a?.depois).toMatchObject({ taxaConvenienciaBps: 850, justificativa: 'Contrato renegociado em reunião.' });
  });

  it('situação do cadastro alterada à mão fica registrada', async () => {
    await alterarKyc(auth, tenantId, 'suspenso', 'Documento divergente na conferência.');
    const [a] = await linhas(sql`select antes, depois from audit_log where acao = 'kyc_alterado_manual' and entidade_id = ${tenantId}`);
    expect(a?.antes).toEqual({ kycStatus: 'pendente' });
    expect(a?.depois).toMatchObject({ kycStatus: 'suspenso' });
  });

  it('repasse com falha é reaberto; liberado não pode ser cancelado', async () => {
    const [falho] = await linhas(sql`
      insert into payouts (tenant_id, event_id, tranche, metodo, bruto_centavos, status, data_prevista,
                           idempotency_key, tentativas, ultimo_erro)
      values (${tenantId}, ${eventId}, 'principal', 'pix', 1000, 'failed', now(), ${`adm-p-${sufixo}`}, 5, 'sem recebedor')
      returning id
    `);
    await reabrirRepasse(auth, falho!.id as string, 'Recebedor cadastrado pelo produtor.');
    const [p] = await linhas(sql`select status, tentativas from payouts where id = ${falho!.id as string}`);
    expect(p).toMatchObject({ status: 'failed', tentativas: 0 });

    const [liberado] = await linhas(sql`
      insert into payouts (tenant_id, event_id, tranche, metodo, bruto_centavos, status, data_prevista, idempotency_key)
      values (${tenantId}, ${eventId}, 'reserva', 'pix', 1000, 'released', now(), ${`adm-r-${sufixo}`})
      returning id
    `);
    await expect(cancelarRepasse(auth, liberado!.id as string, 'Tentativa de cancelar liberado.')).rejects.toThrow();

    await cancelarRepasse(auth, falho!.id as string, 'Evento encerrado sem vendas válidas.');
    const [c] = await linhas(sql`select status from payouts where id = ${falho!.id as string}`);
    expect(c?.status).toBe('canceled');
  });

  it('busca pedido de qualquer produtor e mostra a visão geral', async () => {
    await linhas(sql`
      insert into orders (tenant_id, event_id, numero, comprador_nome, comprador_email, comprador_cpf, subtotal_centavos,
                          total_centavos, valor_produtor_centavos, valor_operador_centavos,
                          taxa_conveniencia_bps_snapshot, comissao_bps_snapshot, status, idempotency_key)
      values (${tenantId}, ${eventId}, 1, 'Zé Busca', ${`ze.${sufixo}@t.local`}, '52998224725', 100, 100, 100, 0, 0, 0, 'paid', ${`adm-o-${sufixo}`})
    `);
    const r = await buscarPedidos(`ze.${sufixo}`);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ produtor: 'Casa Adm' });

    const v = await visaoGeral();
    expect(v.produtores).toBeGreaterThan(0);
  });
});
