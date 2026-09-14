'use client';

import { useActionState, useState, useTransition } from 'react';

import type { EstadoDominio } from '@/lib/dominios';
import { conferir, desvincular, salvarDominio, type EstadoForm } from './acoes';

const INICIAL: EstadoForm = {};
const campo =
  'mt-1.5 w-full rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

function Copiavel({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <code className="tabular rounded-botao bg-base px-2 py-1 text-sm">{valor}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(valor).then(() => setCopiado(true));
        }}
        className="text-xs text-muted underline underline-offset-2 hover:text-txt"
      >
        {copiado ? 'copiado' : 'copiar'}
      </button>
    </span>
  );
}

export function PainelDominio({
  tenantId,
  tenantSlug,
  estado,
  podeMexer,
}: {
  tenantId: string;
  tenantSlug: string;
  estado: EstadoDominio;
  podeMexer: boolean;
}) {
  const [form, enviar, enviando] = useActionState(salvarDominio.bind(null, tenantId), INICIAL);
  const [pendente, iniciar] = useTransition();
  const [resposta, setResposta] = useState<EstadoForm | null>(null);

  const verificacao = resposta?.verificacao;

  return (
    <div className="space-y-6">
      {/* --- estado atual --- */}
      <div className="rounded-cartao border border-line bg-raised p-4">
        {estado.dominio ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-titulo text-lg font-bold">{estado.dominio}</p>
                <p className="mt-0.5 text-xs">
                  {estado.verificado ? (
                    <span className="text-sucesso">verificado e no ar</span>
                  ) : (
                    <span className="text-alerta">aguardando o registro de DNS</span>
                  )}
                </p>
              </div>

              {podeMexer && (
                <div className="flex shrink-0 gap-3">
                  <button
                    type="button"
                    disabled={pendente}
                    onClick={() =>
                      iniciar(async () => setResposta(await conferir(tenantId)))
                    }
                    className="rounded-botao bg-accent px-4 py-2 text-sm font-semibold text-accent-txt disabled:opacity-60"
                  >
                    {pendente ? 'Conferindo…' : 'Conferir agora'}
                  </button>
                  <button
                    type="button"
                    disabled={pendente}
                    onClick={() => iniciar(() => desvincular(tenantId))}
                    className="text-xs text-muted hover:text-perigo disabled:opacity-60"
                  >
                    desvincular
                  </button>
                </div>
              )}
            </div>

            {/* --- instrução de DNS --- */}
            {estado.instrucao && !estado.verificado && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-sm font-medium">Crie este registro no seu DNS</p>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[6rem_1fr]">
                  <dt className="text-faint">Tipo</dt>
                  <dd>
                    <code className="rounded-botao bg-base px-2 py-1 text-sm">
                      {estado.instrucao.tipo}
                    </code>
                  </dd>

                  <dt className="text-faint">Nome</dt>
                  <dd>
                    <Copiavel valor={estado.instrucao.nome} />
                  </dd>

                  <dt className="text-faint">Valor</dt>
                  <dd>
                    <Copiavel valor={estado.instrucao.valor} />
                  </dd>
                </dl>

                {estado.instrucao.aviso && (
                  <p className="prosa mt-4 rounded-botao border border-alerta/40 bg-alerta/10 px-3 py-2.5 text-sm">
                    {estado.instrucao.aviso}
                  </p>
                )}
              </div>
            )}

            {/* --- resposta da conferência --- */}
            {verificacao && (
              <div className="mt-4 border-t border-line pt-4">
                {verificacao.verificado ? (
                  <p className="rounded-botao border border-sucesso/40 bg-sucesso/10 px-3 py-2.5 text-sm">
                    Verificado. Sua vitrine já responde em{' '}
                    <strong>{estado.dominio}</strong>.
                  </p>
                ) : (
                  <>
                    <p className="rounded-botao border border-alerta/40 bg-alerta/10 px-3 py-2.5 text-sm">
                      {verificacao.explicacao}
                    </p>
                    {verificacao.encontrado.length > 0 && (
                      <p className="mt-2 text-xs text-faint">
                        Encontrado: {verificacao.encontrado.join(', ')}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {resposta?.erro && (
              <p role="alert" className="mt-4 text-sm text-perigo">
                {resposta.erro}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            Nenhum domínio próprio ainda. Sua vitrine responde em{' '}
            <code className="rounded-botao bg-base px-2 py-1 text-xs">/{tenantSlug}</code>.
          </p>
        )}
      </div>

      {/* --- cadastro --- */}
      {podeMexer && (
        <form action={enviar} className="space-y-3">
          <label htmlFor="dominio" className="block text-sm font-medium">
            {estado.dominio ? 'Trocar o domínio' : 'Cadastrar domínio'}
          </label>
          <input
            id="dominio"
            name="dominio"
            placeholder="ingressos.suacasa.com.br"
            maxLength={253}
            required
            className={campo}
          />

          {estado.dominio && (
            <p className="text-xs text-faint">
              Trocar derruba a verificação atual: o domínio novo precisa do próprio registro de
              DNS, e até lá a vitrine volta a responder só em /{tenantSlug}.
            </p>
          )}

          {form.erro && (
            <p
              role="alert"
              className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo"
            >
              {form.erro}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="rounded-botao border border-line px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </form>
      )}
    </div>
  );
}
