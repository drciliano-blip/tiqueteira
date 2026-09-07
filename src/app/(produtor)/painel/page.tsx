import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Marca } from '@/components/marca';
import { serviceDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { eventosDoTenant, resumoDoTenant } from '@/lib/painel-queries';
import { dataCurta } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';
import { getAuth } from '@/lib/session-cookie';
import { sair } from '@/app/(public)/entrar/acoes';
import { eq } from 'drizzle-orm';

export const metadata: Metadata = {
  title: 'Painel',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const ROTULO_STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  publicado: 'À venda',
  esgotado: 'Esgotado',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
  adiado: 'Adiado',
};

export default async function Painel() {
  const auth = await getAuth();
  if (!auth) redirect('/entrar');

  // Sem vínculo com produtor nenhum, não há painel a mostrar.
  const primeiro = auth.papeis[0];
  if (!primeiro) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-titulo text-lg font-bold">Sua conta ainda não tem acesso</h1>
        <p className="prosa mx-auto mt-2 text-sm text-muted">
          Peça a quem administra a plataforma para vincular seu usuário a um produtor.
        </p>
        <form action={sair} className="mt-6">
          <button className="text-sm text-accent">Sair</button>
        </form>
      </main>
    );
  }

  const [tenant] = await serviceDb()
    .select({ id: tenants.id, nome: tenants.nome, slug: tenants.slug, kyc: tenants.kycStatus })
    .from(tenants)
    .where(eq(tenants.id, primeiro.tenantId))
    .limit(1);

  if (!tenant) redirect('/entrar');

  const [resumo, eventos] = await Promise.all([
    resumoDoTenant(tenant.id),
    eventosDoTenant(tenant.id),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Marca />
          <span className="text-sm text-faint">/</span>
          <span className="truncate text-sm font-medium">{tenant.nome}</span>

          <div className="ml-auto flex items-center gap-3">
            <Link
              href={`/${tenant.slug}`}
              className="text-sm text-muted transition hover:text-txt"
            >
              Ver vitrine
            </Link>
            <form action={sair}>
              <button className="text-sm text-muted transition hover:text-txt">Sair</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-titulo text-xl font-bold">Visão geral</h1>
          <p className="text-sm text-muted">
            Olá, {auth.nome.split(' ')[0]} · <span className="text-faint">{primeiro.role}</span>
          </p>
        </div>

        {tenant.kyc !== 'aprovado' && (
          <p className="mt-4 rounded-botao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
            Cadastro em análise. Você já pode montar eventos, mas o repasse só é liberado depois
            da aprovação.
          </p>
        )}

        <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Indicador
            rotulo="Ingressos vendidos"
            valor={String(resumo.ingressosVendidos)}
            detalhe={`${resumo.ingressosUsados} já entraram`}
          />
          <Indicador
            rotulo="Faturamento bruto"
            valor={formatarBRL(resumo.brutoCentavos)}
            detalhe={`${resumo.pedidosAguardando} pedidos aguardando pagamento`}
          />
          <Indicador
            rotulo="Líquido a receber"
            valor={formatarBRL(resumo.liquidoCentavos)}
            detalhe="já descontadas taxa e comissão"
          />
          <Indicador
            rotulo="Próximo repasse"
            valor={
              resumo.proximoRepasse
                ? formatarBRL(resumo.proximoRepasse.liberadoCentavos)
                : '—'
            }
            detalhe={
              resumo.proximoRepasse
                ? `previsto para ${dataCurta(resumo.proximoRepasse.dataPrevista)}`
                : 'nenhum repasse agendado'
            }
          />
        </dl>

        <section className="mt-12">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-titulo text-lg font-bold">Eventos</h2>
            <span className="rounded-botao border border-dashed border-line-forte px-3 py-1.5 text-xs text-faint">
              Criar evento — em construção
            </span>
          </div>

          {eventos.length === 0 ? (
            <div className="mt-4 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
              <p className="font-titulo font-semibold">Nenhum evento por aqui ainda</p>
              <p className="mt-2 text-sm text-muted">
                Quando o cadastro de eventos estiver pronto, o primeiro nasce aqui.
              </p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-cartao border border-line">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="bg-raised text-left text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Evento</th>
                    <th className="px-4 py-3 font-semibold">Data</th>
                    <th className="px-4 py-3 font-semibold">Situação</th>
                    <th className="px-4 py-3 text-right font-semibold">Vendidos</th>
                    <th className="px-4 py-3 text-right font-semibold">Bruto</th>
                    <th className="px-4 py-3 font-semibold"><span className="sr-only">Portaria</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {eventos.map((e) => {
                    const ocupacao = e.capacidade > 0 ? e.vendidos / e.capacidade : 0;
                    return (
                      <tr key={e.id} className="transition hover:bg-raised">
                        <td className="px-4 py-3">
                          <Link
                            href={`/${tenant.slug}/e/${e.slug}`}
                            className="font-medium transition hover:text-accent"
                          >
                            {e.titulo}
                          </Link>
                          <p className="text-xs text-faint">{e.venueNome}</p>
                        </td>
                        <td className="tabular px-4 py-3 text-muted">
                          {dataCurta(e.dataInicio)}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {ROTULO_STATUS[e.status] ?? e.status}
                        </td>
                        <td className="tabular px-4 py-3 text-right">
                          {e.vendidos}
                          <span className="text-faint"> / {e.capacidade}</span>
                          <div
                            aria-hidden
                            className="mt-1 h-1 w-full overflow-hidden rounded-full bg-line"
                          >
                            <div
                              className="h-full bg-accent"
                              style={{ width: `${Math.min(100, ocupacao * 100)}%` }}
                            />
                          </div>
                        </td>
                        <td className="tabular px-4 py-3 text-right font-medium">
                          {formatarBRL(e.brutoCentavos)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/portaria/${e.id}`}
                            className="whitespace-nowrap rounded-botao border border-line-forte px-3 py-1.5 text-xs font-medium transition hover:border-accent hover:text-accent"
                          >
                            Portaria
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
}) {
  return (
    <div className="rounded-cartao border border-line bg-raised px-4 py-4">
      <dt className="text-xs uppercase tracking-wide text-faint">{rotulo}</dt>
      <dd className="tabular mt-1.5 font-titulo text-xl font-bold">{valor}</dd>
      <dd className="mt-1 text-xs text-faint">{detalhe}</dd>
    </div>
  );
}
