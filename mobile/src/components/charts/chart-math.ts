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
 * higher on screen (y = 0 at the top). `margem` insets both ends by that many
 * pixels — generous on purpose, since the floating value label sits just
 * above each point and needs room that isn't there at margem 0, which would
 * clip the highest point's label against the chart's own edge. A zero-width
 * domain centers every value rather than dividing by zero.
 */
export function escalaLinear(
  dominio: Dominio,
  altura: number,
  margem: number,
): (valor: number) => number {
  const alturaUtil = altura - margem * 2;
  const largura = dominio.max - dominio.min;
  if (largura === 0) {
    return () => altura / 2;
  }
  return (valor) => margem + alturaUtil - ((valor - dominio.min) / largura) * alturaUtil;
}

/**
 * Evenly spaced x positions for `quantidade` points across `largura`, inset by
 * `margem` pixels on each end — a light touch, just enough that the first and
 * last point don't sit flush against the chart's edge.
 */
export function posicoesX(quantidade: number, largura: number, margem: number): number[] {
  if (quantidade === 0) {
    return [];
  }
  if (quantidade === 1) {
    return [largura / 2];
  }
  const larguraUtil = largura - margem * 2;
  return Array.from({ length: quantidade }, (_, i) => margem + (i / (quantidade - 1)) * larguraUtil);
}
