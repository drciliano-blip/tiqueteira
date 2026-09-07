import Link from 'next/link';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { CartaoEvento } from '@/components/cartao-evento';
import { Rodape } from '@/components/rodape';
import {
  CATEGORIAS,
  listarCidades,
  listarEventosDaPlataforma,
  listarMaisVendidos,
} from '@/lib/marketplace-queries';

export const dynamic = 'force-dynamic';

type Busca = { q?: string; cidade?: string; categoria?: string };
type Props = { searchParams: Promise<Busca> };

/** Monta a URL preservando os outros filtros ativos. */
function href(atual: Busca, mudanca: Partial<Busca>): string {
  const p = new URLSearchParams();
  const final = { ...atual, ...mudanca };
  for (const chave of ['q', 'cidade', 'categoria'] as const) {
    const valor = final[chave];
    if (valor) p.set(chave, valor);
  }
  return p.size ? `/?${p}` : '/';
}

function Chip({
  ativo,
  children,
  ...props
}: { ativo: boolean; children: React.ReactNode } & React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      aria-current={ativo ? 'page' : undefined}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition ${
        ativo
          ? 'border-accent bg-accent font-medium text-accent-txt'
          : 'border-line text-muted hover:border-line-forte hover:text-txt'
      }`}
    >
      {children}
    </Link>
  );
}

export default async function Home({ searchParams }: Props) {
  const filtros = await searchParams;
  const { q, cidade, categoria } = filtros;

  const [eventos, cidades, maisVendidos] = await Promise.all([
    listarEventosDaPlataforma({
      ...(q ? { busca: q } : {}),
      ...(cidade ? { cidade } : {}),
      ...(categoria ? { categoria } : {}),
    }),
    listarCidades(),
    listarMaisVendidos(),
  ]);

  const filtrando = Boolean(q || cidade || categoria);

  // Só mostra categoria que tem evento — chip que leva a lista vazia é ruído.
  const categoriasComEvento = new Set(eventos.map((e) => e.categoria));
  const categoriasVisiveis = CATEGORIAS.filter(
    (c) => categoriasComEvento.has(c.valor) || categoria === c.valor,
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho />
      </Suspense>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {!filtrando && (
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

        {(categoriasVisiveis.length > 1 || cidades.length > 1) && (
          <div className="space-y-3 pb-8">
            {categoriasVisiveis.length > 1 && (
              <nav aria-label="Categorias" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                <Chip href={href(filtros, { categoria: undefined })} ativo={!categoria}>
                  Tudo
                </Chip>
                {categoriasVisiveis.map((c) => (
                  <Chip
                    key={c.valor}
                    href={href(filtros, { categoria: c.valor })}
                    ativo={categoria === c.valor}
                  >
                    {c.rotulo}
                  </Chip>
                ))}
              </nav>
            )}

            {cidades.length > 1 && (
              <nav aria-label="Cidades" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                <Chip href={href(filtros, { cidade: undefined })} ativo={!cidade}>
                  Todas as cidades
                </Chip>
                {cidades.map((c) => (
                  <Chip key={c} href={href(filtros, { cidade: c })} ativo={cidade === c}>
                    {c}
                  </Chip>
                ))}
              </nav>
            )}
          </div>
        )}

        {!filtrando && maisVendidos.length > 0 && (
          <section className="pb-12">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
              Mais vendidos nas últimas 24h
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {maisVendidos.slice(0, 4).map((evento, i) => (
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
          </section>
        )}

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
            {filtrando
              ? `${eventos.length} resultado${eventos.length === 1 ? '' : 's'}`
              : 'Próximos'}
          </h2>

          {eventos.length === 0 ? (
            <div className="mt-4 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
              <p className="font-titulo text-lg font-semibold">
                {filtrando ? 'Nada encontrado' : 'Nenhum evento à venda agora'}
              </p>
              <p className="prosa mx-auto mt-2 text-sm text-muted">
                {filtrando
                  ? 'Tente outro termo, ou veja tudo que está à venda.'
                  : 'Assim que um produtor publicar, o evento aparece aqui.'}
              </p>
              {filtrando && (
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
                    prioridade={!maisVendidos.length && i < 4}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {!filtrando && (
          <section className="mt-16 rounded-cartao border border-line bg-raised px-6 py-8 sm:px-8">
            <h2 className="font-titulo text-lg font-bold">Você organiza eventos?</h2>
            <p className="prosa mt-2 text-sm text-muted">
              Publique, venda e receba sem intermediário. O dinheiro cai direto na sua conta,
              com repasse a partir de dois dias úteis após o evento.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/publique"
                className="rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt"
              >
                Publique seu evento
              </Link>
              <Link
                href="/como-funciona"
                className="rounded-botao border border-line-forte px-5 py-3 font-medium transition hover:border-accent hover:text-accent"
              >
                Como funciona
              </Link>
            </div>
          </section>
        )}
      </main>

      <Rodape />
    </div>
  );
}
