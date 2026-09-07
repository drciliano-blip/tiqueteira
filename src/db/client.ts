/**
 * Conexões com o Postgres.
 *
 * Duas conexões, dois papéis, de propósito (ver src/db/rls.sql):
 *
 *   appDb      → papel `tiqueteira_app`, SUBMETIDO ao RLS. Todo acesso a dado
 *                de tenant passa por `withTenant()`, que define `app.tenant_id`
 *                dentro da transação.
 *   serviceDb  → papel `tiqueteira_service`, com BYPASSRLS. Só para o que
 *                chega sem contexto de tenant: webhook da PSP, fila de jobs e
 *                autenticação. Todo uso deveria deixar rastro no audit_log.
 *
 * Nunca use `serviceDb` para atender requisição de usuário.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * `prepare: false` é obrigatório atrás do pooler do Supabase em modo
 * transação (porta 6543): prepared statements não sobrevivem à troca de
 * conexão do pooler.
 */
function connect(url: string) {
  return postgres(url, {
    prepare: false,
    max: process.env.NODE_ENV === 'production' ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

let _appDb: Database | null = null;
let _serviceDb: Database | null = null;

export function appDb(): Database {
  if (!_appDb) _appDb = drizzle(connect(env().DATABASE_URL), { schema });
  return _appDb;
}

export function serviceDb(): Database {
  if (!_serviceDb) {
    const url = env().SERVICE_DATABASE_URL ?? env().DATABASE_URL;
    _serviceDb = drizzle(connect(url), { schema });
  }
  return _serviceDb;
}

/**
 * Executa `fn` numa transação com `app.tenant_id` definido.
 *
 * O terceiro argumento `true` de set_config torna o valor local à transação:
 * ele morre no COMMIT e não vaza para a próxima requisição que pegar a mesma
 * conexão do pool. Sem esse `true`, multi-tenancy em pool é um vazamento
 * esperando a hora.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return appDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

export { schema };
