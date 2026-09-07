import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Cartaz } from '@/components/cartaz';
import { SeletorIngressos } from '@/components/seletor-ingressos';
import { TemaTenant } from '@/components/tema-tenant';
import { dataLonga, hora } from '@/lib/datas';
import { buscarEventoPublico, resolverTenantPorSlug } from '@/lib/public-queries';
import { criarPedido } from './acoes';

export const revalidate = 15;

type Props = { params: Promise<{ tenantSlug: string; eventSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenantSlug, eventSlug } = await params;
  const tenant = await resolverTenantPorSlug(tenantSlug);
  if (!tenant) return { title: 'Evento não encontrado' };

  const evento = await buscarEventoPublico(tenant.id, eventSlug);
  if (!evento) return { title: 'Evento não encontrado' };

  return {
    title: evento.titulo,
    description: `${dataLonga(evento.dataInicio)} · ${evento.venue.nome}`,
    openGraph: {
      title: evento.titulo,
      description: `${dataLonga(evento.dataInicio)} · ${evento.venue.nome}`,
      type: 'website',
      ...(evento.imagemUrl ? { images: [evento.imagemUrl] } : {}),
    },
  };
}

export default async function PaginaEvento({ params }: Props) {
  const { tenantSlug, eventSlug } = await params;

  const tenant = await resolverTenantPorSlug(tenantSlug);
  if (!tenant) notFound();

  const evento = await buscarEventoPublico(tenant.id, eventSlug);
  if (!evento) notFound();

  const comprar = criarPedido.bind(null, tenantSlug, eventSlug);
  const local = [evento.venue.nome, evento.venue.cidade, evento.venue.uf]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <TemaTenant corAcento={evento.corAcento ?? tenant.corAcento} />

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-base/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
            <Link
              href={`/${tenant.slug}`}
              className="text-sm text-muted transition hover:text-txt"
              aria-label={`Voltar para ${tenant.nome}`}
            >
              ← {tenant.nome}
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 pt-6">
          <div className="mx-auto max-w-[22rem] sm:max-w-[26rem]">
            <Cartaz
              eventoId={evento.id}
              titulo={evento.titulo}
              imagemUrl={evento.imagemUrl}
              prioridade
            />
          </div>

          <h1 className="mt-6 text-xl font-bold leading-tight sm:text-2xl">{evento.titulo}</h1>

          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="sr-only">Data</dt>
              <dd className="tabular text-muted">
                {dataLonga(evento.dataInicio)}, às {hora(evento.dataInicio)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="sr-only">Local</dt>
              <dd className="text-muted">{local}</dd>
            </div>
            {evento.venue.endereco && (
              <div className="flex gap-2">
                <dt className="sr-only">Endereço</dt>
                <dd className="text-faint">{evento.venue.endereco}</dd>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <dd className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                {evento.classificacaoEtaria === 0
                  ? 'Livre'
                  : `${evento.classificacaoEtaria} anos`}
              </dd>
              {evento.ingressoNominal && (
                <dd className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                  Ingresso nominal
                </dd>
              )}
            </div>
          </dl>

          {/* O seletor vem ANTES da descrição — benchmark, seção 5.2. */}
          <SeletorIngressos
            lotes={evento.lotes}
            taxaConvenienciaBps={tenant.taxaConvenienciaBps}
            taxaAbsorvidaPeloProdutor={tenant.taxaAbsorvidaPeloProdutor}
            taxaMinimaCentavos={tenant.taxaMinimaCentavos}
            onComprar={comprar}
          />

          {evento.descricao && (
            <section className="mt-10">
              <h2 className="font-titulo text-lg font-bold">Sobre o evento</h2>
              <p className="prosa mt-3 whitespace-pre-line text-muted">{evento.descricao}</p>
            </section>
          )}

          <section className="mt-10">
            <h2 className="font-titulo text-lg font-bold">Antes de comprar</h2>
            <ul className="prosa mt-3 space-y-2 text-sm text-muted">
              <li>
                Você tem <strong className="text-txt">7 dias</strong> para desistir da compra e
                receber tudo de volta, taxa incluída.
              </li>
              {evento.ingressoNominal && (
                <li>
                  O ingresso é nominal.{' '}
                  {evento.exigeDocumentoEntrada
                    ? 'É preciso apresentar documento com foto na entrada.'
                    : 'O nome do titular fica registrado no ingresso.'}
                </li>
              )}
              <li>
                Se precisar repassar, use a transferência dentro da plataforma: o ingresso
                antigo é cancelado e um novo é emitido para quem vai.
              </li>
              {evento.politicaReembolso && (
                <li className="whitespace-pre-line">{evento.politicaReembolso}</li>
              )}
            </ul>
          </section>
        </main>

        <footer className="border-t border-line">
          <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-faint">
            {tenant.nome} vende com a Tiqueteira.
          </div>
        </footer>
      </div>
    </>
  );
}
