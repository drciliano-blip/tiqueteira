'use client';

import { useEffect } from 'react';

/**
 * Registra o service worker.
 *
 * Só na portaria: é a única tela que precisa funcionar sem rede, e service
 * worker em página de compra costuma servir versão velha do checkout — o tipo
 * de problema que ninguém consegue reproduzir.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  return null;
}
