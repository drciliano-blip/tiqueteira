import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { mascararCpf } from '@/domain/cpf';
import { dataLonga, hora } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';
import { tenantAtual } from '@/lib/painel-contexto';
import { detalharVenda } from '@/lib/vendas-queries';
import { ROTULO_SOLICITACAO, solicitacaoAbertaDoPedido } from '@/lib/solicitacoes';
import { ReembolsoPorProblema } from './problema';
import { ResponderSemDevolucao } from './solicitacao';
import { FormularioReembolso } from './reembolsar';
import { BotaoReenviar } from './reenviar';

export const metadata: Metadata = { title: 'Pedido' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ orderId: string }> };

const SITUACAO_INGRESSO: Record<string, string> = {
  valido: 'Válido',
  usado: 'Entrou',
  cancelado: 'Cancelado',
  transferido: 'Transferido',
};

export default async function DetalheDoPedido({ params }: Props) {
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();

  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const pedido = await detalharVenda(ctx.tenant.id, orderId);
  if (!pedido) notFound();

  const podeDecidir = ctx.papel === 'owner' || ctx.papel === 'admin';
  const solicitacao = await solicitacaoAbertaDoPedido(ctx.tenant.id, orderId);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href="/painel/vendas" className="text-sm text-muted transition hover:text-txt">
        ← Vendas
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="tabular font-titulo text-xl font-bold">Pedido #{pedido.numero}</h1>
          <p className="mt-1 text-sm text-muted">{pedido.eventoTitulo}</p>
        </div>

        {pedido.status === 'paid' && pedido.compradorEmail && (
          <BotaoReenviar
            tenantId={ctx.tenant.id}
            orderId={pedido.id}
            email={pedido.compradorEmail}
          />
        )}
      </div>

      {solicitacao && (
        <section className="mt-6 rounded-cartao border border-alerta/50 bg-alerta/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-alerta">
            O comprador pediu ajuda
          </p>
          <p className="mt-1 font-medium">{ROTULO_SOLICITACAO[solicitacao.tipo]}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{solicitacao.relato}</p>
          {podeDecidir ? (
            <div className="mt-4 space-y-2 text-sm">
              <p className="text-muted">
                Para devolver, use <strong>Problema no evento</strong>, abaixo — o comprador recebe
                o seu relato como resposta. Ou:
              </p>
              <ResponderSemDevolucao
                tenantId={ctx.tenant.id}
                orderId={pedido.id}
                solicitacaoId={solicitacao.id}
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-faint">Só dono ou administrador pode responder.</p>
          )}
        </section>
      )}

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-cartao border border-line bg-raised p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Comprador</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="sr-only">Nome</dt>
              <dd className="font-medium">{pedido.compradorNome ?? '—'}</dd>
            </div>
            <div>
              <dt className="sr-only">E-mail</dt>
              <dd className="break-all text-muted">{pedido.compradorEmail ?? '—'}</dd>
            </div>
            <div>
              <dt className="sr-only">CPF</dt>
              {/*
                Mascarado: quem atende precisa distinguir homônimos, não do
                documento inteiro na tela. LGPD, princípio da necessidade.
              */}
              <dd className="tabular text-muted">
                {pedido.compradorCpf ? mascararCpf(pedido.compradorCpf) : '—'}
              </dd>
            </div>
            {pedido.compradorTelefone && (
              <div>
                <dt className="sr-only">Telefone</dt>
                <dd className="tabular text-muted">{pedido.compradorTelefone}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="rounded-cartao border border-line bg-raised p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Pagamento</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between text-muted">
              <dt>Subtotal</dt>
              <dd className="tabular">{formatarBRL(pedido.subtotalCentavos)}</dd>
            </div>
            {pedido.convenienciaCentavos > 0 && (
              <div className="flex justify-between text-muted">
                <dt>Conveniência</dt>
                <dd className="tabular">{formatarBRL(pedido.convenienciaCentavos)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{formatarBRL(pedido.totalCentavos)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-muted">
              <dt>Você recebe</dt>
              <dd className="tabular">{formatarBRL(pedido.valorProdutorCentavos)}</dd>
            </div>
            <div className="pt-2 text-xs text-faint">
              {pedido.metodo === 'pix'
                ? 'Pix'
                : pedido.metodo === 'credit_card'
                  ? 'Cartão'
                  : '—'}
              {pedido.canal !== 'online' && ` · ${pedido.canal}`}
              {pedido.pagoEm && ` · pago em ${dataLonga(pedido.pagoEm)}, ${hora(pedido.pagoEm)}`}
            </div>
          </dl>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-titulo text-lg font-bold">Ingressos</h2>

        {pedido.ingressos.length === 0 ? (
          <p className="prosa mt-3 rounded-cartao border border-line bg-raised px-4 py-6 text-sm text-muted">
            Nenhum ingresso emitido. É o esperado enquanto o pagamento não é confirmado — a
            emissão acontece pelo webhook da operadora, nunca pela tela.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-cartao border border-line">
            {pedido.ingressos.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.titular}</p>
                  <p className="tabular text-xs text-faint">{i.codigo}</p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p
                    className={
                      i.status === 'usado'
                        ? 'text-sucesso'
                        : i.status === 'valido'
                          ? 'text-muted'
                          : 'text-faint'
                    }
                  >
                    {SITUACAO_INGRESSO[i.status] ?? i.status}
                  </p>
                  {i.checkedInEm && (
                    <p className="tabular text-xs text-faint">{hora(i.checkedInEm)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(pedido.status === 'paid' || pedido.status === 'partially_refunded') && (
        <section className="mt-10">
          <h2 className="font-titulo text-lg font-bold">Reembolso</h2>
          <p className="prosa mt-2 text-sm text-muted">
            Dentro dos 7 dias da compra a devolução é integral, taxa incluída. Fora do prazo,
            vale a política do evento — e só dono ou administrador pode autorizar a exceção.
          </p>
          <div className="mt-4">
            <FormularioReembolso
              tenantId={ctx.tenant.id}
              orderId={pedido.id}
              ingressosValidos={pedido.ingressos.filter((i) => i.status === 'valido').length}
              totalCentavos={pedido.totalCentavos}
              podeManual={ctx.papel === 'owner' || ctx.papel === 'admin'}
            />
          </div>
        </section>
      )}

      {(pedido.status === 'paid' || pedido.status === 'partially_refunded') &&
        (ctx.papel === 'owner' || ctx.papel === 'admin') && (
          <section className="mt-10">
            <h2 className="font-titulo text-lg font-bold">Problema no evento</h2>
            <p className="prosa mt-2 text-sm text-muted">
              Quando o serviço vendido não foi entregue como prometido — evento que não aconteceu,
              comprador barrado, atração anunciada que não veio —, o Código de Defesa do
              Consumidor protege o comprador independentemente de prazo ou da política do
              evento. Devolva aqui, com o relato do que houve.
            </p>
            <div className="mt-4">
              <ReembolsoPorProblema
                tenantId={ctx.tenant.id}
                orderId={pedido.id}
                ingressos={
                  pedido.ingressos.filter((i) => i.status === 'valido' || i.status === 'usado')
                    .length
                }
                totalCentavos={pedido.totalCentavos}
                {...(solicitacao ? { problemaInicial: solicitacao.tipo } : {})}
              />
            </div>
          </section>
        )}

      <section className="mt-8">
        <h2 className="font-titulo text-lg font-bold">Itens</h2>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-cartao border border-line">
          {pedido.itens.map((item, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                <span className="tabular font-semibold">{item.quantidade}×</span> {item.loteNome}
              </span>
              <span className="tabular">
                {formatarBRL(item.precoCentavos * item.quantidade)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
