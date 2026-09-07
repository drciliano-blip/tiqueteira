/**
 * Injeta a cor do produtor na raiz do documento.
 *
 * O `globals.css` define `--color-accent: var(--tenant-accent, ...)`, então
 * basta declarar `--tenant-accent` num ancestral para toda a árvore mudar de
 * cor. Sem classe condicional, sem prop de cor descendo por dez componentes.
 *
 * O texto sobre o acento é escolhido pelo contraste real da cor, e não
 * chutado: um acento amarelo com texto branco é ilegível, e produtor escolhe
 * cor por gosto, não por acessibilidade.
 */

function contrasteSobre(hex: string): '#FFFFFF' | '#12131A' {
  const limpo = hex.replace('#', '');
  const full =
    limpo.length === 3
      ? limpo
          .split('')
          .map((c) => c + c)
          .join('')
      : limpo;

  if (full.length !== 6) return '#FFFFFF';

  // Luminância relativa (WCAG 2.x).
  const canal = (i: number) => {
    const v = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);

  // Contraste contra branco vs. contra o fundo escuro da base.
  const contraBranco = 1.05 / (L + 0.05);
  return contraBranco >= 4.5 ? '#FFFFFF' : '#12131A';
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function TemaTenant({ corAcento }: { corAcento: string | null | undefined }) {
  // Valor vindo do banco entra em CSS: só aceita hexadecimal, nada de
  // interpolar texto livre numa folha de estilo.
  if (!corAcento || !HEX.test(corAcento)) return null;

  const css = `:root{--tenant-accent:${corAcento};--tenant-accent-txt:${contrasteSobre(corAcento)}}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
