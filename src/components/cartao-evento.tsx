import Link from 'next/link';

import { Cartaz } from '@/components/cartaz';
import { dataCurta, hora } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';
import type { EventoResumo } from '@/lib/public-queries';

/**
 * Cartão da vitrine: cartaz, título, data, local e preço mínimo.
 * Grade de dois por linha no celular — benchmark, seção 5.1.
 */
export function CartaoEvento({
  evento,
  tenantSlug,
  prioridade = false,
}: {
  evento: EventoResumo;
  tenantSlug: string;
  prioridade?: boolean;
}) {
  const esgotado = evento.status === 'esgotado' || evento.precoMinimoCentavos === null;

  return (
    <Link
      href={`/${tenantSlug}/e/${evento.slug}`}
      className="group block"
      aria-label={`${evento.titulo}, ${dataCurta(evento.dataInicio)}`}
    >
      <div className="relative overflow-hidden rounded-cartao">
        <div className="transition duration-300 group-hover:scale-[1.03]">
          <Cartaz
            eventoId={evento.id}
            titulo={evento.titulo}
            imagemUrl={evento.imagemUrl}
            prioridade={prioridade}
          />
        </div>

        {esgotado && (
          <div className="absolute inset-0 grid place-items-center bg-base/70">
            <span className="rounded-full border border-line-forte bg-base/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">
              Esgotado
            </span>
          </div>
        )}
      </div>

      <div className="mt-3">
        <h3 className="line-clamp-2 text-base font-semibold leading-snug transition group-hover:text-accent">
          {evento.titulo}
        </h3>
        <p className="tabular mt-1 text-sm text-muted">
          {dataCurta(evento.dataInicio)} · {hora(evento.dataInicio)}
        </p>
        <p className="mt-0.5 truncate text-sm text-faint">
          {evento.venueNome}
          {evento.cidade ? ` · ${evento.cidade}` : ''}
        </p>

        {!esgotado && (
          <p className="tabular mt-2 text-sm">
            <span className="text-faint">a partir de </span>
            <span className="font-semibold">{formatarBRL(evento.precoMinimoCentavos!)}</span>
          </p>
        )}
      </div>
    </Link>
  );
}
