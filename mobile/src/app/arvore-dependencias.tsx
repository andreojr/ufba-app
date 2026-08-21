import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedProps, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, G, Marker, Polygon, Polyline, Rect, Text as SvgText } from "react-native-svg";

import { AppIcon } from "@/components/AppIcon";
import { ApiError, getArvoreDependencias } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { construirLayout, type LayoutArvore } from "@/lib/arvore-dependencias-layout";
import { aplicarPan, aplicarPinch } from "@/lib/pan-zoom";

type Estado =
  | { status: "loading" }
  | { status: "vazio" }
  | { status: "ready"; layout: LayoutArvore }
  | { status: "erro" }
  // Distinta de "vazio": o próprio código raiz não existe na grade ativa do
  // curso (ex: optativa, ou matéria de um currículo antigo, vinda do
  // histórico do aluno) — não "existe mas não tem dependentes". A API
  // devolve 404 (ComponenteDesconhecidoError) para diferenciar os dois casos.
  | { status: "naoNaGrade" };

const ESCALA_MIN = 0.4;
const ESCALA_MAX = 2.5;

// Pan/zoom acontece DENTRO do SVG (uma matriz animada num <G> raiz), nunca
// crescendo o width/height nativos do <Svg> até o tamanho lógico do grafo.
// Motivo: no Android, o SvgView do react-native-svg rasteriza a área INTEIRA
// da view num Bitmap ARGB_8888 (SvgView.onDraw → drawOutput →
// Bitmap.createBitmap(getWidth(), getHeight())) e o Canvas acelerado por
// hardware tem um limite rígido de bytes por bitmap
// (RecordingCanvas.MAX_BITMAP_SIZE, ~100–150MB dependendo da versão/OEM).
// Um grafo de matéria-base real (ex. MATA02: 3978×1784dp pelo dagre) numa
// densidade Samsung típica (~2.75x) vira um bitmap de ~215MB → crash
// "Canvas: trying to draw too large bitmap". Mantendo o <Svg> no tamanho do
// viewport, o bitmap fica limitado ao tamanho físico da tela (~10MB).
const AnimatedG = Animated.createAnimatedComponent(G);

// Tamanho aproximado de caractere em px para fontSize 12 — usado só para
// decidir onde truncar o nome dentro da largura fixa do nó, não para medir
// texto de verdade (react-native-svg não expõe isso).
const CARACTERES_MAX_NOME = 18;

function truncar(texto: string, maxCaracteres: number): string {
  if (texto.length <= maxCaracteres) return texto;
  return `${texto.slice(0, maxCaracteres - 1)}…`;
}

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

  // Matches how professor/[siape].tsx re-runs its own fetch: a plain
  // useCallback driven by both the mount effect and a retry button, so a
  // timeout (this endpoint can trigger a full live SIGAA scrape) doesn't
  // strand the user with no way to try again short of closing the modal.
  const carregar = useCallback(async () => {
    const curso = auth.status === "signedIn" ? auth.user.curso : null;
    if (auth.status !== "signedIn" || !curso || !codigo) {
      setEstado({ status: "erro" });
      return;
    }

    setEstado({ status: "loading" });
    try {
      const resposta = await getArvoreDependencias(auth.accessToken, curso, codigo);
      if (!ativoRef.current) return;
      if (resposta.nos.length <= 1 && resposta.arestas.length === 0) {
        setEstado({ status: "vazio" });
        return;
      }
      setEstado({ status: "ready", layout: construirLayout(resposta) });
    } catch (error) {
      if (!ativoRef.current) return;
      // Um 404 pode vir de dois erros distintos do backend, com o mesmo
      // status: ComponenteDesconhecidoError (a matéria em si não está na
      // grade ativa — o caso que esta tela quer nomear) ou
      // CursoDesconhecidoError (o curso do usuário não bate com nada no
      // diretório — um problema totalmente diferente, à montante). Tratar os
      // dois como o mesmo estado mostraria "matéria não está na grade" para
      // toda e qualquer matéria sempre que a resolução do curso falhasse —
      // mesmo para matérias que estão, de fato, na grade. A mensagem do
      // ComponenteDesconhecidoError cita o código exato tocado; a do
      // CursoDesconhecidoError, não.
      if (error instanceof ApiError && error.status === 404 && error.message.includes(codigo)) {
        setEstado({ status: "naoNaGrade" });
        return;
      }
      setEstado({ status: "erro" });
    }
  }, [auth, codigo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const escala = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // Offsets salvos ao final do gesto anterior — sem eles, cada novo
  // pinch/pan reinicia sua própria escala/translação (e.scale sempre
  // recomeça em 1, e.translationX/Y sempre recomeçam em 0), fazendo o grafo
  // "pular" de volta à posição anterior a cada novo dedo tocando a tela.
  const savedEscala = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedEscala.value = escala.value;
    })
    .onUpdate((e) => {
      escala.value = aplicarPinch(savedEscala.value, e.scale, ESCALA_MIN, ESCALA_MAX);
    });
  const pan = Gesture.Pan()
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = aplicarPan(savedTranslateX.value, e.translationX);
      translateY.value = aplicarPan(savedTranslateY.value, e.translationY);
    });
  const gesto = Gesture.Simultaneous(pinch, pan);

  // Viewport = a área visível onde o grafo é desenhado. Começa no tamanho da
  // janela (bound superior seguro, disponível síncrono) e é refinado pelo
  // onLayout do container real. O <Svg> NUNCA excede esse tamanho — essa é a
  // garantia estrutural contra o crash de bitmap (ver AnimatedG acima).
  const janela = useWindowDimensions();
  const [viewport, setViewport] = useState<{ largura: number; altura: number } | null>(null);
  const larguraViewport = viewport?.largura ?? janela.width;
  const alturaViewport = viewport?.altura ?? janela.height;
  const aoMedirViewport = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ largura: width, altura: height });
  }, []);

  const larguraGrafo = estado.status === "ready" ? estado.layout.largura : 0;
  const alturaGrafo = estado.status === "ready" ? estado.layout.altura : 0;

  // Reproduz exatamente a transformação que antes era um estilo
  // [translateX, translateY, scale] numa Animated.View centrada: escala em
  // torno do centro do viewport (cx, cy), grafo inicialmente centralizado
  // (ox, oy) e translação do pan por cima — agora como matriz SVG [a b c d
  // e f] aplicada no <G> raiz, para que a rasterização nativa continue do
  // tamanho do viewport. viewBox não serve aqui: reanimated não consegue
  // animá-lo por setNativeProps (só atualiza em re-render — ver
  // software-mansion/react-native-reanimated#2181, onde o maintainer
  // recomenda animar o transform de um Group).
  const propsAnimadas = useAnimatedProps(() => {
    const s = escala.value;
    const cx = larguraViewport / 2;
    const cy = alturaViewport / 2;
    const ox = (larguraViewport - larguraGrafo) / 2;
    const oy = (alturaViewport - alturaGrafo) / 2;
    return {
      matrix: [
        s,
        0,
        0,
        s,
        translateX.value + cx * (1 - s) + s * ox,
        translateY.value + cy * (1 - s) + s * oy,
      ],
    };
  });

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

      <View
        testID="arvore-dependencias-viewport"
        className="flex-1 items-center justify-center"
        onLayout={aoMedirViewport}
      >
        {estado.status === "loading" ? (
          <Spinner testID="arvore-dependencias-loading" />
        ) : estado.status === "erro" ? (
          <View className="gap-3 px-6 items-center">
            <Typography.Paragraph testID="arvore-dependencias-erro" color="muted" align="center">
              Não foi possível carregar a árvore de dependências.
            </Typography.Paragraph>
            <Button variant="outline" size="sm" onPress={() => void carregar()}>
              Tentar novamente
            </Button>
          </View>
        ) : estado.status === "naoNaGrade" ? (
          <Typography.Paragraph
            testID="arvore-dependencias-nao-na-grade"
            color="muted"
            align="center"
            className="px-6"
          >
            Essa matéria não está na grade curricular ativa do curso.
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
            <View className="flex-1 self-stretch" collapsable={false}>
              <Svg testID="arvore-dependencias-svg" width={larguraViewport} height={alturaViewport}>
                <Defs>
                  <Marker
                    id="seta-dependencia"
                    viewBox="0 0 10 10"
                    refX={8}
                    refY={5}
                    markerWidth={6}
                    markerHeight={6}
                    // "auto", não "auto-start-reverse": o Android do
                    // react-native-svg (até 15.12.1 e ainda no main) só aceita
                    // "auto" ou um número — qualquer outra string cai num
                    // Double.parseDouble e crasha o app com
                    // NumberFormatException na fase de draw nativa
                    // (MarkerView.java:125). Como este marker só é usado via
                    // markerEnd, a spec SVG garante que "auto" e
                    // "auto-start-reverse" são visualmente idênticos (eles só
                    // diferem em marker-start).
                    orient="auto"
                  >
                    <Polygon points="0,0 10,5 0,10" fill={mutedColor} />
                  </Marker>
                </Defs>
                {/* O cast: `matrix` é um prop nativo real do RNSVGGroup (6
                    valores, VirtualView.setMatrix no Android), mas o tipo
                    público de G só expõe transform/translate/scale —
                    useAnimatedProps precisa do nome nativo para o
                    setNativeProps por frame funcionar sem re-render. */}
                <AnimatedG animatedProps={propsAnimadas as any}>
                  {estado.layout.arestas.map((aresta, i) => {
                    if (aresta.pontos.length === 0) return null;
                    const pontos = aresta.pontos.map((p) => `${p.x},${p.y}`).join(" ");
                    return (
                      <Polyline
                        key={`${aresta.de}-${aresta.para}-${i}`}
                        points={pontos}
                        fill="none"
                        stroke={mutedColor}
                        strokeWidth={1.5}
                        markerEnd="url(#seta-dependencia)"
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
                      key={`codigo-${no.codigo}`}
                      x={no.x}
                      y={no.y - 6}
                      fill={mutedColor}
                      fontSize={9}
                      textAnchor="middle"
                    >
                      {no.codigo}
                    </SvgText>
                  ))}
                  {estado.layout.nos.map((no) => (
                    <SvgText
                      key={`nome-${no.codigo}`}
                      x={no.x}
                      y={no.y + 12}
                      fill={foregroundColor}
                      fontSize={11}
                      textAnchor="middle"
                    >
                      {truncar(no.nome, CARACTERES_MAX_NOME)}
                    </SvgText>
                  ))}
                </AnimatedG>
              </Svg>
            </View>
          </GestureDetector>
        )}
      </View>
    </View>
  );
}
