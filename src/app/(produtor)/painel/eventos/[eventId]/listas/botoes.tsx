'use client';

import { useTransition } from 'react';

import { ligarDesligarLista, tirarDaLista } from './acoes';

/**
 * Desativar a lista é o botão de emergência do produtor: às 23h ele descobre
 * que o promoter colocou nome demais, e precisa fechar a lista sem apagar
 * ninguém — quem já entrou continua no histórico.
 */
export function BotaoLigar({
  eventId,
  listaId,
  ativo,
}: {
  eventId: string;
  listaId: string;
  ativo: boolean;
}) {
  const [pendente, iniciar] = useTransition();

  return (
    <button
      type="button"
      disabled={pendente}
      onClick={() => iniciar(() => ligarDesligarLista(eventId, listaId, !ativo))}
      className="shrink-0 rounded-botao border border-line px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
    >
      {ativo ? 'Desativar' : 'Reativar'}
    </button>
  );
}

export function BotaoRemover({ eventId, entradaId }: { eventId: string; entradaId: string }) {
  const [pendente, iniciar] = useTransition();

  return (
    <button
      type="button"
      disabled={pendente}
      onClick={() => iniciar(() => tirarDaLista(eventId, entradaId))}
      className="shrink-0 text-xs text-faint hover:text-perigo disabled:opacity-60"
    >
      remover
    </button>
  );
}
