import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { ScrollView, Text, View } from "react-native";

export interface Barra {
  rotulo: string;
  valor: number;
}

interface BarChartProps {
  barras: Barra[];
  altura?: number;
}

const ALTURA_PADRAO = 120;
const LARGURA_MINIMA = 280;
const ESPACO_POR_BARRA = 56;
const LARGURA_MINIMA_BARRA = 4;
// Light on x: a little breathing room so the first and last bar don't sit
// flush against the chart's edge. Generous on y: room above the tallest bar
// for its value label, rotated vertical — margem 0 would clip that label
// against the chart's own top edge.
const MARGEM_X = 16;
const MARGEM_Y = 28;
// Purple, low-opacity: a value label that reads as an annotation floating
// over the bar, not another line of body text competing with it.
const COR_VALOR = "rgba(124, 58, 237, 0.55)";

/**
 * The carga-horária-per-período bar chart. Bars scale to the tallest one in
 * the series. Scrolls horizontally once there are more terms than fit the
 * screen, rather than squeezing them together.
 */
export function BarChart({ barras, altura = ALTURA_PADRAO }: BarChartProps): JSX.Element {
  const accent = useThemeColor("accent");

  if (barras.length === 0) {
    return <View testID="bar-chart-vazio" />;
  }

  const largura = Math.max(LARGURA_MINIMA, barras.length * ESPACO_POR_BARRA);
  const larguraColuna = largura / barras.length;
  const maiorValor = Math.max(...barras.map((b) => b.valor), LARGURA_MINIMA_BARRA);
  const alturaUtil = altura - MARGEM_Y;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="bar-chart-scroll">
      <View testID="bar-chart" style={{ width: largura, paddingHorizontal: MARGEM_X }}>
        <View className="flex-row items-end" style={{ height: altura }}>
          {barras.map((barra, indice) => (
            <View key={indice} className="items-center justify-end" style={{ width: larguraColuna }}>
              {/* Vertical rather than horizontal: it already sits over its own
                  bar (unlike the line chart's point, which needed to move),
                  so only the tilt changes — 90° instead of 45°. */}
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "600",
                  color: COR_VALOR,
                  marginBottom: 4,
                  transform: [{ rotate: "-90deg" }],
                }}
              >
                {barra.valor} h
              </Text>
              <View
                className="rounded-t-md w-2/3"
                style={{
                  height: Math.max((barra.valor / maiorValor) * alturaUtil, LARGURA_MINIMA_BARRA),
                  backgroundColor: accent,
                }}
              />
            </View>
          ))}
        </View>
        <View className="flex-row border-t border-white/10 mt-1.5 pt-1.5">
          {barras.map((barra, indice) => (
            <View key={indice} className="items-center" style={{ width: larguraColuna }}>
              <Typography.Paragraph type="body-xs" color="muted">
                {barra.rotulo}
              </Typography.Paragraph>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
