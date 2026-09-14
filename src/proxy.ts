import { NextResponse, type NextRequest } from 'next/server';

import { ehHostDaPlataforma } from '@/domain/dominio';
import { OPERADOR } from '@/lib/operador';

/**
 * Roteamento por domínio próprio do produtor — ADR-018.
 *
 * No Next 16 este arquivo se chama `proxy.ts`: a convenção `middleware.ts` foi
 * depreciada e renomeada. Mesma função, nome novo.
 *
 * **O que ele faz, e só:** quando a requisição chega por um domínio que não é
 * nosso, reescreve o caminho para `/{hostname}/...`, e a rota `[tenantSlug]`
 * resolve o tenant pelo domínio em vez do slug. O navegador continua vendo
 * `ingressos.acasa.com.br/e/festa`; internamente vira
 * `/ingressos.acasa.com.br/e/festa`.
 *
 * **O que ele deliberadamente NÃO faz: consultar o banco.** A documentação do
 * Next avisa que o proxy pode ser distribuído para a CDN, e uma ida ao banco
 * em cada requisição desfaria justamente o trabalho de tornar a página do
 * evento cacheável na borda (ADR-015). Quem resolve o tenant é a página, com
 * o cache que ela já tem.
 *
 * **Reescreve só o que é do tenant.** Checkout, entrar, meus-ingressos,
 * painel e portaria continuam funcionando no domínio do produtor, servidos
 * pelo código da plataforma — o comprador não é jogado para fora do domínio
 * no meio da compra, que é onde se perde venda.
 */

/** Caminhos que pertencem à vitrine do produtor. O resto passa direto. */
function ehCaminhoDoTenant(pathname: string): boolean {
  return pathname === '/' || pathname === '/e' || pathname.startsWith('/e/');
}

export function proxy(request: NextRequest): NextResponse {
  const host = request.headers.get('host') ?? '';
  /**
   * Duas fontes: a variável de ambiente, que muda por deploy, e o domínio
   * institucional, que é constante do código. Assim a virada de DNS não
   * depende de alguém lembrar de atualizar a variável primeiro.
   */
  const nossos = [
    new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').host,
    OPERADOR.dominio,
  ];

  /**
   * Na dúvida, não reescreve. Errar para este lado é barato — o site
   * funciona pelo caminho normal. Errar para o outro derruba a plataforma
   * inteira, porque toda requisição passaria a procurar um tenant que não
   * existe.
   */
  if (!host || ehHostDaPlataforma(host, nossos)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (!ehCaminhoDoTenant(pathname)) return NextResponse.next();

  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  const destino = new URL(`/${hostname}${pathname === '/' ? '' : pathname}${search}`, request.url);

  /**
   * Sem cabeçalho extra: a página deduz que está num domínio próprio pelo
   * próprio parâmetro da rota, que passa a conter um ponto. Cabeçalho aqui
   * seria estado duplicado esperando divergir do parâmetro.
   */
  return NextResponse.rewrite(destino);
}

export const config = {
  /**
   * Fora: rotas de API, arquivos do Next, e os arquivos soltos do `public/`.
   * Sem esta exclusão o proxy rodaria até para CSS e imagem — e aí um erro
   * aqui não deixaria a página nem carregar o estilo para mostrar o erro.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|robots.txt|sitemap.xml).*)',
  ],
};
