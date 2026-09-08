'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Menu do celular.
 *
 * Painel deslizante em vez de lista que empurra a página: a compra acontece
 * quase sempre no celular, e conteúdo que salta ao abrir o menu faz o usuário
 * perder o lugar onde estava.
 */
export function MenuMobile({ temPainel }: { temPainel: boolean }) {
  const [aberto, setAberto] = useState(false);

  // Trava a rolagem do fundo enquanto o painel está aberto.
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  // Escape fecha — teclado e leitor de tela contam com isso.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto]);

  const itens = temPainel
    ? [
        { href: '/painel', rotulo: 'Painel do produtor', destaque: true },
        { href: '/meus-ingressos', rotulo: 'Meus ingressos' },
        { href: '/como-funciona', rotulo: 'Como funciona' },
      ]
    : [
        { href: '/publique', rotulo: 'Criar evento', destaque: true },
        { href: '/meus-ingressos', rotulo: 'Meus ingressos' },
        { href: '/como-funciona', rotulo: 'Como funciona' },
        { href: '/entrar', rotulo: 'Entrar' },
      ];

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir menu"
        aria-expanded={aberto}
        className="grid h-10 w-10 place-items-center rounded-botao border border-line-forte"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 stroke-current stroke-2">
          <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
        </svg>
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setAberto(false)}
            className="absolute inset-0 bg-base/80 backdrop-blur-sm"
          />

          <div className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-l border-line bg-raised p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Menu</span>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar menu"
                className="grid h-9 w-9 place-items-center rounded-botao border border-line"
              >
                <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 stroke-current stroke-2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <nav className="mt-5 flex flex-col gap-1">
              {itens.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setAberto(false)}
                  className={
                    item.destaque
                      ? 'rounded-botao bg-accent px-4 py-3 text-center font-semibold text-accent-txt'
                      : 'rounded-botao px-4 py-3 text-muted transition hover:bg-base hover:text-txt'
                  }
                >
                  {item.rotulo}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
