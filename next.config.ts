import type { NextConfig } from 'next';

/**
 * Cabeçalhos de segurança — plano, seção 14.
 *
 * Duas armadilhas evitadas aqui:
 *
 * 1. **`Permissions-Policy` com `camera=()`** desligaria a câmera do
 *    navegador — e a portaria inteira depende dela. Fica `camera=(self)`.
 * 2. **CSP com `frame-ancestors 'none'`** protege contra clickjacking, que no
 *    nosso caso significaria alguém embutir o checkout num site próprio e
 *    coletar dados por cima.
 *
 * O `script-src` aceita `'unsafe-inline'` porque o Next injeta scripts de
 * hidratação sem nonce por padrão. Apertar isso exige gerar nonce no
 * middleware, e o ganho real é pequeno enquanto não houver conteúdo de
 * terceiros na página. Está anotado como dívida, não esquecido.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // `data:` é necessário: o QR do ingresso é gerado como data URI.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  // A portaria usa a câmera via getUserMedia, que não passa por aqui, mas o
  // media-src cobre o elemento <video>.
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

const CABECALHOS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // Câmera liberada para a própria origem — a portaria depende dela.
    // Microfone, geolocalização e pagamento do navegador não são usados.
    value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: CABECALHOS },
      {
        // Área do comprador, painel e portaria não vão para buscador.
        source: '/(painel|portaria|meus-ingressos|checkout|ingresso)/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
