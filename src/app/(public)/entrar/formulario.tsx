'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { entrarComSenha, type EstadoLogin } from './acoes';

const INICIAL: EstadoLogin = {};

export function FormularioLogin({ cadastro }: { cadastro: boolean }) {
  const [estado, acao, enviando] = useActionState(entrarComSenha, INICIAL);

  return (
    <>
      {cadastro && (
        <div className="mb-6 rounded-cartao border border-line bg-raised px-4 py-4">
          <p className="text-sm font-medium">Quer vender pela plataforma?</p>
          <p className="prosa mt-1 text-sm text-muted">
            O cadastro de produtor ainda é feito por nós, um a um — é o que garante que cada
            recebedor esteja verificado antes da primeira venda. Fale com a equipe e criamos seu
            acesso.
          </p>
        </div>
      )}

      <form action={acao} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="senha" className="block text-sm font-medium">
            Senha
          </label>
          <input
            id="senha"
            name="senha"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>

        {estado.erro && (
          <p
            role="alert"
            className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo"
          >
            {estado.erro}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-botao bg-accent py-3 font-semibold text-accent-txt transition disabled:opacity-60"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" />
        ou
        <span className="h-px flex-1 bg-line" />
      </div>

      {/*
        Entrar com Google exige credencial de OAuth criada no Google Cloud.
        Deixar o botão visível e desabilitado é melhor que escondê-lo: quem
        procura essa opção descobre que ela existe e está a caminho.
      */}
      <button
        type="button"
        disabled
        title="Disponível assim que a credencial do Google for configurada"
        className="flex w-full items-center justify-center gap-2 rounded-botao border border-line py-3 text-sm font-medium text-muted opacity-60"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
          <path
            fill="currentColor"
            d="M21.35 11.1h-9.17v2.96h5.27c-.23 1.37-1.6 4.02-5.27 4.02-3.17 0-5.76-2.62-5.76-5.85s2.59-5.85 5.76-5.85c1.8 0 3.01.77 3.7 1.43l2.52-2.43C16.9 3.9 14.77 3 12.18 3 7.03 3 2.86 7.16 2.86 12.3s4.17 9.3 9.32 9.3c5.38 0 8.94-3.78 8.94-9.1 0-.61-.07-1.08-.17-1.4Z"
          />
        </svg>
        Entrar com Google
      </button>

      <p className="mt-6 text-center text-sm text-muted">
        Comprou um ingresso?{' '}
        <Link href="/meus-ingressos" className="font-medium text-accent">
          Acesse sem senha
        </Link>
      </p>
    </>
  );
}
