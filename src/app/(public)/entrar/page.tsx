import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Marca } from '@/components/marca';
import { getAuth } from '@/lib/session-cookie';
import { FormularioLogin } from './formulario';

export const metadata: Metadata = {
  title: 'Entrar',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ cadastro?: string }> };

export default async function Entrar({ searchParams }: Props) {
  // Quem já tem sessão não precisa ver tela de login.
  if (await getAuth()) redirect('/painel');

  const { cadastro } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4">
          <Marca />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
        <h1 className="font-titulo text-xl font-bold">Entrar no painel</h1>
        <p className="mt-1.5 text-sm text-muted">Para produtores, portaria e administração.</p>

        <div className="mt-8">
          <FormularioLogin cadastro={cadastro === '1'} />
        </div>
      </main>
    </div>
  );
}
