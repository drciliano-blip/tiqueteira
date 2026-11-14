import Link from 'next/link';

import { visaoGeral } from '@/lib/admin';
import { formatarBRL } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function AdminInicio() {
  const v = await visaoGeral();
  const alertas = [
    v.repasses_falha > 0 && { texto: `${v.repasses_falha} repasses com falha`, href: '/admin/repasses' },
    v.descobertos > 0 && { texto: `${v.descobertos} repasses a descoberto`, href: '/admin/repasses' },
    v.solicitacoes_atrasadas > 0 && {
      texto: `${v.solicitacoes_atrasadas} solicitações de compradores sem resposta há mais de 48 h`,
      href: '/admin/pedidos',
    },
    v.jobs_falha > 0 && { texto: `${v.jobs_falha} tarefas com falha na fila`, href: '/admin/operacao' },
    v.webhooks_erro > 0 && { texto: `${v.webhooks_erro} webhooks com erro em 7 dias`, href: '/admin/operacao' },
    v.aguardando_kyc > 0 && { texto: `${v.aguardando_kyc} produtores sem recebimento aprovado`, href: '/admin/produtores' },
  ].filter(Boolean) as { texto: string; href: string }[];

  return (
    <>
      <h1 className="font-titulo text-xl font-bold">Visão geral da plataforma</h1>

      {alertas.length > 0 ? (
        <ul className="mt-5 space-y-2">
          {alertas.map((a) => (
            <li key={a.texto}>
              <Link
                href={a.href}
                className="block rounded-botao border border-alerta/40 bg-alerta/10 px-4 py-2.5 text-sm text-alerta"
              >
                {a.texto} →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 rounded-botao border border-sucesso/30 bg-sucesso/10 px-4 py-2.5 text-sm text-sucesso">
          Nada pedindo atenção agora.
        </p>
      )}

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero rotulo="Produtores" valor={String(v.produtores)} nota={`${v.aprovados} com recebimento aprovado`} />
        <Numero rotulo="Pedidos pagos (24 h)" valor={String(v.pedidos_24h)} />
        <Numero rotulo="Vendido online (30 dias)" valor={formatarBRL(v.gmv_30d ?? 0)} />
        <Numero
          rotulo="Receita da plataforma (30 dias)"
          valor={formatarBRL(v.receita_30d ?? 0)}
          nota="conveniência, comissão e taxa fixa"
        />
      </dl>
    </>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-cartao border border-line bg-raised px-4 py-4">
      <dt className="text-xs uppercase tracking-wide text-faint">{rotulo}</dt>
      <dd className="tabular mt-1 font-titulo text-2xl font-bold">{valor}</dd>
      {nota && <p className="mt-1 text-xs text-faint">{nota}</p>}
    </div>
  );
}
