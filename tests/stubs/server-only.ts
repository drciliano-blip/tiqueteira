/**
 * Substituto de `server-only` nos testes.
 *
 * O pacote real lança erro quando importado fora do servidor React, e os
 * testes rodam em Node puro. O import continua nos módulos de produção, que é
 * onde ele protege de verdade: impedir que código de servidor vá parar no
 * pacote enviado ao navegador.
 */
export {};
