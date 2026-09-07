'use client';

import { useActionState } from 'react';

import { pagarComPix, type EstadoPagamento } from './acoes';

const INICIAL: EstadoPagamento = {};

/**
 * Identificação do comprador. Quatro campos e pronto — nenhuma criação de
 * conta, nenhum upsell antes do pagamento (benchmark, seção 5.3).
 *
 * A máscara de CPF e telefone é aplicada enquanto se digita, mas o valor
 * enviado é normalizado no servidor: máscara é conforto de digitação, não
 * validação.
 */
export function FormularioComprador({ orderId }: { orderId: string }) {
  const acao = pagarComPix.bind(null, orderId);
  const [estado, enviar, enviando] = useActionState(acao, INICIAL);

  return (
    <form action={enviar} className="mt-6 space-y-4">
      <div>
        <label htmlFor="nome" className="block text-sm font-medium">
          Nome completo
        </label>
        <input
          id="nome"
          name="nome"
          autoComplete="name"
          required
          placeholder="Como está no seu documento"
          className="mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-faint">
          A portaria confere o nome no documento na entrada.
        </p>
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className="mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-faint">É para aqui que o ingresso vai.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cpf" className="block text-sm font-medium">
            CPF
          </label>
          <input
            id="cpf"
            name="cpf"
            inputMode="numeric"
            autoComplete="off"
            required
            maxLength={14}
            placeholder="000.000.000-00"
            className="tabular mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="telefone" className="block text-sm font-medium">
            Telefone <span className="font-normal text-faint">(opcional)</span>
          </label>
          <input
            id="telefone"
            name="telefone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={15}
            placeholder="(11) 90000-0000"
            className="tabular mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
      </div>

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
        className="w-full rounded-botao bg-accent py-3.5 font-semibold text-accent-txt transition disabled:opacity-60"
      >
        {enviando ? 'Gerando cobrança…' : 'Pagar com Pix'}
      </button>

      <p className="text-center text-xs text-faint">
        Ao continuar você concorda com os termos de uso. Pode desistir em até 7 dias e receber
        tudo de volta, taxa incluída.
      </p>
    </form>
  );
}
