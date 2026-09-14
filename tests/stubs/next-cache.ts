/**
 * Substituto de `next/cache` nos testes.
 *
 * `unstable_cache` exige o contexto de cache incremental que só existe dentro
 * de uma requisição do Next; em Node puro ele lança
 * `Invariant: incrementalCache missing`. Sem este stub, nenhuma consulta de
 * `src/lib/public-queries.ts` seria testável — e é justamente a camada que
 * resolve produtor por slug e por domínio próprio.
 *
 * O stub **não finge cachear**: devolve a função como ela é. Isso é o certo
 * para teste de integração, onde o que se quer verificar é a consulta ao
 * banco, não a memoização. Um cache real aqui esconderia mudança de dado
 * entre um `it` e o seguinte, e produziria teste que passa por engano.
 *
 * As invalidações viram nada, pelo mesmo motivo: não há nada cacheado para
 * invalidar.
 */

export function unstable_cache<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
): T {
  return fn;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- a assinatura precisa bater com a real. */
export function updateTag(tag: string): void {}
export function revalidateTag(tag: string): void {}
export function revalidatePath(caminho: string, tipo?: string): void {}
export function unstable_noStore(): void {}
