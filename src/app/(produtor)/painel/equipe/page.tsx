import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { temPapel } from '@/lib/auth';
import { equipeDoTenant, eventosParaEscopo } from '@/lib/equipe';
import { tenantAtual } from '@/lib/painel-contexto';
import { getAuth } from '@/lib/session-cookie';
import { FormularioConvite, LinhaDaEquipe } from './formulario';

export const metadata: Metadata = { title: 'Equipe' };
export const dynamic = 'force-dynamic';

const ROTULO: Record<string, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  operador: 'Operador',
  portaria: 'Portaria',
};

export default async function Equipe() {
  const ctx = await tenantAtual();
  if (!ctx) notFound();

  const auth = await getAuth();
  const podeMexer = auth ? temPapel(auth, ctx.tenant.id, 'admin') : false;

  const [pessoas, eventos] = await Promise.all([
    equipeDoTenant(ctx.tenant.id),
    eventosParaEscopo(ctx.tenant.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="font-titulo text-xl font-bold">Equipe</h1>
      <p className="prosa mt-1.5 text-sm text-muted">
        Quem entra no painel e quem opera a porta. O acesso de portaria pode ficar preso a um
        evento — o celular da porta fica na mão de terceiro, na rua, e costuma ser emprestado
        entre turnos.
      </p>

      {!podeMexer && (
        <p className="mt-6 rounded-cartao border border-line bg-raised px-4 py-3 text-sm text-muted">
          Você pode ver a equipe, mas só administrador ou dono pode mexer.
        </p>
      )}

      <ul className="mt-6 divide-y divide-line overflow-hidden rounded-cartao border border-line">
        {pessoas.map((p) => (
          <LinhaDaEquipe
            key={p.membershipId}
            tenantId={ctx.tenant.id}
            pessoa={{
              membershipId: p.membershipId,
              nome: p.nome,
              email: p.email,
              papel: ROTULO[p.role] ?? p.role,
              evento: p.eventoTitulo,
              sessoesAtivas: p.sessoesAtivas,
              inativo: p.status !== 'ativo',
              /** O dono não se remove por acidente. */
              protegido: p.role === 'owner',
            }}
            podeMexer={podeMexer}
          />
        ))}

        {pessoas.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted">
            Ninguém na equipe ainda.
          </li>
        )}
      </ul>

      {podeMexer && (
        <section className="mt-10">
          <h2 className="font-titulo text-lg font-bold">Adicionar alguém</h2>
          <p className="mt-1.5 text-sm text-muted">
            Se a pessoa já tem conta na plataforma, o acesso é liberado com a senha dela. Se não
            tem, a conta é criada e a senha aparece <strong>uma vez só</strong> — anote e passe
            para ela.
          </p>
          <div className="mt-4">
            <FormularioConvite tenantId={ctx.tenant.id} eventos={eventos} />
          </div>
        </section>
      )}
    </main>
  );
}
