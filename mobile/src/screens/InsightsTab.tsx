import { Button, Tabs, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import {
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Gesture, GestureDetector, type NativeGesture, type PanGesture } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AppIcon } from "@/components/AppIcon";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { DownloadProgressBar } from "@/components/DownloadProgressBar";
import { describeApiError } from "@/lib/api-errors";
import { ApiError, getTrajetoria, postTrajetoriaSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { HISTORICO_STAGES } from "@/lib/download-progress";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { useRegisterTabSwipeBlockingGesture } from "@/lib/tab-swipe-context";
import {
  agruparPorSemestre,
  calcularCrAcumulado,
  componentesComCargaHorariaContada,
  contarFaltantes,
  deltasCrPorPeriodo,
  direcaoDoSwipe,
  formatarCoeficiente,
  formatarImpacto,
  formatarNota,
  formatarSemestre,
  historicoDesatualizado,
  maioresImpactos,
  percentualConcluido,
  periodosComNota,
  pesoDasNotas,
  posicaoSemestral,
  proximoInsight,
  rotuloRitmo,
  rotuloSemestreCurto,
  rotulosPorAno,
  segmentosSemestralizacao,
  somarCargaHoraria,
  variacaoUltimoPeriodo,
  type Insight,
  type PeriodoTrajetoria,
  type PosicaoSemestral,
  type SegmentoSemestralizacao,
} from "@/lib/trajetoria";
import type { ComponenteCursado, Historico, MarcosSemestralizacao, TrajetoriaResponse } from "@/lib/types";

type LoadState =
  | { status: "loading" }
  | { status: "unsynced" }
  | { status: "error"; message: string }
  | { status: "ready"; historico: Historico; fetchedAt: Date; marcos: MarcosSemestralizacao | null };

/**
 * Sync failures need one message the shared helper cannot give — see the twin
 * of this function in trajetoria.tsx for the full rationale. Duplicated
 * rather than shared: each tab fetches and syncs independently, same as
 * ajustes.tsx does for the schedule.
 */
function descreverErroSync(error: unknown): string {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status !== undefined && status !== 401 && status !== 429) {
    return "Pode ser um problema no documento. Você ainda pode baixar o PDF em Documentos.";
  }
  return describeApiError(error);
}

export default function InsightsTab(): JSX.Element {
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const mutedColor = useThemeColor("muted");

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [sincronizando, setSincronizando] = useState(false);
  const [erroSync, setErroSync] = useState<string | null>(null);
  const [fimDoPeriodo, setFimDoPeriodo] = useState<string | null>(null);
  // Carga Horária first — the CR breakdown (item 12 do roadmap) só aparece
  // quando a pessoa arrasta o card, não é mais o que ela vê de cara.
  const [insight, setInsight] = useState<Insight>("cargaHoraria");

  // `proximoInsight` is a plain JS function, not a worklet — it has to run
  // back on the JS thread. The functional `setInsight` update means this
  // closure never needs `insight` itself, so it's stable across renders.
  const aplicarSwipe = useCallback((translationX: number, translationY: number) => {
    setInsight((atual) => proximoInsight(atual, translationX, translationY));
  }, []);

  // See trajetoria.tsx's identical pair for why these live outside React
  // state — a re-render mid-gesture is what used to crash the app here.
  const abaAtual = useSharedValue(insight === "cr" ? 0 : 1);
  const arrasto = useSharedValue(0);

  useEffect(() => {
    abaAtual.value = withTiming(insight === "cr" ? 0 : 1, { duration: 220 });
  }, [insight, abaAtual]);

  const lineChartScrollGesture = useMemo(() => Gesture.Native(), []);
  const barChartScrollGesture = useMemo(() => Gesture.Native(), []);
  // The "peso das notas" carousel in the CR card's bottom half — same
  // requireExternalGestureToFail relationship as the two chart scrolls above,
  // otherwise dragging across it reads as the CR/Carga-Horária swipe (or,
  // one level up, the tab pager's own swipe) instead of paging the carousel.
  const pesoScrollGesture = useMemo(() => Gesture.Native(), []);

  const swipeInsight = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-10, 10])
        .requireExternalGestureToFail(lineChartScrollGesture, barChartScrollGesture, pesoScrollGesture)
        .onChange((evento) => {
          let x = evento.translationX;
          if (abaAtual.value === 0 && x > 0) {
            x = 0;
          }
          if (abaAtual.value === 1 && x < 0) {
            x = 0;
          }
          arrasto.value = x;
        })
        .onEnd((evento) => {
          const direcao = direcaoDoSwipe(evento.translationX, evento.translationY);
          if (direcao === "esquerda" && abaAtual.value < 1) {
            abaAtual.value = withTiming(1, { duration: 220 });
          } else if (direcao === "direita" && abaAtual.value > 0) {
            abaAtual.value = withTiming(0, { duration: 220 });
          }
          arrasto.value = withTiming(0, { duration: 220 });
          if (direcao) {
            scheduleOnRN(aplicarSwipe, evento.translationX, evento.translationY);
          }
        }),
    [lineChartScrollGesture, barChartScrollGesture, pesoScrollGesture, abaAtual, arrasto, aplicarSwipe],
  );

  // The tab pager's own left/right swipe (see TabsPager) must lose to this
  // one whenever the drag starts over the CR/Carga-Horária card below —
  // otherwise trying to flip that card would instead flip the whole page.
  useRegisterTabSwipeBlockingGesture(swipeInsight);

  useEffect(() => {
    void getPeriodoCache().then((periodo) => setFimDoPeriodo(periodo?.fim ?? null));
  }, []);

  const aplicar = useCallback((resposta: TrajetoriaResponse) => {
    if (!("historico" in resposta)) {
      setState({ status: "unsynced" });
      return;
    }
    setState({
      status: "ready",
      historico: resposta.historico,
      fetchedAt: new Date(resposta.fetchedAt),
      marcos: resposta.marcos,
    });
    setErroSync(null);
  }, []);

  const carregar = useCallback(
    async () => {
      if (!accessToken) {
        return;
      }
      setState({ status: "loading" });
      try {
        aplicar(await getTrajetoria(accessToken));
      } catch (error) {
        console.warn("Failed to load trajetória", error);
        setState({ status: "error", message: describeApiError(error) });
      }
    },
    [accessToken, aplicar],
  );

  useEffect(() => {
    if (sigaaLink.status === "linked" && accessToken) {
      carregar();
    } else if (sigaaLink.status === "unlinked") {
      setState({ status: "error", message: "Vincule sua conta do SIGAA para ver sua trajetória." });
    }
  }, [sigaaLink.status, accessToken, carregar]);

  const sincronizar = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    const credentials = await getSigaaCredentials();
    if (!credentials) {
      setErroSync("Vincule sua conta do SIGAA primeiro.");
      return;
    }

    setSincronizando(true);
    setErroSync(null);
    try {
      aplicar(
        await postTrajetoriaSync(accessToken, {
          login: credentials.login,
          senha: credentials.senha,
        }),
      );
    } catch (error) {
      console.warn("Failed to sync trajetória", error);
      setErroSync(descreverErroSync(error));
    } finally {
      setSincronizando(false);
    }
  }, [accessToken, aplicar]);

  const erro = erroSync ? (
    <Typography.Paragraph type="body-xs" className="text-danger">
      Não deu para sincronizar seu histórico. {erroSync}
    </Typography.Paragraph>
  ) : null;

  return (
    <View className="flex-1 bg-background">
      {/* No GestureDetector wrapping this ScrollView anymore — swipeInsight is
          now scoped to just the CR/Carga-Horária card inside ReadyInsights,
          so a drag anywhere else on this screen is free to move the tab
          pager instead (see TabsPager and useRegisterTabSwipeBlockingGesture
          above). */}
      <ScrollView
        testID="insights-scroll"
        className="flex-1 px-6"
        contentContainerClassName="gap-5 pb-8"
        showsVerticalScrollIndicator={false}
      >
        {state.status === "loading" ? (
          <View className="rounded-3xl bg-surface-secondary p-8 items-center">
            <Typography.Paragraph type="body-sm" color="muted">
              Carregando seus insights…
            </Typography.Paragraph>
          </View>
        ) : null}

        {state.status === "error" ? (
          <View className="rounded-3xl bg-surface-secondary p-6 items-center gap-3">
            <AppIcon name="IconWarningCircle" size={28} color={mutedColor} />
            <Typography.Paragraph type="body-sm" color="muted" align="center">
              {state.message}
            </Typography.Paragraph>
            {sigaaLink.status === "linked" ? (
              <Button variant="outline" size="sm" onPress={() => carregar()}>
                Tentar de novo
              </Button>
            ) : null}
          </View>
        ) : null}

        {state.status === "unsynced" ? (
          <View className="rounded-3xl bg-surface-secondary p-5 gap-3">
            <Typography.Heading type="h6">Seus insights ainda não foram montados</Typography.Heading>
            <Typography.Paragraph type="body-sm" color="muted">
              Vamos buscar seu histórico escolar no SIGAA. Leva alguns segundos.
            </Typography.Paragraph>
            <Button onPress={sincronizar} isDisabled={sincronizando}>
              {sincronizando ? "Sincronizando…" : "Sincronizar histórico"}
            </Button>
            {sincronizando ? <DownloadProgressBar stages={HISTORICO_STAGES} /> : null}
            {erro}
          </View>
        ) : null}

        {state.status === "ready" ? (
          <ReadyInsights
            historico={state.historico}
            fetchedAt={state.fetchedAt}
            marcos={state.marcos}
            fimDoPeriodo={fimDoPeriodo}
            onSincronizar={sincronizar}
            sincronizando={sincronizando}
            erro={erro}
            insight={insight}
            onInsightChange={setInsight}
            swipeInsight={swipeInsight}
            lineChartScrollGesture={lineChartScrollGesture}
            barChartScrollGesture={barChartScrollGesture}
            pesoScrollGesture={pesoScrollGesture}
            abaAtual={abaAtual}
            arrasto={arrasto}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ReadyInsights({
  historico,
  fetchedAt,
  marcos,
  fimDoPeriodo,
  onSincronizar,
  sincronizando,
  erro,
  insight,
  onInsightChange,
  swipeInsight,
  lineChartScrollGesture,
  barChartScrollGesture,
  pesoScrollGesture,
  abaAtual,
  arrasto,
}: {
  historico: Historico;
  fetchedAt: Date;
  marcos: MarcosSemestralizacao | null;
  fimDoPeriodo: string | null;
  onSincronizar: () => void;
  sincronizando: boolean;
  erro: JSX.Element | null;
  insight: Insight;
  onInsightChange: (insight: Insight) => void;
  swipeInsight: PanGesture;
  lineChartScrollGesture: NativeGesture;
  barChartScrollGesture: NativeGesture;
  pesoScrollGesture: NativeGesture;
  abaAtual: SharedValue<number>;
  arrasto: SharedValue<number>;
}): JSX.Element {
  const { obrigatorias, optativas, complementares, total } = historico.cargaHoraria;
  const percentual = percentualConcluido(total);
  const percentualObrigatorias = percentualConcluido(obrigatorias);
  const percentualOptativas = percentualConcluido(optativas);
  const percentualComplementares = percentualConcluido(complementares);
  const segmentos = segmentosSemestralizacao(marcos?.marcos ?? [], obrigatorias.integralizada);
  const posicao = posicaoSemestral(segmentos);
  const semestresFechados = Math.max(0, historico.periodoLetivoAtual - 1);
  const rotuloRitmoAtual = rotuloRitmo(marcos?.ritmo ?? null);
  const ritmoInfo = rotuloRitmoAtual
    ? {
        rotulo: rotuloRitmoAtual,
        seta: marcos?.ritmo === "adiantado" ? "↑" : marcos?.ritmo === "atrasado" ? "↓" : "→",
        cor:
          marcos?.ritmo === "adiantado"
            ? "text-success"
            : marcos?.ritmo === "atrasado"
              ? "text-danger"
              : "text-muted",
      }
    : null;
  const periodos = agruparPorSemestre(historico.cursados);
  const periodosCr = periodosComNota(periodos);
  const desatualizado = historicoDesatualizado(historico.cursados, fimDoPeriodo, new Date());

  const semestresOrdenados = periodos.map((periodo) => periodo.semestre);
  const rotulosAno = rotulosPorAno(semestresOrdenados);
  const crPorPeriodo = calcularCrAcumulado(historico.cursados, semestresOrdenados);
  const pontosCr = crPorPeriodo.map((ponto, indice) => ({
    rotulo: rotulosAno[indice],
    valor: ponto.cr,
  }));
  const variacaoCr = variacaoUltimoPeriodo(crPorPeriodo);
  const barrasCargaHoraria = periodos.map((periodo, indice) => ({
    rotulo: rotulosAno[indice],
    valor: somarCargaHoraria(componentesComCargaHorariaContada(periodo.componentes)),
  }));

  const larguraCard = useSharedValue(0);
  const [larguraCardPx, setLarguraCardPx] = useState(0);
  const aoMedirCard = (evento: LayoutChangeEvent): void => {
    const { width } = evento.nativeEvent.layout;
    larguraCard.value = width;
    setLarguraCardPx(width);
  };

  const estiloTrilha = useAnimatedStyle(() => ({
    transform: [{ translateX: -abaAtual.value * larguraCard.value + arrasto.value }],
  }));

  // Two dots under the CR/Carga-Horária card signal that it's a carousel —
  // it was already draggable before this, just with no visual hint that it
  // was. Driven straight off `abaAtual` (0..1) so they track the drag itself,
  // not just the settled tab.
  const estiloPontoCr = useAnimatedStyle(() => ({
    opacity: interpolate(abaAtual.value, [0, 1], [1, 0.3], Extrapolation.CLAMP),
  }));
  const estiloPontoCargaHoraria = useAnimatedStyle(() => ({
    opacity: interpolate(abaAtual.value, [0, 1], [0.3, 1], Extrapolation.CLAMP),
  }));

  // The bottom card's own height animates between its two variants (a fixed
  // set of progress bars vs. the CR breakdown, which varies with how many
  // terms have grades) instead of jumping — measured off whichever variant
  // is actually mounted, then eased to the next measurement when `insight`
  // flips. `null` until the first layout so the very first render doesn't
  // animate in from zero.
  const alturaCardInferior = useSharedValue<number | null>(null);
  const aoMedirCardInferior = (evento: LayoutChangeEvent): void => {
    const { height } = evento.nativeEvent.layout;
    alturaCardInferior.value =
      alturaCardInferior.value === null ? height : withTiming(height, { duration: 220 });
  };
  const estiloAlturaCardInferior = useAnimatedStyle(() => ({
    height: alturaCardInferior.value ?? undefined,
  }));

  return (
    <>
      <View className="gap-5">
        {/* `variant="primary"` here, not the `"secondary"` this card used to
            carry on the Trajetória screen — this is the standard tabs look
            used on Perfil and on the professor detail screen. The swipe
            gesture wrapping the page and the sliding panel below are
            unaffected by the variant; only the trigger/indicator styling
            changes. */}
        <Tabs value={insight} onValueChange={(valor) => onInsightChange(valor as Insight)} variant="primary">
          <Tabs.List>
            <Tabs.Indicator />
            <Tabs.Trigger value="cr">
              <Tabs.Label>CR</Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger value="cargaHoraria">
              <Tabs.Label>Carga Horária</Tabs.Label>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>

        <View className="gap-0.5">
          {/* Scoped to just this card (not the whole screen, like before this
              became one tab among several swipeable ones) — see swipeInsight's
              registration in InsightsTab and TabsPager's own gesture. */}
          <GestureDetector gesture={swipeInsight}>
            <View className="rounded-t-3xl rounded-b-md bg-surface-secondary p-4">
              <View className="overflow-hidden" onLayout={aoMedirCard}>
                <Animated.View style={[{ flexDirection: "row", width: larguraCardPx * 2 }, estiloTrilha]}>
                  <View className="gap-2" style={{ width: larguraCardPx }}>
                    <View className="gap-0.5">
                      <Typography.Paragraph type="body-xs" color="muted">
                        Coeficiente de Rendimento
                      </Typography.Paragraph>
                      <View className="flex-row items-center gap-2.5">
                        <Typography.Heading type="h3" className="font-mono">
                          {formatarCoeficiente(historico.indices.cr)}
                        </Typography.Heading>
                        <Typography.Paragraph
                          testID="cr-variacao"
                          type="body-sm"
                          weight="medium"
                          color={variacaoCr ? undefined : "muted"}
                          className="font-mono"
                        >
                          {formatarImpacto(variacaoCr)}
                        </Typography.Paragraph>
                      </View>
                    </View>
                    <LineChart pontos={pontosCr} altura={70} scrollGesture={lineChartScrollGesture} />
                  </View>
                  <View className="gap-2" style={{ width: larguraCardPx }}>
                    <View className="gap-0.5">
                      <Typography.Paragraph type="body-xs" color="muted">
                        Carga horária
                      </Typography.Paragraph>
                      <Typography.Heading type="h3" className="font-mono">
                        {total.integralizada.toLocaleString("pt-BR")} h
                      </Typography.Heading>
                    </View>
                    <BarChart barras={barrasCargaHoraria} altura={70} scrollGesture={barChartScrollGesture} />
                  </View>
                </Animated.View>
              </View>
              {/* Signals the card is a carousel — the drag itself already
                  worked before these dots existed, nothing here changes it. */}
              <View className="flex-row justify-center gap-1.5 mt-3">
                <Animated.View className="w-1.5 h-1.5 rounded-full bg-foreground" style={estiloPontoCr} />
                <Animated.View
                  className="w-1.5 h-1.5 rounded-full bg-foreground"
                  style={estiloPontoCargaHoraria}
                />
              </View>
            </View>
          </GestureDetector>

          <Animated.View
            className="rounded-t-md rounded-b-3xl bg-surface-secondary overflow-hidden"
            style={estiloAlturaCardInferior}
          >
            <View className="p-4 gap-4" onLayout={aoMedirCardInferior}>
              {insight === "cargaHoraria" ? (
                <CargaHorariaResumo
                  historico={historico}
                  segmentos={segmentos}
                  posicao={posicao}
                  semestresFechados={semestresFechados}
                  ritmoInfo={ritmoInfo}
                  percentual={percentual}
                  percentualObrigatorias={percentualObrigatorias}
                  percentualOptativas={percentualOptativas}
                  percentualComplementares={percentualComplementares}
                />
              ) : (
                <ImpactoCrCard
                  periodos={periodosCr}
                  cursados={historico.cursados}
                  pesoScrollGesture={pesoScrollGesture}
                />
              )}
            </View>
          </Animated.View>
        </View>
      </View>

      <View className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Typography.Paragraph type="body-xs" color="muted" className="flex-1">
            {desatualizado ? (
              "O semestre acabou e seu histórico ainda tem matérias em curso — sincronize para ver as notas."
            ) : (
              <>
                Sincronizado em{" "}
                <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                  {fetchedAt.toLocaleDateString("pt-BR")}
                </Typography.Paragraph>
              </>
            )}
          </Typography.Paragraph>
          {sincronizando ? null : (
            <Pressable onPress={onSincronizar} className="h-9 px-1 justify-center">
              <Typography.Paragraph type="body-sm" weight="medium" className="text-accent">
                Sincronizar
              </Typography.Paragraph>
            </Pressable>
          )}
        </View>
        {sincronizando ? <DownloadProgressBar stages={HISTORICO_STAGES} /> : null}
        {erro}
      </View>
    </>
  );
}

type RitmoInfo = { rotulo: string; seta: string; cor: string } | null;

/**
 * The bottom card's Carga Horária variant — course-progress bars, one per
 * natureza, plus the Obrigatórias one's semestralização marcos (item 8 do
 * roadmap). Unchanged content, just pulled out of `ReadyInsights` so the CR
 * variant (`ImpactoCrCard`) can sit beside it as the other half of the same
 * switch (item 12 do roadmap).
 */
function CargaHorariaResumo({
  historico,
  segmentos,
  posicao,
  semestresFechados,
  ritmoInfo,
  percentual,
  percentualObrigatorias,
  percentualOptativas,
  percentualComplementares,
}: {
  historico: Historico;
  segmentos: SegmentoSemestralizacao[];
  posicao: PosicaoSemestral;
  semestresFechados: number;
  ritmoInfo: RitmoInfo;
  percentual: number;
  percentualObrigatorias: number;
  percentualOptativas: number;
  percentualComplementares: number;
}): JSX.Element {
  const { obrigatorias, optativas, complementares, total } = historico.cargaHoraria;
  return (
    <>
      <View className="gap-1.5">
        <View className="flex-row items-center justify-between">
          <Typography.Paragraph type="body-xs" color="muted">
            Obrigatórias
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
            {obrigatorias.exigida.toLocaleString("pt-BR")} h
          </Typography.Paragraph>
        </View>
        {segmentos.length > 0 ? (
          <View className="h-2 flex-row gap-1">
            {segmentos.map((segmento) => (
              <View
                key={segmento.periodo}
                className="h-full rounded-full bg-white/[0.08] overflow-hidden"
                style={{ flexGrow: segmento.larguraPercentual, flexBasis: 0 }}
              >
                <View
                  className={`h-full rounded-full ${
                    segmento.preenchimento >= 1 ? "bg-success" : "bg-accent"
                  }`}
                  style={{ width: `${segmento.preenchimento * 100}%` }}
                />
              </View>
            ))}
          </View>
        ) : (
          <View className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
            <View className="h-full rounded-full bg-accent" style={{ width: `${percentualObrigatorias}%` }} />
          </View>
        )}
        <View className="flex-row items-center justify-between">
          <Typography.Paragraph type="body-xs" color="muted">
            <Typography.Paragraph type="body-sm" weight="bold" className="font-mono">
              {percentualObrigatorias}%
            </Typography.Paragraph>{" "}
            das obrigatórias concluído
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" color="muted">
            {contarFaltantes(historico.pendentesObrigatorios) === 1
              ? "falta 1 matéria"
              : `faltam ${contarFaltantes(historico.pendentesObrigatorios)} matérias`}
          </Typography.Paragraph>
        </View>
        {posicao.total > 0 ? (
          <View className="gap-1 mt-1">
            <Typography.Paragraph type="body-xs" color="muted">
              <Typography.Paragraph type="body-sm" weight="bold" className="font-mono">
                {posicao.concluidos}
              </Typography.Paragraph>{" "}
              de {posicao.total} semestres concluídos
            </Typography.Paragraph>
            {ritmoInfo ? (
              <Typography.Paragraph type="body-xs" className={ritmoInfo.cor}>
                {ritmoInfo.seta} {ritmoInfo.rotulo}
                {"\n"}
                <Typography.Paragraph type="body-xs" color="muted">
                  Você já completou{" "}
                  {semestresFechados === 1 ? "1 semestre" : `${semestresFechados} semestres`}, mas sua
                  carga horária equivale a {formatarSemestre(posicao.posicaoFracionaria)} semestres da
                  grade
                </Typography.Paragraph>
              </Typography.Paragraph>
            ) : null}
          </View>
        ) : null}
      </View>

      <View className="flex-row gap-4">
        <View className="flex-1">
          <BarraCargaHorariaSimples
            rotulo="Optativas"
            exigida={optativas.exigida}
            percentual={percentualOptativas}
            descricao="concluído"
          />
        </View>
        <View className="flex-1">
          <BarraCargaHorariaSimples
            rotulo="Complementares"
            exigida={complementares.exigida}
            percentual={percentualComplementares}
            descricao="concluído"
          />
        </View>
      </View>

      <BarraCargaHorariaSimples
        rotulo="Geral"
        exigida={total.exigida}
        percentual={percentual}
        descricao="do curso concluído"
      />
    </>
  );
}

/**
 * One row of the "impacto por semestre" chart: a bar diverging from a center
 * zero line, green to the right for a term that raised the CR, red to the
 * left for one that lowered it. `magnitude` scales a half-CR-point move
 * (0.5) to a full half-bar — CR moves rarely exceed that in one term, so
 * bigger swings than that just clip to the full width rather than fighting
 * for an ever-shrinking scale.
 */
function LinhaImpactoPeriodo({ rotulo, delta }: { rotulo: string; delta: number | null }): JSX.Element {
  const magnitude = delta === null ? 0 : Math.min(Math.abs(delta) / 0.5, 1);
  return (
    <View className="flex-row items-center gap-2.5">
      <Typography.Paragraph type="body-xs" color="muted" className="font-mono" style={{ width: 32 }}>
        {rotulo}
      </Typography.Paragraph>
      <View className="flex-1 h-3.5 relative justify-center">
        <View className="absolute self-center h-full w-px bg-white/10" />
        {delta !== null && delta !== 0 ? (
          <View
            className={`absolute h-2.5 rounded-sm ${delta > 0 ? "bg-success" : "bg-danger"}`}
            style={
              delta > 0
                ? { left: "50%", width: `${magnitude * 50}%` }
                : { right: "50%", width: `${magnitude * 50}%` }
            }
          />
        ) : null}
      </View>
      <Typography.Paragraph
        type="body-sm"
        weight="medium"
        className={`font-mono text-right ${
          delta === null || delta === 0 ? "text-muted" : delta > 0 ? "text-success" : "text-danger"
        }`}
        style={{ width: 52 }}
      >
        {formatarImpacto(delta)}
      </Typography.Paragraph>
    </View>
  );
}

/**
 * The bottom card's CR variant (item 12 do roadmap): how much each term
 * moved the CR, a drill-down into which of that term's components pulled it
 * the most, and a carousel — one page per term — showing how much each
 * graded component weighed toward that term's own contribution.
 */
function ImpactoCrCard({
  periodos,
  cursados,
  pesoScrollGesture,
}: {
  periodos: PeriodoTrajetoria[];
  cursados: ComponenteCursado[];
  pesoScrollGesture: NativeGesture;
}): JSX.Element {
  const semestresOrdenados = periodos.map((periodo) => periodo.semestre);
  const serieCr = calcularCrAcumulado(cursados, semestresOrdenados);
  const deltas = deltasCrPorPeriodo(serieCr);

  const [indiceCarrossel, setIndiceCarrossel] = useState(0);
  const [larguraCarrossel, setLarguraCarrossel] = useState(0);

  const aoRolarCarrossel = (evento: NativeSyntheticEvent<NativeScrollEvent>): void => {
    if (larguraCarrossel === 0) {
      return;
    }
    const indice = Math.round(evento.nativeEvent.contentOffset.x / larguraCarrossel);
    setIndiceCarrossel(indice);
  };

  const periodoAtivo = periodos[indiceCarrossel] ?? periodos[periodos.length - 1] ?? null;
  const impactos = periodoAtivo ? maioresImpactos(cursados, periodoAtivo.semestre) : [];

  if (periodos.length === 0) {
    return (
      <Typography.Paragraph type="body-sm" color="muted">
        Ainda não há notas suficientes para mostrar o impacto no CR.
      </Typography.Paragraph>
    );
  }

  return (
    <>
      <View className="gap-2">
        <Typography.Paragraph type="body-xs" color="muted">
          Impacto no CR por semestre
        </Typography.Paragraph>
        <View className="gap-2">
          {periodos.map((periodo, indice) => (
            <LinhaImpactoPeriodo
              key={periodo.semestre}
              rotulo={rotuloSemestreCurto(periodo.semestre)}
              delta={deltas[indice]}
            />
          ))}
        </View>
      </View>

      <View className="h-px bg-white/10" />

      <View className="gap-2.5">
        <Typography.Paragraph type="body-xs" color="muted">
          {periodoAtivo
            ? `Maiores impactos • ${rotuloSemestreCurto(periodoAtivo.semestre)}`
            : "Maiores impactos"}
        </Typography.Paragraph>
        {impactos.length > 0 ? (
          <View className="gap-2.5">
            {impactos.map((item) => (
              <View key={item.codigo} className="flex-row items-center justify-between gap-3">
                <View className="flex-1">
                  <Typography.Paragraph type="body-sm" weight="medium">
                    {item.nome}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                    {item.codigo} · nota {formatarNota(item.nota)}
                  </Typography.Paragraph>
                </View>
                <Typography.Paragraph
                  type="body-sm"
                  weight="semibold"
                  className={`font-mono ${item.impacto > 0 ? "text-success" : "text-danger"}`}
                >
                  {item.impacto > 0 ? "↑" : "↓"} {formatarCoeficiente(Math.abs(item.impacto))}
                </Typography.Paragraph>
              </View>
            ))}
          </View>
        ) : (
          <Typography.Paragraph type="body-xs" color="muted">
            Sem notas suficientes nesse semestre.
          </Typography.Paragraph>
        )}
      </View>

      <View className="h-px bg-white/10" />

      <View className="gap-2.5">
        <Typography.Paragraph type="body-xs" color="muted">
          Peso das notas no semestre
        </Typography.Paragraph>
        {/* `pesoScrollGesture` keeps this drag from reading as the
            CR/Carga-Horária swipe (or the tab pager's, one level up) — same
            relationship the line/bar charts already have, see InsightsTab. */}
        <GestureDetector gesture={pesoScrollGesture}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={aoRolarCarrossel}
            onLayout={(evento) => setLarguraCarrossel(evento.nativeEvent.layout.width)}
            testID="carrossel-peso-notas"
          >
            {periodos.map((periodo) => {
              const pesos = pesoDasNotas(periodo.componentes);
              return (
                <View key={periodo.semestre} style={{ width: larguraCarrossel || undefined }} className="gap-2.5">
                  <View className="h-2.5 flex-row rounded-full overflow-hidden bg-white/10">
                    {pesos.map((peso) => (
                      <View
                        key={peso.codigo}
                        style={{ width: `${peso.pesoPercentual}%` }}
                        className={`h-full ${
                          peso.faixa === "alta"
                            ? "bg-success"
                            : peso.faixa === "media"
                              ? "bg-accent"
                              : "bg-danger"
                        }`}
                      />
                    ))}
                  </View>
                  <View className="gap-1.5">
                    {pesos.map((peso) => (
                      <View key={peso.codigo} className="flex-row items-center justify-between gap-2">
                        <View className="flex-row items-center gap-2 flex-1">
                          <View
                            className={`w-2 h-2 rounded-sm ${
                              peso.faixa === "alta"
                                ? "bg-success"
                                : peso.faixa === "media"
                                  ? "bg-accent"
                                  : "bg-danger"
                            }`}
                          />
                          <Typography.Paragraph type="body-xs" className="flex-1" numberOfLines={1}>
                            {peso.nome}
                          </Typography.Paragraph>
                        </View>
                        <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                          nota {formatarNota(peso.nota)} · {peso.cargaHoraria}h
                        </Typography.Paragraph>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </GestureDetector>
        {periodos.length > 1 ? (
          <View className="flex-row justify-center gap-1.5">
            {periodos.map((periodo, indice) => (
              <View
                key={periodo.semestre}
                className={`w-1.5 h-1.5 rounded-full ${
                  indice === indiceCarrossel ? "bg-foreground" : "bg-white/15"
                }`}
              />
            ))}
          </View>
        ) : null}
      </View>
    </>
  );
}

/**
 * One solid progress bar for a natureza with no marcos of its own — optativas,
 * complementares, and the aggregate Geral bar. Unlike the Obrigatórias bar
 * above, none of these can segment by período: optativas/complementares carry
 * no período in the grade, and Geral mixes all three naturezas together, so
 * there is no single set of marcos to render as segments.
 */
function BarraCargaHorariaSimples({
  rotulo,
  exigida,
  percentual,
  descricao,
}: {
  rotulo: string;
  exigida: number;
  percentual: number;
  /** Appended after the bold percentual — "concluído" or "do curso concluído". */
  descricao: string;
}): JSX.Element {
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <Typography.Paragraph type="body-xs" color="muted">
          {rotulo}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
          {exigida.toLocaleString("pt-BR")} h
        </Typography.Paragraph>
      </View>
      <View className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
        <View className="h-full rounded-full bg-accent" style={{ width: `${percentual}%` }} />
      </View>
      <Typography.Paragraph type="body-xs" color="muted">
        <Typography.Paragraph type="body-sm" weight="bold" className="font-mono">
          {percentual}%
        </Typography.Paragraph>{" "}
        {descricao}
      </Typography.Paragraph>
    </View>
  );
}
