'use client';

import { useState, useTransition } from 'react';

import { mudarStatusDoEvento } from '../../acoes';

const ROTULO: Record<string, string> = {
  rascunho: 'Rascunho',
  publicado: 'À venda',
  esgotado: 'Esgotado',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
  adiado: 'Adiado',
};

/**
 * Publicar e despublicar.
 *
 * Cancelar não está aqui de propósito: cancelar evento dispara reembolso em
 * massa e é irreversível. Uma ação dessas não pode ficar a um clique de
 * distância do botão de publicar — entra em tela própria, com confirmação e
 * justificativa registrada no audit_log.
 */
export function BotoesStatus({
  tenantId,
  eventId,
  status,
  temLoteAtivo,
}: {
  tenantId: string;
  eventId: string;
  status: string;
  temLoteAtivo: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [mudando, iniciar] = useTransition();

  const mudar = (novo: 'publicado' | 'rascunho' | 'encerrado') =>
    iniciar(async () => {
      const r = await mudarStatusDoEvento(tenantId, eventId, novo);
      setErro(r.erro ?? null);
    });

  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-3">
        <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
          {ROTULO[status] ?? status}
        </span>

        {status === 'rascunho' && (
          <button
            type="button"
            disabled={mudando || !temLoteAtivo}
            onClick={() => mudar('publicado')}
            title={temLoteAtivo ? undefined : 'Crie ao menos um lote antes de publicar'}
            className="rounded-botao bg-accent px-5 py-2.5 text-sm font-semibold text-accent-txt disabled:opacity-50"
          >
            {mudando ? 'Publicando…' : 'Publicar'}
          </button>
        )}

        {status === 'publicado' && (
          <button
            type="button"
            disabled={mudando}
            onClick={() => mudar('rascunho')}
            className="rounded-botao border border-line-forte px-4 py-2.5 text-sm font-medium transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Tirar da vitrine
          </button>
        )}
      </div>

      {erro && (
        <p role="alert" className="mt-2 max-w-xs text-right text-xs text-perigo">
          {erro}
        </p>
      )}
    </div>
  );
}
