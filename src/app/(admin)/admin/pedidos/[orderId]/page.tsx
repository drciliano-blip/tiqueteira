import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { mascararCpf } from '@/domain/cpf';
import { pedidoAdmin } from '@/lib/admin';
import { dataCurta } from '@/lib/datas';
import { formatarBRL } from '@/lib/money';
import { reembolsoAdmin } from '../../acoes';
import { CAMPO_ADMIN, FormAcao, Motivo } from '../../form-acao';

export const metadata: Metadata = { title: 'Pedido' };
export const dynamic = 'force-dynamic';

export default async function PedidoAdmin({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();
  const r = await pedidoAdmin(orderId);
  if (!r) notFound();
  const o = r.pedido;
  const validos = r.ingressos.filter((i) => i.status === 'valido').length;
  const ativo = o.status === 'paid' || o.status === 'partially_refunded';

  return (
    <>
      <Link href="/admin/pedidos" className="text-sm text-muted">
        ← Pedidos
      </Link>
      <h1 className="tabular mt-3 font-titulo text-xl font-bold">Pedido #{Number(o.numero)}</h1>
      <p className="text-sm text-muted">
        {o.produtor as string} · {o.evento as string} · {dataCurta(new Date(o.evento_inicio as string))}
      </p>

      <dl className="tabular mt-6 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Item rotulo="Situação" valor={`${o.status as string} · ${o.canal as string}`} />
        <Item rotulo="Comprador" valor={`${(o.comprador_nome as string) ?? '—'} · ${(o.comprador_email as string) ?? ''}`} />
        <Item rotulo="CPF" valor={o.comprador_cpf ? mascararCpf(o.comprador_cpf as string) : '—'} />
        <Item rotulo="Total" valor={formatarBRL(Number(o.total_centavos))} />
        <Item rotulo="Produtor recebe" valor={formatarBRL(Number(o.valor_produtor_centavos))} />
        <Item rotulo="Plataforma" valor={formatarBRL(Number(o.valor_operador_centavos))} />
        <Item rotulo="Transação na PSP" valor={(o.provider_transaction_id as string) ?? '—'} />
      </dl>

      <Bloco titulo="Ingressos">
        {r.ingressos.map((i) => (
          <li key={i.codigo as string}>
            {i.codigo as string} · {i.titular_nome as string} · <span className="text-muted">{i.status as string}</span>
          </li>
        ))}
      </Bloco>
      {r.devolucoes.length > 0 && (
        <Bloco titulo="Devoluções">
          {r.devolucoes.map((d, n) => (
            <li key={n}>
              {formatarBRL(Number(d.valor_centavos))} · {d.tipo as string} · {d.status as string}
              <span className="block text-xs text-faint">{d.observacao as string}</span>
            </li>
          ))}
        </Bloco>
      )}
      {r.solicitacoes.length > 0 && (
        <Bloco titulo="Solicitações do comprador">
          {r.solicitacoes.map((s, n) => (
            <li key={n}>
              {s.tipo as string} · <span className="text-muted">{s.status as string}</span>
              <span className="block text-xs text-faint">{s.relato as string}</span>
              {s.resposta ? <span className="block text-xs">Resposta: {s.resposta as string}</span> : null}
            </li>
          ))}
        </Bloco>
      )}

      {ativo && validos > 0 && (
        <section className="mt-8 max-w-md rounded-cartao border border-line p-4">
          <h2 className="font-titulo font-bold">Reembolso pelo suporte</h2>
          <p className="mt-1 text-xs text-faint">
            Ignora prazos e política do evento. Para falha do evento, prefira que o produtor use
            “Problema no evento” no painel dele.
          </p>
          <div className="mt-3">
            <FormAcao acao={reembolsoAdmin.bind(null, orderId, o.tenant_id as string)} botao="Reembolsar" perigo>
              <select name="quantidade" defaultValue={validos} className={CAMPO_ADMIN}>
                {Array.from({ length: validos }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'ingresso' : 'ingressos'}
                  </option>
                ))}
              </select>
              <Motivo />
            </FormAcao>
          </div>
        </section>
      )}
    </>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="truncate text-right">{valor}</dd>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">{titulo}</h2>
      <ul className="mt-2 space-y-1.5 text-sm">{children}</ul>
    </section>
  );
}
