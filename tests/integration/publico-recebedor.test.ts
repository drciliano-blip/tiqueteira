/**
 * Base de compradores, exportação CSV e situação do recebedor — ADR-024.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';
import { FakeProvider } from '@/lib/payments/fake';
import { compradoresDoProdutor, paraCsv } from '@/lib/publico-queries';
import { processarWebhook } from '@/lib/webhook-processor';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');
const conexao = postgres(DIRECT_URL, { max: 3, prepare: false });
const db = drizzle(conexao, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
type Linha = Record<string, unknown>;
const linhas = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Linha[];

const sufixo = Date.now().toString(36);
let tenantId: string;
let outro: string;
const eventos: string[] = [];
let numero = 0;

beforeAll(async () => {
  const [t] = await linhas(sql`insert into tenants (slug, nome, email) values (${`pub-${sufixo}`}, 'Casa', 'c@t.local') returning id`);
  tenantId = t!.id as string;
  const [o] = await linhas(sql`insert into tenants (slug, nome, email) values (${`pub2-${sufixo}`}, 'Outra', 'o@t.local') returning id`);
  outro = o!.id as string;
  const [v] = await linhas(sql`insert into venues (tenant_id, nome, capacidade_maxima) values (${tenantId}, 'Casa', 100) returning id`);
  for (let i = 0; i < 2; i++) {
    const [e] = await linhas(sql`
      insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim, capacidade, status)
      values (${tenantId}, ${v!.id as string}, ${`ev-pub-${sufixo}-${i}`}, ${`Festa ${i}`},
              now() - interval '10 days', now() - interval '10 days' + interval '4 hours', 100, 'encerrado')
      returning id
    `);
    eventos.push(e!.id as string);
  }
  // Ana: dois eventos (recorrente), uma devolução parcial. Bruno: um evento, nome com ponto e vírgula.
  await pedido(eventos[0]!, 'Ana@Teste.local', 'Ana Souza', 10000);
  const p2 = await pedido(eventos[1]!, 'ana@teste.local', 'Ana S. Souza', 8000);
  await db.execute(sql`
    insert into refunds (tenant_id, order_id, motivo, valor_centavos, status, idempotency_key)
    values (${tenantId}, ${p2}, 'buyer_request', 3000, 'succeeded', ${`rf-pub-${sufixo}`})
  `);
  await pedido(eventos[0]!, 'bruno@teste.local', 'Bruno; "Bê"', 5000);
});

afterAll(async () => {
  await conexao.end();
});

async function pedido(eventId: string, email: string, nome: string, total: number): Promise<string> {
  numero += 1;
  const [o] = await linhas(sql`
    insert into orders
      (tenant_id, event_id, numero, comprador_nome, comprador_email, comprador_cpf, comprador_telefone,
       subtotal_centavos, total_centavos, valor_produtor_centavos, valor_operador_centavos,
       taxa_conveniencia_bps_snapshot, comissao_bps_snapshot, status, idempotency_key, metodo, pago_em)
    values (${tenantId}, ${eventId}, ${numero}, ${nome}, ${email}, '52998224725', '11999990000',
            ${total}, ${total}, ${total}, 0, 0, 0, 'paid', ${`pub_${sufixo}_${numero}`}, 'pix', now())
    returning id
  `);
  return o!.id as string;
}

describe('público do produtor', () => {
  it('junta a pessoa pelo e-mail, conta eventos e desconta devolução', async () => {
    const { resumo, lista } = await compradoresDoProdutor(tenantId);
    expect(resumo).toMatchObject({ compradores: 2, recorrentes: 1 });

    const ana = lista[0]!;
    expect(ana).toMatchObject({ email: 'ana@teste.local', pedidos: 2, eventos: 2, gastoCentavos: 15000 });
    expect(ana.nome).toBe('Ana S. Souza'); // o nome da compra mais recente
  });

  it('filtra por evento', async () => {
    const { lista } = await compradoresDoProdutor(tenantId, { eventId: eventos[1] });
    expect(lista.map((c) => c.email)).toEqual(['ana@teste.local']);
  });

  it('outro produtor não vê ninguém daqui', async () => {
    expect((await compradoresDoProdutor(outro)).lista).toEqual([]);
  });

  it('CSV abre no Excel em português e escapa o que precisa', async () => {
    const { lista } = await compradoresDoProdutor(tenantId);
    const csv = paraCsv(lista);
    expect(csv.startsWith('﻿Nome;E-mail;')).toBe(true);
    expect(csv).toContain(';150,00;');
    expect(csv).toContain('"Bruno; ""Bê""";bruno@teste.local');
    expect(csv).not.toContain('52998224725'); // CPF não sai
  });
});

describe('situação do recebedor pela PSP', () => {
  it('webhook de aprovação, conferido na API, aprova o produtor', async () => {
    const psp = new FakeProvider('segredo-rec', `rec${sufixo}`);
    const recebedor = await psp.createRecipient({
      tenantId,
      legalName: 'Casa Ltda',
      document: '69700606000136',
      documentType: 'cnpj',
      email: 'c@t.local',
      phone: '11999990000',
      address: { street: 'R', number: '1', neighborhood: 'B', city: 'São Paulo', state: 'SP', zipCode: '01152000' },
      bankAccount: {
        bankCode: '341', branch: '1', account: '1', accountDigit: '1',
        accountType: 'checking', holderName: 'Casa Ltda', holderDocument: '69700606000136',
      },
    });
    await db.execute(sql`
      update tenants set provider_recipient_id = ${recebedor.providerRecipientId}, kyc_status = 'em_analise'
       where id = ${tenantId}
    `);

    const { body, headers } = psp.envelope(psp.simulateRecipientApproval(recebedor.providerRecipientId));
    const r = await processarWebhook(body, headers, { provider: psp, db, ticketSecret: 'x'.repeat(40) });
    expect(r.status).toBe(200);

    const [t] = await linhas(sql`select kyc_status from tenants where id = ${tenantId}`);
    expect(t?.kyc_status).toBe('aprovado');
  });
});
