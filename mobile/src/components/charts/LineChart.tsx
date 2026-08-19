import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { ScrollView, Text, View } from "react-native";
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
}

const ALTURA_PADRAO = 120;
const LARGURA_MINIMA = 280;
// Wide enough that a point's floating label doesn't crowd its neighbour.
const ESPACO_POR_PONTO = 56;
// Light on x: points shouldn't sit flush against the chart's edge, but
// nothing more is needed there. Generous on y: the CR's own value floats
// diagonally just above each point (see COR_VALOR below), and margem 0 would
// clip that label — right at the highest point, exactly where its value most
// matters — against the chart's own top edge.
const MARGEM_X = 16;
const MARGEM_Y = 28;
// A CR series moves in hundredths — padding by a fraction of a near-zero
// range would barely widen it, so the line would still look flat.
const MARGEM_DOMINIO = 0.2;
// Purple, low-opacity: a value label that reads as an annotation floating
// over the point, not another line of body text competing with it.
const COR_VALOR = "rgba(124, 58, 237, 0.55)";

/**
 * The CR-per-período line chart. The y-axis is scaled to the series' own
 * min/max (see chart-math's `dominioComMargem`), not a fixed 0–10 range: the
 * CR moves in small steps, and a scale built for grades would flatten that
 * movement into a near-straight line. Scrolls horizontally once there are
 * more terms than fit the screen, rather than squeezing them together.
 */
export function LineChart({ pontos, altura = ALTURA_PADRAO }: LineChartProps): JSX.Element {
  const accent = useThemeColor("accent");

  if (pontos.length === 0) {
    return <View testID="line-chart-vazio" />;
  }

  const largura = Math.max(LARGURA_MINIMA, pontos.length * ESPACO_POR_PONTO);
  const valoresGraficaveis = pontos.map((p) => p.valor).filter((v): v is number => v !== null);
  const escalaY = escalaLinear(
    dominioComMargem(valoresGraficaveis, MARGEM_DOMINIO),
    altura,
    MARGEM_Y,
  );
  const xs = posicoesX(pontos.length, largura, MARGEM_X);

  const coordenadas = pontos
    .map((ponto, indice) =>
      ponto.valor === null ? null : { x: xs[indice], y: escalaY(ponto.valor), valor: ponto.valor },
    )
    .filter((c): c is { x: number; y: number; valor: number } => c !== null);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="line-chart-scroll">
      <View testID="line-chart" style={{ width: largura }}>
        <View style={{ width: largura, height: altura }}>
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
          {/* Floating rather than a value row under the chart: a small, tilted
              label sitting right over its own point reads as an annotation of
              that point, without a second row of numbers competing with the
              rótulo row below for the reader's attention. */}
          {coordenadas.map((coordenada, indice) => (
            <Text
              key={indice}
              style={{
                position: "absolute",
                left: coordenada.x - 12,
                top: coordenada.y - 24,
                fontSize: 10,
                fontWeight: "600",
                color: COR_VALOR,
                transform: [{ rotate: "-45deg" }],
              }}
            >
              {formatarCoeficiente(coordenada.valor)}
            </Text>
          ))}
        </View>
        <View
          className="flex-row border-t border-white/10 mt-1.5 pt-1.5"
          style={{ width: largura }}
        >
          {pontos.map((ponto, indice) => (
            <View key={indice} className="items-center" style={{ width: largura / pontos.length }}>
              <Typography.Paragraph type="body-xs" color="muted">
                {ponto.rotulo}
              </Typography.Paragraph>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
