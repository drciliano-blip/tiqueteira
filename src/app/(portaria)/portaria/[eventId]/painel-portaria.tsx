'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { ScannerQr } from '@/components/scanner-qr';
import type { Movimento, PoliticaPortaria } from '@/domain/portaria';
import type { ContadorPortaria, ResultadoCheckin } from '@/lib/checkin';
import {
  baixarManifesto,
  buscarNoManifesto,
  filaPendente,
  indexar,
  manifestoGuardado,
  sincronizar,
  validarLocalmente,
  type IngressoManifesto,
  type Manifesto,
} from '@/lib/portaria-offline';
import { buscar, contador, liberarManualmente, lerQr, marcarDocumento } from './acoes';

/**
 * Tela de portaria — benchmark, seção 5.6, e plano, seção 24.
 *
 * Câmera ocupando quase tudo, resultado em bloco de cor cheia, sem menu.
 * O projeto assume as condições reais: escuro, barulho, fila atrás, operador
 * com uma mão só, e rede que cai justamente quando a casa enche.
 *
 * **Funciona sem rede.** O aparelho baixa o manifesto ao abrir e valida no
 * local. Quando há rede, quem decide é o servidor — só ele enxerga o que os
 * outros portões fizeram. Sem rede, a validação local segura a operação e a
 * passagem entra numa fila que sobe depois.
 *
 * **O sentido é grudento.** Um aparelho escalado para a saída fica na saída,
 * inclusive depois de recarregar a página. Voltar sozinho para "entrada"
 * seria o pior erro possível: o operador continuaria lendo QRs sem perceber
 * que trocou de sentido, e cada saída viraria uma recusa na cara da pessoa.
 */

type Modo = 'scanner' | 'busca';

type LinhaBuscaLocal = IngressoManifesto & { id?: string };

type Resultado = ResultadoCheckin | { situacao: 'desconhecido' };

const CORES: Record<string, string> = {
  liberado: 'bg-sucesso text-black',
  documento: 'bg-alerta text-black',
  // Branco para a saída: distinto do verde da entrada mesmo de relance, no
  // escuro, e sem depender da cor do produtor.
  saida: 'bg-white text-black',
  recusado: 'bg-perigo text-white',
  outro_evento: 'bg-perigo text-white',
  invalido: 'bg-perigo text-white',
  desconhecido: 'bg-alerta text-black',
};

const TITULO_RECUSA: Record<string, string> = {
  ja_entrou: 'Já entrou',
  reentrada_bloqueada: 'Não pode voltar',
  nao_esta_dentro: 'Não está na casa',
  cancelado: 'Cancelado',
  transferido: 'Transferido',
  saida_nao_controlada: 'Saída desligada',
};

const CHAVE_SENTIDO = (eventId: string) => `portaria:sentido:${eventId}`;

function hora(d: Date | string): string {
  const data = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(data);
}

export function PainelPortaria({
  eventId,
  eventoTitulo,
  inicial,
  politica,
}: {
  eventId: string;
  eventoTitulo: string;
  inicial: ContadorPortaria;
  politica: PoliticaPortaria;
}) {
  const [modo, setModo] = useState<Modo>('scanner');
  const [sentido, setSentido] = useState<Movimento>('entrada');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [aguardandoDocumento, setAguardandoDocumento] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [numeros, setNumeros] = useState(inicial);
  const [processando, iniciar] = useTransition();

  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<LinhaBuscaLocal[]>([]);

  const [manifesto, setManifesto] = useState<Manifesto | null>(null);
  /**
   * Idade da lista em estado, não calculada na renderização: ler o relógio
   * durante o render deixa o resultado instável entre um desenho e outro.
   */
  const [idadeDoManifesto, setIdadeDoManifesto] = useState<number | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendentes, setPendentes] = useState(0);

  const indice = useMemo(
    () => (manifesto ? indexar(manifesto) : new Map<string, IngressoManifesto>()),
    [manifesto],
  );
  const ultimoToken = useRef('');

  /**
   * Lista guardada entra primeiro, para a portaria já abrir funcionando; a
   * versão atualizada vem em seguida.
   *
   * Tudo assíncrono de propósito: `localStorage` e `navigator.onLine` só
   * existem no navegador, e lê-los durante a renderização quebraria a
   * hidratação — o servidor não tem nem um nem outro.
   */
  useEffect(() => {
    let ativo = true;

    void (async () => {
      const guardado = manifestoGuardado(eventId);
      if (!ativo) return;

      if (guardado) setManifesto(guardado);
      setPendentes(filaPendente(eventId).length);
      setOnline(navigator.onLine);

      try {
        const salvo = localStorage.getItem(CHAVE_SENTIDO(eventId));
        if (salvo === 'saida' || salvo === 'entrada') setSentido(salvo);
      } catch {
        // Aba privada. Segue na entrada, que é o padrão.
      }

      const atualizado = await baixarManifesto(eventId);
      if (ativo && atualizado) setManifesto(atualizado);
    })();

    return () => {
      ativo = false;
    };
  }, [eventId]);

  const trocarSentido = useCallback(
    (novo: Movimento) => {
      setSentido(novo);
      setResultado(null);
      try {
        localStorage.setItem(CHAVE_SENTIDO(eventId), novo);
      } catch {
        // Não poder lembrar não pode impedir de trocar agora.
      }
    },
    [eventId],
  );

  useEffect(() => {
    if (!manifesto) return;

    const geradoEm = new Date(manifesto.geradoEm).getTime();
    const atualizar = () => setIdadeDoManifesto(Math.round((Date.now() - geradoEm) / 60_000));

    // Primeira medida no próximo tique, não no corpo do efeito: medir o
    // relógio durante a renderização torna o resultado instável.
    const inicial = setTimeout(atualizar, 0);
    const id = setInterval(atualizar, 30_000);

    return () => {
      clearTimeout(inicial);
      clearInterval(id);
    };
  }, [manifesto]);

  useEffect(() => {
    const mudou = () => setOnline(navigator.onLine);
    window.addEventListener('online', mudou);
    window.addEventListener('offline', mudou);
    return () => {
      window.removeEventListener('online', mudou);
      window.removeEventListener('offline', mudou);
    };
  }, []);

  /** Sobe a fila e atualiza o contador sempre que houver rede. */
  useEffect(() => {
    const rodar = async () => {
      if (!navigator.onLine) return;

      const r = await sincronizar(eventId);
      if (r.enviadas > 0) setPendentes(filaPendente(eventId).length);

      try {
        setNumeros(await contador(eventId));
      } catch {
        // Rede caiu no meio. O próximo ciclo tenta de novo.
      }
    };

    void rodar();
    const id = setInterval(() => void rodar(), 20_000);
    return () => clearInterval(id);
  }, [eventId]);

  const mostrar = useCallback((r: Resultado, pedeDocumento: boolean) => {
    setResultado(r);
    setAguardandoDocumento(pedeDocumento);
    // O que não exige ação some sozinho: a fila não espera.
    if (!pedeDocumento) setTimeout(() => setResultado(null), 2500);
  }, []);

  /** Move o contador local na direção certa, sem esperar o servidor. */
  const contarLocalmente = useCallback((movimento: Movimento, reentrada: boolean) => {
    setNumeros((n) => {
      if (movimento === 'saida') {
        return { ...n, dentro: Math.max(0, n.dentro - 1), sairam: n.sairam + 1 };
      }
      return {
        ...n,
        dentro: n.dentro + 1,
        entraram: reentrada ? n.entraram : n.entraram + 1,
        sairam: reentrada ? Math.max(0, n.sairam - 1) : n.sairam,
      };
    });
  }, []);

  const processar = useCallback(
    (token: string) => {
      ultimoToken.current = token;

      iniciar(async () => {
        setErro(null);

        // Sem rede: decide no aparelho. É para isso que o manifesto existe.
        if (!navigator.onLine) {
          if (!manifesto) {
            setErro('Sem rede e sem lista baixada. Conecte uma vez para baixar a lista.');
            return;
          }

          const local = await validarLocalmente(eventId, token, manifesto, indice, sentido);
          setPendentes(filaPendente(eventId).length);

          if (local.situacao === 'liberado') {
            contarLocalmente('entrada', local.reentrada);
            mostrar(
              {
                situacao: 'liberado',
                ticketId: '',
                codigo: local.codigo,
                titular: local.titular,
                titularCpf: local.cpfParcial,
                lote: local.lote,
                reentrada: local.reentrada,
                exigeDocumento: local.exigeDocumento,
              },
              local.exigeDocumento,
            );
          } else if (local.situacao === 'saida') {
            contarLocalmente('saida', false);
            mostrar(
              {
                situacao: 'saida',
                ticketId: '',
                codigo: local.codigo,
                titular: local.titular,
                entrouEm: local.entrouEm ? new Date(local.entrouEm) : null,
              },
              false,
            );
          } else if (local.situacao === 'recusado') {
            mostrar(
              {
                situacao: 'recusado',
                motivo: local.motivo,
                explicacao: local.explicacao,
                codigo: local.codigo,
                titular: local.titular,
                entrouPor: null,
              },
              false,
            );
          } else {
            mostrar({ situacao: 'desconhecido' }, false);
          }
          return;
        }

        // Com rede, o servidor manda: só ele vê os outros portões.
        const r = await lerQr(eventId, token, sentido);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }

        const pedeDocumento = r.resultado.situacao === 'liberado' && r.resultado.exigeDocumento;

        if (r.resultado.situacao === 'liberado') {
          contarLocalmente('entrada', r.resultado.reentrada);
        } else if (r.resultado.situacao === 'saida') {
          contarLocalmente('saida', false);
        }

        mostrar(r.resultado, pedeDocumento);
      });
    },
    [eventId, manifesto, indice, mostrar, sentido, contarLocalmente],
  );

  /** Busca: cai para o manifesto quando não há rede. */
  useEffect(() => {
    if (termo.trim().length < 3) return;

    const id = setTimeout(() => {
      void (async () => {
        if (!navigator.onLine) {
          setAchados(manifesto ? buscarNoManifesto(manifesto, termo) : []);
          return;
        }
        try {
          const linhas = await buscar(eventId, termo);
          setAchados(
            linhas.map((t) => ({
              h: '',
              c: t.codigo,
              n: t.titular,
              d: t.titularCpf ? t.titularCpf.slice(3, 9) : null,
              l: '',
              s: t.status,
              e: t.checkedInEm ? new Date(t.checkedInEm).toISOString() : null,
              i: t.dentro,
              q: t.entradasCount,
              x: t.ultimaSaidaEm ? new Date(t.ultimaSaidaEm).toISOString() : null,
              id: t.id,
            })),
          );
        } catch {
          setAchados(manifesto ? buscarNoManifesto(manifesto, termo) : []);
        }
      })();
    }, 300);

    return () => clearTimeout(id);
  }, [termo, eventId, manifesto]);

  const visiveis = termo.trim().length >= 3 ? achados : [];

  const situacaoVisual =
    resultado?.situacao === 'liberado' && resultado.exigeDocumento
      ? 'documento'
      : resultado?.situacao;

  /**
   * A política do servidor manda; o manifesto cobre o caso de a página ter
   * vindo do cache do service worker com dado velho.
   */
  const controlaSaida = manifesto?.controlaSaida ?? politica.controlaSaida;
  const naSaida = controlaSaida && sentido === 'saida';

  return (
    <div className="flex min-h-dvh flex-col bg-black text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{eventoTitulo}</p>
          <p className="flex items-center gap-1.5 text-xs text-white/50">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-sucesso' : 'bg-alerta'}`}
            />
            {online ? 'conectado' : 'sem rede'}
            {idadeDoManifesto !== null && (
              <> · lista de {idadeDoManifesto < 1 ? 'agora' : `${idadeDoManifesto} min`}</>
            )}
            {pendentes > 0 && <> · {pendentes} a sincronizar</>}
          </p>
        </div>

        {/**
         * Com controle de saída, o número que importa é quem está DENTRO —
         * é o que o bombeiro pergunta e o que o produtor quer saber às duas
         * da manhã. Sem controle de saída, "dentro" seria só um sinônimo
         * confuso de "já entrou", então a tela mostra o que é verdade.
         */}
        <p className="tabular shrink-0 text-right text-sm leading-tight">
          <span className="font-bold">{controlaSaida ? numeros.dentro : numeros.entraram}</span>
          <span className="text-white/50"> / {numeros.emitidos}</span>
          {controlaSaida && (
            <span className="block text-[11px] text-white/40">
              {numeros.entraram} entraram · {numeros.sairam} saíram
            </span>
          )}
        </p>
      </header>

      {controlaSaida && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={() => trocarSentido('entrada')}
            aria-pressed={!naSaida}
            className={`rounded-botao py-3 text-lg font-bold ${
              naSaida ? 'bg-white/10 text-white/60' : 'bg-sucesso text-black'
            }`}
          >
            Entrada
          </button>
          <button
            type="button"
            onClick={() => trocarSentido('saida')}
            aria-pressed={naSaida}
            className={`rounded-botao py-3 text-lg font-bold ${
              naSaida ? 'bg-white text-black' : 'bg-white/10 text-white/60'
            }`}
          >
            Saída
          </button>
        </div>
      )}

      <main className={`flex-1 px-4 pb-4 ${naSaida ? 'ring-inset ring-4 ring-white/80' : ''}`}>
        {modo === 'scanner' ? (
          <>
            <ScannerQr onLeitura={processar} pausado={resultado !== null || processando} />

            {!manifesto && (
              <button
                type="button"
                disabled={baixando}
                onClick={() => {
                  setBaixando(true);
                  void baixarManifesto(eventId)
                    .then((m) => {
                      if (m) setManifesto(m);
                      else setErro('Não consegui baixar a lista.');
                    })
                    .finally(() => setBaixando(false));
                }}
                className="mt-3 w-full rounded-botao bg-white/10 py-3 text-sm font-medium"
              >
                {baixando ? 'Baixando lista…' : 'Baixar lista para funcionar sem rede'}
              </button>
            )}
          </>
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

            <ul className="mt-3 divide-y divide-white/10">
              {visiveis.map((t) => (
                <li key={t.c} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t.n}</p>
                    <p className="tabular text-xs text-white/50">
                      {t.c}
                      {t.d ? ` · ***${t.d}**` : ''}
                      {t.e ? ` · entrou ${hora(t.e)}` : ''}
                      {t.x ? ` · saiu ${hora(t.x)}` : ''}
                      {controlaSaida && t.i ? ' · na casa' : ''}
                    </p>
                  </div>

                  {t.id ? (
                    <button
                      type="button"
                      disabled={processando}
                      onClick={() =>
                        iniciar(async () => {
                          const r = await liberarManualmente(eventId, t.id!, sentido);
                          if (!r.ok) {
                            setErro(r.erro);
                            return;
                          }

                          if (r.resultado.situacao === 'liberado') {
                            contarLocalmente('entrada', r.resultado.reentrada);
                            mostrar(r.resultado, r.resultado.exigeDocumento);
                          } else {
                            if (r.resultado.situacao === 'saida') contarLocalmente('saida', false);
                            mostrar(r.resultado, false);
                          }
                          setTermo('');
                        })
                      }
                      className={`shrink-0 rounded-botao px-4 py-2 text-sm font-semibold ${
                        naSaida ? 'bg-white text-black' : 'bg-sucesso text-black'
                      }`}
                    >
                      {naSaida ? 'Saída' : 'Liberar'}
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs uppercase text-white/40">leia o QR</span>
                  )}
                </li>
              ))}

              {termo.trim().length >= 3 && visiveis.length === 0 && (
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
                {resultado.exigeDocumento
                  ? 'Confira o documento'
                  : resultado.reentrada
                    ? 'Voltou — pode entrar'
                    : 'Pode entrar'}
              </p>
              <p className="mt-4 text-2xl font-bold">{resultado.titular}</p>
              {resultado.titularCpf && (
                <p className="tabular mt-1 text-lg">***{resultado.titularCpf}**</p>
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
                      if (resultado.ticketId) {
                        void marcarDocumento(eventId, resultado.ticketId);
                      }
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

          {resultado.situacao === 'saida' && (
            <>
              <p className="text-4xl font-black uppercase">Saída registrada</p>
              <p className="mt-4 text-2xl font-bold">{resultado.titular}</p>
              {resultado.entrouEm && (
                <p className="mt-3 text-lg">Entrou às {hora(resultado.entrouEm)}</p>
              )}
              <p className="mt-2 text-base opacity-70">{resultado.codigo}</p>
            </>
          )}

          {resultado.situacao === 'recusado' && (
            <>
              <p className="text-4xl font-black uppercase">
                {TITULO_RECUSA[resultado.motivo] ?? 'Não pode passar'}
              </p>
              {resultado.titular && (
                <p className="mt-4 text-2xl font-bold">{resultado.titular}</p>
              )}
              <p className="mt-3 max-w-xs text-lg">{resultado.explicacao}</p>
              {resultado.entrouPor && (
                <p className="mt-2 text-sm opacity-80">Liberado por {resultado.entrouPor}</p>
              )}
              <p className="mt-6 max-w-xs text-sm opacity-70">
                Chame a supervisão se a pessoa contestar.
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

          {resultado.situacao === 'desconhecido' && (
            <>
              <p className="text-4xl font-black uppercase">Não está na lista</p>
              <p className="mt-4 max-w-xs text-base">
                Pode ser um ingresso comprado depois que a lista foi baixada. Havendo rede, leia
                de novo antes de barrar.
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
