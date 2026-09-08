'use client';

import { useState, useTransition } from 'react';

import { reenviarIngressos } from '../acoes';

/**
 * "Não recebi o ingresso" é o chamado número um de qualquer bilheteria.
 * Quase sempre é caixa de spam ou e-mail digitado errado, e resolver na hora
 * evita que o caso atravesse a noite.
 */
export function BotaoReenviar({
  tenantId,
  orderId,
  email,
}: {
  tenantId: string;
  orderId: string;
  email: string;
}) {
  const [estado, setEstado] = useState<'parado' | 'ok' | 'erro'>('parado');
  const [mensagem, setMensagem] = useState('');
  const [enviando, iniciar] = useTransition();

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={enviando}
        onClick={() =>
          iniciar(async () => {
            const r = await reenviarIngressos(tenantId, orderId);
            if (r.ok) {
              setEstado('ok');
              setMensagem(`Reenviado para ${email}`);
            } else {
              setEstado('erro');
              setMensagem(r.erro ?? 'Não foi possível reenviar.');
            }
          })
        }
        className="rounded-botao border border-line-forte px-4 py-2.5 text-sm font-medium transition hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {enviando ? 'Enviando…' : 'Reenviar ingresso'}
      </button>

      {estado !== 'parado' && (
        <p
          role="status"
          className={`mt-2 max-w-xs text-xs ${estado === 'ok' ? 'text-sucesso' : 'text-perigo'}`}
        >
          {mensagem}
        </p>
      )}
    </div>
  );
}
