'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { simularPagamento } from './acoes';

/**
 * Tela de espera do Pix.
 *
 * A tela reconhece o pagamento sozinha — o comprador não clica em "já paguei".
 * Esse botão existe em quase toda bilheteria e é fonte de confusão: quem
 * confirma o pagamento é o webhook da PSP, e o clique não muda nada.
 *
 * O polling é curto e para sozinho quando o pedido sai de `awaiting_payment`.
 */
export function PainelPix({
  orderId,
  qrCode,
  qrCodeImagem,
  simulacaoDisponivel,
}: {
  orderId: string;
  qrCode: string;
  qrCodeImagem: string;
  simulacaoDisponivel: boolean;
}) {
  const router = useRouter();
  const [copiado, setCopiado] = useState(false);
  const [simulando, iniciarSimulacao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;

    const consultar = async () => {
      try {
        const resposta = await fetch(`/api/orders/${orderId}/status`, { cache: 'no-store' });
        if (!resposta.ok) return;
        const dados = (await resposta.json()) as { status: string; expirado: boolean };
        if (!ativo) return;
        if (dados.status !== 'awaiting_payment' || dados.expirado) router.refresh();
      } catch {
        // Rede instável em casa noturna é regra, não exceção. Silêncio aqui e
        // nova tentativa no próximo ciclo.
      }
    };

    const id = setInterval(consultar, 3000);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [orderId, router]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(qrCode);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro('Não consegui copiar. Selecione o código manualmente.');
    }
  }

  return (
    <section className="mt-6">
      <h2 className="font-titulo text-lg font-bold">Pague com Pix</h2>
      <p className="prosa mt-1.5 text-sm text-muted">
        Abra o aplicativo do seu banco, escolha Pix e leia o código. Assim que o pagamento cair,
        esta tela avança sozinha.
      </p>

      <div className="mt-5 flex flex-col items-center rounded-cartao border border-line bg-raised p-5">
        {/* Fundo branco: leitor de QR erra em código invertido. */}
        <div className="rounded-lg bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCodeImagem} alt="QR code para pagamento por Pix" className="h-52 w-52" />
        </div>

        <button
          type="button"
          onClick={copiar}
          className="mt-5 w-full rounded-botao border border-line-forte py-3 text-sm font-medium transition hover:border-accent hover:text-accent"
        >
          {copiado ? 'Código copiado' : 'Copiar código Pix'}
        </button>

        <p className="mt-3 w-full break-all rounded-botao bg-base px-3 py-2 text-center text-[11px] text-faint">
          {qrCode}
        </p>
      </div>

      <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted">
        <span
          aria-hidden
          className="h-2 w-2 animate-pulse rounded-full bg-alerta"
          style={{ animationDuration: '1.5s' }}
        />
        Aguardando o pagamento
      </div>

      {erro && (
        <p role="alert" className="mt-3 text-center text-sm text-perigo">
          {erro}
        </p>
      )}

      {simulacaoDisponivel && (
        <div className="mt-8 rounded-cartao border border-dashed border-line-forte px-4 py-4 text-center">
          <p className="text-xs uppercase tracking-wide text-faint">Ambiente de teste</p>
          <p className="prosa mx-auto mt-1.5 text-sm text-muted">
            Não há cobrança real. O botão abaixo dispara o mesmo webhook que a operadora enviaria
            — o pedido só vira pago por esse caminho, nunca pela tela.
          </p>
          <button
            type="button"
            disabled={simulando}
            onClick={() =>
              iniciarSimulacao(async () => {
                const r = await simularPagamento(orderId);
                if (r.erro) setErro(r.erro);
                else router.refresh();
              })
            }
            className="mt-4 rounded-botao border border-line-forte px-4 py-2 text-sm font-medium transition hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {simulando ? 'Confirmando…' : 'Simular pagamento'}
          </button>
        </div>
      )}
    </section>
  );
}
