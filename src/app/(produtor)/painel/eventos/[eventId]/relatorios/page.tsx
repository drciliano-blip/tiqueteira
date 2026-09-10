import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { events } from '@/db/schema';
import { dataCurta, hora } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';
import { tenantAtual } from '@/lib/painel-contexto';
import {
  comparecimento,
  comparecimentoPorLote,
  curvaDaNoite,
  curvaDeVendas,
} from '@/lib/relatorios';

export const metadata: Metadata = { title: 'Relatórios' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ eventId: string }> };

/**
 * Barra horizontal em CSS puro, sem biblioteca de gráfico.
 *
 * Um gráfico aqui custaria centenas de kilobytes para desenhar o que uma
 * `div` com largura percentual desenha igual — e esta tela é aberta às quatro
 * da manhã, no celular, na rede da casa.
 */
function Barra({ valor, maximo, cor }: { valor: number; maximo: number; cor: string }) {
  const pct = maximo === 0 ? 0 : Math.round((valor / maximo) * 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default async function Relatorios({ params }: Props) {
  const { eventId } = await params;
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const [evento] = await serviceDb()
    .select({
      id: events.id,
      tenantId: events.tenantId,
      titulo: events.titulo,
      controlaSaida: events.controlaSaida,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!evento || evento.tenantId !== ctx.tenant.id) notFound();

  const [noite, vendas, presenca, porLote] = await Promise.all([
    curvaDaNoite(ctx.tenant.id, eventId),
    curvaDeVendas(ctx.tenant.id, eventId),
    comparecimento(ctx.tenant.id, eventId),
    comparecimentoPorLote(ctx.tenant.id, eventId),
  ]);

  const picoDentro = noite.reduce((m, p) => Math.max(m, p.dentro), 0);
  const picoEntradas = noite.reduce((m, p) => Math.max(m, p.entradas), 0);
  const momentoDoPico = noite.find((p) => p.dentro === picoDentro);
  const maiorVenda = vendas.reduce((m, v) => Math.max(m, v.ingressos), 0);
  const faltaram = presenca.emitidos - presenca.compareceram;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href={`/painel/eventos/${eventId}`} className="text-sm text-muted hover:text-txt">
        ← {evento.titulo}
      </Link>

      <h1 className="mt-3 font-titulo text-xl font-bold">Relatórios</h1>

      {/* --- Comparecimento --- */}
      <section className="mt-6 rounded-cartao border border-line bg-raised p-4">
        <h2 className="text-sm font-medium">Comparecimento</h2>

        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="tabular font-titulo text-2xl font-bold">{presenca.emitidos}</p>
            <p className="text-xs text-faint">emitidos</p>
          </div>
          <div>
            <p className="tabular font-titulo text-2xl font-bold">{presenca.compareceram}</p>
            <p className="text-xs text-faint">apareceram</p>
          </div>
          <div>
            <p className="tabular font-titulo text-2xl font-bold">
              {(presenca.taxaBps / 100).toFixed(0)}%
            </p>
            <p className="text-xs text-faint">de presença</p>
          </div>
          {evento.controlaSaida && (
            <div>
              <p className="tabular font-titulo text-2xl font-bold">{presenca.dentroAgora}</p>
              <p className="text-xs text-faint">na casa agora</p>
            </div>
          )}
        </div>

        {presenca.emitidos > 0 && (
          <p className="prosa mt-4 text-sm text-muted">
            {faltaram === 0
              ? 'Todo mundo que comprou apareceu.'
              : `${faltaram} ${faltaram === 1 ? 'pessoa comprou e não foi' : 'pessoas compraram e não foram'}. ` +
                'É a conta que muda o planejamento do próximo: vender mil para setecentas aparecerem é outro evento.'}
          </p>
        )}

        {presenca.primeiraEntrada && (
          <p className="mt-2 text-xs text-faint">
            Primeira entrada às {hora(presenca.primeiraEntrada)}
            {presenca.ultimaEntrada ? `, última às ${hora(presenca.ultimaEntrada)}` : ''}.
          </p>
        )}
      </section>

      {/* --- A noite --- */}
      <section className="mt-8">
        <h2 className="font-titulo text-lg font-bold">A noite</h2>
        <p className="mt-1.5 text-sm text-muted">
          Faixas de quinze minutos.{' '}
          {momentoDoPico
            ? `O pico foi às ${hora(momentoDoPico.em)}, com ${picoDentro} pessoas na casa.`
            : 'Ninguém entrou ainda.'}
        </p>

        {noite.length > 0 && (
          <ul className="mt-4 space-y-2">
            {noite.map((p) => (
              <li key={p.em.toISOString()} className="flex items-center gap-3">
                <span className="tabular w-12 shrink-0 text-xs text-faint">{hora(p.em)}</span>
                <div className="min-w-0 flex-1">
                  <Barra
                    valor={evento.controlaSaida ? p.dentro : p.entradas}
                    maximo={evento.controlaSaida ? picoDentro : picoEntradas}
                    cor="bg-accent"
                  />
                </div>
                <span className="tabular w-24 shrink-0 text-right text-xs text-faint">
                  {evento.controlaSaida ? `${p.dentro} dentro` : `+${p.entradas}`}
                  {p.saidas > 0 ? ` · −${p.saidas}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Por lote --- */}
      {porLote.length > 0 && (
        <section className="mt-10">
          <h2 className="font-titulo text-lg font-bold">Presença por lote</h2>
          <p className="mt-1.5 text-sm text-muted">
            Camarote costuma faltar mais que pista. Saber quanto muda o quanto se pode vender
            além da lotação sem risco.
          </p>

          <ul className="mt-4 space-y-3">
            {porLote.map((l) => (
              <li key={l.nome}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{l.nome}</span>
                  <span className="tabular shrink-0 text-xs text-faint">
                    {l.compareceram} de {l.emitidos}
                    {l.emitidos > 0 && ` · ${Math.round((l.compareceram / l.emitidos) * 100)}%`}
                  </span>
                </div>
                <div className="mt-1.5">
                  <Barra valor={l.compareceram} maximo={l.emitidos} cor="bg-sucesso" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Vendas --- */}
      <section className="mt-10">
        <h2 className="font-titulo text-lg font-bold">Curva de vendas</h2>
        <p className="mt-1.5 text-sm text-muted">
          Mostra se a divulgação funcionou, e quando parar de gastar com ela.
        </p>

        {vendas.length === 0 ? (
          <p className="mt-4 rounded-cartao border border-line bg-raised px-4 py-6 text-center text-sm text-muted">
            Nenhuma venda paga ainda.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {vendas.map((v) => (
              <li key={v.dia.toISOString()} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-faint">{dataCurta(v.dia)}</span>
                <div className="min-w-0 flex-1">
                  <Barra valor={v.ingressos} maximo={maiorVenda} cor="bg-accent" />
                </div>
                <span className="tabular w-32 shrink-0 text-right text-xs text-faint">
                  {v.ingressos} · {formatarBRL(v.brutoCentavos)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
