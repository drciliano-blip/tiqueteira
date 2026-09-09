/**
 * Etiquetas do cache das páginas públicas.
 *
 * Existe um arquivo só para isto porque a regra de invalidação é fácil de
 * errar e cara quando erra: cache que não invalida mostra evento cancelado
 * como se estivesse à venda.
 *
 * A escolha é grossa de propósito — uma etiqueta por produtor, mais uma para
 * a vitrine. Mexeu em qualquer evento, joga fora o cache daquele produtor
 * inteiro. Rastrear slug por slug seria mais fino e uma fonte permanente de
 * "esqueci de invalidar aquele caso".
 */
import { updateTag } from 'next/cache';

export function etiquetaDeEventos(tenantId: string): string {
  return `eventos:${tenantId}`;
}

export function etiquetaDeTenant(slug: string): string {
  return `tenant:${slug}`;
}

/** A vitrine cruza produtores, então tem etiqueta própria. */
export const ETIQUETA_VITRINE = 'vitrine';

/**
 * Chame depois de QUALQUER alteração que o comprador possa ver: publicar,
 * despublicar, editar, mexer em lote, cancelar evento, renomear espaço.
 *
 * Usa `updateTag` e não `revalidateTag` porque só ele garante que o próprio
 * produtor veja a mudança imediatamente ao ser redirecionado — publicar um
 * evento e cair numa página que ainda diz "rascunho" parece bug, mesmo
 * durando 15 segundos. **Por isso só funciona dentro de Server Action**; em
 * job de fundo, a expiração natural do cache resolve.
 *
 * **Venda não entra nesta lista, de propósito.** Cada compra muda o contador
 * de estoque, e invalidar a cada compra destruiria o cache exatamente no
 * minuto de pico — que é quando ele existe para servir. O contador pode
 * atrasar 15 segundos; quem decide se ainda há ingresso é o `UPDATE` atômico
 * da reserva, que nunca lê cache.
 */
export function invalidarCachePublico(tenantId: string, tenantSlug?: string): void {
  updateTag(etiquetaDeEventos(tenantId));
  updateTag(ETIQUETA_VITRINE);
  if (tenantSlug) updateTag(etiquetaDeTenant(tenantSlug));
}
