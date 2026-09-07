import Link from 'next/link';

export function Rodape() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="font-titulo font-bold">Tiqueteira</p>
          <p className="prosa mt-2 text-sm text-faint">
            Plataforma de venda de ingressos para casas e produtores.
          </p>
        </div>

        <nav aria-label="Comprador">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
            Comprador
          </p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <Link href="/meus-ingressos" className="transition hover:text-txt">
                Meus ingressos
              </Link>
            </li>
            <li>
              <Link href="/como-funciona" className="transition hover:text-txt">
                Como funciona
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Produtor">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">Produtor</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <Link href="/publique" className="transition hover:text-txt">
                Publique seu evento
              </Link>
            </li>
            <li>
              <Link href="/entrar" className="transition hover:text-txt">
                Entrar no painel
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 px-4 py-5 text-xs text-faint">
          <Link href="/termos" className="transition hover:text-muted">
            Termos de uso
          </Link>
          <Link href="/privacidade" className="transition hover:text-muted">
            Política de privacidade
          </Link>
          <span className="ml-auto">© {new Date().getFullYear()} Tiqueteira</span>
        </div>
      </div>
    </footer>
  );
}
