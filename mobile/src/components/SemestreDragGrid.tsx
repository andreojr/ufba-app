import { useEffect, type JSX } from "react";
import { Modal, View, useWindowDimensions } from "react-native";
import { Typography } from "heroui-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { useArrastoSemestre } from "@/lib/arrasto-semestre-context";
import {
  COLUNAS_GRID,
  ESPACO_QUADRADINHO,
  TAMANHO_QUADRADINHO,
  posicionarQuadradinhos,
  quadradinhosDoGrid,
} from "@/lib/drag-grid";

/**
 * O overlay full-screen que aparece enquanto o dedo segura um CardProjetado.
 * Não é filho do card — os dois só se falam pelo ArrastoSemestreProvider, e
 * é por isso que a posição de cada quadradinho é calculada aqui (geometria
 * pura, ver posicionarQuadradinhos) em vez de medida via onLayout: o mesmo
 * cálculo decide onde desenhar e onde a colisão de soltura procura.
 */
export function SemestreDragGrid({
  semestresProjetados,
}: {
  semestresProjetados: string[];
}): JSX.Element | null {
  const { arrasto, registrarQuadradinhos, finalizar, fingerX, fingerY } = useArrastoSemestre();
  const { width, height } = useWindowDimensions();

  const quadradinhos = arrasto
    ? quadradinhosDoGrid(semestresProjetados, arrasto.semestreAtual, arrasto.componente.manual)
    : [];
  const larguraGrid = COLUNAS_GRID * TAMANHO_QUADRADINHO + (COLUNAS_GRID - 1) * ESPACO_QUADRADINHO;
  const linhas = Math.max(1, Math.ceil(quadradinhos.length / COLUNAS_GRID));
  const alturaGrid = linhas * TAMANHO_QUADRADINHO + (linhas - 1) * ESPACO_QUADRADINHO;
  const origemX = (width - larguraGrid) / 2;
  const origemY = (height - alturaGrid) / 2;
  const posicionados = posicionarQuadradinhos(quadradinhos, origemX, origemY);
  // Serializado pra dependência estável do efeito — o array de objetos é
  // recriado a cada render.
  const chaveQuadradinhos = posicionados.map((q) => `${q.id}:${q.x}:${q.y}`).join("|");

  useEffect(() => {
    if (arrasto) {
      registrarQuadradinhos(posicionados);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrasto, chaveQuadradinhos]);

  const estiloFantasma = useAnimatedStyle(() => ({
    left: fingerX.value - TAMANHO_QUADRADINHO / 2,
    top: fingerY.value - TAMANHO_QUADRADINHO / 2,
  }));

  if (!arrasto) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => finalizar(-1, -1)}
    >
      <View testID="semestre-drag-grid" className="flex-1 bg-black/70">
        {posicionados.map((quadradinho) => (
          <View
            key={quadradinho.id}
            testID={`quadrado-${quadradinho.id}`}
            style={{
              position: "absolute",
              left: quadradinho.x,
              top: quadradinho.y,
              width: quadradinho.width,
              height: quadradinho.height,
            }}
            className={`rounded-2xl items-center justify-center px-2 ${
              quadradinho.desabilitado
                ? "bg-white/5 opacity-40"
                : quadradinho.pontilhado
                  ? "border border-dashed border-white/30"
                  : "bg-surface-secondary"
            }`}
          >
            <Typography.Paragraph type="body-sm" className="font-mono text-center">
              {quadradinho.rotulo}
            </Typography.Paragraph>
          </View>
        ))}
        <Animated.View
          testID="card-fantasma"
          pointerEvents="none"
          style={[{ position: "absolute", width: TAMANHO_QUADRADINHO }, estiloFantasma]}
        >
          <View className="rounded-2xl bg-surface-secondary p-3">
            <Typography.Paragraph weight="medium">{arrasto.componente.nome}</Typography.Paragraph>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
