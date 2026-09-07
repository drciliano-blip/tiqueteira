/**
 * Cartaz do evento, proporção 3:4 — benchmark, seção 4.4, princípio 3.
 *
 * Quando o produtor sobe a arte, mostra a arte. Enquanto não sobe, gera um
 * cartaz de espaço reservado a partir do id do evento: mesmo evento, mesmo
 * cartaz, sempre. Determinismo importa aqui — cartaz que muda de cor a cada
 * recarga parece defeito.
 *
 * O reservado não é um cinza vazio de propósito. Um placeholder apagado faz a
 * vitrine parecer quebrada; este preenche o espaço com peso gráfico, para que
 * o layout seja avaliado como será na vida real.
 */

function hash(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Duas ou três palavras do título, para caber no cartaz sem virar sopa. */
function chamada(titulo: string): string[] {
  const palavras = titulo.trim().split(/\s+/).filter(Boolean);
  if (palavras.length <= 3) return palavras;
  return [palavras[0]!, palavras.slice(1, 3).join(' '), palavras.slice(3).join(' ')].filter(Boolean);
}

export function Cartaz({
  eventoId,
  titulo,
  imagemUrl,
  prioridade = false,
}: {
  eventoId: string;
  titulo: string;
  imagemUrl?: string | null;
  prioridade?: boolean;
}) {
  if (imagemUrl) {
    return (
      // Sem next/image por enquanto: a arte virá de domínio externo ou do
      // Storage, e cada um exige configuração própria de host.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imagemUrl}
        alt={`Cartaz de ${titulo}`}
        loading={prioridade ? 'eager' : 'lazy'}
        className="aspect-[3/4] w-full rounded-cartao object-cover"
      />
    );
  }

  const h = hash(eventoId);
  const matiz = h % 360;
  const matiz2 = (matiz + 40 + (h % 60)) % 360;
  const linhas = chamada(titulo);

  return (
    <div
      role="img"
      aria-label={`Cartaz de ${titulo}`}
      className="relative aspect-[3/4] w-full overflow-hidden rounded-cartao"
      style={{
        background: `linear-gradient(150deg,
          hsl(${matiz} 72% 22%) 0%,
          hsl(${matiz} 60% 12%) 45%,
          hsl(${matiz2} 65% 18%) 100%)`,
      }}
    >
      {/* Halo de luz, para não parecer um retângulo chapado. */}
      <div
        aria-hidden
        className="absolute -right-1/4 -top-1/4 h-2/3 w-2/3 rounded-full opacity-50 blur-2xl"
        style={{ background: `hsl(${matiz2} 85% 45%)` }}
      />
      <div
        aria-hidden
        className="absolute -bottom-1/3 -left-1/4 h-2/3 w-2/3 rounded-full opacity-30 blur-2xl"
        style={{ background: `hsl(${matiz} 90% 50%)` }}
      />

      <div className="absolute inset-0 flex flex-col justify-end p-4">
        <div className="font-titulo text-[clamp(1rem,7cqw,1.6rem)] font-extrabold uppercase leading-[0.95] tracking-tight text-white/95">
          {linhas.map((l, i) => (
            <div key={i} className={i === 1 ? 'text-white' : 'text-white/80'}>
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* Vinheta inferior, para o título ler bem sobre qualquer matiz. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/5"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)' }}
      />
    </div>
  );
}
