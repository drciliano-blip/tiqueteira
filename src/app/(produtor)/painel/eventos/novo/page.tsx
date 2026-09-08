import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import { venues } from '@/db/schema';
import { tenantAtual } from '@/lib/painel-contexto';
import { criarEvento } from '../../acoes';
import { FormularioEvento } from '../formulario-evento';

export const metadata: Metadata = { title: 'Novo evento' };
export const dynamic = 'force-dynamic';

export default async function NovoEvento() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const espacos = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({
        id: venues.id,
        nome: venues.nome,
        capacidadeMaxima: venues.capacidadeMaxima,
      })
      .from(venues)
      .where(eq(venues.tenantId, ctx.tenant.id))
      .orderBy(asc(venues.nome)),
  );

  const acao = criarEvento.bind(null, ctx.tenant.id);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Novo evento</h1>
      <p className="mt-1.5 text-sm text-muted">
        O evento nasce como rascunho. Ele só aparece na vitrine depois que você criar os lotes e
        publicar.
      </p>

      <div className="mt-8">
        <FormularioEvento acao={acao} espacos={espacos} rotuloBotao="Criar evento" />
      </div>
    </main>
  );
}
