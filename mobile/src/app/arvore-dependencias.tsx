import { useLocalSearchParams, useRouter } from "expo-router";
import { Spinner, Typography, useThemeColor } from "heroui-native";
import { useEffect, useRef, useState, type JSX } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { AppIcon } from "@/components/AppIcon";
import { getArvoreDependencias } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { construirLayout, type LayoutArvore } from "@/lib/arvore-dependencias-layout";

type Estado =
  | { status: "loading" }
  | { status: "vazio" }
  | { status: "ready"; layout: LayoutArvore }
  | { status: "erro" };

const ESCALA_MIN = 0.4;
const ESCALA_MAX = 2.5;

/**
 * Modal com o grafo de matérias que dependem da matéria selecionada
 * (`codigo`), com posições calculadas por `construirLayout` (dagre) e
 * renderizadas em SVG. Suporta pan/zoom via gesture-handler + reanimated.
 */
export default function ArvoreDependenciasScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { codigo, nome } = useLocalSearchParams<{ codigo: string; nome?: string }>();
  const [foregroundColor, mutedColor] = useThemeColor(["foreground", "muted"]);
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  // Guards against setEstado firing after the modal is dismissed while the
  // fetch is still in flight (same pattern as professor/[siape].tsx).
  const ativoRef = useRef(true);

  useEffect(
    () => () => {
      ativoRef.current = false;
    },
    []
  );

  useEffect(() => {
    const curso = auth.status === "signedIn" ? auth.user.curso : null;
    if (auth.status !== "signedIn" || !curso || !codigo) {
      setEstado({ status: "erro" });
      return;
    }

    setEstado({ status: "loading" });
    getArvoreDependencias(auth.accessToken, curso, codigo)
      .then((resposta) => {
        if (!ativoRef.current) return;
        if (resposta.nos.length <= 1 && resposta.arestas.length === 0) {
          setEstado({ status: "vazio" });
          return;
        }
        setEstado({ status: "ready", layout: construirLayout(resposta) });
      })
      .catch(() => {
        if (ativoRef.current) setEstado({ status: "erro" });
      });
  }, [auth, codigo]);

  const escala = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const pinch = Gesture.Pinch().onUpdate((e) => {
    escala.value = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, e.scale));
  });
  const pan = Gesture.Pan().onUpdate((e) => {
    translateX.value = e.translationX;
    translateY.value = e.translationY;
  });
  const gesto = Gesture.Simultaneous(pinch, pan);

  const estiloAnimado = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: escala.value },
    ],
  }));

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-6 pb-3.5"
        style={{ paddingTop: insets.top + 14 }}
      >
        <View className="flex-1 gap-0.5">
          <Typography.Heading type="h4">{nome ?? codigo}</Typography.Heading>
          <Typography.Paragraph type="body-xs" color="muted">
            Matérias que dependem de {codigo}
          </Typography.Paragraph>
        </View>
        <Pressable testID="arvore-dependencias-close" onPress={() => router.back()} hitSlop={12}>
          <AppIcon name="IconX" size={24} color={foregroundColor} />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center">
        {estado.status === "loading" ? (
          <Spinner testID="arvore-dependencias-loading" />
        ) : estado.status === "erro" ? (
          <Typography.Paragraph
            testID="arvore-dependencias-erro"
            color="muted"
            align="center"
            className="px-6"
          >
            Não foi possível carregar a árvore de dependências.
          </Typography.Paragraph>
        ) : estado.status === "vazio" ? (
          <Typography.Paragraph
            testID="arvore-dependencias-vazio"
            color="muted"
            align="center"
            className="px-6"
          >
            Nenhuma matéria depende de {codigo} na grade atual.
          </Typography.Paragraph>
        ) : (
          <GestureDetector gesture={gesto}>
            <Animated.View style={estiloAnimado}>
              <Svg
                testID="arvore-dependencias-svg"
                width={estado.layout.largura}
                height={estado.layout.altura}
              >
                {estado.layout.arestas.map((aresta, i) => {
                  const [primeiro] = aresta.pontos;
                  const ultimo = aresta.pontos[aresta.pontos.length - 1];
                  if (!primeiro || !ultimo) return null;
                  return (
                    <Line
                      key={`${aresta.de}-${aresta.para}-${i}`}
                      x1={primeiro.x}
                      y1={primeiro.y}
                      x2={ultimo.x}
                      y2={ultimo.y}
                      stroke={mutedColor}
                      strokeWidth={1.5}
                    />
                  );
                })}
                {estado.layout.nos.map((no) => (
                  <Rect
                    key={no.codigo}
                    x={no.x - no.largura / 2}
                    y={no.y - no.altura / 2}
                    width={no.largura}
                    height={no.altura}
                    rx={12}
                    fill={no.codigo === codigo ? mutedColor : "transparent"}
                    stroke={mutedColor}
                    strokeWidth={1.5}
                  />
                ))}
                {estado.layout.nos.map((no) => (
                  <SvgText
                    key={`texto-${no.codigo}`}
                    x={no.x}
                    y={no.y}
                    fill={foregroundColor}
                    fontSize={12}
                    textAnchor="middle"
                  >
                    {no.codigo}
                  </SvgText>
                ))}
              </Svg>
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </View>
  );
}
