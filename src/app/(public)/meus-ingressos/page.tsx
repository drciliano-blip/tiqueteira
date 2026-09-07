import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { Rodape } from '@/components/rodape';
import { ingressosPorEmail } from '@/lib/buyer-queries';
import { COOKIE_COMPRADOR, lerSessaoComprador } from '@/lib/buyer-session';
import { dataLonga, faltam, hora } from '@/lib/datas';
import { env } from '@/lib/env';
import { FormularioAcesso } from './formulario';
import { sairDaAreaDoComprador } from './acoes';

export const metadata: Metadata = {
  title: 'Meus ingressos',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ erro?: string }> };

const MOTIVOS: Record<string, string> = {
  invalido: 'Esse link não é válido. Peça um novo abaixo.',
  expirado: 'O link expirou. Peça um novo — leva alguns segundos.',
  usado: 'Esse link já foi usado. Peça um novo abaixo.',
};

export default async function MeusIngressos({ searchParams }: Props) {
  const { erro } = await searchParams;

  const store = await cookies();
  const email = lerSessaoComprador(store.get(COOKIE_COMPRADOR)?.value, env().AUTH_SECRET);

  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho comBusca={false} />
      </Suspense>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        {!email ? (
          <div className="mx-auto max-w-sm">
            <h1 className="font-titulo text-xl font-bold">Meus ingressos</h1>
            <p className="prosa mt-2 text-sm text-muted">
              Informe o e-mail que você usou na compra. Enviamos um link de acesso — sem senha,
              sem cadastro.
            </p>

            {erro && MOTIVOS[erro] && (
              <p
                role="alert"
                className="mt-5 rounded-botao border border-alerta/40 bg-alerta/10 px-3 py-2.5 text-sm text-alerta"
              >
                {MOTIVOS[erro]}
              </p>
            )}

            <FormularioAcesso />
          </div>
        ) : (
          <ListaDeIngressos email={email} />
        )}
      </main>

      <Rodape />
    </div>
  );
}

async function ListaDeIngressos({ email }: { email: string }) {
  const ingressos = await ingressosPorEmail(email);
  const agora = new Date();

  const proximos = ingressos.filter((i) => i.eventoInicio > agora);
  const passados = ingressos.filter((i) => i.eventoInicio <= agora);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-titulo text-xl font-bold">Meus ingressos</h1>
        <form action={sairDaAreaDoComprador}>
          <button className="text-sm text-muted transition hover:text-txt">
            Sair ({email})
          </button>
        </form>
      </div>

      {ingressos.length === 0 ? (
        <div className="mt-8 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
          <p className="font-titulo text-lg font-semibold">Nenhum ingresso por aqui</p>
          <p className="prosa mx-auto mt-2 text-sm text-muted">
            Não encontramos compras confirmadas para {email}. Se você comprou com outro e-mail,
            saia e entre com ele.
          </p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt"
          >
            Ver eventos
          </Link>
        </div>
      ) : (
        <>
          {proximos.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                Próximos
              </h2>
              <ul className="mt-4 space-y-3">
                {proximos.map((i) => (
                  <CartaoIngresso key={i.id} ingresso={i} destaque />
                ))}
              </ul>
            </section>
          )}

          {passados.length > 0 && (
            <section className="mt-12">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                Já aconteceram
              </h2>
              <ul className="mt-4 space-y-3 opacity-60">
                {passados.map((i) => (
                  <CartaoIngresso key={i.id} ingresso={i} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function CartaoIngresso({
  ingresso,
  destaque = false,
}: {
  ingresso: Awaited<ReturnType<typeof ingressosPorEmail>>[number];
  destaque?: boolean;
}) {
  const cancelado = ingresso.status === 'cancelado';
  const usado = ingresso.status === 'usado';

  return (
    <li>
      <Link
        href={`/ingresso/${ingresso.codigo}`}
        className="flex items-center gap-4 rounded-cartao border border-line bg-raised p-4 transition hover:border-borda-forte hover:bg-fundo-cartao"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{ingresso.eventoTitulo}</p>
          <p className="tabular mt-0.5 text-sm text-muted">
            {dataLonga(ingresso.eventoInicio)}, às {hora(ingresso.eventoInicio)}
          </p>
          <p className="mt-0.5 truncate text-sm text-faint">
            {ingresso.venueNome}
            {ingresso.cidade ? ` · ${ingresso.cidade}` : ''}
          </p>
          <p className="mt-1.5 text-xs text-faint">
            {ingresso.titular} · {ingresso.lote}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="tabular text-sm font-semibold">{ingresso.codigo}</p>
          {cancelado && <p className="mt-1 text-xs text-perigo">Cancelado</p>}
          {usado && <p className="mt-1 text-xs text-sucesso">Entrou</p>}
          {destaque && !cancelado && !usado && (
            <p className="mt-1 text-xs text-muted">em {faltam(ingresso.eventoInicio)}</p>
          )}
        </div>
      </Link>
    </li>
  );
}
