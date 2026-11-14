import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { Rodape } from '@/components/rodape';
import { FormularioCadastro } from './formulario';

export const metadata: Metadata = {
  title: 'Criar conta de produtor',
  description: 'Venda ingressos com a sua marca, receba direto na sua conta e controle a portaria.',
};

export default function Cadastro() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho comBusca={false} comCategorias={false} />
      </Suspense>
      <main className="mx-auto w-full max-w-sm flex-1 px-4 py-12">
        <h1 className="font-titulo text-2xl font-bold">Comece a vender</h1>
        <p className="prosa mt-2 text-sm text-muted">
          Crie a conta em um minuto. Você monta o primeiro evento na hora; para vender online,
          falta só cadastrar a conta onde o dinheiro cai.
        </p>
        <FormularioCadastro />
        <p className="mt-6 text-center text-sm text-muted">
          Já tem conta?{' '}
          <Link href="/entrar" className="text-accent">
            Entrar
          </Link>
        </p>
      </main>
      <Rodape />
    </div>
  );
}
