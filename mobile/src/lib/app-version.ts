/**
 * Version comparison for the update check. Kept pure and I/O-free so the whole
 * "is there an update?" decision is testable in isolation — the UI only ever
 * consumes the boolean.
 */

const SEMVER = /^\d+(\.\d+){0,2}$/;

function segmentos(versao: string): number[] | null {
  const limpa = versao.trim();
  if (!SEMVER.test(limpa)) {
    return null;
  }
  const partes = limpa.split(".").map((parte) => Number.parseInt(parte, 10));
  // Pad so "1.2" and "1.2.0" compare equal.
  while (partes.length < 3) {
    partes.push(0);
  }
  return partes;
}

/** -1 / 0 / 1, like a sort comparator. Unparseable versions compare as equal. */
export function compararVersoes(a: string, b: string): number {
  const esquerda = segmentos(a);
  const direita = segmentos(b);
  if (!esquerda || !direita) {
    return 0;
  }
  for (let i = 0; i < 3; i += 1) {
    if (esquerda[i] !== direita[i]) {
      return esquerda[i] < direita[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Only strictly-ahead counts. An installed build *newer* than what is published
 * (a local build, or a rolled-back release) is not an update — and neither is
 * anything we cannot parse, which keeps a malformed environment variable from
 * nagging every user in the field.
 */
export function haAtualizacao(instalada: string, publicada: string): boolean {
  if (!segmentos(instalada) || !segmentos(publicada)) {
    return false;
  }
  return compararVersoes(instalada, publicada) < 0;
}
