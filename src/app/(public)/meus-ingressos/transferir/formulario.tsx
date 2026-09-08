'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { AVISO_DE_REEMBOLSO } from '@/domain/transferencia';
import { transferirIngresso, type EstadoTransferencia } from './acoes';

const INICIAL: EstadoTransferencia = {};
const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

export function FormularioTransferencia({
  ticketId,
  codigo,
}: {
  ticketId: string;
  codigo: string;
}) {
  const acao = transferirIngresso.bind(null, ticketId);
  const [estado, enviar, enviando] = useActionState(acao, INICIAL);

  if (estado.ok) {
    return (
      <div className="rounded-cartao border border-sucesso/40 bg-sucesso/10 p-6 text-center">
        <p className="font-titulo text-lg font-bold text-sucesso">Ingresso transferido</p>
        <p className="prosa mx-auto mt-2 text-sm text-muted">
          O ingresso <span className="tabular font-semibold">{codigo}</span> foi cancelado e um
          novo foi emitido com o código{' '}
          <span className="tabular font-semibold text-txt">{estado.codigoNovo}</span>. Quem
          recebeu já foi avisado por e-mail.
        </p>
        <Link
          href="/meus-ingressos"
          className="mt-5 inline-block rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt"
        >
          Voltar aos meus ingressos
        </Link>
      </div>
    );
  }

  return (
    <form action={enviar} className="space-y-4">
      <div>
        <label htmlFor="nome" className="block text-sm font-medium">
          Nome completo de quem vai
        </label>
        <input id="nome" name="nome" required maxLength={120} className={campo} />
        <p className="mt-1 text-xs text-faint">
          Precisa ser igual ao documento: a portaria confere na entrada.
        </p>
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          E-mail
        </label>
        <input id="email" name="email" type="email" required className={campo} />
      </div>

      <div>
        <label htmlFor="cpf" className="block text-sm font-medium">
          CPF
        </label>
        <input
          id="cpf"
          name="cpf"
          inputMode="numeric"
          required
          maxLength={14}
          placeholder="000.000.000-00"
          className={`tabular ${campo}`}
        />
      </div>

      {/*
        O aviso vem ANTES do botão, e não em letra miúda no rodapé. É a regra
        que impede a transferência de virar porta de fraude, e o comprador
        precisa decidir sabendo dela.
      */}
      <div className="rounded-botao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
        <p className="font-medium">Antes de confirmar</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>O seu QR atual é cancelado na hora e não passa mais na porta.</li>
          <li>{AVISO_DE_REEMBOLSO}</li>
          <li>A transferência não pode ser desfeita.</li>
        </ul>
      </div>

      {estado.erro && (
        <p
          role="alert"
          className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo"
        >
          {estado.erro}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-botao bg-accent px-6 py-3 font-semibold text-accent-txt disabled:opacity-60"
        >
          {enviando ? 'Transferindo…' : 'Transferir ingresso'}
        </button>
        <Link
          href="/meus-ingressos"
          className="rounded-botao border border-line px-5 py-3 text-sm text-muted transition hover:text-txt"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
