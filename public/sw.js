/**
 * Service worker da portaria.
 *
 * Guarda o "esqueleto" da aplicação — HTML, JavaScript e CSS — para que a
 * tela abra mesmo sem rede. Os DADOS não passam por aqui: o manifesto de
 * ingressos vive no localStorage, e servir resposta de API guardada em cache
 * seria pior que não abrir, porque mostraria um ingresso já usado como válido.
 *
 * Estratégia: rede primeiro, cache como rede reserva. Assim o aparelho sempre
 * pega a versão nova quando há sinal, e continua funcionando quando não há.
 */
const CACHE = 'tiqueteira-v1';

self.addEventListener('install', (evento) => {
  // Ativa a versão nova sem esperar o fechamento das abas: portaria não fecha
  // o navegador no meio do evento.
  self.skipWaiting();
  evento.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;

  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;

  // Nada de API em cache: dado de ingresso desatualizado é pior que erro.
  if (url.pathname.startsWith('/api/')) return;

  evento.respondWith(
    (async () => {
      try {
        const resposta = await fetch(requisicao);
        if (resposta.ok) {
          const cache = await caches.open(CACHE);
          cache.put(requisicao, resposta.clone());
        }
        return resposta;
      } catch {
        const guardada = await caches.match(requisicao);
        if (guardada) return guardada;
        throw new Error('sem rede e sem cópia guardada');
      }
    })(),
  );
});
