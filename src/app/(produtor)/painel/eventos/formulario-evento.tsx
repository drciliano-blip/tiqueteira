'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { CATEGORIAS } from '@/domain/categorias';
import type { EstadoFormulario } from '../acoes';

const INICIAL: EstadoFormulario = {};

export type ValoresEvento = {
  venueId: string;
  titulo: string;
  descricao: string;
  categoria: string;
  dataInicio: string;
  horaInicio: string;
  dataFim: string;
  horaFim: string;
  capacidade: number;
  classificacaoEtaria: number;
  ingressoNominal: boolean;
  exigeDocumentoEntrada: boolean;
};

export type Espaco = { id: string; nome: string; capacidadeMaxima: number };

const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

export function FormularioEvento({
  acao,
  espacos,
  valores,
  rotuloBotao,
}: {
  acao: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  espacos: Espaco[];
  valores?: Partial<ValoresEvento>;
  rotuloBotao: string;
}) {
  const [estado, enviar, enviando] = useActionState(acao, INICIAL);

  if (espacos.length === 0) {
    return (
      <div className="rounded-cartao border border-line bg-raised px-5 py-8 text-center">
        <p className="font-titulo font-semibold">Cadastre um espaço primeiro</p>
        <p className="prosa mx-auto mt-2 text-sm text-muted">
          Todo evento acontece em algum lugar, e é a capacidade do espaço que limita quantos
          ingressos podem ser vendidos.
        </p>
        <Link
          href="/painel/espacos"
          className="mt-5 inline-block rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt"
        >
          Cadastrar espaço
        </Link>
      </div>
    );
  }

  return (
    <form action={enviar} className="space-y-5">
      <div>
        <label htmlFor="titulo" className="block text-sm font-medium">
          Título do evento
        </label>
        <input
          id="titulo"
          name="titulo"
          required
          maxLength={160}
          defaultValue={valores?.titulo ?? ''}
          placeholder="Baile do Jussara 2026"
          className={campo}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="venueId" className="block text-sm font-medium">
            Espaço
          </label>
          <select
            id="venueId"
            name="venueId"
            required
            defaultValue={valores?.venueId ?? ''}
            className={campo}
          >
            <option value="" disabled>
              Escolha…
            </option>
            {espacos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome} (até {e.capacidadeMaxima})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="categoria" className="block text-sm font-medium">
            Categoria
          </label>
          <select
            id="categoria"
            name="categoria"
            defaultValue={valores?.categoria ?? 'festa'}
            className={campo}
          >
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="dataInicio" className="block text-sm font-medium">
              Começa em
            </label>
            <input
              id="dataInicio"
              name="dataInicio"
              type="date"
              required
              defaultValue={valores?.dataInicio ?? ''}
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="horaInicio" className="block text-sm font-medium">
              Hora
            </label>
            <input
              id="horaInicio"
              name="horaInicio"
              type="time"
              required
              defaultValue={valores?.horaInicio ?? '22:00'}
              className={campo}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="dataFim" className="block text-sm font-medium">
              Termina em
            </label>
            <input
              id="dataFim"
              name="dataFim"
              type="date"
              required
              defaultValue={valores?.dataFim ?? ''}
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="horaFim" className="block text-sm font-medium">
              Hora
            </label>
            <input
              id="horaFim"
              name="horaFim"
              type="time"
              required
              defaultValue={valores?.horaFim ?? '05:00'}
              className={campo}
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-faint">Horários no fuso de Brasília.</p>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="capacidade" className="block text-sm font-medium">
            Capacidade do evento
          </label>
          <input
            id="capacidade"
            name="capacidade"
            type="number"
            min={1}
            required
            defaultValue={valores?.capacidade ?? ''}
            className={campo}
          />
          <p className="mt-1 text-xs text-faint">
            Não pode passar da capacidade do espaço — alvará e AVCB não são sugestão.
          </p>
        </div>

        <div>
          <label htmlFor="classificacaoEtaria" className="block text-sm font-medium">
            Classificação etária
          </label>
          <select
            id="classificacaoEtaria"
            name="classificacaoEtaria"
            defaultValue={String(valores?.classificacaoEtaria ?? 18)}
            className={campo}
          >
            <option value="0">Livre</option>
            <option value="12">12 anos</option>
            <option value="14">14 anos</option>
            <option value="16">16 anos</option>
            <option value="18">18 anos</option>
            <option value="21">21 anos</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="descricao" className="block text-sm font-medium">
          Descrição <span className="font-normal text-faint">(opcional)</span>
        </label>
        <textarea
          id="descricao"
          name="descricao"
          rows={4}
          maxLength={4000}
          defaultValue={valores?.descricao ?? ''}
          placeholder="Line-up, ambientes, o que o público precisa saber."
          className={campo}
        />
      </div>

      <fieldset className="space-y-3 rounded-cartao border border-line bg-raised p-4">
        <legend className="px-1 text-sm font-medium">Controle de entrada</legend>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="ingressoNominal"
            defaultChecked={valores?.ingressoNominal ?? true}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Ingresso nominal
            <span className="block text-xs text-faint">
              O nome do comprador fica no ingresso. É a defesa mais barata contra print revendido.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="exigeDocumentoEntrada"
            defaultChecked={valores?.exigeDocumentoEntrada ?? false}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Conferir documento na entrada
            <span className="block text-xs text-faint">
              A portaria exige confirmação do operador a cada leitura. Deixa a fila mais lenta e
              a fraude muito mais difícil.
            </span>
          </span>
        </label>
      </fieldset>

      {estado.erro && (
        <p
          role="alert"
          className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo"
        >
          {estado.erro}
        </p>
      )}

      {estado.ok && (
        <p className="rounded-botao border border-sucesso/40 bg-sucesso/10 px-3 py-2.5 text-sm text-sucesso">
          Salvo.
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-botao bg-accent px-6 py-3 font-semibold text-accent-txt transition disabled:opacity-60"
      >
        {enviando ? 'Salvando…' : rotuloBotao}
      </button>
    </form>
  );
}
