'use client';

import { useActionState, useState } from 'react';

import { formatarBRL } from '@/lib/money';
import { reembolsarPedido, type EstadoFormulario } from '../../acoes';

const INICIAL: EstadoFormulario = {};

/**
 * Reembolso a partir da tela do pedido.
 *
 * Duas modalidades, e a diferença importa:
 *
 * - **Dentro do prazo**: a regra decide sozinha, e qualquer operador pode.
 * - **Fora do prazo**: exige dono ou administrador, e fica marcado como
 *   autorização manual no `audit_log`. É a exceção que a vida exige — erro de
 *   digitação, cobrança em duplicidade —, mas exceção precisa ter dono.
 */
export function FormularioReembolso({
  tenantId,
  orderId,
  ingressosValidos,
  totalCentavos,
  podeManual,
}: {
  tenantId: string;
  orderId: string;
  ingressosValidos: number;
  totalCentavos: number;
  podeManual: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const acao = reembolsarPedido.bind(null, tenantId, orderId);
  const [estado, enviar, enviando] = useActionState(acao, INICIAL);
  const [quantidade, setQuantidade] = useState(ingressosValidos);

  if (estado.ok) {
    return (
      <div className="rounded-cartao border border-sucesso/40 bg-sucesso/10 px-4 py-4">
        <p className="font-semibold text-sucesso">Reembolso registrado</p>
        <p className="prosa mt-1.5 text-sm text-muted">
          Os ingressos devolvidos foram cancelados. A devolução aparece na conta do comprador no
          prazo do meio de pagamento usado.
        </p>
      </div>
    );
  }

  if (ingressosValidos === 0) {
    return (
      <p className="text-sm text-faint">
        Não há ingresso válido neste pedido para reembolsar.
      </p>
    );
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-botao border border-line-forte px-4 py-2.5 text-sm font-medium transition hover:border-perigo hover:text-perigo"
      >
        Reembolsar
      </button>
    );
  }

  // Estimativa proporcional; o valor que vale é o calculado no servidor.
  const estimado = Math.round((totalCentavos * quantidade) / ingressosValidos);

  return (
    <form action={enviar} className="space-y-4 rounded-cartao border border-line bg-raised p-4">
      <div>
        <label htmlFor="quantidade" className="block text-sm font-medium">
          Quantos ingressos devolver
        </label>
        <select
          id="quantidade"
          name="quantidade"
          value={quantidade}
          onChange={(e) => setQuantidade(Number(e.target.value))}
          className="mt-1.5 w-full rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        >
          {Array.from({ length: ingressosValidos }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'ingresso' : 'ingressos'}
              {n === ingressosValidos ? ' (todos)' : ''}
            </option>
          ))}
        </select>
        <p className="tabular mt-1.5 text-xs text-faint">
          Devolução estimada: {formatarBRL(estimado)}
        </p>
      </div>

      <div>
        <label htmlFor="observacao" className="block text-sm font-medium">
          Observação <span className="font-normal text-faint">(opcional)</span>
        </label>
        <input
          id="observacao"
          name="observacao"
          maxLength={300}
          className="mt-1.5 w-full rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      {podeManual && (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="manual" className="mt-0.5 h-4 w-4" />
          <span>
            Autorizar fora do prazo
            <span className="block text-xs text-faint">
              Ignora a janela de cancelamento. Fica registrado com seu nome na auditoria.
            </span>
          </span>
        </label>
      )}

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
          {enviando ? 'Processando…' : 'Confirmar reembolso'}
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
