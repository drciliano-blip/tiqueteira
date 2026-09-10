'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { MenuMobile } from '@/components/menu-mobile';

/**
 * As ações de conta do cabeçalho, resolvidas no navegador — ADR-015.
 *
 * Parece detalhe e é decisão de capacidade. Ler o cookie de sessão no
 * servidor torna a rota inteira dinâmica, e o Next passa a ignorar
 * `revalidate` em silêncio: a página do evento ia ao banco em toda visita, e
 * o teste de carga cobrou a conta com 500 acessos simultâneos.
 *
 * Com o login resolvido aqui, a página do evento vira HTML igual para todo
 * mundo — cacheável na borda, capacidade praticamente ilimitada para quem só
 * está olhando. O preço é este botão aparecer uma fração de segundo depois do
 * resto, como acontece na Sympla. É troca de estética por capacidade, e numa
 * abertura de festival não há dúvida sobre qual das duas importa.
 *
 * O espaço é reservado antes da resposta chegar: botão que empurra o layout
 * ao aparecer faz a pessoa clicar no lugar errado.
 */

type Conta = { temPainel: boolean } | null;

export function AcoesDaConta() {
  const [conta, setConta] = useState<Conta>(null);

  useEffect(() => {
    let ativo = true;

    void (async () => {
      try {
        const r = await fetch('/api/sessao', { cache: 'no-store' });
        if (!r.ok) return;

        const dados = (await r.json()) as { temPainel: boolean };
        if (ativo) setConta(dados);
      } catch {
        // Sem resposta, o cabeçalho fica no estado de visitante. É o certo:
        // "Entrar" leva quem já tem conta para o lugar certo de qualquer jeito.
      }
    })();

    return () => {
      ativo = false;
    };
  }, []);

  const temPainel = conta?.temPainel ?? false;

  return (
    <>
      <nav aria-label="Principal" className="ml-auto hidden items-center gap-1 md:flex">
        <Link
          href="/como-funciona"
          className="rounded-botao px-3 py-2 text-sm text-muted transition hover:bg-raised hover:text-txt"
        >
          Como funciona
        </Link>
        <Link
          href="/meus-ingressos"
          className="rounded-botao px-3 py-2 text-sm text-muted transition hover:bg-raised hover:text-txt"
        >
          Meus ingressos
        </Link>

        <span aria-hidden className="mx-1 h-5 w-px bg-line" />

        {/* Altura fixa: o que chega depois não pode empurrar o resto. */}
        <div className="flex h-9 items-center gap-1">
          {conta === null ? (
            <span aria-hidden className="h-9 w-32 rounded-botao bg-raised/60" />
          ) : temPainel ? (
            <Link
              href="/painel"
              className="rounded-botao bg-accent px-4 py-2 text-sm font-semibold text-accent-txt"
            >
              Painel do produtor
            </Link>
          ) : (
            <>
              <Link
                href="/entrar"
                className="rounded-botao px-3 py-2 text-sm text-muted transition hover:bg-raised hover:text-txt"
              >
                Entrar
              </Link>
              <Link
                href="/publique"
                className="rounded-botao bg-accent px-4 py-2 text-sm font-semibold text-accent-txt"
              >
                Criar evento
              </Link>
            </>
          )}
        </div>
      </nav>

      <div className="ml-auto md:hidden">
        <MenuMobile temPainel={temPainel} />
      </div>
    </>
  );
}
