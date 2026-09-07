import Link from 'next/link';

import { dataCurta, hora, selo } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';
import type { EventoResumo } from '@/lib/public-queries';

export function CartaoEvento({ evento, tenantSlug }: { evento: EventoResumo; tenantSlug: string }) {
  const { dia, mes } = selo(evento.dataInicio);
  const esgotado = evento.status === 'esgotado' || evento.precoMinimoCentavos === null;

  return (
    <Link
      href={`/${tenantSlug}/e/${evento.slug}`}
      className="group flex gap-4 rounded-cartao border border-borda bg-fundo-elevado p-4 transition hover:border-borda-forte hover:bg-fundo-cartao sm:gap-5 sm:p-5"
    >
      <div
        aria-hidden
        className="tabular flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-borda bg-fundo text-center"
      >
        <span className="text-xl font-semibold leading-none">{dia}</span>
        <span className="mt-1 text-[11px] font-medium tracking-wide text-texto-fraco">{mes}</span>
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold tracking-tight group-hover:text-destaque-forte">
          {evento.titulo}
        </h3>

        <p className="mt-1 truncate text-sm text-texto-suave">
          {dataCurta(evento.dataInicio)} · {hora(evento.dataInicio)}
        </p>

        <p className="mt-0.5 truncate text-sm text-texto-fraco">
          {evento.venueNome}
          {evento.cidade ? ` · ${evento.cidade}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center text-right">
        {esgotado ? (
          <span className="rounded-full border border-borda px-2.5 py-1 text-xs font-medium text-texto-fraco">
            Esgotado
          </span>
        ) : (
          <>
            <span className="text-[11px] uppercase tracking-wide text-texto-fraco">a partir de</span>
            <span className="tabular mt-0.5 font-semibold">
              {formatarBRL(evento.precoMinimoCentavos!)}
            </span>
          </>
        )}
      </div>
    </Link>
  );
}
