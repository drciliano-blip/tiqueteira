'use client';

import { useActionState } from 'react';

import type { EstadoFormulario } from '../acoes';

const INICIAL: EstadoFormulario = {};
const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

export function FormularioEspaco({
  acao,
}: {
  acao: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
}) {
  const [estado, enviar, enviando] = useActionState(acao, INICIAL);

  return (
    <form action={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="nome" className="block text-sm font-medium">
            Nome
          </label>
          <input id="nome" name="nome" required maxLength={120} className={campo} />
        </div>
        <div>
          <label htmlFor="capacidadeMaxima" className="block text-sm font-medium">
            Capacidade
          </label>
          <input
            id="capacidadeMaxima"
            name="capacidadeMaxima"
            type="number"
            min={1}
            required
            className={campo}
          />
        </div>
      </div>

      <div>
        <label htmlFor="endereco" className="block text-sm font-medium">
          Endereço <span className="font-normal text-faint">(opcional)</span>
        </label>
        <input id="endereco" name="endereco" maxLength={200} className={campo} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="cidade" className="block text-sm font-medium">
            Cidade
          </label>
          <input id="cidade" name="cidade" maxLength={80} className={campo} />
        </div>
        <div>
          <label htmlFor="uf" className="block text-sm font-medium">
            UF
          </label>
          <input id="uf" name="uf" maxLength={2} placeholder="SP" className={campo} />
        </div>
      </div>

      {estado.erro && (
        <p
          role="alert"
          className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo"
        >
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p className="rounded-botao border border-sucesso/40 bg-sucesso/10 px-3 py-2.5 text-sm text-sucesso">
          Espaço cadastrado.
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-botao bg-accent px-6 py-3 font-semibold text-accent-txt transition disabled:opacity-60"
      >
        {enviando ? 'Salvando…' : 'Cadastrar espaço'}
      </button>
    </form>
  );
}
