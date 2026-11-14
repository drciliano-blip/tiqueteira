'use client';

import { useActionState, useState, useTransition } from 'react';

import {
  cancelarCompra,
  reenviarMeusIngressos,
  relatarProblema,
  type EstadoComprador,
} from './acoes';

const INICIAL: EstadoComprador = {};

const CAMPO =
  'mt-1.5 w-full rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

function Aviso({ estado }: { estado: EstadoComprador }) {
  if (estado.erro) {
    return (
      <p role="alert" className="mt-3 rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo">
        {estado.erro}
      </p>
    );
  }
  if (estado.mensagem) {
    return (
      <p role="status" className="mt-3 rounded-botao border border-sucesso/40 bg-sucesso/10 px-3 py-2.5 text-sm text-sucesso">
        {estado.mensagem}
      </p>
    );
  }
  return null;
}

export function ReenviarIngressos({ orderId }: { orderId: string }) {
  const [estado, setEstado] = useState<EstadoComprador>({});
  const [enviando, iniciar] = useTransition();
  return (
    <div>
      <button
        type="button"
        disabled={enviando}
        onClick={() => iniciar(async () => setEstado(await reenviarMeusIngressos(orderId)))}
        className="text-sm font-medium text-accent disabled:opacity-60"
      >
        {enviando ? 'Reenviando…' : 'Não recebeu? Reenviar por e-mail'}
      </button>
      <Aviso estado={estado} />
    </div>
  );
}

export function CancelarCompra({ orderId, validos }: { orderId: string; validos: number }) {
  const [aberto, setAberto] = useState(false);
  const [estado, enviar, enviando] = useActionState(cancelarCompra.bind(null, orderId), INICIAL);

  if (estado.ok) return <Aviso estado={estado} />;

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-botao border border-line-forte px-4 py-2.5 text-sm font-medium transition hover:border-perigo hover:text-perigo"
      >
        Cancelar e pedir devolução
      </button>
    );
  }

  return (
    <form action={enviar} className="space-y-4 rounded-cartao border border-line bg-raised p-4">
      <div>
        <label htmlFor="quantidade" className="block text-sm font-medium">
          Quantos ingressos cancelar
        </label>
        <select id="quantidade" name="quantidade" defaultValue={validos} className={CAMPO}>
          {Array.from({ length: validos }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'ingresso' : 'ingressos'}
              {n === validos ? ' (todos)' : ''}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-faint">
          Os ingressos cancelados deixam de valer na portaria na hora.
        </p>
      </div>
      <Aviso estado={estado} />
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-botao bg-perigo px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {enviando ? 'Cancelando…' : 'Confirmar cancelamento'}
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

const TIPOS = [
  { valor: 'evento_nao_realizado', rotulo: 'O evento não aconteceu' },
  { valor: 'servico_nao_prestado', rotulo: 'Não consegui entrar ou aproveitar o evento' },
  { valor: 'servico_diferente_do_ofertado', rotulo: 'O evento foi diferente do anunciado' },
  { valor: 'reclamacao_procedente', rotulo: 'Outro problema' },
] as const;

export function RelatarProblema({ orderId }: { orderId: string }) {
  const [aberto, setAberto] = useState(false);
  const [estado, enviar, enviando] = useActionState(relatarProblema.bind(null, orderId), INICIAL);

  if (estado.ok) return <Aviso estado={estado} />;

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-botao border border-line-forte px-4 py-2.5 text-sm font-medium transition hover:border-accent hover:text-accent"
      >
        Relatar um problema
      </button>
    );
  }

  return (
    <form action={enviar} className="space-y-4 rounded-cartao border border-line bg-raised p-4">
      <fieldset>
        <legend className="text-sm font-medium">O que aconteceu</legend>
        <div className="mt-2 space-y-2">
          {TIPOS.map((t) => (
            <label key={t.valor} className="flex items-center gap-3 text-sm">
              <input type="radio" name="tipo" value={t.valor} required className="h-4 w-4" />
              {t.rotulo}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="relato" className="block text-sm font-medium">
          Conte o que houve
        </label>
        <textarea
          id="relato"
          name="relato"
          required
          minLength={15}
          maxLength={2000}
          rows={4}
          placeholder="O que aconteceu, a que horas, e como isso afetou você."
          className={CAMPO}
        />
      </div>
      <Aviso estado={estado} />
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-botao bg-accent px-5 py-2.5 text-sm font-semibold text-accent-txt disabled:opacity-60"
        >
          {enviando ? 'Enviando…' : 'Enviar ao organizador'}
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
