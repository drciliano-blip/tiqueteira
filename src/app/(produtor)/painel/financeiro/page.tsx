import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { dataCurta } from '@/lib/datas';
import { financeiroDoProdutor, type TrancheNaTela } from '@/lib/financeiro-queries';
import { formatarBRL } from '@/lib/money';
import { tenantAtual } from '@/lib/painel-contexto';

export const metadata: Metadata = { title: 'Financeiro' };
export const dynamic = 'force-dynamic';

const METODO: Record<string, string> = { pix: 'Pix', credit_card: 'Cartão' };

const SITUACAO: Record<string, { texto: string; cor: string }> = {
  previsto: { texto: 'Previsto', cor: 'text-faint' },
  scheduled: { texto: 'Agendado', cor: 'text-muted' },
  processing: { texto: 'Liberando', cor: 'text-alerta' },
  released: { texto: 'Liberado', cor: 'text-sucesso' },
  failed: { texto: 'Com falha', cor: 'text-perigo' },
  canceled: { texto: 'Cancelado', cor: 'text-faint' },
};

/**
 * Financeiro do produtor — repasses por evento. ADR-021.
 *
 * Só dono e administrador: é o dinheiro da casa, e operador de portaria não
 * precisa ver quanto o evento faturou.
 */
export default async function Financeiro() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  if (ctx.papel !== 'owner' && ctx.papel !== 'admin') {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-titulo text-lg font-bold">Acesso restrito</h1>
        <p className="prosa mx-auto mt-2 text-sm text-muted">
          Os repasses só são visíveis para o dono e os administradores da conta.
        </p>
      </main>
    );
  }

  const resumo = await financeiroDoProdutor(ctx.tenant.id);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Financeiro</h1>
      <p className="prosa mt-1.5 max-w-2xl text-sm text-muted">
        O dinheiro das vendas online fica guardado na operadora de pagamento e é liberado para a
        sua conta em duas partes: a principal, logo depois do evento, e a reserva de garantia,
        algumas semanas depois — descontados reembolsos e contestações de cartão. Vendas de
        bilheteria não entram aqui: esse dinheiro já está com você.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Cartao rotulo="Já liberado" valor={resumo.liberadoCentavos} cor="text-sucesso" />
        <Cartao rotulo="A liberar" valor={resumo.aLiberarCentavos} cor="text-txt" />
        {resumo.descobertoCentavos < 0 && (
          <Cartao
            rotulo="Saldo a descoberto"
            valor={resumo.descobertoCentavos}
            cor="text-perigo"
            nota="Contestações maiores que o valor retido. Fale com o suporte."
          />
        )}
      </dl>

      {resumo.eventos.length === 0 ? (
        <div className="mt-8 rounded-cartao border border-line bg-raised px-5 py-12 text-center">
          <p className="font-titulo font-semibold">Nenhuma venda online ainda</p>
          <p className="prosa mx-auto mt-2 text-sm text-muted">
            Quando um evento vender pelo site, a previsão de repasse aparece aqui.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {resumo.eventos.map((e) => (
            <section key={e.eventId} className="rounded-cartao border border-line">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate font-titulo font-bold">{e.titulo}</h2>
                  <p className="tabular text-xs text-faint">
                    {e.cancelado
                      ? 'Cancelado'
                      : `${e.terminou ? 'Terminou' : 'Termina'} em ${dataCurta(e.dataFim)}`}
                    {e.previsto && !e.cancelado ? ' · datas e valores previstos' : ''}
                  </p>
                </div>
                <dl className="tabular flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  <Linha rotulo="Vendido" valor={e.totais.brutoCentavos} />
                  <Linha rotulo="Taxas da plataforma" valor={-e.totais.comissaoCentavos} />
                  {e.totais.reembolsosCentavos > 0 && (
                    <Linha rotulo="Reembolsos" valor={-e.totais.reembolsosCentavos} />
                  )}
                  {e.totais.chargebacksCentavos > 0 && (
                    <Linha rotulo="Contestações" valor={-e.totais.chargebacksCentavos} />
                  )}
                  <Linha rotulo="Seu líquido" valor={e.totais.liquidoCentavos} forte />
                </dl>
              </header>

              {e.cancelado ? (
                <p className="px-4 py-4 text-sm text-muted">
                  Evento cancelado: o valor das vendas volta para os compradores e não há
                  repasse.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-faint">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Parte</th>
                        <th className="px-4 py-2 font-semibold">Data</th>
                        <th className="px-4 py-2 text-right font-semibold">Valor</th>
                        <th className="px-4 py-2 font-semibold">Situação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {e.tranches.map((t) => (
                        <LinhaTranche key={`${t.tranche}-${t.metodo}`} t={t} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <p className="prosa mt-8 max-w-2xl text-xs text-faint">
        Valores marcados como estimativa são recalculados na data do repasse, com os reembolsos e
        as contestações que tiverem chegado até lá. Datas consideram dias úteis; a operadora de
        pagamento pode levar um dia útil a mais para o dinheiro aparecer no seu extrato.
      </p>
    </main>
  );
}

function LinhaTranche({ t }: { t: TrancheNaTela }) {
  const s = SITUACAO[t.status] ?? { texto: t.status, cor: 'text-muted' };
  const definitivo = t.liberadoCentavos !== null;
  const valor = definitivo ? t.liberadoCentavos! : t.estimadoCentavos;

  return (
    <tr>
      <td className="px-4 py-3">
        {t.tranche === 'principal' ? 'Principal' : 'Reserva de garantia'}
        <span className="text-faint"> · {METODO[t.metodo] ?? t.metodo}</span>
      </td>
      <td className="tabular px-4 py-3 text-muted">
        {dataCurta(t.dataEfetiva ?? t.dataPrevista)}
      </td>
      <td className={`tabular px-4 py-3 text-right ${valor < 0 ? 'text-perigo' : ''}`}>
        {formatarBRL(valor)}
        {!definitivo && <span className="block text-xs text-faint">estimativa</span>}
      </td>
      <td className={`px-4 py-3 ${s.cor}`}>
        {s.texto}
        {t.status === 'failed' && t.ultimoErro && (
          <span className="block text-xs text-faint">{t.ultimoErro}</span>
        )}
      </td>
    </tr>
  );
}

function Cartao({
  rotulo,
  valor,
  cor,
  nota,
}: {
  rotulo: string;
  valor: number;
  cor: string;
  nota?: string;
}) {
  return (
    <div className="rounded-cartao border border-line bg-raised px-4 py-4">
      <dt className="text-xs uppercase tracking-wide text-faint">{rotulo}</dt>
      <dd className={`tabular mt-1 font-titulo text-2xl font-bold ${cor}`}>{formatarBRL(valor)}</dd>
      {nota && <p className="mt-1 text-xs text-faint">{nota}</p>}
    </div>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: number; forte?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-faint">{rotulo}</dt>
      <dd className={forte ? 'font-semibold' : 'text-muted'}>{formatarBRL(valor)}</dd>
    </div>
  );
}
