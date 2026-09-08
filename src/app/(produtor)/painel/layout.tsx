import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Marca } from '@/components/marca';
import { sair } from '@/app/(public)/entrar/acoes';
import { tenantAtual } from '@/lib/painel-contexto';

export const metadata: Metadata = {
  title: { default: 'Painel', template: '%s · Painel' },
  robots: { index: false, follow: false },
};

export default async function LayoutPainel({ children }: { children: ReactNode }) {
  const ctx = await tenantAtual();

  if (!ctx) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-titulo text-lg font-bold">Sua conta ainda não tem acesso</h1>
        <p className="prosa mx-auto mt-2 text-sm text-muted">
          Peça a quem administra a plataforma para vincular seu usuário a um produtor.
        </p>
        <form action={sair} className="mt-6">
          <button className="text-sm text-accent">Sair</button>
        </form>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Marca href="/painel" />
          <span className="text-sm text-faint">/</span>
          <span className="min-w-0 truncate text-sm font-medium">{ctx.tenant.nome}</span>

          <div className="ml-auto flex items-center gap-4 text-sm">
            <Link href={`/${ctx.tenant.slug}`} className="text-muted transition hover:text-txt">
              Ver vitrine
            </Link>
            <form action={sair}>
              <button className="text-muted transition hover:text-txt">Sair</button>
            </form>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 px-3 pb-2">
          {[
            { href: '/painel', rotulo: 'Visão geral' },
            { href: '/painel/vendas', rotulo: 'Vendas' },
            { href: '/painel/eventos/novo', rotulo: 'Novo evento' },
            { href: '/painel/espacos', rotulo: 'Espaços' },
            { href: '/painel/saude', rotulo: 'Saúde' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-botao px-3 py-2 text-sm text-muted transition hover:bg-raised hover:text-txt"
            >
              {item.rotulo}
            </Link>
          ))}
        </nav>
      </header>

      {children}
    </div>
  );
}
