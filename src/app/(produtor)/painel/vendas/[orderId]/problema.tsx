'use client';

import { useActionState, useState } from 'react';

import { formatarBRL } from '@/lib/money';
import { reembolsarPorProblema, type EstadoFormulario } from '../../acoes';

const INICIAL: EstadoFormulario = {};

const PROBLEMAS = [
  {
    valor: 'evento_nao_realizado',
    rotulo: 'O evento não aconteceu',
    ajuda: 'Não foi realizado e não foi cancelado pelo sistema.',
  },
  {
    valor: 'servico_nao_prestado',
    rotulo: 'O comprador não recebeu o serviço',
    ajuda: 'Barrado indevidamente, setor fechado, lotação estourada.',
  },
  {
    valor: 'servico_diferente_do_ofertado',
    rotulo: 'O evento foi diferente do anunciado',
    ajuda: 'Atração principal ausente, local, data ou horário trocados.',
  },
  {
    valor: 'reclamacao_procedente',
    rotulo: 'Reclamação procedente',
    ajuda: 'Reclamação reconhecida que não se encaixa nas anteriores.',
  },
] as const;

/**
 * Reembolso por falha na prestação do serviço — ADR-022.
 *
 * Separado do formulário comum de propósito: aqui não se trata de exceção de
 * prazo, e sim de reconhecer que o que foi vendido não foi entregue. Não tem
 * prazo, não depende da política do evento, e exige o relato por escrito.
 */
export function ReembolsoPorProblema({
  tenantId,
  orderId,
  ingressos,
  totalCentavos,
}: {
  tenantId: string;
  orderId: string;
  /** Ingressos que ainda contam: válidos e já usados. */
  ingressos: number;
  totalCentavos: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [modalidade, setModalidade] = useState<'integral' | 'abatimento'>('integral');
  const [quantidade, setQuantidade] = useState(ingressos);
  const acao = reembolsarPorProblema.bind(null, tenantId, orderId);
  const [estado, enviar, enviando] = useActionState(acao, INICIAL);

  if (estado.ok) {
    return (
      <div className="rounded-cartao border border-sucesso/40 bg-sucesso/10 px-4 py-4">
        <p className="font-semibold text-sucesso">Devolução registrada</p>
        <p className="prosa mt-1.5 text-sm text-muted">
          O relato ficou na auditoria com seu nome. A devolução aparece na conta do comprador no
          prazo do meio de pagamento usado.
        </p>
      </div>
    );
  }

  if (ingressos === 0) return null;

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-botao border border-line-forte px-4 py-2.5 text-sm font-medium transition hover:border-perigo hover:text-perigo"
      >
        Devolver por problema no evento
      </button>
    );
  }

  const teto = Math.round((totalCentavos * quantidade) / ingressos);

  return (
    <form action={enviar} className="space-y-5 rounded-cartao border border-line bg-raised p-4">
      <fieldset>
        <legend className="text-sm font-medium">O que aconteceu</legend>
        <div className="mt-2 space-y-2">
          {PROBLEMAS.map((p) => (
            <label key={p.valor} className="flex items-start gap-3 text-sm">
              <input type="radio" name="problema" value={p.valor} required className="mt-1 h-4 w-4" />
              <span>
                {p.rotulo}
                <span className="block text-xs text-faint">{p.ajuda}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="quantidade-problema" className="block text-sm font-medium">
          Ingressos afetados
        </label>
        <select
          id="quantidade-problema"
          name="quantidade"
          value={quantidade}
          onChange={(e) => setQuantidade(Number(e.target.value))}
          className="mt-1.5 w-full rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        >
          {Array.from({ length: ingressos }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'ingresso' : 'ingressos'}
              {n === ingressos ? ' (todos)' : ''}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Como devolver</legend>
        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="modalidade"
              value="integral"
              checked={modalidade === 'integral'}
              onChange={() => setModalidade('integral')}
              className="mt-1 h-4 w-4"
            />
            <span>
              Devolução integral
              <span className="tabular block text-xs text-faint">
                Cerca de {formatarBRL(teto)}, taxa incluída. Os ingressos que ainda valem são
                cancelados.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="modalidade"
              value="abatimento"
              checked={modalidade === 'abatimento'}
              onChange={() => setModalidade('abatimento')}
              className="mt-1 h-4 w-4"
            />
            <span>
              Abatimento parcial
              <span className="block text-xs text-faint">
                Devolve parte do valor e o ingresso continua valendo. Para quando o evento
                aconteceu, mas pior do que o anunciado.
              </span>
            </span>
          </label>
        </div>
        {modalidade === 'abatimento' && (
          <div className="mt-3">
            <label htmlFor="abatimento" className="block text-sm font-medium">
              Valor a devolver (R$)
            </label>
            <input
              id="abatimento"
              name="abatimento"
              inputMode="decimal"
              placeholder="0,00"
              required
              className="tabular mt-1.5 w-40 rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
            />
            <p className="tabular mt-1.5 text-xs text-faint">Máximo: {formatarBRL(teto)}</p>
          </div>
        )}
      </fieldset>

      <div>
        <label htmlFor="justificativa" className="block text-sm font-medium">
          Relato
        </label>
        <textarea
          id="justificativa"
          name="justificativa"
          required
          minLength={15}
          maxLength={1000}
          rows={3}
          placeholder="O que aconteceu, quando, e como o comprador foi afetado."
          className="mt-1.5 w-full rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-faint">
          Fica registrado com seu nome. É o que responde se o comprador reclamar ao Procon ou
          contestar a compra no cartão.
        </p>
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
          {enviando ? 'Processando…' : 'Confirmar devolução'}
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
