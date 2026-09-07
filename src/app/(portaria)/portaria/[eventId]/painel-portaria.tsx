'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { ScannerQr } from '@/components/scanner-qr';
import { mascararCpf } from '@/domain/cpf';
import type { ContadorPortaria, LinhaBusca, ResultadoCheckin } from '@/lib/checkin';
import { buscar, contador, liberarManualmente, lerQr, marcarDocumento } from './acoes';

/**
 * Tela de portaria — benchmark, seção 5.6.
 *
 * Câmera ocupando quase tudo e resultado em bloco de cor cheia: verde entra,
 * vermelho não entra, âmbar exige conferência de documento. Fonte grande.
 *
 * O projeto assume as condições reais da porta: escuro, barulho, fila atrás,
 * operador com uma mão só. Por isso não há menu, o resultado é lido de longe,
 * e o botão de busca manual fica ao alcance do polegar.
 */

type Modo = 'scanner' | 'busca';

const CORES: Record<string, string> = {
  liberado: 'bg-sucesso text-black',
  documento: 'bg-alerta text-black',
  duplicado: 'bg-perigo text-white',
  cancelado: 'bg-perigo text-white',
  outro_evento: 'bg-perigo text-white',
  invalido: 'bg-perigo text-white',
};

function hora(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}

export function PainelPortaria({
  eventId,
  eventoTitulo,
  inicial,
}: {
  eventId: string;
  eventoTitulo: string;
  inicial: ContadorPortaria;
}) {
  const [modo, setModo] = useState<Modo>('scanner');
  const [resultado, setResultado] = useState<ResultadoCheckin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [numeros, setNumeros] = useState(inicial);
  const [processando, iniciar] = useTransition();

  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<LinhaBusca[]>([]);
  const [buscando, iniciarBusca] = useTransition();

  /**
   * Estado, não ref: o bloco de resultado depende disto para decidir se some
   * ao toque. Ref lido durante a renderização não faz o React redesenhar.
   */
  const [aguardandoDocumento, setAguardandoDocumento] = useState(false);

  /** Contador ao vivo, sem pesar: uma consulta a cada 20 segundos. */
  useEffect(() => {
    const id = setInterval(() => {
      void contador(eventId).then(setNumeros).catch(() => undefined);
    }, 20_000);
    return () => clearInterval(id);
  }, [eventId]);

  const processar = useCallback(
    (token: string) => {
      iniciar(async () => {
        setErro(null);
        const r = await lerQr(eventId, token);

        if (!r.ok) {
          setErro(r.erro);
          return;
        }

        const pedeDocumento =
          r.resultado.situacao === 'liberado' && r.resultado.exigeDocumento;

        setResultado(r.resultado);
        setAguardandoDocumento(pedeDocumento);

        if (r.resultado.situacao === 'liberado') {
          setNumeros((n) => ({ ...n, presentes: n.presentes + 1 }));
        }

        // Resultado que não exige ação some sozinho: a fila não espera.
        if (!pedeDocumento) {
          setTimeout(() => setResultado(null), 2500);
        }
      });
    },
    [eventId],
  );

  useEffect(() => {
    if (termo.trim().length < 3) return;

    // Pausa antes de consultar: com fila na porta o operador digita rápido, e
    // uma consulta por tecla derrubaria a resposta.
    const id = setTimeout(() => {
      iniciarBusca(async () => {
        try {
          setAchados(await buscar(eventId, termo));
        } catch {
          setAchados([]);
        }
      });
    }, 300);

    return () => clearTimeout(id);
  }, [termo, eventId]);

  /**
   * Lista derivada em vez de limpa por efeito: apagar o campo esconde os
   * resultados na mesma renderização, sem passar por um ciclo a mais.
   */
  const visiveis = termo.trim().length >= 3 ? achados : [];

  const situacaoVisual =
    resultado?.situacao === 'liberado' && resultado.exigeDocumento
      ? 'documento'
      : resultado?.situacao;

  return (
    <div className="flex min-h-dvh flex-col bg-black text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="min-w-0 truncate text-sm font-medium">{eventoTitulo}</p>
        <p className="tabular shrink-0 text-sm">
          <span className="font-bold">{numeros.presentes}</span>
          <span className="text-white/50"> / {numeros.emitidos}</span>
        </p>
      </header>

      <main className="flex-1 px-4 pb-4">
        {modo === 'scanner' ? (
          <ScannerQr onLeitura={processar} pausado={resultado !== null || processando} />
        ) : (
          <div className="rounded-cartao bg-white/5 p-4">
            <label htmlFor="busca-portaria" className="text-sm text-white/70">
              Nome, CPF ou código
            </label>
            <input
              id="busca-portaria"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              autoFocus
              placeholder="Ex.: Marina Costa"
              className="mt-2 w-full rounded-botao border border-white/20 bg-black px-3 py-3 text-lg text-white placeholder:text-white/30 focus:border-white focus:outline-none"
            />

            {buscando && <p className="mt-3 text-sm text-white/50">Procurando…</p>}

            <ul className="mt-3 divide-y divide-white/10">
              {visiveis.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t.titular}</p>
                    <p className="tabular text-xs text-white/50">
                      {t.codigo}
                      {t.titularCpf ? ` · ${mascararCpf(t.titularCpf)}` : ''}
                      {t.checkedInEm ? ` · entrou ${hora(new Date(t.checkedInEm))}` : ''}
                    </p>
                  </div>

                  {t.status === 'valido' ? (
                    <button
                      type="button"
                      disabled={processando}
                      onClick={() =>
                        iniciar(async () => {
                          const r = await liberarManualmente(eventId, t.id);
                          if (r.ok) {
                            setResultado(r.resultado);
                            if (r.resultado.situacao === 'liberado') {
                              setNumeros((n) => ({ ...n, presentes: n.presentes + 1 }));
                              setAguardandoDocumento(r.resultado.exigeDocumento);
                              if (!r.resultado.exigeDocumento) {
                                setTimeout(() => setResultado(null), 2500);
                              }
                            }
                            setTermo('');
                          } else setErro(r.erro);
                        })
                      }
                      className="shrink-0 rounded-botao bg-sucesso px-4 py-2 text-sm font-semibold text-black"
                    >
                      Liberar
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs uppercase text-white/40">
                      {t.status}
                    </span>
                  )}
                </li>
              ))}

              {termo.trim().length >= 3 && !buscando && visiveis.length === 0 && (
                <li className="py-6 text-center text-sm text-white/50">
                  Ninguém com esse nome neste evento.
                </li>
              )}
            </ul>
          </div>
        )}

        {erro && (
          <p role="alert" className="mt-3 rounded-botao bg-perigo px-4 py-3 text-sm">
            {erro}
          </p>
        )}
      </main>

      {/* Alternância ao alcance do polegar, no rodapé. */}
      <nav className="grid grid-cols-2 gap-2 border-t border-white/10 p-3">
        <button
          type="button"
          onClick={() => setModo('scanner')}
          className={`rounded-botao py-3 font-semibold ${
            modo === 'scanner' ? 'bg-white text-black' : 'bg-white/10 text-white'
          }`}
        >
          Ler QR
        </button>
        <button
          type="button"
          onClick={() => setModo('busca')}
          className={`rounded-botao py-3 font-semibold ${
            modo === 'busca' ? 'bg-white text-black' : 'bg-white/10 text-white'
          }`}
        >
          Buscar nome
        </button>
      </nav>

      {/* Resultado em bloco de cor cheia, legível a dois metros de distância. */}
      {resultado && (
        <div
          role="status"
          aria-live="assertive"
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center p-6 text-center ${
            CORES[situacaoVisual ?? 'invalido']
          }`}
          onClick={() => {
            if (!aguardandoDocumento) setResultado(null);
          }}
        >
          {resultado.situacao === 'liberado' && (
            <>
              <p className="text-4xl font-black uppercase">
                {resultado.exigeDocumento ? 'Confira o documento' : 'Pode entrar'}
              </p>
              <p className="mt-4 text-2xl font-bold">{resultado.titular}</p>
              {resultado.titularCpf && (
                <p className="tabular mt-1 text-lg">{mascararCpf(resultado.titularCpf)}</p>
              )}
              <p className="mt-2 text-base opacity-80">
                {resultado.lote} · {resultado.codigo}
              </p>

              {resultado.exigeDocumento && (
                <div className="mt-8 grid w-full max-w-sm gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAguardandoDocumento(false);
                      void marcarDocumento(eventId, resultado.ticketId);
                      setResultado(null);
                    }}
                    className="rounded-botao bg-black py-4 text-lg font-bold text-white"
                  >
                    Documento confere — liberar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAguardandoDocumento(false);
                      setResultado(null);
                    }}
                    className="rounded-botao border-2 border-black py-3 font-semibold"
                  >
                    Não confere
                  </button>
                </div>
              )}
            </>
          )}

          {resultado.situacao === 'duplicado' && (
            <>
              <p className="text-4xl font-black uppercase">Já entrou</p>
              <p className="mt-4 text-2xl font-bold">{resultado.titular}</p>
              <p className="mt-3 text-lg">
                Entrada às {hora(new Date(resultado.entrouEm))}
                {resultado.entrouPor ? `, por ${resultado.entrouPor}` : ''}
              </p>
              <p className="mt-6 max-w-xs text-sm opacity-80">
                Este ingresso já foi usado. Chame a supervisão se a pessoa contestar.
              </p>
            </>
          )}

          {resultado.situacao === 'cancelado' && (
            <>
              <p className="text-4xl font-black uppercase">Cancelado</p>
              <p className="mt-4 text-lg">Código {resultado.codigo}</p>
              <p className="mt-2 max-w-xs text-sm opacity-80">
                {resultado.motivo === 'refunded'
                  ? 'Ingresso reembolsado.'
                  : resultado.motivo === 'chargeback'
                    ? 'Pagamento contestado.'
                    : 'Ingresso cancelado.'}
              </p>
            </>
          )}

          {resultado.situacao === 'outro_evento' && (
            <>
              <p className="text-4xl font-black uppercase">Outro evento</p>
              <p className="mt-4 max-w-xs text-base">
                Este ingresso é válido, mas não é para esta festa.
              </p>
            </>
          )}

          {resultado.situacao === 'invalido' && (
            <>
              <p className="text-4xl font-black uppercase">Inválido</p>
              <p className="mt-4 max-w-xs text-base">
                {resultado.motivo === 'assinatura'
                  ? 'Este QR não foi emitido por nós.'
                  : 'Não consegui ler este código.'}
              </p>
            </>
          )}

          {!aguardandoDocumento && (
            <p className="absolute bottom-8 text-sm opacity-70">Toque para continuar</p>
          )}
        </div>
      )}
    </div>
  );
}
