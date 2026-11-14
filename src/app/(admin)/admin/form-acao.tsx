'use client';

import { useActionState, type ReactNode } from 'react';

import type { EstadoAdmin } from './acoes';

/**
 * Formulário genérico da área administrativa: os campos vêm de fora, e a
 * resposta (erro ou feito) aparece no próprio formulário.
 */
export function FormAcao({
  acao,
  botao,
  perigo,
  children,
}: {
  acao: (estado: EstadoAdmin, formData: FormData) => Promise<EstadoAdmin>;
  botao: string;
  perigo?: boolean;
  children: ReactNode;
}) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  return (
    <form action={enviar} className="space-y-3">
      {children}
      {estado.erro && (
        <p role="alert" className="text-sm text-perigo">
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="text-sm text-sucesso">
          Feito. Registrado na auditoria.
        </p>
      )}
      <button
        type="submit"
        disabled={enviando}
        className={`rounded-botao px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
          perigo ? 'bg-perigo' : 'bg-accent'
        }`}
      >
        {enviando ? 'Salvando…' : botao}
      </button>
    </form>
  );
}

export const CAMPO_ADMIN =
  'mt-1 w-full rounded-botao border border-line bg-base px-3 py-2 text-sm focus:border-accent focus:outline-none';

export function Motivo({ nome = 'justificativa' }: { nome?: string }) {
  return (
    <label className="block text-sm">
      Motivo (fica na auditoria)
      <textarea name={nome} required minLength={10} rows={2} className={CAMPO_ADMIN} />
    </label>
  );
}
