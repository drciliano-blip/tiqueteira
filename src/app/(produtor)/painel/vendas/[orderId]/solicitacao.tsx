'use client';

import { useActionState, useState } from 'react';

import { recusarSolicitacaoDoComprador, type EstadoFormulario } from '../../acoes';

const INICIAL: EstadoFormulario = {};

/** Responder sem devolver — ADR-023. A resposta vai por e-mail ao comprador. */
export function ResponderSemDevolucao({
  tenantId,
  orderId,
  solicitacaoId,
}: {
  tenantId: string;
  orderId: string;
  solicitacaoId: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, enviar, enviando] = useActionState(
    recusarSolicitacaoDoComprador.bind(null, tenantId, orderId, solicitacaoId),
    INICIAL,
  );

  if (estado.ok) {
    return <p className="text-sm text-sucesso">Resposta enviada ao comprador.</p>;
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-sm text-muted underline-offset-2 transition hover:text-txt hover:underline"
      >
        Responder sem devolução
      </button>
    );
  }

  return (
    <form action={enviar} className="space-y-3">
      <label htmlFor="resposta" className="block text-sm font-medium">
        Resposta ao comprador
      </label>
      <textarea
        id="resposta"
        name="resposta"
        required
        minLength={15}
        maxLength={2000}
        rows={3}
        placeholder="Explique o que foi verificado e por que não haverá devolução."
        className="w-full rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
      />
      <p className="text-xs text-faint">
        Vai por e-mail ao comprador e fica registrada. Seja claro: uma resposta vaga é o que
        leva a reclamação ao Procon.
      </p>
      {estado.erro && (
        <p role="alert" className="text-sm text-perigo">
          {estado.erro}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-botao bg-accent px-4 py-2 text-sm font-semibold text-accent-txt disabled:opacity-60"
        >
          {enviando ? 'Enviando…' : 'Enviar resposta'}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="text-sm text-muted">
          Voltar
        </button>
      </div>
    </form>
  );
}
