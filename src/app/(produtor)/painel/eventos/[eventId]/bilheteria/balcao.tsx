'use client';

import { useActionState, useState } from 'react';

import { formatarBRL } from '@/lib/money';
import { venderNoBalcao, type EstadoVenda } from './acoes';

const INICIAL: EstadoVenda = {};
const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

type Lote = { id: string; nome: string; precoCentavos: number; disponivel: number };

/**
 * O balcão.
 *
 * Desenhado para ser usado em pé, com fila e uma mão só: campos grandes, a
 * quantidade em botões e não em teclado, e o resultado numa tela cheia que
 * some ao toque. A pessoa da bilheteria não tem tempo de procurar um campo.
 */
export function Balcao({ eventId, lotes }: { eventId: string; lotes: Lote[] }) {
  const [estado, enviar, enviando] = useActionState(
    venderNoBalcao.bind(null, eventId),
    INICIAL,
  );

  const [loteId, setLoteId] = useState(lotes[0]?.id ?? '');
  const [quantidade, setQuantidade] = useState(1);
  const [metodo, setMetodo] = useState('dinheiro');

  const lote = lotes.find((l) => l.id === loteId);
  const unitario = metodo === 'cortesia' ? 0 : (lote?.precoCentavos ?? 0);
  const total = unitario * quantidade;

  if (lotes.length === 0) {
    return (
      <p className="rounded-cartao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm">
        Este evento não tem lote ativo. Crie um lote antes de abrir a bilheteria.
      </p>
    );
  }

  return (
    <>
      <form action={enviar} className="space-y-5 rounded-cartao border border-line bg-raised p-4">
        <input type="hidden" name="ticketTypeId" value={loteId} />
        <input type="hidden" name="quantidade" value={quantidade} />
        <input type="hidden" name="metodo" value={metodo} />

        <div>
          <p className="text-sm font-medium">Lote</p>
          <div className="mt-2 grid gap-2">
            {lotes.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLoteId(l.id)}
                disabled={l.disponivel === 0}
                className={`flex items-center justify-between gap-3 rounded-botao border px-4 py-3 text-left text-sm transition disabled:opacity-40 ${
                  l.id === loteId ? 'border-accent bg-accent/10' : 'border-line'
                }`}
              >
                <span className="min-w-0 truncate font-medium">{l.nome}</span>
                <span className="tabular shrink-0 text-xs text-faint">
                  {formatarBRL(l.precoCentavos)} ·{' '}
                  {l.disponivel === 0 ? 'esgotado' : `${l.disponivel} restantes`}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Quantidade</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setQuantidade(n)}
                className={`tabular h-11 w-11 rounded-botao border text-sm font-semibold transition ${
                  n === quantidade ? 'border-accent bg-accent/10' : 'border-line'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Forma de pagamento</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ['dinheiro', 'Dinheiro'],
              ['debito', 'Débito'],
              ['credito', 'Crédito'],
              ['cortesia', 'Cortesia'],
              ['outro', 'Outro'],
            ].map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setMetodo(valor!)}
                className={`rounded-botao border px-4 py-2.5 text-sm font-medium transition ${
                  valor === metodo ? 'border-accent bg-accent/10' : 'border-line'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
          {metodo === 'cortesia' && (
            <p className="mt-2 text-xs text-faint">
              Cortesia sai por zero, qualquer que seja o preço do lote — e continua consumindo
              lugar, porque a capacidade do espaço não distingue quem pagou.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="compradorNome" className="block text-sm font-medium">
              Nome de quem vai entrar
            </label>
            <input
              id="compradorNome"
              name="compradorNome"
              required
              maxLength={120}
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="compradorCpf" className="block text-sm font-medium">
              CPF <span className="font-normal text-faint">(opcional)</span>
            </label>
            <input id="compradorCpf" name="compradorCpf" inputMode="numeric" className={campo} />
          </div>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="jaEntrou" className="mt-0.5 h-4 w-4" />
          <span>
            A pessoa já está entrando agora
            <span className="block text-xs text-faint">
              Marca a entrada junto com a venda. Sem isto, o ingresso sai válido e alguém
              precisa ler o QR dela na porta — trabalho inventado quando ela está bem na sua
              frente.
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

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <p className="tabular text-2xl font-bold">{formatarBRL(total)}</p>
          <button
            type="submit"
            disabled={enviando || !lote || lote.disponivel < quantidade}
            className="rounded-botao bg-accent px-6 py-3 font-semibold text-accent-txt disabled:opacity-60"
          >
            {enviando ? 'Registrando…' : 'Registrar venda'}
          </button>
        </div>
      </form>

      {estado.venda && <Comprovante venda={estado.venda} />}
    </>
  );
}

function Comprovante({ venda }: { venda: NonNullable<EstadoVenda['venda']> }) {
  const [aberto, setAberto] = useState(true);
  if (!aberto) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-sucesso p-6 text-center text-black"
      onClick={() => setAberto(false)}
    >
      <p className="text-4xl font-black uppercase">
        {venda.jaEntrou ? 'Vendido — pode entrar' : 'Vendido'}
      </p>
      <p className="tabular mt-4 text-2xl font-bold">{formatarBRL(venda.totalCentavos)}</p>
      <p className="mt-2 text-base opacity-80">Pedido {venda.numero}</p>

      <ul className="tabular mt-6 space-y-1 text-lg font-semibold">
        {venda.ingressos.map((i) => (
          <li key={i.id}>{i.codigo}</li>
        ))}
      </ul>

      {!venda.jaEntrou && (
        <p className="mt-6 max-w-xs text-sm opacity-80">
          Anote o código, ou busque por ele na portaria. O ingresso está válido para entrada.
        </p>
      )}

      <p className="absolute bottom-8 text-sm opacity-70">Toque para continuar</p>
    </div>
  );
}
