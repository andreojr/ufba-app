import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

import { formatarCoeficiente } from "@/lib/trajetoria";

import { dominioComMargem, escalaLinear, posicoesX } from "./chart-math";

export interface PontoLinha {
  rotulo: string;
  /** Null when the term has nothing graded yet — the point is skipped, not drawn at zero. */
  valor: number | null;
}

interface LineChartProps {
  pontos: PontoLinha[];
  altura?: number;
  largura?: number;
}

const ALTURA_PADRAO = 120;
const LARGURA_PADRAO = 280;
// A CR series moves in hundredths — padding by a fraction of a near-zero
// range would barely widen it, so the line would still look flat.
const MARGEM_DOMINIO = 0.2;

/**
 * The CR-per-período line chart. The y-axis is scaled to the series' own
 * min/max (see chart-math's `dominioComMargem`), not a fixed 0–10 range: the
 * CR moves in small steps, and a scale built for grades would flatten that
 * movement into a near-straight line.
 */
export function LineChart({
  pontos,
  altura = ALTURA_PADRAO,
  largura = LARGURA_PADRAO,
}: LineChartProps): JSX.Element {
  const accent = useThemeColor("accent");

  if (pontos.length === 0) {
    return <View testID="line-chart-vazio" />;
  }

  const valoresGraficaveis = pontos
    .map((p) => p.valor)
    .filter((v): v is number => v !== null);
  const escalaY = escalaLinear(dominioComMargem(valoresGraficaveis, MARGEM_DOMINIO), altura);
  const xs = posicoesX(pontos.length, largura);

  const coordenadas = pontos
    .map((ponto, indice) => (ponto.valor === null ? null : { x: xs[indice], y: escalaY(ponto.valor) }))
    .filter((c): c is { x: number; y: number } => c !== null);

  return (
    <View testID="line-chart" style={{ width: largura }}>
      <Svg width={largura} height={altura}>
        {coordenadas.length > 1 ? (
          <Polyline
            points={coordenadas.map((c) => `${c.x},${c.y}`).join(" ")}
            fill="none"
            stroke={accent}
            strokeWidth={2}
          />
        ) : null}
        {coordenadas.map((coordenada, indice) => (
          <Circle key={indice} cx={coordenada.x} cy={coordenada.y} r={3.5} fill={accent} />
        ))}
      </Svg>
      <View className="flex-row justify-between mt-1.5">
        {pontos.map((ponto, indice) => (
          <View key={indice} className="items-center" style={{ width: largura / pontos.length }}>
            <Typography.Paragraph type="body-xs" weight="medium">
              {ponto.valor === null ? "—" : formatarCoeficiente(ponto.valor)}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" color="muted">
              {ponto.rotulo}
            </Typography.Paragraph>
          </View>
        ))}
      </View>
    </View>
  );
}
