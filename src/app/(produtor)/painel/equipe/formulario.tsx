'use client';

import { useActionState, useState, useTransition } from 'react';

import { convidar, desconectar, novaSenha, remover, type EstadoEquipe } from './acoes';

const INICIAL: EstadoEquipe = {};
const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

/**
 * A senha temporária aparece uma vez e some. Não guardamos senha em texto em
 * lugar nenhum — o que existe no banco é o hash — então não há como mostrar de
 * novo depois. Só trocar.
 */
function Senha({ senha }: { senha: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="rounded-cartao border border-sucesso/40 bg-sucesso/10 px-4 py-3">
      <p className="text-sm font-medium">Senha temporária — anote agora</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="tabular rounded-botao bg-base px-3 py-2 text-lg font-bold tracking-wider">
          {senha}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(senha).then(() => setCopiado(true));
          }}
          className="rounded-botao border border-line px-3 py-2 text-xs font-semibold"
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <p className="mt-2 text-xs text-faint">
        Ela não aparece de novo. Se perder, gere outra pela lista acima.
      </p>
    </div>
  );
}

export function FormularioConvite({
  tenantId,
  eventos,
}: {
  tenantId: string;
  eventos: { id: string; titulo: string }[];
}) {
  const [estado, enviar, enviando] = useActionState(convidar.bind(null, tenantId), INICIAL);
  const [papel, setPapel] = useState('portaria');

  return (
    <form action={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nome" className="block text-sm font-medium">
            Nome
          </label>
          <input id="nome" name="nome" required maxLength={120} className={campo} />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            E-mail
          </label>
          <input id="email" name="email" type="email" required className={campo} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="role" className="block text-sm font-medium">
            Acesso
          </label>
          <select
            id="role"
            name="role"
            value={papel}
            onChange={(e) => setPapel(e.target.value)}
            className={campo}
          >
            <option value="portaria">Portaria — só lê QR e libera entrada</option>
            <option value="operador">Operador — cria evento, vê vendas</option>
            <option value="admin">Administrador — tudo, inclusive equipe</option>
          </select>
        </div>

        {papel === 'portaria' && (
          <div>
            <label htmlFor="eventoId" className="block text-sm font-medium">
              Preso a um evento <span className="font-normal text-faint">(recomendado)</span>
            </label>
            <select id="eventoId" name="eventoId" className={campo}>
              <option value="">Todos os eventos da casa</option>
              {eventos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.titulo}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-faint">
              Sem isto, o aparelho emprestado num turno vira acesso a qualquer evento da casa.
            </p>
          </div>
        )}
      </div>

      {estado.erro && (
        <p
          role="alert"
          className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo"
        >
          {estado.erro}
        </p>
      )}

      {estado.mensagem && (
        <p className="rounded-botao border border-line bg-raised px-3 py-2.5 text-sm">
          {estado.mensagem}
        </p>
      )}

      {estado.senha && <Senha senha={estado.senha} />}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-botao bg-accent px-4 py-2.5 text-sm font-semibold text-accent-txt disabled:opacity-60"
      >
        {enviando ? 'Adicionando…' : 'Adicionar à equipe'}
      </button>
    </form>
  );
}

export function LinhaDaEquipe({
  tenantId,
  pessoa,
  podeMexer,
}: {
  tenantId: string;
  pessoa: {
    membershipId: string;
    nome: string;
    email: string;
    papel: string;
    evento: string | null;
    sessoesAtivas: number;
    inativo: boolean;
    protegido: boolean;
  };
  podeMexer: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const [resposta, setResposta] = useState<EstadoEquipe | null>(null);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {pessoa.nome}
            {pessoa.inativo && (
              <span className="ml-2 text-xs uppercase text-perigo">inativo</span>
            )}
          </p>
          <p className="truncate text-sm text-faint">
            {pessoa.email} · {pessoa.papel}
            {pessoa.evento ? ` · ${pessoa.evento}` : ''}
            {pessoa.sessoesAtivas > 0
              ? ` · ${pessoa.sessoesAtivas} aparelho${pessoa.sessoesAtivas === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>

        {podeMexer && !pessoa.protegido && (
          <div className="flex shrink-0 gap-3 text-xs">
            <button
              type="button"
              disabled={pendente}
              onClick={() =>
                iniciar(async () => setResposta(await novaSenha(tenantId, pessoa.membershipId)))
              }
              className="text-muted hover:text-txt disabled:opacity-50"
            >
              nova senha
            </button>
            <button
              type="button"
              disabled={pendente || pessoa.sessoesAtivas === 0}
              onClick={() =>
                iniciar(async () =>
                  setResposta(await desconectar(tenantId, pessoa.membershipId)),
                )
              }
              className="text-muted hover:text-txt disabled:opacity-40"
            >
              desconectar
            </button>
            <button
              type="button"
              disabled={pendente}
              onClick={() => iniciar(() => remover(tenantId, pessoa.membershipId))}
              className="text-muted hover:text-perigo disabled:opacity-50"
            >
              remover
            </button>
          </div>
        )}
      </div>

      {resposta?.senha && (
        <div className="mt-3">
          <Senha senha={resposta.senha} />
        </div>
      )}

      {resposta?.mensagem && <p className="mt-2 text-xs text-muted">{resposta.mensagem}</p>}
      {resposta?.erro && <p className="mt-2 text-xs text-perigo">{resposta.erro}</p>}
    </li>
  );
}
