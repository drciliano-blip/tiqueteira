'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Leitor de QR pela câmera do celular.
 *
 * Dois caminhos, nesta ordem:
 *
 * 1. `BarcodeDetector` — nativo do navegador, decodifica no próprio sistema.
 *    É muito mais rápido e gasta menos bateria, o que importa num aparelho
 *    que vai ficar cinco horas com a câmera ligada na porta.
 * 2. `jsQR` — baixado sob demanda, só quando o nativo não existe (Safari em
 *    iOS antigo, por exemplo). Funciona em qualquer lugar, custa mais CPU.
 *
 * Detalhes que só aparecem no uso real e que estão tratados aqui:
 * - `facingMode: environment` para abrir a câmera de trás, não a selfie.
 * - `playsInline` porque o iOS abre vídeo em tela cheia sem ele.
 * - Trava de repetição: o mesmo QR na frente da câmera dispara dezenas de
 *   leituras por segundo, e cada uma seria uma ida ao servidor.
 * - A câmera é desligada ao sair da tela. Aparelho de portaria costuma ficar
 *   com a tela ligada a noite toda.
 */

type BarcodeDetectorLike = {
  detect: (fonte: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

declare global {
  interface Window {
    BarcodeDetector?: {
      new (opcoes?: { formats?: string[] }): BarcodeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

export type EstadoScanner = 'iniciando' | 'lendo' | 'pausado' | 'sem_permissao' | 'sem_camera';

export function ScannerQr({
  onLeitura,
  pausado = false,
}: {
  onLeitura: (texto: string) => void;
  /** Pausa a leitura enquanto o resultado anterior está na tela. */
  pausado?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ultimaLeitura = useRef<{ texto: string; em: number }>({ texto: '', em: 0 });
  const pausadoRef = useRef(pausado);

  const [estado, setEstado] = useState<EstadoScanner>('iniciando');

  useEffect(() => {
    pausadoRef.current = pausado;
  }, [pausado]);

  const emitir = useCallback(
    (texto: string) => {
      const agora = Date.now();
      // Mesmo código só passa de novo depois de 3s: sem isso, um QR parado na
      // frente da câmera dispara dezenas de requisições por segundo.
      if (ultimaLeitura.current.texto === texto && agora - ultimaLeitura.current.em < 3000) {
        return;
      }
      ultimaLeitura.current = { texto, em: agora };

      if (navigator.vibrate) navigator.vibrate(60);
      onLeitura(texto);
    },
    [onLeitura],
  );

  useEffect(() => {
    let ativo = true;
    let quadro = 0;
    let detector: BarcodeDetectorLike | null = null;
    let jsQR: typeof import('jsqr').default | null = null;

    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setEstado('sem_camera');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!ativo) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();
        setEstado('lendo');
      } catch (e) {
        setEstado(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'sem_permissao'
            : 'sem_camera',
        );
        return;
      }

      if (window.BarcodeDetector) {
        try {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          detector = null;
        }
      }

      if (!detector) {
        jsQR = (await import('jsqr')).default;
        canvasRef.current = document.createElement('canvas');
      }

      const analisar = async () => {
        if (!ativo) return;
        quadro = requestAnimationFrame(() => void analisar());

        const video = videoRef.current;
        if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;
        if (pausadoRef.current) return;

        try {
          if (detector) {
            const achados = await detector.detect(video);
            const valor = achados[0]?.rawValue;
            if (valor) emitir(valor);
            return;
          }

          const canvas = canvasRef.current;
          if (!canvas || !jsQR) return;

          // Amostra reduzida: 480px de largura basta para QR e corta o custo
          // de CPU pela metade em aparelho antigo.
          const escala = Math.min(1, 480 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * escala);
          canvas.height = Math.round(video.videoHeight * escala);

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const achado = jsQR(imagem.data, imagem.width, imagem.height, {
            inversionAttempts: 'dontInvert',
          });
          if (achado?.data) emitir(achado.data);
        } catch {
          // Quadro ruim acontece o tempo todo com luz baixa. Segue o próximo.
        }
      };

      void analisar();
    }

    void iniciar();

    return () => {
      ativo = false;
      cancelAnimationFrame(quadro);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [emitir]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-cartao bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        aria-label="Câmera para leitura do QR do ingresso"
        className="h-full w-full object-cover"
      />

      {/* Mira: ajuda a pessoa a posicionar o ingresso sem instrução escrita. */}
      {estado === 'lendo' && !pausado && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-3/5 w-3/5 rounded-2xl border-2 border-white/70 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]" />
        </div>
      )}

      {estado !== 'lendo' && (
        <div className="absolute inset-0 grid place-items-center bg-base/90 p-6 text-center">
          {estado === 'iniciando' && <p className="text-sm text-muted">Ligando a câmera…</p>}

          {estado === 'sem_permissao' && (
            <div>
              <p className="font-semibold">Câmera bloqueada</p>
              <p className="prosa mt-2 text-sm text-muted">
                Libere o acesso à câmera nas permissões do navegador e recarregue. Enquanto
                isso, use a busca por nome.
              </p>
            </div>
          )}

          {estado === 'sem_camera' && (
            <div>
              <p className="font-semibold">Sem câmera disponível</p>
              <p className="prosa mt-2 text-sm text-muted">
                Este aparelho não tem câmera acessível pelo navegador. Use a busca por nome ou
                código.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
