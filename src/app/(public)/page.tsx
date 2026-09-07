import Link from 'next/link';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { CartaoEvento } from '@/components/cartao-evento';
import { Rodape } from '@/components/rodape';
import { listarCidades, listarEventosDaPlataforma } from '@/lib/marketplace-queries';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ q?: string; cidade?: string }> };

export default async function Home({ searchParams }: Props) {
  const { q, cidade } = await searchParams;

  const [eventos, cidades] = await Promise.all([
    listarEventosDaPlataforma({
      ...(q ? { busca: q } : {}),
      ...(cidade ? { cidade } : {}),
    }),
    listarCidades(),
  ]);

  const buscando = Boolean(q || cidade);

  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho />
      </Suspense>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {!buscando && (
          <section className="pb-8">
            <h1 className="max-w-xl text-xl font-bold leading-tight sm:text-2xl">
              As melhores festas, com ingresso garantido.
            </h1>
            <p className="prosa mt-3 text-muted">
              Compre em segundos, sem criar conta. O ingresso chega por e-mail com QR e entra
              direto na portaria.
            </p>
          </section>
        )}

        {cidades.length > 1 && (
          <nav aria-label="Filtrar por cidade" className="flex flex-wrap gap-2 pb-6">
            <Link
              href={q ? `/?q=${encodeURIComponent(q)}` : '/'}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                cidade
                  ? 'border-line text-muted hover:text-txt'
                  : 'border-accent bg-accent text-accent-txt'
              }`}
            >
              Todas
            </Link>
            {cidades.map((c) => {
              const params = new URLSearchParams();
              if (q) params.set('q', q);
              params.set('cidade', c);
              return (
                <Link
                  key={c}
                  href={`/?${params}`}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    cidade === c
                      ? 'border-accent bg-accent text-accent-txt'
                      : 'border-line text-muted hover:text-txt'
                  }`}
                >
                  {c}
                </Link>
              );
            })}
          </nav>
        )}

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
            {buscando ? `${eventos.length} resultado${eventos.length === 1 ? '' : 's'}` : 'Próximos'}
          </h2>

          {eventos.length === 0 ? (
            <div className="mt-4 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
              <p className="font-titulo text-lg font-semibold">
                {buscando ? 'Nada encontrado' : 'Nenhum evento à venda agora'}
              </p>
              <p className="prosa mx-auto mt-2 text-sm text-muted">
                {buscando
                  ? 'Tente outro termo, ou veja tudo que está à venda.'
                  : 'Assim que um produtor publicar, o evento aparece aqui.'}
              </p>
              {buscando && (
                <Link
                  href="/"
                  className="mt-5 inline-block rounded-botao border border-line-forte px-4 py-2 text-sm font-medium transition hover:border-accent hover:text-accent"
                >
                  Ver todos os eventos
                </Link>
              )}
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {eventos.map((evento, i) => (
                <li key={evento.id}>
                  <CartaoEvento
                    evento={evento}
                    tenantSlug={evento.tenantSlug}
                    tenantNome={evento.tenantNome}
                    prioridade={i < 4}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {!buscando && (
          <section className="mt-16 rounded-cartao border border-line bg-raised px-6 py-8 sm:px-8">
            <h2 className="font-titulo text-lg font-bold">Você organiza eventos?</h2>
            <p className="prosa mt-2 text-sm text-muted">
              Publique, venda e receba sem intermediário. O dinheiro cai direto na sua conta,
              com repasse a partir de dois dias úteis após o evento.
            </p>
            <Link
              href="/publique"
              className="mt-5 inline-block rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt"
            >
              Publique seu evento
            </Link>
          </section>
        )}
      </main>

      <Rodape />
    </div>
  );
}
