'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { cadastrarProdutor, type EstadoCadastro } from './acoes';

const CAMPO =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none';

export function FormularioCadastro() {
  const [estado, enviar, enviando] = useActionState<EstadoCadastro, FormData>(cadastrarProdutor, {});

  return (
    <form action={enviar} className="mt-6 space-y-4">
      <Campo nome="casa" rotulo="Nome da casa ou produtora" auto="organization" />
      <Campo nome="nome" rotulo="Seu nome" auto="name" />
      <Campo nome="email" rotulo="E-mail" tipo="email" auto="email" />
      <Campo nome="telefone" rotulo="Celular" tipo="tel" auto="tel" placeholder="(11) 90000-0000" />
      <Campo nome="senha" rotulo="Senha" tipo="password" auto="new-password" ajuda="Pelo menos 10 caracteres." />

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="termos" required className="mt-0.5 h-4 w-4" />
        <span className="text-muted">
          Li e aceito os{' '}
          <Link href="/termos" className="text-accent" target="_blank">
            termos de uso
          </Link>{' '}
          e a{' '}
          <Link href="/privacidade" className="text-accent" target="_blank">
            política de privacidade
          </Link>
          .
        </span>
      </label>

      {estado.erro && (
        <p role="alert" className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo">
          {estado.erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt disabled:opacity-60"
      >
        {enviando ? 'Criando sua conta…' : 'Criar conta'}
      </button>
    </form>
  );
}

function Campo({
  nome,
  rotulo,
  tipo = 'text',
  auto,
  placeholder,
  ajuda,
}: {
  nome: string;
  rotulo: string;
  tipo?: string;
  auto?: string;
  placeholder?: string;
  ajuda?: string;
}) {
  return (
    <div>
      <label htmlFor={nome} className="block text-sm font-medium">
        {rotulo}
      </label>
      <input id={nome} name={nome} type={tipo} autoComplete={auto} placeholder={placeholder} required className={CAMPO} />
      {ajuda && <p className="mt-1 text-xs text-faint">{ajuda}</p>}
    </div>
  );
}
