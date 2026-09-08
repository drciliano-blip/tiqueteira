import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { CartaoEvento } from '@/components/cartao-evento';
import { Rodape } from '@/components/rodape';
import { TemaTenant } from '@/components/tema-tenant';
import { listarEventosDoTenant, resolverTenantPorSlug } from '@/lib/public-queries';

export const revalidate = 30;

type Props = { params: Promise<{ tenantSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenantSlug } = await params;
  const tenant = await resolverTenantPorSlug(tenantSlug);
  if (!tenant) return { title: 'Produtor não encontrado' };

  return {
    title: tenant.nome,
    description: `Ingressos para os eventos de ${tenant.nome}.`,
    openGraph: { title: tenant.nome, type: 'website' },
  };
}

export default async function VitrineProdutor({ params }: Props) {
  const { tenantSlug } = await params;

  const tenant = await resolverTenantPorSlug(tenantSlug);
  if (!tenant) notFound();

  const eventos = await listarEventosDoTenant(tenant.id);
  const aVenda = eventos.filter((e) => e.status !== 'esgotado' && e.precoMinimoCentavos !== null);
  const esgotados = eventos.filter((e) => e.status === 'esgotado' || e.precoMinimoCentavos === null);

  return (
    <>
      <TemaTenant corAcento={tenant.corAcento} />

      <div className="flex min-h-dvh flex-col">
        {/*
          O MESMO cabeçalho de todas as páginas. A vitrine do produtor é uma
          seção da plataforma, não outro site — trocar a navegação aqui faz o
          comprador achar que saiu do lugar onde estava comprando.
        */}
        <Suspense fallback={<div className="h-16 border-b border-line" />}>
          <Cabecalho />
        </Suspense>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {/* Identidade do produtor, na cor dele. */}
          <div className="flex items-center gap-4 border-b border-line pb-8">
            <div
              aria-hidden
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent text-xl font-bold text-accent-txt"
            >
              {tenant.nome.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold leading-tight sm:text-2xl">
                {tenant.nome}
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                {eventos.length === 0
                  ? 'Nenhum evento à venda'
                  : `${eventos.length} ${eventos.length === 1 ? 'evento' : 'eventos'}`}
              </p>
            </div>
          </div>

          {eventos.length === 0 ? (
            <div className="mt-8 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
              <p className="font-titulo text-lg font-semibold">Nenhum evento por aqui ainda</p>
              <p className="prosa mx-auto mt-2 text-sm text-muted">
                Quando {tenant.nome} publicar o próximo, ele aparece nesta página.
              </p>
            </div>
          ) : (
            <>
              {aVenda.length > 0 && (
                <section className="mt-8">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                    À venda
                  </h2>
                  <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                    {aVenda.map((evento, i) => (
                      <li key={evento.id}>
                        <CartaoEvento
                          evento={evento}
                          tenantSlug={tenant.slug}
                          prioridade={i < 4}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {esgotados.length > 0 && (
                <section className="mt-14">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                    Esgotados
                  </h2>
                  <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                    {esgotados.map((evento) => (
                      <li key={evento.id}>
                        <CartaoEvento evento={evento} tenantSlug={tenant.slug} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </main>

        <Rodape />
      </div>
    </>
  );
}
