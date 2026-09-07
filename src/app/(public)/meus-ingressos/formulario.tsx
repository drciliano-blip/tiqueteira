'use client';

import { useActionState } from 'react';

import { pedirLink, type EstadoAcesso } from './acoes';

const INICIAL: EstadoAcesso = {};

export function FormularioAcesso() {
  const [estado, acao, enviando] = useActionState(pedirLink, INICIAL);

  if (estado.enviado) {
    return (
      <div className="mt-6 rounded-cartao border border-sucesso/40 bg-sucesso/10 px-4 py-5">
        <p className="font-semibold text-sucesso">Link enviado</p>
        <p className="prosa mt-2 text-sm text-muted">
          Se existir compra com esse e-mail, o link chega em instantes. Ele vale por 15 minutos
          e só funciona uma vez.
        </p>
        <p className="mt-3 text-xs text-faint">
          Não chegou? Confira a caixa de spam antes de pedir outro.
        </p>
      </div>
    );
  }

  return (
    <form action={acao} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          E-mail da compra
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          autoFocus
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
        {enviando ? 'Enviando…' : 'Receber link de acesso'}
      </button>
    </form>
  );
}
