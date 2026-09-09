'use client';

import { useActionState } from 'react';

import { incluirNomes, novaLista, type EstadoLista } from './acoes';

const INICIAL: EstadoLista = {};
const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

function Erro({ estado }: { estado: EstadoLista }) {
  if (!estado.erro) return null;
  return (
    <p
      role="alert"
      className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo"
    >
      {estado.erro}
    </p>
  );
}

export function FormularioLista({
  eventId,
  lotes,
}: {
  eventId: string;
  lotes: { id: string; nome: string }[];
}) {
  const [estado, enviar, enviando] = useActionState(novaLista.bind(null, eventId), INICIAL);

  return (
    <form action={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="nome" className="block text-sm font-medium">
            Nome da lista
          </label>
          <input
            id="nome"
            name="nome"
            required
            maxLength={80}
            placeholder="Ex.: Lista Rafael"
            className={campo}
          />
        </div>
        <div>
          <label htmlFor="cota" className="block text-sm font-medium">
            Cota
          </label>
          <input id="cota" name="cota" type="number" min={1} required className={campo} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="promoterNome" className="block text-sm font-medium">
            Promoter <span className="font-normal text-faint">(opcional)</span>
          </label>
          <input id="promoterNome" name="promoterNome" maxLength={120} className={campo} />
        </div>
        <div>
          <label htmlFor="ticketTypeId" className="block text-sm font-medium">
            Lote que a cortesia consome
          </label>
          <select id="ticketTypeId" name="ticketTypeId" required className={campo}>
            {lotes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="validoAte" className="block text-sm font-medium">
          Vale até <span className="font-normal text-faint">(opcional)</span>
        </label>
        <input id="validoAte" name="validoAte" type="datetime-local" className={campo} />
        <p className="mt-1.5 text-xs text-faint">
          Depois deste horário a porta recusa a lista. É o que faz &ldquo;lista até meia-noite&rdquo;
          significar alguma coisa.
        </p>
      </div>

      <Erro estado={estado} />

      <button
        type="submit"
        disabled={enviando}
        className="rounded-botao bg-accent px-4 py-2.5 text-sm font-semibold text-accent-txt disabled:opacity-60"
      >
        {enviando ? 'Criando…' : 'Criar lista'}
      </button>
    </form>
  );
}

export function FormularioNomes({
  eventId,
  listaId,
  vagas,
}: {
  eventId: string;
  listaId: string;
  vagas: number;
}) {
  const [estado, enviar, enviando] = useActionState(incluirNomes.bind(null, eventId), INICIAL);

  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="listaId" value={listaId} />

      <label htmlFor={`texto-${listaId}`} className="block text-sm font-medium">
        Incluir nomes
        <span className="ml-2 font-normal text-faint">
          {vagas > 0 ? `${vagas} vaga${vagas === 1 ? '' : 's'}` : 'cota cheia'}
        </span>
      </label>

      <textarea
        id={`texto-${listaId}`}
        name="texto"
        rows={3}
        maxLength={20000}
        placeholder={'Um nome por linha.\nCole direto do WhatsApp, sem arrumar.'}
        className={campo}
      />

      <div className="flex flex-wrap items-center gap-3">
        <select name="tipo" className="rounded-botao border border-line bg-raised px-3 py-2 text-sm">
          <option value="cortesia">Cortesia</option>
          <option value="desconto">Desconto</option>
        </select>

        <button
          type="submit"
          disabled={enviando || vagas === 0}
          className="rounded-botao border border-line px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {enviando ? 'Incluindo…' : 'Incluir'}
        </button>
      </div>

      <Erro estado={estado} />

      {estado.resultado && (
        <div className="rounded-botao border border-line bg-raised px-3 py-2.5 text-sm">
          <p>
            {estado.resultado.adicionados === 0
              ? 'Nenhum nome novo entrou.'
              : `${estado.resultado.adicionados} nome${
                  estado.resultado.adicionados === 1 ? '' : 's'
                } na lista.`}
          </p>

          {estado.resultado.recusados.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-faint">
              {estado.resultado.recusados.map((r, i) => (
                <li key={`${r.nome}-${i}`}>
                  {r.nome} —{' '}
                  {r.motivo === 'duplicado'
                    ? 'já estava na lista'
                    : r.motivo === 'sem_cota'
                      ? 'não coube na cota'
                      : 'nome curto demais'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
