import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { descreverCupom } from '@/domain/cupom';
import { cuponsDoTenant } from '@/lib/cupons';
import { dataCurta, hora } from '@/lib/datas';
import { tenantAtual } from '@/lib/painel-contexto';
import { BotaoCupom, FormularioCupom } from './formulario';

export const metadata: Metadata = { title: 'Cupons' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ eventId: string }> };

export default async function Cupons({ params }: Props) {
  const { eventId } = await params;
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const [evento] = await serviceDb()
    .select({ id: events.id, tenantId: events.tenantId, titulo: events.titulo })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento || evento.tenantId !== ctx.tenant.id) notFound();

  const cupons = await cuponsDoTenant(ctx.tenant.id, eventId);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href={`/painel/eventos/${eventId}`} className="text-sm text-muted hover:text-txt">
        ← {evento.titulo}
      </Link>

      <h1 className="mt-3 font-titulo text-xl font-bold">Cupons</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        O desconto reduz o preço do ingresso, e a taxa de serviço acompanha o preço que o
        comprador realmente pagou — cobrar taxa sobre um valor que ele não pagou é o tipo de
        coisa que o Procon autua.
      </p>

      {cupons.length > 0 && (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-cartao border border-line">
          {cupons.map((c) => {
            const esgotado = c.usosMaximos !== null && c.usosAtuais >= c.usosMaximos;
            const vencido = c.validoAte !== null && c.validoAte <= new Date();

            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    <code className="tabular">{c.codigo}</code>
                    <span className="ml-2 font-normal text-muted">{descreverCupom(c)}</span>
                  </p>
                  <p className="text-xs text-faint">
                    {c.eventId ? 'só neste evento' : 'todos os eventos da casa'}
                    {' · '}
                    {c.usosAtuais}
                    {c.usosMaximos !== null ? ` de ${c.usosMaximos}` : ''} usado
                    {c.usosAtuais === 1 ? '' : 's'}
                    {c.validoAte ? ` · até ${dataCurta(c.validoAte)}, ${hora(c.validoAte)}` : ''}
                    {!c.ativo ? ' · desativado' : esgotado ? ' · esgotado' : vencido ? ' · vencido' : ''}
                  </p>
                </div>

                <BotaoCupom eventId={eventId} cupomId={c.id} ativo={c.ativo} />
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-10">
        <h2 className="font-titulo text-lg font-bold">Novo cupom</h2>
        <p className="mt-1.5 text-sm text-muted">
          Deixe o limite de usos em branco para cupom sem teto. Quem abandona o carrinho devolve
          o uso quando a reserva expira — senão o cupom se esgotaria sozinho.
        </p>
        <div className="mt-4">
          <FormularioCupom eventId={eventId} />
        </div>
      </section>
    </main>
  );
}
