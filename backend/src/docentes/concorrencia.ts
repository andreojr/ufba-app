/**
 * Promise.all with a ceiling. The docente profile GETs are stateless and would
 * happily all fire at once, but nobody has measured SIGAA's rate limit on these
 * public endpoints, so the ceiling is the cheap insurance.
 */
export async function mapComLimite<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;

  async function worker(): Promise<void> {
    while (proximo < itens.length) {
      const indice = proximo;
      proximo += 1;
      resultados[indice] = await fn(itens[indice]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, () => worker()),
  );
  return resultados;
}
