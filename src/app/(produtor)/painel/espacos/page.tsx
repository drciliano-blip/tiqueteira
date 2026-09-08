import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import { venues } from '@/db/schema';
import { tenantAtual } from '@/lib/painel-contexto';
import { criarEspaco } from '../acoes';
import { FormularioEspaco } from './formulario';

export const metadata: Metadata = { title: 'Espaços' };
export const dynamic = 'force-dynamic';

export default async function Espacos() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const lista = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({
        id: venues.id,
        nome: venues.nome,
        endereco: venues.endereco,
        cidade: venues.cidade,
        uf: venues.uf,
        capacidadeMaxima: venues.capacidadeMaxima,
      })
      .from(venues)
      .where(eq(venues.tenantId, ctx.tenant.id))
      .orderBy(asc(venues.nome)),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Espaços</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        A capacidade cadastrada aqui é o teto de tudo: nenhum evento pode vender além dela.
      </p>

      {lista.length > 0 && (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-cartao border border-line">
          {lista.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{v.nome}</p>
                <p className="truncate text-sm text-faint">
                  {[v.endereco, v.cidade, v.uf].filter(Boolean).join(' · ') || 'Sem endereço'}
                </p>
              </div>
              <p className="tabular shrink-0 text-sm">
                {v.capacidadeMaxima}
                <span className="text-faint"> lugares</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-10">
        <h2 className="font-titulo text-lg font-bold">Cadastrar espaço</h2>
        <div className="mt-4">
          <FormularioEspaco acao={criarEspaco.bind(null, ctx.tenant.id)} />
        </div>
      </section>
    </main>
  );
}
