'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { ScannerQr } from '@/components/scanner-qr';
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
 * entrada entra numa fila que sobe depois.
 */

type Modo = 'scanner' | 'busca';

type LinhaBuscaLocal = IngressoManifesto & { id?: string };

type Resultado = ResultadoCheckin | { situacao: 'desconhecido' };

const CORES: Record<string, string> = {
  liberado: 'bg-sucesso text-black',
  documento: 'bg-alerta text-black',
  duplicado: 'bg-perigo text-white',
  cancelado: 'bg-perigo text-white',
  outro_evento: 'bg-perigo text-white',
  invalido: 'bg-perigo text-white',
  desconhecido: 'bg-alerta text-black',
};

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
}: {
  eventId: string;
  eventoTitulo: string;
  inicial: ContadorPortaria;
}) {
  const [modo, setModo] = useState<Modo>('scanner');
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

      const atualizado = await baixarManifesto(eventId);
      if (ativo && atualizado) setManifesto(atualizado);
    })();

    return () => {
      ativo = false;
    };
  }, [eventId]);

  useEffect(() => {
    if (!manifesto) return;

    const geradoEm = new Date(manifesto.geradoEm).getTime();
    const atualizar = () =>
      setIdadeDoManifesto(Math.round((Date.now() - geradoEm) / 60_000));

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

          const local = await validarLocalmente(eventId, token, manifesto, indice);
          setPendentes(filaPendente(eventId).length);

          if (local.situacao === 'liberado') {
            setNumeros((n) => ({ ...n, presentes: n.presentes + 1 }));
            mostrar(
              {
                situacao: 'liberado',
                ticketId: '',
                codigo: local.codigo,
                titular: local.titular,
                titularCpf: local.cpfParcial,
                lote: local.lote,
                exigeDocumento: local.exigeDocumento,
              },
              local.exigeDocumento,
            );
          } else if (local.situacao === 'duplicado') {
            mostrar(
              {
                situacao: 'duplicado',
                codigo: local.codigo,
                titular: local.titular,
                entrouEm: new Date(local.entrouEm),
                entrouPor: null,
              },
              false,
            );
          } else if (local.situacao === 'cancelado') {
            mostrar({ situacao: 'cancelado', codigo: local.codigo, motivo: null }, false);
          } else {
            mostrar({ situacao: 'desconhecido' }, false);
          }
          return;
        }

        // Com rede, o servidor manda: só ele vê os outros portões.
        const r = await lerQr(eventId, token);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }

        const pedeDocumento =
          r.resultado.situacao === 'liberado' && r.resultado.exigeDocumento;

        if (r.resultado.situacao === 'liberado') {
          setNumeros((n) => ({ ...n, presentes: n.presentes + 1 }));
        }

        mostrar(r.resultado, pedeDocumento);
      });
    },
    [eventId, manifesto, indice, mostrar],
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

        <p className="tabular shrink-0 text-sm">
          <span className="font-bold">{numeros.presentes}</span>
          <span className="text-white/50"> / {numeros.emitidos}</span>
        </p>
      </header>

      <main className="flex-1 px-4 pb-4">
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
                    </p>
                  </div>

                  {t.s === 'valido' && t.id ? (
                    <button
                      type="button"
                      disabled={processando}
                      onClick={() =>
                        iniciar(async () => {
                          const r = await liberarManualmente(eventId, t.id!);
                          if (r.ok) {
                            if (r.resultado.situacao === 'liberado') {
                              setNumeros((n) => ({ ...n, presentes: n.presentes + 1 }));
                              mostrar(r.resultado, r.resultado.exigeDocumento);
                            } else {
                              mostrar(r.resultado, false);
                            }
                            setTermo('');
                          } else {
                            setErro(r.erro);
                          }
                        })
                      }
                      className="shrink-0 rounded-botao bg-sucesso px-4 py-2 text-sm font-semibold text-black"
                    >
                      Liberar
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs uppercase text-white/40">
                      {t.s === 'valido' ? 'leia o QR' : t.s}
                    </span>
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
                {resultado.exigeDocumento ? 'Confira o documento' : 'Pode entrar'}
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

          {resultado.situacao === 'duplicado' && (
            <>
              <p className="text-4xl font-black uppercase">Já entrou</p>
              <p className="mt-4 text-2xl font-bold">{resultado.titular}</p>
              <p className="mt-3 text-lg">
                Entrada às {hora(resultado.entrouEm)}
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
