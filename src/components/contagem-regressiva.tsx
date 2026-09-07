'use client';

import { useEffect, useState } from 'react';

/**
 * Contagem regressiva da reserva.
 *
 * Recebe a data como string ISO e não como `Date`: o servidor e o cliente
 * renderizam o primeiro quadro, e comparar objetos `Date` entre os dois gera
 * divergência de hidratação. Além disso, o primeiro render precisa ser
 * determinístico — por isso o valor só começa a contar depois da montagem.
 */
export function ContagemRegressiva({ ate }: { ate: string }) {
  const alvo = new Date(ate).getTime();
  const [restante, setRestante] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRestante(Math.max(0, alvo - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [alvo]);

  if (restante === null) return <span className="tabular text-sm text-muted">—</span>;

  const totalSeg = Math.floor(restante / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  const urgente = totalSeg <= 60;

  return (
    <span
      role="timer"
      aria-live={urgente ? 'polite' : 'off'}
      className={`tabular text-sm font-semibold ${urgente ? 'text-alerta' : 'text-muted'}`}
    >
      {totalSeg === 0
        ? 'Reserva expirada'
        : `${min}:${String(seg).padStart(2, '0')} para concluir`}
    </span>
  );
}
