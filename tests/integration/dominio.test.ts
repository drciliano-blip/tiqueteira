/**
 * Domínio próprio contra o banco — ADR-018.
 *
 * O que esta suíte protege é posse. Um domínio que resolve sem verificação
 * deixaria qualquer pessoa apontar um CNAME para nós, digitar o endereço no
 * próprio cadastro, e passar a servir a vitrine de outro produtor — ou nos
 * deixar servindo conteúdo num endereço de terceiro. Por isso o teste central
 * é o do domínio cadastrado e NÃO verificado, que não pode resolver.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { resolverTenantPorDominio, resolverTenantPublico } from '@/lib/public-queries';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const donoSql = postgres(DIRECT_URL, { max: 2, prepare: false });
const dono = drizzle(donoSql);

let casaId: string;
let vizinhaId: string;
let inativaId: string;
let sufixo: string;

const dominioDaCasa = () => `ingressos.casa-${sufixo}.com.br`;
const dominioDaVizinha = () => `ingressos.vizinha-${sufixo}.com.br`;
const dominioDaInativa = () => `ingressos.inativa-${sufixo}.com.br`;

async function criarTenant(params: {
  slug: string;
  dominio: string | null;
  verificado: boolean;
  status?: string;
}): Promise<string> {
  const linhas = (await dono.execute(sql`
    insert into tenants (slug, nome, email, dominio_customizado, dominio_verificado, status)
    values (${params.slug}, ${'Casa ' + params.slug}, ${params.slug + '@teste.local'},
            ${params.dominio}, ${params.verificado},
            ${params.status ?? 'ativo'}::tenant_status)
    returning id
  `)) as unknown as { id: string }[];
  return linhas[0]!.id;
}

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  casaId = await criarTenant({
    slug: 'casa-' + sufixo,
    dominio: dominioDaCasa(),
    verificado: true,
  });

  vizinhaId = await criarTenant({
    slug: 'vizinha-' + sufixo,
    dominio: dominioDaVizinha(),
    verificado: false,
  });

  inativaId = await criarTenant({
    slug: 'inativa-' + sufixo,
    dominio: dominioDaInativa(),
    verificado: true,
    status: 'suspenso',
  });
});

afterAll(async () => {
  await dono.execute(sql`
    delete from tenants where id in (${casaId}, ${vizinhaId}, ${inativaId})
  `);
  await donoSql.end();
});

// ---------------------------------------------------------------------------

describe('resolver por domínio', () => {
  it('domínio verificado resolve para o produtor', async () => {
    const t = await resolverTenantPorDominio(dominioDaCasa());
    expect(t?.id).toBe(casaId);
  });

  it('domínio cadastrado e NÃO verificado não resolve', async () => {
    // É a linha de defesa inteira: sem prova de posse, não serve.
    expect(await resolverTenantPorDominio(dominioDaVizinha())).toBeNull();
  });

  it('produtor suspenso não resolve, mesmo com domínio verificado', async () => {
    expect(await resolverTenantPorDominio(dominioDaInativa())).toBeNull();
  });

  it('domínio que ninguém cadastrou não resolve', async () => {
    expect(await resolverTenantPorDominio('nao-existe-' + sufixo + '.com.br')).toBeNull();
  });

  it('normaliza o que chega: caixa, porta e ponto final', async () => {
    const variacoes = [
      dominioDaCasa().toUpperCase(),
      dominioDaCasa() + '.',
      dominioDaCasa() + ':443',
    ];

    for (const v of variacoes) {
      expect((await resolverTenantPorDominio(v))?.id).toBe(casaId);
    }
  });
});

describe('resolver pelo parâmetro da rota', () => {
  it('sem ponto, trata como slug', async () => {
    const t = await resolverTenantPublico('casa-' + sufixo);
    expect(t?.id).toBe(casaId);
  });

  it('com ponto, trata como domínio', async () => {
    const t = await resolverTenantPublico(dominioDaCasa());
    expect(t?.id).toBe(casaId);
  });

  it('não confunde slug com domínio de outro produtor', async () => {
    // O slug da vizinha resolve; o domínio dela, não verificado, não.
    expect((await resolverTenantPublico('vizinha-' + sufixo))?.id).toBe(vizinhaId);
    expect(await resolverTenantPublico(dominioDaVizinha())).toBeNull();
  });

  it('slug inexistente não resolve', async () => {
    expect(await resolverTenantPublico('nao-existe-' + sufixo)).toBeNull();
  });
});

describe('unicidade do domínio', () => {
  it('o banco recusa o mesmo domínio em dois produtores', async () => {
    // Dois produtores no mesmo endereço seria ambiguidade insolúvel: a
    // requisição chega por hostname e não há como escolher.
    await expect(
      criarTenant({
        slug: 'clone-' + sufixo,
        dominio: dominioDaCasa(),
        verificado: false,
      }),
    ).rejects.toThrow();
  });
});
