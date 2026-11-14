import type { Metadata } from 'next';
import Link from 'next/link';

import { Marca } from '@/components/marca';
import { exigirAdmin } from '@/lib/admin';
import { sair } from '@/app/(public)/entrar/acoes';

export const metadata: Metadata = {
  title: { default: 'Administração', template: '%s · Administração' },
  robots: { index: false, follow: false },
};

const MENU = [
  { href: '/admin', rotulo: 'Visão geral' },
  { href: '/admin/produtores', rotulo: 'Produtores' },
  { href: '/admin/pedidos', rotulo: 'Pedidos' },
  { href: '/admin/repasses', rotulo: 'Repasses' },
  { href: '/admin/operacao', rotulo: 'Operação' },
  { href: '/admin/auditoria', rotulo: 'Auditoria' },
];

/** Área da equipe da plataforma — ADR-025. */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const auth = await exigirAdmin();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Marca href="/admin" />
          <span className="text-sm text-faint">/</span>
          <span className="text-sm font-medium text-perigo">Administração</span>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="hidden text-faint sm:inline">{auth.email}</span>
            <form action={sair}>
              <button className="text-muted transition hover:text-txt">Sair</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2">
          {MENU.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="shrink-0 whitespace-nowrap rounded-botao px-3 py-2 text-sm text-muted transition hover:bg-raised hover:text-txt"
            >
              {m.rotulo}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
