/**
 * Pure accumulation math for the árvore de dependências screen's pan/zoom
 * gestures — split out of the component so it's unit-testable without a
 * native gesture recognizer (react-native-gesture-handler's Pinch/Pan
 * `onUpdate` deltas reset to 1/0 at the start of every new gesture; these
 * helpers combine that per-gesture delta with the offset saved at the
 * previous gesture's end, so consecutive pinch/pan sequences compose
 * instead of snapping back).
 */

export function aplicarPinch(
  escalaSalva: number,
  deltaEscala: number,
  min: number,
  max: number
): number {
  return Math.min(max, Math.max(min, escalaSalva * deltaEscala));
}

export function aplicarPan(
  translacaoSalva: number,
  deltaTranslacao: number
): number {
  return translacaoSalva + deltaTranslacao;
}
