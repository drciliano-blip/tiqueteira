import Link from 'next/link';

import { BuscaEventos } from '@/components/busca-eventos';
import { Marca } from '@/components/marca';
import { getAuth } from '@/lib/session-cookie';

/**
 * Cabeçalho da plataforma.
 *
 * A porta de entrada atende dois públicos com intenções opostas — quem vem
 * comprar e quem vem vender — e precisa deixar os dois caminhos visíveis sem
 * dar o mesmo peso aos dois. Comprar é o volume; vender é o negócio.
 *
 * Por isso: busca ocupa o centro, "Publique seu evento" fica discreto à
 * direita, e "Meus ingressos" aparece porque é o que o comprador procura
 * depois — e é o campeão de chamado de suporte em qualquer bilheteria.
 */
export async function Cabecalho({ comBusca = true }: { comBusca?: boolean }) {
  const auth = await getAuth();
  const temPainel = auth !== null && auth.papeis.length > 0;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-base/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Marca />

        {comBusca && (
          <div className="hidden min-w-0 flex-1 md:block">
            <BuscaEventos />
          </div>
        )}

        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link
            href="/como-funciona"
            className="hidden rounded-botao px-3 py-2 text-sm text-muted transition hover:text-txt lg:block"
          >
            Como funciona
          </Link>
          <Link
            href="/meus-ingressos"
            className="rounded-botao px-3 py-2 text-sm text-muted transition hover:text-txt"
          >
            Meus ingressos
          </Link>

          {temPainel ? (
            <Link
              href="/painel"
              className="rounded-botao border border-line-forte px-3 py-2 text-sm font-medium transition hover:border-accent hover:text-accent"
            >
              Painel
            </Link>
          ) : (
            <>
              <Link
                href="/publique"
                className="hidden rounded-botao px-3 py-2 text-sm text-muted transition hover:text-txt sm:block"
              >
                Publique seu evento
              </Link>
              <Link
                href="/entrar"
                className="rounded-botao border border-line-forte px-3 py-2 text-sm font-medium transition hover:border-accent hover:text-accent"
              >
                Entrar
              </Link>
            </>
          )}
        </nav>
      </div>

      {comBusca && (
        <div className="border-t border-line px-4 pb-3 pt-2 md:hidden">
          <BuscaEventos />
        </div>
      )}
    </header>
  );
}
