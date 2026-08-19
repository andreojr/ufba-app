export interface Dominio {
  min: number;
  max: number;
}

/**
 * The series' own min/max, padded by `margem` (a fraction of the range) on
 * each side. Used instead of a fixed 0–10 scale: the CR barely moves between
 * terms, and a scale sized for grades would flatten that movement into a
 * near-straight line.
 */
export function dominioComMargem(valores: number[], margem: number): Dominio {
  if (valores.length === 0) {
    return { min: -0.5, max: 0.5 };
  }
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  // Every value identical (or a single value) — pad by a fixed amount rather
  // than a fraction of a zero-width range, which would pad by nothing.
  const folga = max > min ? (max - min) * margem : 0.5;
  return { min: min - folga, max: max + folga };
}

/**
 * Linear map from a value domain to an SVG y-axis, where higher values sit
 * higher on screen (y = 0 at the top). A zero-width domain centers every
 * value rather than dividing by zero.
 */
export function escalaLinear(dominio: Dominio, altura: number): (valor: number) => number {
  const largura = dominio.max - dominio.min;
  if (largura === 0) {
    return () => altura / 2;
  }
  return (valor) => altura - ((valor - dominio.min) / largura) * altura;
}

/** Evenly spaced x positions for `quantidade` points across `largura`, edge to edge. */
export function posicoesX(quantidade: number, largura: number): number[] {
  if (quantidade === 0) {
    return [];
  }
  if (quantidade === 1) {
    return [largura / 2];
  }
  return Array.from({ length: quantidade }, (_, i) => (i / (quantidade - 1)) * largura);
}
