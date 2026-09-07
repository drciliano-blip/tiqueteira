import Link from 'next/link';

import { Marca } from '@/components/marca';
import { listarProdutores } from '@/lib/public-queries';

export const revalidate = 60;

export default async function Home() {
  const produtores = await listarProdutores();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-borda">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-5">
          <Marca />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-16">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Ingressos para os melhores eventos
        </h1>
        <p className="mt-3 max-w-lg text-texto-suave">
          Escolha um produtor para ver o que está à venda.
        </p>

        {produtores.length === 0 ? (
          <p className="mt-12 rounded-cartao border border-borda bg-fundo-elevado px-5 py-8 text-texto-suave">
            Nenhum evento à venda no momento.
          </p>
        ) : (
          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {produtores.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/${p.slug}`}
                  className="group flex items-center justify-between rounded-cartao border border-borda bg-fundo-elevado px-5 py-5 transition hover:border-borda-forte hover:bg-fundo-cartao"
                >
                  <span className="font-medium">{p.nome}</span>
                  <span
                    aria-hidden
                    className="text-texto-fraco transition group-hover:translate-x-0.5 group-hover:text-destaque"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="border-t border-borda">
        <div className="mx-auto max-w-5xl px-5 py-8 text-sm text-texto-fraco">
          Tiqueteira — plataforma de venda de ingressos.
        </div>
      </footer>
    </div>
  );
}
