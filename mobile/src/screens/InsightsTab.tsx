import { useRouter } from "expo-router";
import { Button, Tabs, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import {
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
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AppIcon } from "@/components/AppIcon";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { describeApiError } from "@/lib/api-errors";
import { getTrajetoria } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { useSyncFreshness } from "@/lib/sync-freshness-context";
import { tocouDentroDaArea } from "@/lib/gesture-bounds";
import { useRegisterTabSwipeBlockingArea, useRegisterTabSwipeBlockingGesture } from "@/lib/tab-swipe-context";
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
  impactosPorSemestre,
  percentualConcluido,
  periodosComNota,
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

export default function InsightsTab(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const mutedColor = useThemeColor("muted");
  // Shared with Início's freshness badge and Perfil's sync item — see
  // sync-freshness-context's docstring.
  const { setHistoricoFetchedAt } = useSyncFreshness();

  const [state, setState] = useState<LoadState>({ status: "loading" });
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
  const abaAtual = useSharedValue(insight === "cargaHoraria" ? 0 : 1);
  const arrasto = useSharedValue(0);

  useEffect(() => {
    abaAtual.value = withTiming(insight === "cargaHoraria" ? 0 : 1, { duration: 220 });
  }, [insight, abaAtual]);

  const lineChartScrollGesture = useMemo(() => Gesture.Native(), []);
  const barChartScrollGesture = useMemo(() => Gesture.Native(), []);
  // The "peso das notas" carousel in the CR card's bottom half — same
  // requireExternalGestureToFail relationship as the two chart scrolls above,
  // otherwise dragging across it reads as the CR/Carga-Horária swipe (or,
  // one level up, the tab pager's own swipe) instead of paging the carousel.
  const pesoScrollGesture = useMemo(() => Gesture.Native(), []);

  // The on-screen bounds of the two charts and the "peso das notas" carousel
  // — checked on touch-down (see `tocouDentroDaArea`) so a touch that started
  // over one of them can never read as the CR/Carga-Horária swipe or the tab
  // pager's own swipe, even once the finger has drifted off that area. A
  // gesture race (`requireExternalGestureToFail`, below and in TabsPager)
  // only helps once the nested gesture actually recognizes — a chart with
  // too little content to scroll never does — so this check doesn't depend
  // on that at all, just on where the touch began.
  const lineChartArea = useAnimatedRef<View>();
  const barChartArea = useAnimatedRef<View>();
  const pesoArea = useAnimatedRef<View>();

  const swipeInsight = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-10, 10])
        .requireExternalGestureToFail(lineChartScrollGesture, barChartScrollGesture, pesoScrollGesture)
        .onTouchesDown((evento, manager) => {
          "worklet";
          if (tocouDentroDaArea(evento, lineChartArea) || tocouDentroDaArea(evento, barChartArea)) {
            manager.fail();
          }
        })
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
    [
      lineChartScrollGesture,
      barChartScrollGesture,
      pesoScrollGesture,
      lineChartArea,
      barChartArea,
      abaAtual,
      arrasto,
      aplicarSwipe,
    ],
  );

  // The tab pager's own left/right swipe (see TabsPager) must lose to this
  // one whenever the drag starts over the CR/Carga-Horária card below —
  // otherwise trying to flip that card would instead flip the whole page.
  useRegisterTabSwipeBlockingGesture(swipeInsight);
  // The pager also needs to lose directly to the charts' and carousel's own
  // native scroll gestures, not just to swipeInsight — when one of those wins
  // a drag, swipeInsight (which was waiting on it) fails, and if the pager
  // were only watching swipeInsight it would read that failure as its cue to
  // activate mid-scroll. Registering these too makes the pager wait on the
  // actual gesture, not on one that's already been shouldered aside.
  useRegisterTabSwipeBlockingGesture(lineChartScrollGesture);
  useRegisterTabSwipeBlockingGesture(barChartScrollGesture);
  useRegisterTabSwipeBlockingGesture(pesoScrollGesture);
  // Same touch-origin check `swipeInsight` runs above, one level up: the
  // pager must fail itself for a touch that started over any of these three
  // areas too, not just wait on a gesture race that a non-scrollable chart
  // never wins.
  useRegisterTabSwipeBlockingArea(lineChartArea);
  useRegisterTabSwipeBlockingArea(barChartArea);
  useRegisterTabSwipeBlockingArea(pesoArea);

  useEffect(() => {
    void getPeriodoCache().then((periodo) => setFimDoPeriodo(periodo?.fim ?? null));
  }, []);

  const aplicar = useCallback(
    (resposta: TrajetoriaResponse) => {
      if (!("historico" in resposta)) {
        setState({ status: "unsynced" });
        return;
      }
      const fetchedAt = new Date(resposta.fetchedAt);
      setState({
        status: "ready",
        historico: resposta.historico,
        fetchedAt,
        marcos: resposta.marcos,
      });
      setHistoricoFetchedAt(fetchedAt);
    },
    [setHistoricoFetchedAt],
  );

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

  // Depends on the link status only to re-read after the student links or
  // unlinks — never to decide *whether* to read. The stored histórico lives in
  // our own database and needs no SIGAA password to come back out.
  useEffect(() => {
    if (accessToken) {
      carregar();
    }
  }, [sigaaLink.status, accessToken, carregar]);

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
            {/* A plain re-read of our own database — offered linked or not. */}
            <Button variant="outline" size="sm" onPress={() => carregar()}>
              Tentar de novo
            </Button>
          </View>
        ) : null}

        {state.status === "unsynced" ? (
          <View className="rounded-3xl bg-surface-secondary p-5 gap-3">
            <Typography.Heading type="h6">Seus insights ainda não foram montados</Typography.Heading>
            <Typography.Paragraph type="body-sm" color="muted">
              {sigaaLink.status === "linked"
                ? "Sincronize sua conta em Perfil para buscar seu histórico escolar no SIGAA."
                : "Vincule sua conta em Perfil para buscar seu histórico escolar no SIGAA."}
            </Typography.Paragraph>
            {/* Sync now happens in one place — Perfil syncs the whole
                profile (horário + histórico) in a single press, instead of
                each tab re-scraping the same histórico on its own. */}
            <Button onPress={() => router.push("/ajustes")}>Ir para Perfil</Button>
          </View>
        ) : null}

        {state.status === "ready" ? (
          <ReadyInsights
            historico={state.historico}
            marcos={state.marcos}
            fimDoPeriodo={fimDoPeriodo}
            insight={insight}
            onInsightChange={setInsight}
            swipeInsight={swipeInsight}
            lineChartScrollGesture={lineChartScrollGesture}
            barChartScrollGesture={barChartScrollGesture}
            pesoScrollGesture={pesoScrollGesture}
            lineChartArea={lineChartArea}
            barChartArea={barChartArea}
            pesoArea={pesoArea}
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
  marcos,
  fimDoPeriodo,
  insight,
  onInsightChange,
  swipeInsight,
  lineChartScrollGesture,
  barChartScrollGesture,
  pesoScrollGesture,
  lineChartArea,
  barChartArea,
  pesoArea,
  abaAtual,
  arrasto,
}: {
  historico: Historico;
  marcos: MarcosSemestralizacao | null;
  fimDoPeriodo: string | null;
  insight: Insight;
  onInsightChange: (insight: Insight) => void;
  swipeInsight: PanGesture;
  lineChartScrollGesture: NativeGesture;
  barChartScrollGesture: NativeGesture;
  pesoScrollGesture: NativeGesture;
  lineChartArea: AnimatedRef<View>;
  barChartArea: AnimatedRef<View>;
  pesoArea: AnimatedRef<View>;
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
  const impactoVariacaoCr = formatarImpacto(variacaoCr);
  const textoVariacaoCr = impactoVariacaoCr === "—" ? impactoVariacaoCr : `${impactoVariacaoCr}*`;
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
  const estiloPontoCargaHoraria = useAnimatedStyle(() => ({
    opacity: interpolate(abaAtual.value, [0, 1], [1, 0.3], Extrapolation.CLAMP),
  }));
  const estiloPontoCr = useAnimatedStyle(() => ({
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
            <Tabs.Trigger value="cargaHoraria">
              <Tabs.Label>Carga Horária</Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger value="cr">
              <Tabs.Label>CR</Tabs.Label>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>

        {/* The plain "sincronizado em" line is gone — that freshness now
            lives on Início's badge, fed by every screen that reads the
            histórico (see sync-freshness-context). Only the actionable
            nudge survives here, since it's not about freshness but about a
            specific missing-notas gap. */}
        {desatualizado ? (
          <Typography.Paragraph type="body-xs" color="muted">
            O semestre acabou e seu histórico ainda tem matérias em curso — sincronize em Perfil para ver
            as notas.
          </Typography.Paragraph>
        ) : null}

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
                        Carga horária
                      </Typography.Paragraph>
                      <Typography.Heading type="h3" className="font-mono">
                        {total.integralizada.toLocaleString("pt-BR")} h
                      </Typography.Heading>
                    </View>
                    <View ref={barChartArea} collapsable={false}>
                      <BarChart barras={barrasCargaHoraria} altura={70} scrollGesture={barChartScrollGesture} />
                    </View>
                  </View>
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
                          {/* The "*" only appears beside an actual number, not
                              the "—" em-dash — see the matching footnote at
                              the bottom of the CR breakdown card below, which
                              explains it's in centésimos. Anchored here too,
                              not just there, since this is the first such
                              value a person sees. */}
                          {textoVariacaoCr}
                        </Typography.Paragraph>
                      </View>
                    </View>
                    <View ref={lineChartArea} collapsable={false}>
                      <LineChart pontos={pontosCr} altura={70} scrollGesture={lineChartScrollGesture} />
                    </View>
                  </View>
                </Animated.View>
              </View>
              {/* Signals the card is a carousel — the drag itself already
                  worked before these dots existed, nothing here changes it. */}
              <View className="flex-row justify-center gap-1.5 mt-3">
                <Animated.View
                  className="w-1.5 h-1.5 rounded-full bg-foreground"
                  style={estiloPontoCargaHoraria}
                />
                <Animated.View className="w-1.5 h-1.5 rounded-full bg-foreground" style={estiloPontoCr} />
              </View>
            </View>
          </GestureDetector>

          <Animated.View
            className="rounded-t-md rounded-b-3xl bg-surface-secondary overflow-hidden"
            style={estiloAlturaCardInferior}
          >
            {/* Horizontal padding moved off this shared wrapper and onto each
                variant's own content (see CargaHorariaResumo/ImpactoCrCard):
                the carousel inside ImpactoCrCard needs its pages to span the
                card's full, unpadded width so paging math lines up with what
                `onLayout` measures — carrying px here would leave adjacent
                pages' content flush against each other mid-swipe. */}
            <View className="py-4 gap-4" onLayout={aoMedirCardInferior}>
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
                  pesoArea={pesoArea}
                />
              )}
            </View>
          </Animated.View>
        </View>
      </View>

      {/* Page footer — covers every "*" on the screen (the two titles inside
          the CR breakdown card, plus `cr-variacao` above it) without
          repeating itself, and without living inside the card it's
          footnoting. Only relevant on the CR side, where those "*"s are. */}
      {insight === "cr" ? (
        <Typography.Paragraph type="body-xs" color="muted">
          * Valores de impacto representados em centésimos
        </Typography.Paragraph>
      ) : null}
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
    <View className="px-4 gap-4">
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
    </View>
  );
}

/**
 * One row of the "impacto por semestre" chart: a bar diverging from a center
 * zero line, green to the right for a term that raised the CR, red to the
 * left for one that lowered it. `maximo` is the biggest |delta| across the
 * whole series (see `ImpactoCrCard`) — the scale is relative to the
 * student's own history, not a fixed CR-point guess: whichever term moved
 * the CR the most fills the bar all the way, every other term is
 * proportional to that. A flat history (every term moved the CR by the same
 * amount) makes every bar full, which is the correct read — there's no
 * "biggest mover" to contrast against.
 */
function LinhaImpactoPeriodo({
  rotulo,
  delta,
  maximo,
}: {
  rotulo: string;
  delta: number | null;
  maximo: number;
}): JSX.Element {
  // Same "rounds to 0 centésimos" check `formatarImpacto` makes internally —
  // kept in sync here so a near-zero float (0.001, never a real term-to-term
  // move, just accumulation noise) doesn't draw a sliver of colored bar next
  // to a value that itself already renders as "—". A term with no move reads
  // exactly like the first term (which has nothing to compare against at
  // all): no bar, just the center line, muted "—".
  const semImpacto = delta === null || Math.round(Math.abs(delta) * 100) === 0;
  const magnitude = semImpacto || maximo === 0 ? 0 : Math.min(Math.abs(delta as number) / maximo, 1);
  return (
    <View className="flex-row items-center gap-2.5">
      <Typography.Paragraph type="body-xs" color="muted" className="font-mono" style={{ width: 32 }}>
        {rotulo}
      </Typography.Paragraph>
      <View className="flex-1 h-3.5 relative justify-center">
        <View className="absolute self-center h-full w-px bg-white/10" />
        {!semImpacto ? (
          <View
            className={`absolute h-2.5 rounded-sm ${(delta as number) > 0 ? "bg-success" : "bg-danger"}`}
            style={
              (delta as number) > 0
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
          semImpacto ? "text-muted" : (delta as number) > 0 ? "text-success" : "text-danger"
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
 * moved the CR, then a carousel — one page per term — spelling out every
 * graded component's own pull on the CR that term, biggest riser first down
 * to the biggest drag.
 */
function ImpactoCrCard({
  periodos,
  cursados,
  pesoScrollGesture,
  pesoArea,
}: {
  periodos: PeriodoTrajetoria[];
  cursados: ComponenteCursado[];
  pesoScrollGesture: NativeGesture;
  pesoArea: AnimatedRef<View>;
}): JSX.Element {
  const semestresOrdenados = periodos.map((periodo) => periodo.semestre);
  const serieCr = calcularCrAcumulado(cursados, semestresOrdenados);
  const deltas = deltasCrPorPeriodo(serieCr);
  // The biggest single-term move in this student's own series — see
  // `LinhaImpactoPeriodo`'s docstring for why this beats a fixed constant.
  const maiorDelta = Math.max(0, ...deltas.filter((d): d is number => d !== null).map(Math.abs));

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

  if (periodos.length === 0) {
    return (
      <Typography.Paragraph type="body-sm" color="muted" className="px-4">
        Ainda não há notas suficientes para mostrar o impacto no CR.
      </Typography.Paragraph>
    );
  }

  return (
    <View className="gap-4">
      <View className="px-4 gap-2">
        <Typography.Paragraph type="body-xs" color="muted">
          Impacto no CR por semestre*
        </Typography.Paragraph>
        <View className="gap-2">
          {periodos.map((periodo, indice) => (
            <LinhaImpactoPeriodo
              key={periodo.semestre}
              rotulo={rotuloSemestreCurto(periodo.semestre)}
              delta={deltas[indice]}
              maximo={maiorDelta}
            />
          ))}
        </View>
      </View>

      <View className="h-px bg-white/10 mx-4" />

      <View className="gap-2.5">
        <Typography.Paragraph type="body-xs" color="muted" className="px-4">
          {periodoAtivo ? `Notas por impacto* • ${rotuloSemestreCurto(periodoAtivo.semestre)}` : "Notas por impacto*"}
        </Typography.Paragraph>
        {/* `pesoScrollGesture` keeps this drag from reading as the
            CR/Carga-Horária swipe (or the tab pager's, one level up) — same
            relationship the line/bar charts already have, see InsightsTab.
            `pesoArea` backs that same relationship for a touch that started
            here and then drifted outside these bounds.

            No horizontal padding here or on the ScrollView itself — the
            carousel has to span the card's full, unpadded width so its
            pages' widths (and therefore the paging math) match exactly what
            `onLayout` measures below. Each page carries its own `px-4`
            instead (see the mapped `View` right below), which is what
            actually keeps a page's content off the card's edges — without
            it, this card's own `p-4` used to eat into every page equally,
            but adjacent pages' content still touched at the seam mid-swipe:
            paging showed exactly one page-width at a time, so there was
            never a gap between one page's trailing edge and the next page's
            leading edge for that padding to create. */}
        <View ref={pesoArea} collapsable={false}>
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
                const impactos = impactosPorSemestre(cursados, periodo.semestre);
                return (
                  // `overflow-hidden` is what actually enforces the page width
                  // below: `numberOfLines={1}` only decides *where* a name
                  // truncates once Yoga has already given its Text a bounded
                  // width — it doesn't force that bound to exist. Without
                  // this, a long, space-less nome could still render past
                  // this page's edge and visibly bleed into the carousel's
                  // next one instead of getting clipped here.
                  <View
                    key={periodo.semestre}
                    style={{ width: larguraCarrossel || undefined }}
                    className="gap-2.5 overflow-hidden px-4"
                  >
                    {impactos.length > 0 ? (
                      impactos.map((item) => {
                        // Same zero-centésimos check `formatarImpacto` makes
                        // internally — kept in sync here just to pick the
                        // neutral color for a value it renders as "—".
                        const semImpacto = Math.round(Math.abs(item.impacto) * 100) === 0;
                        return (
                          <View key={item.codigo} className="flex-row items-center justify-between gap-3">
                            <View className="flex-1 shrink">
                              <Typography.Paragraph type="body-sm" weight="medium" numberOfLines={1}>
                                {item.nome}
                              </Typography.Paragraph>
                              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                                {item.codigo} · nota {formatarNota(item.nota)}
                              </Typography.Paragraph>
                            </View>
                            <Typography.Paragraph
                              type="body-sm"
                              weight="semibold"
                              className={`font-mono shrink-0 ${
                                semImpacto ? "text-muted" : item.impacto > 0 ? "text-success" : "text-danger"
                              }`}
                            >
                              {formatarImpacto(item.impacto)}
                            </Typography.Paragraph>
                          </View>
                        );
                      })
                    ) : (
                      <Typography.Paragraph type="body-xs" color="muted">
                        Sem notas suficientes nesse semestre.
                      </Typography.Paragraph>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </GestureDetector>
        </View>
        {periodos.length > 1 ? (
          <View className="flex-row justify-center gap-1.5 px-4">
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
    </View>
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
