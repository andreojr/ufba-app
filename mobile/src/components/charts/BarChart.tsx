import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { ScrollView, Text, View } from "react-native";
import { GestureDetector, type NativeGesture } from "react-native-gesture-handler";

export interface Barra {
  rotulo: string;
  valor: number;
}

interface BarChartProps {
  barras: Barra[];
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
const ESPACO_POR_BARRA = 56;
const LARGURA_MINIMA_BARRA = 4;
// Reserved above the plot, outside `altura`, purely for the floating value
// label — same fix the line chart needed: sharing this space with the bars
// themselves (a fixed MARGEM_Y taken out of a short chart) left too little
// height for the bars to show real contrast between close values.
const ESPACO_LABEL = 44;
// Faded via opacity, not a separate color, so it always tracks whatever
// `accent` resolves to for the current theme — this used to be a hardcoded
// violet left over from Gradline's old purple brand, which read wrong once
// `accent` became UFBA's institutional blue (see global.css).
const OPACIDADE_VALOR = 0.75;

/**
 * The carga-horária-per-período bar chart. Bars scale to the tallest one in
 * the series across the FULL `altura` — the value label floats in its own
 * reserved band above the plot instead of eating into that height. Scrolls
 * horizontally once there are more terms than fit the screen, rather than
 * squeezing them together.
 */
export function BarChart({ barras, altura = ALTURA_PADRAO, scrollGesture }: BarChartProps): JSX.Element {
  const accent = useThemeColor("accent");

  if (barras.length === 0) {
    return <View testID="bar-chart-vazio" />;
  }

  const largura = Math.max(LARGURA_MINIMA, barras.length * ESPACO_POR_BARRA);
  const larguraColuna = largura / barras.length;
  const maiorValor = Math.max(...barras.map((b) => b.valor), LARGURA_MINIMA_BARRA);
  const alturasBarras = barras.map((barra) =>
    Math.max((barra.valor / maiorValor) * altura, LARGURA_MINIMA_BARRA),
  );

  const conteudo = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="bar-chart-scroll">
      <View testID="bar-chart" style={{ width: largura }}>
        <View style={{ width: largura, height: altura + ESPACO_LABEL }}>
          <View
            className="flex-row items-end"
            style={{
              position: "absolute",
              top: ESPACO_LABEL,
              left: 0,
              width: largura,
              height: altura,
            }}
          >
            {barras.map((barra, indice) => (
              <View key={indice} className="items-center" style={{ width: larguraColuna }}>
                <View
                  className="rounded-t-md w-2/3"
                  style={{ height: alturasBarras[indice], backgroundColor: accent }}
                />
              </View>
            ))}
          </View>
          {/* Floating above its own bar rather than sharing the bar's own
              height budget — same fix as the line chart's point labels. */}
          {barras.map((barra, indice) => (
            <Text
              key={indice}
              style={{
                position: "absolute",
                left: indice * larguraColuna,
                top: ESPACO_LABEL + (altura - alturasBarras[indice]) - 30,
                width: larguraColuna,
                textAlign: "center",
                fontSize: 10,
                fontFamily: "SourceCodePro_400Regular",
                fontWeight: "600",
                color: accent,
                opacity: OPACIDADE_VALOR,
                transform: [{ rotate: "-90deg" }],
              }}
            >
              {barra.valor} h
            </Text>
          ))}
        </View>
        <View className="flex-row border-t border-white/10 pt-1.5">
          {barras.map((barra, indice) => (
            <View key={indice} className="items-center" style={{ width: larguraColuna }}>
              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                {barra.rotulo}
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
