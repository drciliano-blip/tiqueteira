/**
 * Produtor ativo do painel.
 *
 * Um usuário pode servir vários produtores (a tabela `memberships` prevê
 * isso desde o começo). Por ora o painel usa o primeiro vínculo; quando
 * houver usuário com mais de um, entra um seletor no cabeçalho e este é o
 * único lugar que muda.
 */
import 'server-only';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { tenants } from '@/db/schema';
import type { AuthContext, Role } from '@/lib/auth';
import { getAuth } from '@/lib/session-cookie';

export type ContextoPainel = {
  auth: AuthContext;
  papel: Role;
  tenant: {
    id: string;
    nome: string;
    slug: string;
    kycStatus: string;
    corAcento: string;
  };
};

export async function tenantAtual(): Promise<ContextoPainel | null> {
  const auth = await getAuth();
  if (!auth) redirect('/entrar');

  const vinculo = auth.papeis[0];
  if (!vinculo) return null;

  const [tenant] = await serviceDb()
    .select({
      id: tenants.id,
      nome: tenants.nome,
      slug: tenants.slug,
      kycStatus: tenants.kycStatus,
      corAcento: tenants.corAcento,
    })
    .from(tenants)
    .where(eq(tenants.id, vinculo.tenantId))
    .limit(1);

  if (!tenant) return null;
  return { auth, papel: vinculo.role, tenant };
}
