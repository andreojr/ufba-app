import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { ScrollView, Text, View } from "react-native";
import { GestureDetector, type NativeGesture } from "react-native-gesture-handler";
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
  /**
   * Lets a page-level swipe gesture (e.g. the trajectory's tab switcher) defer
   * to this chart's own horizontal scroll instead of racing it — see
   * `requireExternalGestureToFail` on the gesture that owns this. Omitted in
   * this component's own tests, where no such outer gesture exists.
   */
  scrollGesture?: NativeGesture;
}

const ALTURA_PADRAO = 120;
const LARGURA_MINIMA = 280;
// Wide enough that a point's floating label doesn't crowd its neighbour.
const ESPACO_POR_PONTO = 56;
// The label tilts -45° up and to the right of its own point (see COR_VALOR's
// Text below), so the two ends need different room: the left edge only has
// to clear a point sitting flush against it, while the right edge also has
// to clear that same point's own label, which reaches further right than the
// point itself.
const MARGEM_ESQUERDA = 8;
const MARGEM_DIREITA = 40;
// Only what a dot needs to clear the plot's own top/bottom edge — this
// margin comes straight out of `altura`, and the label has its own dedicated
// headroom (ESPACO_LABEL) above the plot now, so it no longer has to compete
// with the line for vertical room the way it used to.
const MARGEM_Y = 6;
// Reserved above the plot, outside `altura`, purely for the floating label.
// Without this, lifting the label enough to clear its own point pushed it
// past the plot's own top edge — which clips, not just overflows, so the
// label's top sheared clean off instead of merely looking cramped.
const ESPACO_LABEL = 26;
// As tight as the domain math allows without pinning the line to the very
// edges: the CR series already moves in small steps, and any padding beyond
// this buries that movement in dead space instead of letting it fill the
// chart — the opposite of the contrast auto-scaling this domain is meant to
// expose.
const MARGEM_DOMINIO = 0.02;
// Faded via opacity, not a separate color, so it always tracks whatever
// `accent` resolves to for the current theme — this used to be a hardcoded
// violet left over from Gradline's old purple brand, which read wrong once
// `accent` became UFBA's institutional blue (see global.css).
const OPACIDADE_VALOR = 0.75;

/**
 * The CR-per-período line chart. The y-axis is scaled to the series' own
 * min/max (see chart-math's `dominioComMargem`), not a fixed 0–10 range: the
 * CR moves in small steps, and a scale built for grades would flatten that
 * movement into a near-straight line. Scrolls horizontally once there are
 * more terms than fit the screen, rather than squeezing them together.
 */
export function LineChart({ pontos, altura = ALTURA_PADRAO, scrollGesture }: LineChartProps): JSX.Element {
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
  const xs = posicoesX(pontos.length, largura, MARGEM_ESQUERDA, MARGEM_DIREITA);

  const coordenadas = pontos
    .map((ponto, indice) =>
      ponto.valor === null ? null : { x: xs[indice], y: escalaY(ponto.valor), valor: ponto.valor },
    )
    .filter((c): c is { x: number; y: number; valor: number } => c !== null);

  const conteudo = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="line-chart-scroll">
      <View testID="line-chart" style={{ width: largura }}>
        <View style={{ width: largura, height: altura + ESPACO_LABEL }}>
          <View style={{ position: "absolute", top: ESPACO_LABEL, left: 0 }}>
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
          </View>
          {/* Floating rather than a value row under the chart: a small, tilted
              label sitting right over its own point reads as an annotation of
              that point, without a second row of numbers competing with the
              rótulo row below for the reader's attention. Positioned up and to
              the right of the point — along the same diagonal the tilt
              implies — so its tail clears the line instead of running back
              through it. */}
          {coordenadas.map((coordenada, indice) => (
            <Text
              key={indice}
              style={{
                position: "absolute",
                left: coordenada.x + 4,
                top: ESPACO_LABEL + coordenada.y - 22,
                fontSize: 10,
                fontFamily: "SourceCodePro_400Regular",
                fontWeight: "600",
                color: accent,
                opacity: OPACIDADE_VALOR,
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
              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                {ponto.rotulo}
              </Typography.Paragraph>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );

  // Wrapped only when a page-level swipe is in the picture — this component's
  // own tests render it bare, with no such gesture to defer to.
  return scrollGesture ? (
    <GestureDetector gesture={scrollGesture}>{conteudo}</GestureDetector>
  ) : (
    conteudo
  );
}
