import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CartaoEvento } from '@/components/cartao-evento';
import { Marca } from '@/components/marca';
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
        <header className="sticky top-0 z-20 border-b border-line bg-base/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <span className="font-titulo text-lg font-bold tracking-tight">{tenant.nome}</span>
            <Marca href="/" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {eventos.length === 0 ? (
            <div className="rounded-cartao border border-line bg-raised px-5 py-12 text-center">
              <p className="font-titulo text-lg font-semibold">Nenhum evento por aqui ainda</p>
              <p className="mt-2 text-sm text-muted">
                Quando {tenant.nome} publicar o próximo, ele aparece nesta página.
              </p>
            </div>
          ) : (
            <>
              {aVenda.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                    Próximos
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

        <footer className="border-t border-line">
          <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-faint">
            {tenant.nome} vende com a Tiqueteira.
          </div>
        </footer>
      </div>
    </>
  );
}
