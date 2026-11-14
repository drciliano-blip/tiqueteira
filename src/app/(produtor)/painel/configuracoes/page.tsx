import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { formatarCnpj } from '@/domain/cpf';
import { formatarBRL } from '@/lib/money';
import { tenantAtual } from '@/lib/painel-contexto';
import { FormularioConfiguracoes } from './formulario';

export const metadata: Metadata = { title: 'Configurações' };
export const dynamic = 'force-dynamic';

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export default async function Configuracoes() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const [t] = await serviceDb().select().from(tenants).where(eq(tenants.id, ctx.tenant.id)).limit(1);
  if (!t) notFound();

  const podeEditar = ctx.papel === 'owner' || ctx.papel === 'admin';

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Configurações</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        Como a sua casa aparece para o público e como a plataforma fala com você.
      </p>

      <div className="mt-6">
        <FormularioConfiguracoes
          tenantId={t.id}
          podeEditar={podeEditar}
          inicial={{
            nome: t.nome,
            razaoSocial: t.razaoSocial ?? '',
            cnpj: t.cnpj ? formatarCnpj(t.cnpj) : '',
            email: t.email,
            telefone: t.telefone ?? '',
            corAcento: t.corAcento,
            logoUrl: t.logoUrl ?? '',
            pixelMetaId: t.pixelMetaId ?? '',
            googleAnalyticsId: t.googleAnalyticsId ?? '',
          }}
        />
      </div>

      <section className="mt-10 rounded-cartao border border-line p-4">
        <h2 className="font-titulo font-bold">Condições comerciais</h2>
        <p className="prosa mt-1 text-sm text-muted">
          Definidas no contrato com a plataforma. Para mudar, fale com o suporte — toda alteração
          fica registrada.
        </p>
        <dl className="tabular mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Item rotulo="Taxa de conveniência" valor={pct(t.taxaConvenienciaBps)} />
          <Item rotulo="Taxa mínima por ingresso" valor={formatarBRL(t.taxaMinimaCentavos)} />
          <Item rotulo="Comissão" valor={pct(t.comissaoBps)} />
          <Item rotulo="Taxa fixa por ingresso" valor={formatarBRL(t.taxaFixaCentavos)} />
          <Item
            rotulo="Quem paga a conveniência"
            valor={t.taxaAbsorvidaPeloProdutor ? 'Você (preço sem taxa)' : 'O comprador'}
          />
          <Item rotulo="Reserva no cartão" valor={pct(t.reservaCartaoBps)} />
          <Item rotulo="Reserva no Pix" valor={pct(t.reservaPixBps)} />
          <Item
            rotulo="Repasse principal"
            valor={`${t.diasLiberacaoEvento} dias úteis após o evento`}
          />
          <Item rotulo="Reserva liberada" valor={`${t.diasLiberacaoReserva} dias após o evento`} />
        </dl>
      </section>

      <p className="mt-6 text-sm text-muted">
        Dados bancários e situação do cadastro na operadora:{' '}
        <Link href="/painel/recebimento" className="text-accent">
          Recebimento
        </Link>
        . Endereço próprio para a vitrine:{' '}
        <Link href="/painel/dominio" className="text-accent">
          Domínio
        </Link>
        .
      </p>
    </main>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="text-right">{valor}</dd>
    </div>
  );
}
