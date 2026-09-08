'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * Busca e filtros das vendas.
 *
 * A URL guarda o estado: o produtor consegue mandar o link de um resultado
 * para quem está na porta, e o botão de voltar do navegador funciona.
 */
export function FiltrosVendas({
  eventos,
}: {
  eventos: { id: string; titulo: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [termo, setTermo] = useState(params.get('q') ?? '');
  const [, iniciar] = useTransition();

  useEffect(() => {
    const atual = params.get('q') ?? '';
    if (termo === atual) return;

    const id = setTimeout(() => {
      const busca = new URLSearchParams(Array.from(params.entries()));
      if (termo.trim()) busca.set('q', termo.trim());
      else busca.delete('q');
      busca.delete('pagina');
      iniciar(() => router.replace(`/painel/vendas?${busca}`, { scroll: false }));
    }, 350);

    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo]);

  function trocar(chave: string, valor: string) {
    const busca = new URLSearchParams(Array.from(params.entries()));
    if (valor) busca.set(chave, valor);
    else busca.delete(chave);
    busca.delete('pagina');
    router.replace(`/painel/vendas?${busca}`, { scroll: false });
  }

  const campo =
    'rounded-botao border border-line bg-raised px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

  return (
    <div className="flex flex-wrap gap-3">
      <input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Nome, CPF, e-mail, código do ingresso ou nº do pedido"
        aria-label="Buscar pedidos"
        className={`${campo} min-w-0 flex-1`}
      />

      <select
        value={params.get('evento') ?? ''}
        onChange={(e) => trocar('evento', e.target.value)}
        aria-label="Filtrar por evento"
        className={campo}
      >
        <option value="">Todos os eventos</option>
        {eventos.map((e) => (
          <option key={e.id} value={e.id}>
            {e.titulo}
          </option>
        ))}
      </select>

      <select
        value={params.get('status') ?? ''}
        onChange={(e) => trocar('status', e.target.value)}
        aria-label="Filtrar por situação"
        className={campo}
      >
        <option value="">Todos</option>
        <option value="pagos">Pagos</option>
        <option value="pendentes">Aguardando</option>
        <option value="problemas">Reembolso e chargeback</option>
      </select>
    </div>
  );
}
