import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

/**
 * Migrations rodam pela conexão DIRETA (porta 5432), nunca pelo pooler:
 * DDL e prepared statements não convivem bem com pooling em modo transação.
 */
// `generate` monta a migration a partir do schema e não abre conexão, então
// aceita placeholder. `migrate` e `push` falham cedo se a URL não existir.
const url =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  'postgresql://sem-conexao@localhost:5432/postgres';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
