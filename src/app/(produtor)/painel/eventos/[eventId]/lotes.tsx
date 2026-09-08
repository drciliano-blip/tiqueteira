'use client';

import { useActionState, useState } from 'react';

import { formatarBRL } from '@/lib/money';
import { alternarLote, salvarLote, type EstadoFormulario } from '../../acoes';

const INICIAL: EstadoFormulario = {};
const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

export type Lote = {
  id: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  tipo: string;
  quantidadeTotal: number;
  quantidadeVendida: number;
  quantidadeReservada: number;
  limitePorPedido: number;
  vendasInicio: Date;
  vendasFim: Date;
  exigeDocumento: boolean;
  ativo: boolean;
};

const TIPOS = [
  { valor: 'inteira', rotulo: 'Inteira' },
  { valor: 'meia', rotulo: 'Meia-entrada' },
  { valor: 'cortesia', rotulo: 'Cortesia' },
  { valor: 'pcd', rotulo: 'PCD' },
  { valor: 'idoso', rotulo: 'Idoso' },
] as const;

/** `2026-10-07T22:00:00Z` → `2026-10-07` e `19:00` no fuso de Brasília. */
function partes(d: Date): { data: string; hora: string } {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [data, hora] = f.format(d).split(' ');
  return { data: data ?? '', hora: (hora ?? '').slice(0, 5) };
}

export function Lotes({
  tenantId,
  eventId,
  lotes,
  capacidade,
  cotaMeiaBps,
}: {
  tenantId: string;
  eventId: string;
  lotes: Lote[];
  capacidade: number;
  cotaMeiaBps: number;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [criando, setCriando] = useState(lotes.length === 0);

  const usados = lotes.reduce((a, l) => a + l.quantidadeTotal, 0);
  const restantes = capacidade - usados;
  const tetoMeia = Math.floor((capacidade * cotaMeiaBps) / 10_000);
  const meiasUsadas = lotes
    .filter((l) => l.tipo === 'meia')
    .reduce((a, l) => a + l.quantidadeTotal, 0);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-titulo text-lg font-bold">Lotes de ingresso</h2>
        <p className="tabular text-sm text-muted">
          {usados} de {capacidade} lugares distribuídos
          {restantes > 0 && <span className="text-faint"> · {restantes} livres</span>}
        </p>
      </div>

      <p className="mt-1 text-xs text-faint">
        Meia-entrada: {meiasUsadas} de {tetoMeia} permitidos ({cotaMeiaBps / 100}% da
        capacidade, Lei nº 12.933/2013). PCD e idoso são gratuidade legal e não entram na cota.
      </p>

      {lotes.length > 0 && (
        <ul className="mt-5 space-y-3">
          {lotes.map((lote) => (
            <li key={lote.id}>
              {editando === lote.id ? (
                <div className="rounded-cartao border border-accent bg-raised p-4">
                  <FormularioLote
                    tenantId={tenantId}
                    eventId={eventId}
                    lote={lote}
                    aoFechar={() => setEditando(null)}
                  />
                </div>
              ) : (
                <div
                  className={`flex flex-wrap items-center gap-4 rounded-cartao border border-line bg-raised px-4 py-3 ${
                    lote.ativo ? '' : 'opacity-55'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {lote.nome}
                      {lote.tipo !== 'inteira' && (
                        <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                          {TIPOS.find((t) => t.valor === lote.tipo)?.rotulo ?? lote.tipo}
                        </span>
                      )}
                    </p>
                    <p className="tabular mt-0.5 text-sm text-muted">
                      {formatarBRL(lote.precoCentavos)} ·{' '}
                      {lote.quantidadeVendida + lote.quantidadeReservada} de{' '}
                      {lote.quantidadeTotal} comprometidos
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditando(lote.id)}
                      className="rounded-botao border border-line-forte px-3 py-1.5 text-xs font-medium transition hover:border-accent hover:text-accent"
                    >
                      Editar
                    </button>
                    <form
                      action={async () => {
                        await alternarLote(tenantId, eventId, lote.id, !lote.ativo);
                      }}
                    >
                      <button className="rounded-botao border border-line px-3 py-1.5 text-xs text-muted transition hover:text-txt">
                        {lote.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {criando ? (
        <div className="mt-5 rounded-cartao border border-accent bg-raised p-4">
          <FormularioLote
            tenantId={tenantId}
            eventId={eventId}
            aoFechar={() => setCriando(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCriando(true)}
          className="mt-5 rounded-botao border border-dashed border-line-forte px-4 py-3 text-sm font-medium transition hover:border-accent hover:text-accent"
        >
          + Adicionar lote
        </button>
      )}
    </section>
  );
}

function FormularioLote({
  tenantId,
  eventId,
  lote,
  aoFechar,
}: {
  tenantId: string;
  eventId: string;
  lote?: Lote;
  aoFechar: () => void;
}) {
  const acao = salvarLote.bind(null, tenantId, eventId, lote?.id ?? null);
  const [estado, enviar, enviando] = useActionState(acao, INICIAL);

  const inicio = lote ? partes(lote.vendasInicio) : null;
  const fim = lote ? partes(lote.vendasFim) : null;

  return (
    <form action={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium">Nome do lote</label>
          <input
            name="nome"
            required
            maxLength={120}
            defaultValue={lote?.nome ?? ''}
            placeholder="1º Lote — Inteira"
            className={campo}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Tipo</label>
          <select name="tipo" defaultValue={lote?.tipo ?? 'inteira'} className={campo}>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-sm font-medium">Preço</label>
          <input
            name="preco"
            required
            inputMode="decimal"
            defaultValue={lote ? (lote.precoCentavos / 100).toFixed(2).replace('.', ',') : ''}
            placeholder="100,00"
            className={campo}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Quantidade</label>
          <input
            name="quantidadeTotal"
            type="number"
            min={1}
            required
            defaultValue={lote?.quantidadeTotal ?? ''}
            className={campo}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Limite por pedido</label>
          <input
            name="limitePorPedido"
            type="number"
            min={1}
            max={50}
            defaultValue={lote?.limitePorPedido ?? 6}
            className={campo}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium">Vendas começam</label>
            <input
              name="vendasInicioData"
              type="date"
              required
              defaultValue={inicio?.data ?? ''}
              className={campo}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Hora</label>
            <input
              name="vendasInicioHora"
              type="time"
              required
              defaultValue={inicio?.hora ?? '10:00'}
              className={campo}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium">Vendas terminam</label>
            <input
              name="vendasFimData"
              type="date"
              required
              defaultValue={fim?.data ?? ''}
              className={campo}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Hora</label>
            <input
              name="vendasFimHora"
              type="time"
              required
              defaultValue={fim?.hora ?? '23:00'}
              className={campo}
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">
          Descrição <span className="font-normal text-faint">(opcional)</span>
        </label>
        <input
          name="descricao"
          maxLength={300}
          defaultValue={lote?.descricao ?? ''}
          placeholder="Inclui welcome drink"
          className={campo}
        />
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="exigeDocumento"
          defaultChecked={lote?.exigeDocumento ?? false}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Exigir documento na entrada
          <span className="block text-xs text-faint">
            Obrigatório para meia-entrada e gratuidade: é assim que se comprova o direito.
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

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-botao bg-accent px-5 py-2.5 text-sm font-semibold text-accent-txt disabled:opacity-60"
        >
          {enviando ? 'Salvando…' : lote ? 'Salvar lote' : 'Criar lote'}
        </button>
        <button
          type="button"
          onClick={aoFechar}
          className="rounded-botao border border-line px-5 py-2.5 text-sm text-muted transition hover:text-txt"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
