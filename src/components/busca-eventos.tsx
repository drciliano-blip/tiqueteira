'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/**
 * Busca de eventos.
 *
 * Envia por formulário de verdade, com `action` — assim funciona sem
 * JavaScript e o resultado tem URL própria, que dá para compartilhar e o
 * navegador consegue voltar.
 *
 * A digitação atualiza a URL depois de uma pausa. Sem a pausa, cada tecla
 * viraria uma consulta ao banco.
 *
 * Só navega depois de a pessoa DIGITAR, e só se o termo mudou de fato. O
 * cabeçalho aparece também na página do evento: antes, uma remontagem do
 * componente (troca de tamanho de tela, modo estrito do React) disparava a
 * navegação para a home no meio da compra — o comprador clicava em
 * "Comprar" e caía na página inicial em vez do pagamento.
 */
export function BuscaEventos({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [termo, setTermo] = useState(params.get('q') ?? '');
  const [, iniciar] = useTransition();
  const digitou = useRef(false);

  useEffect(() => {
    if (!digitou.current) return;
    if (termo.trim() === (params.get('q') ?? '').trim()) return;

    const id = setTimeout(() => {
      const busca = new URLSearchParams(Array.from(params.entries()));
      if (termo.trim()) busca.set('q', termo.trim());
      else busca.delete('q');
      iniciar(() => router.replace(busca.size ? `/?${busca}` : '/', { scroll: false }));
    }, 350);

    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo]);

  return (
    <form action="/" role="search" className="relative w-full">
      <label htmlFor="busca" className="sr-only">
        Buscar eventos
      </label>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-faint stroke-2"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="M14 14l4 4" strokeLinecap="round" />
      </svg>
      <input
        id="busca"
        name="q"
        type="search"
        value={termo}
        onChange={(e) => {
          digitou.current = true;
          setTermo(e.target.value);
        }}
        autoFocus={autoFocus}
        placeholder="Buscar por evento, casa ou cidade"
        className="w-full rounded-botao border border-line bg-raised py-2.5 pl-9 pr-3 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
      />
    </form>
  );
}
