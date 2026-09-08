'use client';

import { useActionState, useState } from 'react';

import { cancelarEvento, type EstadoFormulario } from '../../acoes';

const INICIAL: EstadoFormulario = {};

/**
 * Cancelar evento.
 *
 * Fica no fim da página, atrás de um botão, com confirmação por digitação e
 * justificativa obrigatória. É deliberadamente chato: a ação devolve dinheiro
 * para todo mundo, cancela todos os ingressos e não tem como desfazer.
 */
export function CancelarEvento({
  tenantId,
  eventId,
  titulo,
  pedidosPagos,
}: {
  tenantId: string;
  eventId: string;
  titulo: string;
  pedidosPagos: number;
}) {
  const [aberto, setAberto] = useState(false);
  const acao = cancelarEvento.bind(null, tenantId, eventId);
  const [estado, enviar, enviando] = useActionState(acao, INICIAL);

  if (estado.ok) {
    return (
      <div className="rounded-cartao border border-perigo/40 bg-perigo/10 px-5 py-6">
        <p className="font-titulo font-bold text-perigo">Evento cancelado</p>
        <p className="prosa mt-2 text-sm text-muted">
          As vendas foram encerradas e os reembolsos entraram na fila. Eles são processados em
          lotes e podem levar alguns minutos para aparecer como concluídos.
        </p>
      </div>
    );
  }

  if (!aberto) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="rounded-botao border border-perigo/50 px-5 py-2.5 text-sm font-medium text-perigo transition hover:bg-perigo/10"
        >
          Cancelar evento
        </button>
        <p className="mt-2 text-xs text-faint">
          Devolve o dinheiro de todos os compradores e invalida todos os ingressos.
        </p>
      </div>
    );
  }

  return (
    <form
      action={enviar}
      className="space-y-4 rounded-cartao border border-perigo/40 bg-perigo/5 p-5"
    >
      <div>
        <p className="font-titulo font-bold text-perigo">Cancelar {titulo}</p>
        <p className="prosa mt-2 text-sm text-muted">
          {pedidosPagos > 0 ? (
            <>
              <strong className="text-txt">
                {pedidosPagos} {pedidosPagos === 1 ? 'pedido pago' : 'pedidos pagos'}
              </strong>{' '}
              serão reembolsados integralmente, taxa incluída, e todos os ingressos serão
              invalidados. Não há como desfazer.
            </>
          ) : (
            'Nenhum pedido pago até agora, então não haverá reembolso. Ainda assim, o evento sai da vitrine e não há como desfazer.'
          )}
        </p>
      </div>

      <div>
        <label htmlFor="justificativa" className="block text-sm font-medium">
          Motivo do cancelamento
        </label>
        <textarea
          id="justificativa"
          name="justificativa"
          rows={3}
          required
          minLength={10}
          placeholder="Ex.: interdição do espaço pela prefeitura"
          className="mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-perigo focus:outline-none"
        />
        <p className="mt-1 text-xs text-faint">
          Fica registrado na trilha de auditoria, com seu nome e o horário.
        </p>
      </div>

      <div>
        <label htmlFor="confirmacao" className="block text-sm font-medium">
          Digite <span className="font-mono text-perigo">{titulo}</span> para confirmar
        </label>
        <input
          id="confirmacao"
          name="confirmacao"
          required
          autoComplete="off"
          className="mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-perigo focus:outline-none"
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

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-botao bg-perigo px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {enviando ? 'Cancelando…' : 'Cancelar evento e reembolsar todos'}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="rounded-botao border border-line px-5 py-2.5 text-sm text-muted transition hover:text-txt"
        >
          Voltar
        </button>
      </div>
    </form>
  );
}
