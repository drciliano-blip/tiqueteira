'use client';

import { useMemo, useState, useTransition } from 'react';

import { aplicarBps } from '@/lib/money';
import { formatarBRL } from '@/lib/money';
import type { LotePublico } from '@/lib/public-queries';

/**
 * Seletor de ingressos e barra de compra fixa — benchmark, seções 5.2 e 4.4.
 *
 * Fica ACIMA da descrição do evento: quem chegou pelo Instagram já sabe qual é
 * a festa, e obrigar a rolar até o fim para comprar custa conversão.
 *
 * A taxa de conveniência aparece discriminada em cada linha. Taxa embutida sem
 * exibição é risco de Procon, e é também o tipo de surpresa no total que faz
 * o comprador abandonar o carrinho.
 *
 * O total calculado aqui é APENAS para a tela. Quem calcula de verdade é o
 * servidor, em `src/lib/fees.ts`, no momento de criar o pedido — o cliente
 * nunca é fonte de verdade sobre dinheiro.
 */

export type SeletorProps = {
  lotes: LotePublico[];
  taxaConvenienciaBps: number;
  taxaAbsorvidaPeloProdutor: boolean;
  taxaMinimaCentavos: number;
  /**
   * Reserva os ingressos e leva ao pagamento. Em caso de falha esperada
   * (lote esgotou, venda encerrada) devolve a mensagem em vez de lançar:
   * o Next redige exceção de server action em produção, e o comprador
   * veria "algo deu errado" sem saber o quê.
   */
  onComprar: (
    itens: { ticketTypeId: string; quantidade: number }[],
  ) => Promise<{ erro: string } | void>;
};

const ROTULO_SITUACAO: Record<Exclude<LotePublico['situacao'], 'a_venda'>, string> = {
  esgotado: 'Esgotado',
  em_breve: 'Em breve',
  encerrado: 'Encerrado',
  inativo: 'Indisponível',
};

export function SeletorIngressos({
  lotes,
  taxaConvenienciaBps,
  taxaAbsorvidaPeloProdutor,
  taxaMinimaCentavos,
  onComprar,
}: SeletorProps) {
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [enviando, iniciarEnvio] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  /** Conveniência de uma unidade, respeitando o piso configurado. */
  const convenienciaUnitaria = (preco: number) => {
    if (taxaAbsorvidaPeloProdutor || preco === 0) return 0;
    return Math.max(aplicarBps(preco, taxaConvenienciaBps), taxaMinimaCentavos);
  };

  const resumo = useMemo(() => {
    let subtotal = 0;
    let conveniencia = 0;
    let unidades = 0;

    for (const lote of lotes) {
      const q = quantidades[lote.id] ?? 0;
      if (q <= 0) continue;
      subtotal += lote.precoCentavos * q;
      conveniencia += convenienciaUnitaria(lote.precoCentavos) * q;
      unidades += q;
    }

    return { subtotal, conveniencia, total: subtotal + conveniencia, unidades };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotes, quantidades, taxaConvenienciaBps, taxaAbsorvidaPeloProdutor, taxaMinimaCentavos]);

  function ajustar(lote: LotePublico, delta: number) {
    setErro(null);
    setQuantidades((atual) => {
      const q = (atual[lote.id] ?? 0) + delta;
      const teto = Math.min(lote.limitePorPedido, lote.disponivel);
      const novo = Math.max(0, Math.min(q, teto));
      return { ...atual, [lote.id]: novo };
    });
  }

  function comprar() {
    const itens = Object.entries(quantidades)
      .filter(([, q]) => q > 0)
      .map(([ticketTypeId, quantidade]) => ({ ticketTypeId, quantidade }));

    if (itens.length === 0) return;

    setErro(null);
    iniciarEnvio(async () => {
      try {
        const resultado = await onComprar(itens);
        if (resultado?.erro) setErro(resultado.erro);
      } catch (e) {
        setErro(
          e instanceof Error
            ? e.message
            : 'Não foi possível reservar os ingressos. Tente de novo.',
        );
      }
    });
  }

  const aVenda = lotes.filter((l) => l.situacao === 'a_venda');
  const indisponiveis = lotes.filter((l) => l.situacao !== 'a_venda');

  return (
    <>
      <section aria-labelledby="ingressos" className="mt-8">
        <h2 id="ingressos" className="font-titulo text-lg font-bold">
          Ingressos
        </h2>

        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-cartao border border-line bg-raised">
          {aVenda.map((lote) => {
            const q = quantidades[lote.id] ?? 0;
            const conveniencia = convenienciaUnitaria(lote.precoCentavos);
            const teto = Math.min(lote.limitePorPedido, lote.disponivel);
            const poucos = lote.disponivel <= 10;

            return (
              <li key={lote.id} className="flex items-center gap-4 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{lote.nome}</p>
                  {lote.descricao && (
                    <p className="mt-0.5 text-sm text-muted">{lote.descricao}</p>
                  )}

                  <p className="tabular mt-1.5 text-sm">
                    <span className="font-semibold">{formatarBRL(lote.precoCentavos)}</span>
                    {conveniencia > 0 && (
                      <span className="text-faint">
                        {' '}
                        + {formatarBRL(conveniencia)} de taxa
                      </span>
                    )}
                  </p>

                  {/* Urgência honesta: só quando é verdade. */}
                  {poucos && (
                    <p className="mt-1 text-xs font-medium text-alerta">
                      {lote.disponivel === 1
                        ? 'Último ingresso'
                        : `Últimos ${lote.disponivel} ingressos`}
                    </p>
                  )}
                  {lote.exigeDocumento && (
                    <p className="mt-1 text-xs text-faint">Documento conferido na entrada</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => ajustar(lote, -1)}
                    disabled={q === 0}
                    aria-label={`Remover um ${lote.nome}`}
                    className="grid h-9 w-9 place-items-center rounded-botao border border-line-forte text-lg leading-none transition enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-30"
                  >
                    −
                  </button>
                  <span
                    className="tabular w-8 text-center font-semibold"
                    aria-live="polite"
                    aria-atomic
                  >
                    {q}
                  </span>
                  <button
                    type="button"
                    onClick={() => ajustar(lote, +1)}
                    disabled={q >= teto}
                    aria-label={`Adicionar um ${lote.nome}`}
                    className="grid h-9 w-9 place-items-center rounded-botao border border-line-forte text-lg leading-none transition enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}

          {indisponiveis.map((lote) => (
            <li
              key={lote.id}
              className="flex items-center justify-between px-4 py-4 opacity-55"
            >
              <div>
                <p className="font-medium line-through decoration-faint">{lote.nome}</p>
                <p className="tabular mt-0.5 text-sm text-faint">
                  {formatarBRL(lote.precoCentavos)}
                </p>
              </div>
              <span className="rounded-full border border-line px-2.5 py-1 text-xs text-muted">
                {ROTULO_SITUACAO[lote.situacao as keyof typeof ROTULO_SITUACAO]}
              </span>
            </li>
          ))}

          {lotes.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">
              Nenhum lote publicado ainda.
            </li>
          )}
        </ul>

        {erro && (
          <p
            role="alert"
            className="mt-3 rounded-botao border border-perigo/40 bg-perigo/10 px-4 py-3 text-sm text-perigo"
          >
            {erro}
          </p>
        )}
      </section>

      {/* Barra fixa: aparece só quando há o que comprar. */}
      {resumo.unidades > 0 && (
        <>
          {/* Espaçador, para a barra não cobrir o fim da página. */}
          <div aria-hidden className="h-24" />

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-base/95 backdrop-blur">
            <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="tabular text-lg font-bold leading-tight">
                  {formatarBRL(resumo.total)}
                </p>
                <p className="tabular text-xs text-faint">
                  {resumo.unidades} {resumo.unidades === 1 ? 'ingresso' : 'ingressos'}
                  {resumo.conveniencia > 0 && (
                    <> · inclui {formatarBRL(resumo.conveniencia)} de taxa</>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={comprar}
                disabled={enviando}
                className="rounded-botao bg-accent px-6 py-3 font-semibold text-accent-txt transition disabled:opacity-60"
              >
                {enviando ? 'Reservando…' : 'Comprar'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
