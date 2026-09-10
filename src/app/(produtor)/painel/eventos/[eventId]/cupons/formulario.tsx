'use client';

import { useActionState, useState, useTransition } from 'react';

import { ligarDesligarCupom, novoCupom, type EstadoCupom } from './acoes';

const INICIAL: EstadoCupom = {};
const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

export function FormularioCupom({ eventId }: { eventId: string }) {
  const [estado, enviar, enviando] = useActionState(novoCupom.bind(null, eventId), INICIAL);
  const [tipo, setTipo] = useState<'pct' | 'valor'>('pct');

  return (
    <form action={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="codigo" className="block text-sm font-medium">
            Código
          </label>
          <input
            id="codigo"
            name="codigo"
            required
            maxLength={40}
            placeholder="VERAO2026"
            className={`${campo} uppercase`}
          />
          <p className="mt-1.5 text-xs text-faint">
            Espaço e acentuação somem: o comprador digita no celular.
          </p>
        </div>

        <div>
          <label htmlFor="tipo" className="block text-sm font-medium">
            Tipo
          </label>
          <select
            id="tipo"
            name="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as 'pct' | 'valor')}
            className={campo}
          >
            <option value="pct">Percentual</option>
            <option value="valor">Valor fixo</option>
          </select>
        </div>

        <div>
          <label htmlFor="valor" className="block text-sm font-medium">
            {tipo === 'pct' ? 'Desconto (%)' : 'Desconto (R$)'}
          </label>
          <input
            id="valor"
            name="valor"
            type="number"
            step={tipo === 'pct' ? '0.5' : '0.01'}
            min="0.01"
            max={tipo === 'pct' ? '100' : undefined}
            required
            className={campo}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="usosMaximos" className="block text-sm font-medium">
            Limite de usos <span className="font-normal text-faint">(opcional)</span>
          </label>
          <input
            id="usosMaximos"
            name="usosMaximos"
            type="number"
            min={1}
            placeholder="sem limite"
            className={campo}
          />
        </div>

        <div>
          <label htmlFor="validoAte" className="block text-sm font-medium">
            Vale até <span className="font-normal text-faint">(opcional)</span>
          </label>
          <input id="validoAte" name="validoAte" type="datetime-local" className={campo} />
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="soNesteEvento" defaultChecked className="mt-0.5 h-4 w-4" />
        <span>
          Só neste evento
          <span className="block text-xs text-faint">
            Desmarcado, o cupom vale em todos os eventos da casa — inclusive nos que ainda nem
            foram criados.
          </span>
        </span>
      </label>

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
        className="rounded-botao bg-accent px-4 py-2.5 text-sm font-semibold text-accent-txt disabled:opacity-60"
      >
        {enviando ? 'Criando…' : 'Criar cupom'}
      </button>
    </form>
  );
}

export function BotaoCupom({
  eventId,
  cupomId,
  ativo,
}: {
  eventId: string;
  cupomId: string;
  ativo: boolean;
}) {
  const [pendente, iniciar] = useTransition();

  return (
    <button
      type="button"
      disabled={pendente}
      onClick={() => iniciar(() => ligarDesligarCupom(eventId, cupomId, !ativo))}
      className="shrink-0 rounded-botao border border-line px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
    >
      {ativo ? 'Desativar' : 'Reativar'}
    </button>
  );
}
