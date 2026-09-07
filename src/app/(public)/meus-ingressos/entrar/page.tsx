import { redirect } from 'next/navigation';

import { entrarComLink } from '../acoes';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ t?: string }> };

/**
 * Destino do link mágico. Consome o token e devolve para a área de ingressos.
 * Não renderiza nada: é uma passagem.
 */
export default async function EntrarComLink({ searchParams }: Props) {
  const { t } = await searchParams;
  if (!t) redirect('/meus-ingressos?erro=invalido');

  await entrarComLink(t);
}
