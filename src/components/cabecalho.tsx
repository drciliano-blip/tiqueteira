import Link from 'next/link';

import { AcoesDaConta } from '@/components/acoes-da-conta';
import { BuscaEventos } from '@/components/busca-eventos';
import { Marca } from '@/components/marca';
import { CATEGORIAS } from '@/domain/categorias';

/**
 * Navegação principal.
 *
 * Duas faixas, com papéis distintos:
 *
 * 1. **Comando** — marca, busca e as ações. A busca ocupa o centro porque é
 *    o que mais se usa; as ações ficam à direita, na ordem de frequência.
 * 2. **Categorias** — como o público explora quando ainda não sabe o que
 *    quer. É por aqui que a maioria navega, não pela busca digitada.
 *
 * A mesma navegação aparece em todas as páginas públicas. Trocar o cabeçalho
 * entre seções faz o comprador achar que saiu do site — e quem acha que saiu,
 * desiste da compra.
 *
 * **Este componente não lê cookie** — ADR-015. Ler cookie aqui tornava toda
 * página pública dinâmica, e o Next passava a ignorar `revalidate` em
 * silêncio: a página do evento ia ao banco em cada visita. O estado de login
 * vive em `AcoesDaConta`, que o resolve no navegador.
 */
export function Cabecalho({
  comBusca = true,
  comCategorias = true,
}: {
  comBusca?: boolean;
  comCategorias?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-base/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Marca />

        {comBusca && (
          <div className="ml-2 hidden min-w-0 max-w-md flex-1 md:block">
            <BuscaEventos />
          </div>
        )}

        <AcoesDaConta />
      </div>

      {comBusca && (
        <div className="border-t border-line px-4 py-2 md:hidden">
          <BuscaEventos />
        </div>
      )}

      {comCategorias && (
        <nav
          aria-label="Categorias"
          className="border-t border-line/70 bg-base/60"
        >
          <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 py-1.5">
            <Link
              href="/"
              className="shrink-0 rounded-botao px-3 py-1.5 text-sm text-muted transition hover:bg-raised hover:text-txt"
            >
              Tudo
            </Link>
            {CATEGORIAS.map((c) => (
              <Link
                key={c.valor}
                href={`/?categoria=${c.valor}`}
                className="shrink-0 rounded-botao px-3 py-1.5 text-sm text-muted transition hover:bg-raised hover:text-txt"
              >
                {c.rotulo}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
