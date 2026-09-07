/**
 * Aplica src/db/rls.sql pela conexão DIRETA, com o papel dono do schema.
 *
 *   pnpm db:rls
 *
 * As senhas dos papéis vêm do ambiente, não do arquivo SQL — assim o SQL pode
 * ser versionado sem segredo dentro. Defina em .env.local:
 *   APP_DB_PASSWORD=...
 *   SERVICE_DB_PASSWORD=...
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Defina DIRECT_URL em .env.local');

const appPassword = process.env.APP_DB_PASSWORD;
const servicePassword = process.env.SERVICE_DB_PASSWORD;
if (!appPassword || !servicePassword) {
  throw new Error('Defina APP_DB_PASSWORD e SERVICE_DB_PASSWORD em .env.local');
}

const caminho = fileURLToPath(new URL('./rls.sql', import.meta.url));
const bruto = await readFile(caminho, 'utf8');

const sqlTexto = bruto
  .replaceAll('TROQUE_ESTA_SENHA_APP', appPassword.replaceAll("'", "''"))
  .replaceAll('TROQUE_ESTA_SENHA_SERVICE', servicePassword.replaceAll("'", "''"));

const sql = postgres(url, { max: 1, prepare: false });

try {
  await sql.unsafe(sqlTexto);
  console.log('RLS aplicada.');

  const semRls = await sql`
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname <> '__drizzle_migrations'
       and (c.relrowsecurity = false or c.relforcerowsecurity = false)
     order by 1
  `;

  if (semRls.length > 0) {
    console.error('Tabelas sem RLS forçada:', semRls.map((r) => r.relname).join(', '));
    process.exitCode = 1;
  } else {
    console.log('Conferência: todas as tabelas com RLS habilitada e forçada.');
  }
} finally {
  await sql.end();
}
