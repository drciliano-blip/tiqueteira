import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { temPapel } from '@/lib/auth';
import { dominioDoTenant } from '@/lib/dominios';
import { tenantAtual } from '@/lib/painel-contexto';
import { getAuth } from '@/lib/session-cookie';
import { PainelDominio } from './painel-dominio';

export const metadata: Metadata = { title: 'Domínio próprio' };
export const dynamic = 'force-dynamic';

export default async function Dominio() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const auth = await getAuth();
  const podeMexer = auth ? temPapel(auth, ctx.tenant.id, 'owner') : false;

  const estado = await dominioDoTenant(ctx.tenant.id);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Domínio próprio</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        Sua vitrine no seu endereço. O comprador vê o seu domínio da primeira página até o
        ingresso — a plataforma não aparece na barra de endereço.
      </p>

      {!podeMexer && (
        <p className="mt-6 rounded-cartao border border-line bg-raised px-4 py-3 text-sm text-muted">
          Só o dono da conta pode mexer no domínio. Ele redireciona todo o público da vitrine.
        </p>
      )}

      <div className="mt-6">
        <PainelDominio
          tenantId={ctx.tenant.id}
          tenantSlug={ctx.tenant.slug}
          estado={estado}
          podeMexer={podeMexer}
        />
      </div>

      <section className="mt-12">
        <h2 className="font-titulo text-lg font-bold">Como funciona</h2>
        <ol className="prosa mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Você cadastra o domínio aqui. Recomendamos um <strong>subdomínio</strong>, como{' '}
            <code>ingressos.suacasa.com.br</code> — não a raiz.
          </li>
          <li>
            Cria o registro de DNS que aparece abaixo, no painel de quem hospeda seu domínio.
          </li>
          <li>
            Clica em conferir. Enquanto o DNS propaga, a resposta é &ldquo;ainda não&rdquo; — leva
            de minutos a algumas horas, e isso é normal.
          </li>
          <li>Verificado, a vitrine passa a responder no seu endereço.</li>
        </ol>

        <p className="prosa mt-4 text-sm text-muted">
          <strong>Por que subdomínio e não a raiz:</strong> o e-mail dos ingressos precisa de
          reputação própria. Problema de entrega de e-mail não pode contaminar o domínio
          institucional da casa. E, tecnicamente, o DNS não permite CNAME na raiz de um
          domínio — nem todo provedor oferece a alternativa.
        </p>
      </section>
    </main>
  );
}
