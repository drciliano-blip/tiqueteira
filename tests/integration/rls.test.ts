/**
 * Isolamento entre tenants — Definition of Done da Fase 0.
 *
 * Este é o teste que precisa FALHAR ao tentar ler dado dos outros. Um teste
 * de multi-tenancy que só confirma o caminho feliz não prova nada: ele passa
 * igual com RLS desligada.
 *
 * Exige banco de pé, migrations aplicadas e `pnpm db:rls` já rodado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const DIRECT_URL = process.env.DIRECT_URL;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DIRECT_URL || !DATABASE_URL) {
  throw new Error('DIRECT_URL e DATABASE_URL precisam estar definidas para os testes.');
}

/** Papel dono do schema. Monta o cenário. */
const dono = postgres(DIRECT_URL, { max: 1, prepare: false });
/** Papel da aplicação — sem BYPASSRLS. É o que está sendo testado. */
const app = postgres(DATABASE_URL, { max: 1, prepare: false });

let tenantA: string;
let tenantB: string;
let eventoA: string;
let eventoB: string;

beforeAll(async () => {
  const [a] = await dono`
    insert into tenants (slug, nome, email)
    values (${'rls-test-a-' + Date.now()}, 'RLS Teste A', 'a@rls.test')
    returning id
  `;
  const [b] = await dono`
    insert into tenants (slug, nome, email)
    values (${'rls-test-b-' + Date.now()}, 'RLS Teste B', 'b@rls.test')
    returning id
  `;
  tenantA = a!.id;
  tenantB = b!.id;

  const criarVenueEEvento = async (tenantId: string, slug: string) => {
    const [venue] = await dono`
      insert into venues (tenant_id, nome, capacidade_maxima)
      values (${tenantId}, 'Espaço RLS', 500) returning id
    `;
    const [evento] = await dono`
      insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim, capacidade)
      values (${tenantId}, ${venue!.id}, ${slug}, 'Evento RLS',
              now() + interval '10 days', now() + interval '10 days 6 hours', 300)
      returning id
    `;
    return evento!.id as string;
  };

  eventoA = await criarVenueEEvento(tenantA, 'evento-a-' + Date.now());
  eventoB = await criarVenueEEvento(tenantB, 'evento-b-' + Date.now());
});

afterAll(async () => {
  await dono`delete from tenants where id in (${tenantA}, ${tenantB})`;
  await dono.end();
  await app.end();
});

/** Roda `fn` numa transação com `app.tenant_id` definido, como a aplicação faz. */
async function comoTenant<T>(
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return app.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

describe('RLS: isolamento entre tenants', () => {
  it('o papel da aplicação não tem BYPASSRLS', async () => {
    const [papel] = await app`select current_user as nome, rolbypassrls
                                from pg_roles where rolname = current_user`;
    expect(papel!.rolbypassrls, `papel ${papel!.nome} tem BYPASSRLS — o teste não provaria nada`)
      .toBe(false);
  });

  it('vê os próprios eventos', async () => {
    const linhas = await comoTenant(tenantA, (tx) => tx`select id from events`);
    expect(linhas.map((l) => l.id)).toContain(eventoA);
  });

  it('NÃO vê evento de outro tenant, nem pedindo pelo id', async () => {
    const linhas = await comoTenant(tenantA, (tx) => tx`select id from events where id = ${eventoB}`);
    expect(linhas).toHaveLength(0);
  });

  it('NÃO vê venues de outro tenant', async () => {
    const linhas = await comoTenant(tenantA, (tx) => tx`select tenant_id from venues`);
    expect(linhas.every((l) => l.tenant_id === tenantA)).toBe(true);
  });

  it('sem app.tenant_id definido, não vê nada', async () => {
    // O padrão precisa ser "não enxerga", não "enxerga tudo".
    const linhas = await app`select id from events`;
    expect(linhas).toHaveLength(0);
  });

  it('NÃO consegue inserir registro carimbado com outro tenant', async () => {
    await expect(
      comoTenant(
        tenantA,
        (tx) => tx`
          insert into venues (tenant_id, nome, capacidade_maxima)
          values (${tenantB}, 'Invasão', 100)
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('NÃO consegue mover um registro próprio para outro tenant', async () => {
    await expect(
      comoTenant(
        tenantA,
        (tx) => tx`update events set tenant_id = ${tenantB} where id = ${eventoA}`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('UPDATE em registro de outro tenant não afeta nenhuma linha', async () => {
    // Silencioso de propósito: o RLS filtra antes, então não há o que atualizar.
    await comoTenant(tenantA, (tx) => tx`update events set titulo = 'Sequestrado' where id = ${eventoB}`);
    const [linha] = await dono`select titulo from events where id = ${eventoB}`;
    expect(linha!.titulo).toBe('Evento RLS');
  });

  it('DELETE em registro de outro tenant não apaga nada', async () => {
    await comoTenant(tenantA, (tx) => tx`delete from events where id = ${eventoB}`);
    const [linha] = await dono`select count(*)::int as n from events where id = ${eventoB}`;
    expect(linha!.n).toBe(1);
  });
});

describe('RLS: vazamento por conexão reaproveitada', () => {
  it('o tenant não sobrevive ao fim da transação', async () => {
    // `set_config(..., true)` é local à transação. Sem esse `true`, o valor
    // ficaria grudado na conexão e a próxima requisição a pegá-la do pool
    // enxergaria o tenant anterior. É o vazamento clássico de multi-tenant.
    await comoTenant(tenantA, (tx) => tx`select 1`);

    const [config] = await app`select current_setting('app.tenant_id', true) as valor`;
    expect(config!.valor === null || config!.valor === '').toBe(true);
  });
});

describe('RLS: trilha de auditoria', () => {
  it('a aplicação não consegue escrever no audit_log', async () => {
    // Trilha que a própria aplicação reescreve não é trilha. ADR-007.
    await expect(
      comoTenant(
        tenantA,
        (tx) => tx`
          insert into audit_log (tenant_id, acao, entidade)
          values (${tenantA}, 'apagar_rastro', 'orders')
        `,
      ),
    ).rejects.toThrow(/permission denied|permissão negada/i);
  });

  it('a aplicação lê o audit_log do próprio tenant', async () => {
    await dono`
      insert into audit_log (tenant_id, acao, entidade)
      values (${tenantA}, 'teste', 'events'), (${tenantB}, 'teste', 'events')
    `;
    const linhas = await comoTenant(tenantA, (tx) => tx`select tenant_id from audit_log`);
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((l) => l.tenant_id === tenantA)).toBe(true);
  });
});

describe('RLS: tabelas de infraestrutura', () => {
  it('a aplicação não acessa users', async () => {
    // O login roda pela conexão de serviço, antes de existir tenant.
    await expect(app`select id from users`).rejects.toThrow(/permission denied|permissão negada/i);
  });

  it('a aplicação não acessa webhook_events', async () => {
    await expect(app`select id from webhook_events`).rejects.toThrow(
      /permission denied|permissão negada/i,
    );
  });
});
