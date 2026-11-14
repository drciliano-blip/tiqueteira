import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { tenantAtual } from '@/lib/painel-contexto';
import { FormularioRecebimento } from './formulario';

export const metadata: Metadata = { title: 'Recebimento' };
export const dynamic = 'force-dynamic';

const SITUACAO: Record<string, { titulo: string; texto: string; cor: string }> = {
  pendente: {
    titulo: 'Cadastro não enviado',
    texto: 'Sem os dados de recebimento, a sua vitrine não vende online.',
    cor: 'border-alerta/40 bg-alerta/10 text-alerta',
  },
  em_analise: {
    titulo: 'Em análise na operadora',
    texto: 'Costuma levar de um a três dias úteis. Avisamos quando sair.',
    cor: 'border-line bg-raised text-muted',
  },
  aprovado: {
    titulo: 'Aprovado',
    texto: 'Você já pode vender online. Os repasses caem na conta abaixo.',
    cor: 'border-sucesso/40 bg-sucesso/10 text-sucesso',
  },
  reprovado: {
    titulo: 'Reprovado pela operadora',
    texto: 'Confira se a conta está no nome do documento informado e envie de novo.',
    cor: 'border-perigo/40 bg-perigo/10 text-perigo',
  },
  suspenso: {
    titulo: 'Suspenso',
    texto: 'A operadora suspendeu o recebimento. Fale com o suporte.',
    cor: 'border-perigo/40 bg-perigo/10 text-perigo',
  },
};

/** Onboarding de recebedor — plano, seção 13; ADR-024. */
export default async function Recebimento() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const [t] = await serviceDb()
    .select({
      kyc: tenants.kycStatus,
      recebedor: tenants.providerRecipientId,
      razaoSocial: tenants.razaoSocial,
      cnpj: tenants.cnpj,
      email: tenants.email,
      telefone: tenants.telefone,
      nome: tenants.nome,
    })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenant.id))
    .limit(1);
  if (!t) notFound();

  const s = SITUACAO[t.kyc] ?? SITUACAO.pendente!;
  const dono = ctx.papel === 'owner';

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Recebimento</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        A conta onde o dinheiro das vendas online cai. O cadastro é feito direto na operadora de
        pagamento: a plataforma não guarda os seus dados bancários e nunca recebe o seu dinheiro.
      </p>

      <div className={`mt-6 rounded-cartao border px-4 py-3 ${s.cor}`}>
        <p className="font-semibold">{s.titulo}</p>
        <p className="mt-0.5 text-sm">{s.texto}</p>
      </div>

      <section className="mt-8">
        <h2 className="font-titulo font-bold">
          {t.recebedor ? 'Trocar a conta bancária' : 'Dados de recebimento'}
        </h2>
        {dono ? (
          <div className="mt-4">
            <FormularioRecebimento
              tenantId={ctx.tenant.id}
              jaCadastrado={Boolean(t.recebedor)}
              inicial={{
                legalName: t.razaoSocial ?? '',
                document: t.cnpj ?? '',
                email: t.email,
                phone: t.telefone ?? '',
                tradeName: t.nome,
              }}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Só o dono da conta cadastra ou troca a conta bancária.</p>
        )}
      </section>
    </main>
  );
}
