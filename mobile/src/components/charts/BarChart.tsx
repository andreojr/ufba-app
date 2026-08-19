import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

export interface Barra {
  rotulo: string;
  valor: number;
}

interface BarChartProps {
  barras: Barra[];
  altura?: number;
  largura?: number;
}

const ALTURA_PADRAO = 120;
const LARGURA_PADRAO = 280;
const LARGURA_MINIMA_BARRA = 4;

/** The carga-horária-per-período bar chart. Bars scale to the tallest one in the series. */
export function BarChart({
  barras,
  altura = ALTURA_PADRAO,
  largura = LARGURA_PADRAO,
}: BarChartProps): JSX.Element {
  const accent = useThemeColor("accent");

  if (barras.length === 0) {
    return <View testID="bar-chart-vazio" />;
  }

  const maiorValor = Math.max(...barras.map((b) => b.valor), LARGURA_MINIMA_BARRA);
  const larguraColuna = largura / barras.length;

  return (
    <View testID="bar-chart" style={{ width: largura }}>
      <View className="flex-row items-end" style={{ height: altura }}>
        {barras.map((barra, indice) => (
          <View key={indice} className="items-center" style={{ width: larguraColuna }}>
            <Typography.Paragraph type="body-xs" weight="medium">
              {barra.valor} h
            </Typography.Paragraph>
            <View
              className="rounded-t-md w-2/3"
              style={{
                height: Math.max((barra.valor / maiorValor) * altura, LARGURA_MINIMA_BARRA),
                backgroundColor: accent,
              }}
            />
          </View>
        ))}
      </View>
      <View className="flex-row">
        {barras.map((barra, indice) => (
          <View key={indice} className="items-center" style={{ width: larguraColuna }}>
            <Typography.Paragraph type="body-xs" color="muted">
              {barra.rotulo}
            </Typography.Paragraph>
          </View>
        ))}
      </View>
    </View>
  );
}
