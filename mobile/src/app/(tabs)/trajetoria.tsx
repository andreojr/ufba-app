import { Button, Menu, Tabs, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Pressable, RefreshControl, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector, type NativeGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { DownloadProgressBar } from "@/components/DownloadProgressBar";
import { describeApiError } from "@/lib/api-errors";
import { ApiError, getTrajetoria, postTrajetoriaSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { HISTORICO_STAGES } from "@/lib/download-progress";
import { cargaHorariaColor, gradeColor } from "@/lib/mock-data";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { identidadeAppBar } from "@/lib/user-name";
import {
  agruparPorAno,
  agruparPorSemestre,
  calcularCrAcumulado,
  componentesComCargaHorariaContada,
  contarFaltantes,
  formatarCoeficiente,
  formatarImpacto,
  formatarNota,
  historicoDesatualizado,
  impactoNoCr,
  percentualConcluido,
  direcaoDoSwipe,
  poolPlanejavel,
  proximoInsight,
  rotuloSituacao,
  rotulosPorAno,
  somarCargaHoraria,
  variacaoUltimoPeriodo,
  zonasDePlanejamento,
  type AnoTrajetoria,
  type Insight,
} from "@/lib/trajetoria";
import type { ComponenteCursado, Historico, ItemPlano, TrajetoriaResponse } from "@/lib/types";

type LoadState =
  | { status: "loading" }
  | { status: "unsynced" }
  | { status: "error"; message: string }
  | { status: "ready"; historico: Historico; fetchedAt: Date; plano: ItemPlano[] };

/** The planner's catch-all: everything not assigned to a term sits here. */
const ZONA_SEM_PERIODO = "pool";

/** How many upcoming terms the planner offers as drop zones. */
const ZONAS_FUTURAS = 2;

/**
 * Which term each pending component was put in, keyed by código. Keyed rather
 * than a list per zone so a move is a single overwrite: a component has one
 * term by construction and cannot end up listed under two.
 */
type Plano = Record<string, string>;

/**
 * "Em curso" would be a lie once the term's end date has passed: the MATR rows
 * mean only that our copy of the transcript predates the grades. Naming the
 * wait is what the badge can honestly say, and it agrees with the nudge the
 * same condition puts above.
 */
function rotuloPeriodo(emCurso: boolean, desatualizado: boolean): string {
  if (!emCurso) {
    return "Concluído";
  }
  return desatualizado ? "Aguardando notas" : "Em curso";
}

/**
 * Sync failures need one message the shared helper cannot give. A transcript
 * the parser refuses — for breaking the document's own invariants — comes back
 * as a bare 500, indistinguishable from a server hiccup but deterministic:
 * "Tente novamente" would send the student round a loop that fails identically
 * every time. So anything other than the two statuses the shared helper names
 * gets copy that promises no retry and points at the one thing that still
 * works, the PDF download on the Documentos tab.
 *
 * Bad credentials, rate limits and a dead connection keep the shared wording —
 * those really are retryable, and they are the same failures everywhere else.
 */
function descreverErroSync(error: unknown): string {
  // A status at all means a response came back, which is the only case where
  // the document itself can be what failed.
  const status = error instanceof ApiError ? error.status : undefined;
  if (status !== undefined && status !== 401 && status !== 429) {
    return "Pode ser um problema no documento. Você ainda pode baixar o PDF em Documentos.";
  }
  return describeApiError(error);
}

/** The saved plan, in the shape the zones read. Unplaced items stay out of it. */
function planoSalvo(plano: ItemPlano[]): Plano {
  return Object.fromEntries(
    plano.flatMap((item) => (item.semestre ? [[item.codigo, item.semestre] as const] : [])),
  );
}

export default function TrajetoriaTab(): JSX.Element {
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const identidade = identidadeAppBar(auth.status === "signedIn" ? auth.user : null);
  const mutedColor = useThemeColor("muted");

  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Moves the student made in this session, on top of the plan the server sent.
  // Persisting them is a later task, so leaving the screen drops them — but a
  // refresh must not, since nothing about the plan changed. Only a re-sync
  // clears them, and there the server's plan is the authority.
  const [movimentos, setMovimentos] = useState<Plano>({});
  const [refreshing, setRefreshing] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [erroSync, setErroSync] = useState<string | null>(null);
  const [fimDoPeriodo, setFimDoPeriodo] = useState<string | null>(null);
  const [insight, setInsight] = useState<Insight>("cr");

  // `proximoInsight` is a plain JS function, not a worklet — it has to run
  // back on the JS thread. The functional `setInsight` update means this
  // closure never needs `insight` itself, so it's stable across renders.
  const aplicarSwipe = useCallback((translationX: number, translationY: number) => {
    setInsight((atual) => proximoInsight(atual, translationX, translationY));
  }, []);

  // The UI-thread half of `insight`: which panel is settled at (0 = cr, 1 =
  // cargaHoraria) and how far the live drag has pulled it from there. Neither
  // is React state on purpose — a re-render mid-gesture (tearing down and
  // rebuilding whichever chart's ScrollView is on screen, gesture and all)
  // is what crashed the app when the tab switch used to be decided this
  // early. These two values instead let the content track the finger, and
  // `setInsight` below only ever fires once, from `onEnd`, exactly like the
  // laggy-but-safe version this replaces — the only difference is the
  // content now visibly follows the drag the whole way there.
  const abaAtual = useSharedValue(insight === "cr" ? 0 : 1);
  const arrasto = useSharedValue(0);

  // A tab tapped directly (not swiped) still has to move `abaAtual` — this is
  // the only place besides the gesture below that touches it.
  useEffect(() => {
    abaAtual.value = withTiming(insight === "cr" ? 0 : 1, { duration: 220 });
  }, [insight, abaAtual]);

  // One native gesture per chart, not one shared between them: both
  // LineChart and BarChart stay mounted at all times now (see ReadyTrajetoria
  // — a mid-gesture unmount is what crashed), so each needs its own stable
  // handle to its own ScrollView for `requireExternalGestureToFail` below to
  // point at. Memoized so the reference stays the same object across
  // renders — a fresh one each render would only ever describe *that*
  // render's chart to the relation, breaking it the moment either side
  // re-rendered independently.
  const lineChartScrollGesture = useMemo(() => Gesture.Native(), []);
  const barChartScrollGesture = useMemo(() => Gesture.Native(), []);

  // Lives here, wrapping the whole scrollable page, rather than just the
  // insight card: a swipe anywhere on the trajectory — over the timeline, the
  // planner, wherever the thumb happens to land — switches CR/Carga Horária,
  // not just one over the card itself. `failOffsetY` hands anything more
  // vertical than horizontal straight to the ScrollView underneath (and its
  // pull-to-refresh), so this never fights the page's own scroll.
  // `requireExternalGestureToFail` is the other half: a plain ScrollView
  // doesn't automatically arbitrate against a custom Pan like this one, so
  // without it the two raced for the same horizontal drag over the chart.
  // Now this one waits — a touch that starts on the chart's own horizontal
  // scroll is claimed by that scroll, full stop, never the tab switch.
  const swipeInsight = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-10, 10])
        .requireExternalGestureToFail(lineChartScrollGesture, barChartScrollGesture)
        .onChange((evento) => {
          // Clamped, not rubber-banded: there's nothing past the first or
          // last tab to peek at, so a drag that direction simply doesn't
          // move the content at all.
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
          // Settles the drag back to zero regardless of whether it landed on
          // a new tab — `abaAtual` above already carries the new resting
          // position, so this is relative to that, not a snap back to where
          // the drag started.
          arrasto.value = withTiming(0, { duration: 220 });
          if (direcao) {
            scheduleOnRN(aplicarSwipe, evento.translationX, evento.translationY);
          }
        }),
    [lineChartScrollGesture, barChartScrollGesture, abaAtual, arrasto, aplicarSwipe],
  );

  // No request of its own: the home screen writes this cache after every
  // schedule fetch, and reading it is what lets this screen tell whether the
  // term the transcript is still showing as "em curso" has already ended.
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
      plano: resposta.plano,
    });
    // Fresh data on screen must not keep a stale failure under it contradicting
    // what the student is now reading.
    setErroSync(null);
  }, []);

  // Reading the stored trajectory needs no SIGAA credential — the JWT already
  // scopes it to this student. Only the re-scrape below does.
  const carregar = useCallback(
    async (silent = false) => {
      if (!accessToken) {
        return;
      }
      if (!silent) {
        setState({ status: "loading" });
      }
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await carregar(true);
    setRefreshing(false);
  }, [carregar]);

  const sincronizar = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    const credentials = await getSigaaCredentials();
    if (!credentials) {
      // Reads as one sentence after the prefix the error line already carries.
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
      // Only here: a re-sync replaces the transcript the moves were made
      // against, and the plan the server sent back is the authority. A plain
      // refresh must leave them be — see onRefresh.
      setMovimentos({});
    } catch (error) {
      console.warn("Failed to sync trajetória", error);
      // The state deliberately survives the failure: a student looking at last
      // term's grades should keep seeing them when a re-sync fails.
      setErroSync(descreverErroSync(error));
    } finally {
      setSincronizando(false);
    }
  }, [accessToken, aplicar]);

  function moverComponente(codigo: string, zona: string): void {
    setMovimentos((atual) => ({ ...atual, [codigo]: zona }));
  }

  const erro = erroSync ? (
    <Typography.Paragraph type="body-xs" className="text-danger">
      Não deu para sincronizar seu histórico. {erroSync}
    </Typography.Paragraph>
  ) : null;

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Minha trajetória" {...identidade} />
      <GestureDetector gesture={swipeInsight}>
        <ScrollView
          testID="trajetoria-scroll"
          className="flex-1 px-6"
          contentContainerClassName="gap-5 pb-8"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {state.status === "loading" ? (
            <View className="rounded-3xl bg-surface-secondary p-8 items-center">
              <Typography.Paragraph type="body-sm" color="muted">
                Carregando sua trajetória…
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
              <Typography.Heading type="h6">Sua trajetória ainda não foi montada</Typography.Heading>
              <Typography.Paragraph type="body-sm" color="muted">
                Vamos buscar seu histórico escolar no SIGAA e montar sua trajetória. Leva alguns
                segundos.
              </Typography.Paragraph>

              {/* Above the button, never below it: pressing sync is the moment the
                  student hands us a document carrying their CPF, RG and date of
                  birth, so both halves — what we keep and what we throw away —
                  have to be readable before the press. */}
              <View className="rounded-2xl bg-white/[0.04] p-3.5 gap-1.5">
                <Typography.Paragraph type="body-xs" color="muted">
                  <Typography.Paragraph type="body-xs" weight="medium">
                    O que fica guardado:{" "}
                  </Typography.Paragraph>
                  suas matérias, notas e carga horária — é o que monta esta tela.
                </Typography.Paragraph>
                <Typography.Paragraph type="body-xs" color="muted">
                  <Typography.Paragraph type="body-xs" weight="medium">
                    O que não fica:{" "}
                  </Typography.Paragraph>
                  CPF, RG e data de nascimento. Eles estão no documento, mas são descartados na
                  leitura.
                </Typography.Paragraph>
              </View>

              <Button onPress={sincronizar} isDisabled={sincronizando}>
                {sincronizando ? "Sincronizando…" : "Sincronizar histórico"}
              </Button>

              {/* The wait is ~40s of server-side scraping. A disabled button with a
                  changed label is not enough feedback for that long, and the
                  calibrated stage model for exactly this request already exists. */}
              {sincronizando ? <DownloadProgressBar stages={HISTORICO_STAGES} /> : null}
              {erro}
            </View>
          ) : null}

          {state.status === "ready" ? (
            <ReadyTrajetoria
              historico={state.historico}
              fetchedAt={state.fetchedAt}
              fimDoPeriodo={fimDoPeriodo}
              plano={state.plano}
              movimentos={movimentos}
              onMover={moverComponente}
              onSincronizar={sincronizar}
              sincronizando={sincronizando}
              erro={erro}
              mutedColor={mutedColor}
              insight={insight}
              onInsightChange={setInsight}
              lineChartScrollGesture={lineChartScrollGesture}
              barChartScrollGesture={barChartScrollGesture}
              abaAtual={abaAtual}
              arrasto={arrasto}
            />
          ) : null}
        </ScrollView>
      </GestureDetector>
    </View>
  );
}

function ReadyTrajetoria({
  historico,
  fetchedAt,
  fimDoPeriodo,
  plano,
  movimentos,
  onMover,
  onSincronizar,
  sincronizando,
  erro,
  mutedColor,
  insight,
  onInsightChange,
  lineChartScrollGesture,
  barChartScrollGesture,
  abaAtual,
  arrasto,
}: {
  historico: Historico;
  fetchedAt: Date;
  fimDoPeriodo: string | null;
  plano: ItemPlano[];
  movimentos: Plano;
  onMover: (codigo: string, zona: string) => void;
  onSincronizar: () => void;
  sincronizando: boolean;
  erro: JSX.Element | null;
  mutedColor: string;
  // Lifted to the tab's top level: the swipe gesture that also drives this
  // lives up there now, wrapping the whole scrollable page rather than just
  // this card.
  insight: Insight;
  onInsightChange: (insight: Insight) => void;
  // Handed straight through to their respective, always-mounted chart — see
  // each one's `scrollGesture` prop for why.
  lineChartScrollGesture: NativeGesture;
  barChartScrollGesture: NativeGesture;
  // The sliding card's UI-thread position — see `swipeInsight` for how these
  // move, and this component's own `estiloTrilha` for how they're read.
  abaAtual: SharedValue<number>;
  arrasto: SharedValue<number>;
}): JSX.Element {
  const { total } = historico.cargaHoraria;
  const percentual = percentualConcluido(total);
  const periodos = agruparPorSemestre(historico.cursados);
  const anos = agruparPorAno(periodos);
  const pendentes = poolPlanejavel(historico.pendentesObrigatorios);
  // Unlike `pendentes` above (what the planner may still place), this also
  // counts a component the student is already taking: enrolled-but-ungraded
  // is still not done.
  const faltantes = contarFaltantes(historico.pendentesObrigatorios);
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

  // The term in progress, or — on a transcript with nothing enrolled — the last
  // one on it, so the planner still has somewhere to count forward from.
  const semestreAtual =
    periodos.find((periodo) => periodo.emCurso)?.semestre ??
    periodos[periodos.length - 1]?.semestre;
  const zonas = semestreAtual
    ? zonasDePlanejamento(semestreAtual, historico.prazoConclusaoMaximo, ZONAS_FUTURAS)
    : [];
  const salvo = planoSalvo(plano);

  // Both the row's own width and the two panels' widths are set from this
  // exact same pixel number the translateX below reads — a `"50%"`/`"200%"`
  // version (Yoga resolving one percentage against another, itself against
  // the measured width) let the two drift by a few pixels, which was the
  // sliver of the next panel peeking in at rest. The plain `useState` mirror
  // is what lets a plain (non-animated) `style` read it at all — a shared
  // value's `.value` is only readable inside a worklet.
  //
  // Measured on the plain View just *inside* the card's own padding, not the
  // padded card itself: `onLayout` reports a view's own border-box, padding
  // included, which is wider than what's actually visible once that padding
  // is accounted for — using it directly would have translated by more than
  // one panel's real width.
  const larguraCard = useSharedValue(0);
  const [larguraCardPx, setLarguraCardPx] = useState(0);
  const aoMedirCard = (evento: LayoutChangeEvent): void => {
    const { width } = evento.nativeEvent.layout;
    larguraCard.value = width;
    setLarguraCardPx(width);
  };

  // Drives the sliding card: `abaAtual` (0 = cr, 1 = cargaHoraria) plus the
  // live `arrasto` offset, both set by `swipeInsight` up in TrajetoriaTab —
  // this is the only place either is read.
  const estiloTrilha = useAnimatedStyle(() => ({
    transform: [{ translateX: -abaAtual.value * larguraCard.value + arrasto.value }],
  }));

  return (
    <>
      <View className="gap-5">
        <Tabs value={insight} onValueChange={(valor) => onInsightChange(valor as Insight)} variant="secondary">
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

        {/* The insight (CR or carga horária) and the course-wide progress
            render as one visually connected group: a hairline gap and
            matching soft inner corners join the two cards — same treatment
            ajustes.tsx gives the profile + academic info cards. */}
        <View className="gap-0.5">
          <View className="rounded-t-3xl rounded-b-md bg-surface-secondary p-4">
            {/* `overflow-hidden` sits on this plain View, one level *inside*
                the card's own padding — not on the padded card above. CSS/RN
                clips to an element's own outer edge, padding included, so
                putting it on the padded card let the sliding row bleed into
                that padding's reserved space on the far side before getting
                cut — exactly the sliver that was showing. This wrapper's own
                edge has no padding of its own, so its clip boundary is
                exactly the visible width, no gap to bleed into. Its width is
                also what `onLayout` below measures, for the same reason. */}
            <View className="overflow-hidden" onLayout={aoMedirCard}>
              {/* Both panels stay mounted and laid out at all times, side by
                  side in a row twice the card's width — only `translateX`
                  moves which one shows, never a conditional mount/unmount or
                  a `display` toggle. A version that hid the inactive one
                  that way crashed the app: toggling `display` on a subtree
                  holding a `Gesture.Native()` (the chart's own scroll — see
                  `requireExternalGestureToFail`) recycles the underlying
                  native view mid-gesture, and the gesture relation doesn't
                  survive that. Sliding sidesteps the question entirely —
                  nothing is ever hidden or rebuilt. */}
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
                      {/* vs. o período anterior: sem cor de destaque quando é
                          null ou zero — "sem mudança" não deve competir
                          visualmente com uma alta ou queda real. */}
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
                    {/* Just the hours done — the total is fixed at the end of
                        the progress bar below, not repeated here. Same
                        heading size as the CR tab's value: one card, one
                        standard of emphasis. */}
                    <Typography.Heading type="h3" className="font-mono">
                      {total.integralizada.toLocaleString("pt-BR")} h
                    </Typography.Heading>
                  </View>
                  <BarChart barras={barrasCargaHoraria} altura={70} scrollGesture={barChartScrollGesture} />
                </View>
              </Animated.View>
            </View>
          </View>

          <View className="rounded-t-md rounded-b-3xl bg-surface-secondary p-4 gap-1.5">
            <View className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
              <View
                className="h-full rounded-full bg-accent"
                style={{ width: `${percentual}%` }}
              />
            </View>
            {/* The course's total requirement, fixed at the bar's own end —
                it doesn't change tab to tab, so it isn't repeated in the
                value above like it used to be. */}
            <Typography.Paragraph type="body-xs" color="muted" align="end" className="font-mono">
              {total.exigida.toLocaleString("pt-BR")} h
            </Typography.Paragraph>
            <View className="flex-row items-center justify-between">
              <Typography.Paragraph type="body-xs" color="muted">
                {/* Only the number itself is emphasised — the sentence
                    around it stays body text, same as "faltam N matérias"
                    beside it. */}
                <Typography.Paragraph type="body-sm" weight="bold" className="font-mono">
                  {percentual}%
                </Typography.Paragraph>{" "}
                do curso concluído
              </Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted">
                {faltantes === 1 ? "falta 1 matéria" : `faltam ${faltantes} matérias`}
              </Typography.Paragraph>
            </View>
          </View>
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

      <LinhaDoTempo
        anos={anos}
        desatualizado={desatualizado}
        insight={insight}
        cursados={historico.cursados}
      />

      <View className="gap-5">
        {/* Everything around the planner now reads as the student's real
            transcript — the coefficient, the grades, the periods — so a
            dragged card reads as saved too. It is not: `movimentos` is
            session-only state, and nothing here writes it back. */}
        <Typography.Paragraph type="body-xs" color="muted">
          Ainda não salva: mudar uma matéria de período aqui vale só para esta
          visita à tela — ao sair, ela volta para onde estava.
        </Typography.Paragraph>
        {[...zonas, ZONA_SEM_PERIODO].map((zona) => {
          const semPeriodo = zona === ZONA_SEM_PERIODO;
          const componentes = pendentes.filter((pendente) => {
            const atual = movimentos[pendente.codigo] ?? salvo[pendente.codigo];
            // A term the planner no longer offers (past the deadline, or beyond
            // the two it shows) falls back to the pool rather than taking its
            // component off the screen entirely.
            return atual && zonas.includes(atual) ? atual === zona : semPeriodo;
          });
          const vazia = componentes.length === 0;
          return (
            <View key={zona} className="gap-2.5">
              <View className="flex-row items-center gap-2.5">
                <Typography.Paragraph weight="medium">
                  {semPeriodo ? "Sem período" : zona}
                </Typography.Paragraph>
                <View className="rounded-full bg-white/5 px-2 py-1">
                  <Typography.Paragraph type="body-xs" color="muted">
                    {semPeriodo
                      ? `a cursar · ${componentes.length}`
                      : vazia
                        ? "vazio"
                        : `${componentes.length} ${componentes.length === 1 ? "matéria" : "matérias"}`}
                  </Typography.Paragraph>
                </View>
                <View className="flex-1 h-px bg-white/10" />
              </View>
              <View
                className={`gap-2 rounded-[20px] p-2 min-h-16 ${
                  vazia ? "border border-dashed border-white/20" : ""
                }`}
              >
                {componentes.map((componente) => (
                  <Menu key={componente.codigo}>
                    <Menu.Trigger asChild>
                      <Pressable className="rounded-2xl bg-surface-secondary p-3 flex-row items-center gap-2.5">
                        <AppIcon name="IconCheck" size={18} color={mutedColor} />
                        <View className="flex-1 gap-0.5">
                          <Typography.Paragraph weight="medium">
                            {componente.nome}
                          </Typography.Paragraph>
                          <Typography.Paragraph type="body-xs" color="muted">
                            {componente.codigo} ·{" "}
                            <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                              {componente.cargaHoraria} h
                            </Typography.Paragraph>
                          </Typography.Paragraph>
                        </View>
                      </Pressable>
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Overlay />
                      <Menu.Content presentation="popover" width={220}>
                        <Menu.Label>Mover para</Menu.Label>
                        {[...zonas, ZONA_SEM_PERIODO]
                          .filter((destino) => destino !== zona)
                          .map((destino) => (
                            <Menu.Item
                              key={destino}
                              onPress={() => onMover(componente.codigo, destino)}
                            >
                              <Menu.ItemTitle>
                                {destino === ZONA_SEM_PERIODO ? "Sem período" : destino}
                              </Menu.ItemTitle>
                            </Menu.Item>
                          ))}
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu>
                ))}
                {vazia ? (
                  <View className="py-3.5 px-1.5 items-center">
                    <Typography.Paragraph type="body-sm" color="muted">
                      {semPeriodo
                        ? "Tudo planejado."
                        : "Nenhuma matéria planejada para este período."}
                    </Typography.Paragraph>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

/**
 * The trajectory grid itself: one row per year, its periods side by side,
 * connected top to bottom by the accent dots and line down the left edge —
 * chronological order top to bottom, ending in the linha de chegada card.
 */
function LinhaDoTempo({
  anos,
  desatualizado,
  insight,
  cursados,
}: {
  anos: AnoTrajetoria[];
  desatualizado: boolean;
  insight: Insight;
  cursados: ComponenteCursado[];
}): JSX.Element {
  const accentColor = useThemeColor("accent");
  return (
    <View>
      {anos.map((anoBloco) => {
        // A year only reads as done once every period on it is — one
        // "Em curso"/"Aguardando notas" left is still a year in progress.
        const anoConcluido = anoBloco.periodos.every((periodo) => !periodo.emCurso);
        return (
        <View key={anoBloco.ano} className="flex-row gap-3">
          <View className="w-3 items-center">
            <View
              className={`w-2.5 h-2.5 rounded-full mt-1 ${anoConcluido ? "bg-success" : "bg-accent"}`}
            />
            <View className="flex-1 w-px bg-white/15" />
          </View>
          <View className="flex-1 gap-2.5 pb-5">
            <Typography.Paragraph weight="medium" className="font-mono">
              {anoBloco.ano}
            </Typography.Paragraph>
            <View className="gap-3">
              {anoBloco.periodos.map((periodo) => (
                <View key={periodo.semestre} className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <Typography.Paragraph type="body-sm" weight="medium" className="font-mono">
                      {periodo.semestre}
                    </Typography.Paragraph>
                    <View
                      className={`rounded-full px-2 py-0.5 ${
                        periodo.emCurso ? "bg-accent-soft" : "bg-success-soft"
                      }`}
                    >
                      <Typography.Paragraph
                        type="body-xs"
                        className={periodo.emCurso ? "text-accent" : "text-success"}
                      >
                        {rotuloPeriodo(periodo.emCurso, desatualizado)}
                      </Typography.Paragraph>
                    </View>
                  </View>
                  {/* One box per período, matérias flowing left to right and
                      wrapping — not a single column anymore. Each card sets
                      its own min width below and lets flex-wrap decide how
                      many fit per row. */}
                  <View className="flex-row flex-wrap gap-2">
                    {periodo.componentes.map((componente) => (
                      <MateriaCard
                        key={`${componente.semestre}-${componente.codigo}`}
                        componente={componente}
                        insight={insight}
                        cursados={cursados}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
        );
      })}

      <View className="flex-row gap-3">
        <View className="w-3 items-center">
          <View className="w-2.5 h-2.5 rounded-full bg-accent mt-1" />
        </View>
        <View className="flex-1 rounded-2xl bg-surface-secondary p-3.5 flex-row items-center gap-2.5">
          <AppIcon name="IconFlag" size={20} color={accentColor} />
          <Typography.Paragraph weight="medium">Linha de chegada</Typography.Paragraph>
        </View>
      </View>
    </View>
  );
}

/**
 * A matéria card in the grid. What sits on its right depends on the selected
 * tab: the CR tab pairs the grade with how much that grade pulls the overall
 * CR up or down; the carga horária tab shows only the hours, no grade at all.
 */
function MateriaCard({
  componente,
  insight,
  cursados,
}: {
  componente: ComponenteCursado;
  insight: Insight;
  cursados: ComponenteCursado[];
}): JSX.Element {
  const rotulo = rotuloSituacao(componente.situacao);
  const nota = formatarNota(componente.nota);
  const impacto = insight === "cr" && componente.nota !== null ? impactoNoCr(cursados, componente.codigo) : null;
  const mutedColor = useThemeColor("muted");
  // Trancada, cancelada, etc.: no grade at all, so nothing on this card
  // moves the CR — the dashed border and faded fill are what say "it's here,
  // but it doesn't count" without needing another line of text.
  const naoConta = componente.nota === null;

  return (
    // Narrow enough to sit two (or more) per row in the período box's
    // flex-wrap above — `flexBasis`/`minWidth` together are what let it grow
    // past that floor when there's room, but never shrink below it.
    <View
      className={`rounded-2xl p-3 justify-between gap-1.5 ${
        naoConta
          ? "bg-surface-secondary/40 border border-dashed border-white/20 opacity-60"
          : "bg-surface-secondary"
      }`}
      style={{ minWidth: 140, flexGrow: 1, flexBasis: 140 }}
    >
      {/* A nota 10 gets its own sticker — a blue circle poking out past the
          card's own top-right corner. Absolute + a negative offset is what
          lets it bleed outside the card's bounds instead of being clipped to
          it; nothing here sets `overflow-hidden`, so it's free to. */}
      {componente.nota === 10 ? (
        <View
          className="absolute items-center justify-center rounded-full bg-blue-500 border-2 border-background"
          style={{ top: -6, right: -6, width: 24, height: 24 }}
        >
          <AppIcon name="IconStar" size={13} color="white" />
        </View>
      ) : null}
      {/* Its own group, separate from the badge/nota row below: the row's
          parent stretches every card in a flex-wrap line to match the
          tallest one, and `justify-between` on that parent is what pins this
          row to the bottom of that stretched height instead of leaving it
          floating right under a short nome with dead space beneath it. */}
      <View className="gap-0.5">
        <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
          {componente.codigo}
        </Typography.Paragraph>
        <Typography.Paragraph weight="medium">{componente.nome}</Typography.Paragraph>
      </View>
      <View className="flex-row items-end justify-between">
        {/* Bottom-left: situação badge stacked above the CR impact — the two
            rarely both show (a trancada/refatorada has no nota, so no
            impacto either), but a reprovada can carry both. */}
        <View className="items-start gap-1">
          {rotulo ? (
            <View className="rounded-full bg-white/5 px-2 py-1 flex-row items-center gap-1">
              {componente.situacao === "TRANC" ? (
                <AppIcon name="IconLockKey" size={11} color={mutedColor} />
              ) : null}
              <Typography.Paragraph type="body-xs" color="muted">
                {rotulo}
              </Typography.Paragraph>
            </View>
          ) : null}
          {/* The 0,005 floor, not a plain truthy check: `impacto` is a raw
              float, and one that rounds to "0,00" at the two decimals this
              displays (e.g. 0.001) is still nonzero in JS — a bare `!== 0`
              let exactly that case through with an arrow glued to a number
              that reads as no change at all. */}
          {impacto !== null && Math.abs(impacto) >= 0.005 ? (
            <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
              {formatarImpacto(impacto)}
            </Typography.Paragraph>
          ) : null}
        </View>
        {/* Bottom-right, always: the card's one headline number — nota on
            the CR tab, carga horária on the other. A trancada/cancelada has
            no nota at all, and "—" in that slot reads as a real value gone
            missing rather than a value that was never going to exist —
            better to leave the corner blank. */}
        {insight === "cargaHoraria" ? (
          <View className="flex-row items-center gap-1">
            <AppIcon name="IconClock" size={13} color={cargaHorariaColor(componente.cargaHoraria)} />
            <Typography.Heading
              type="h6"
              className="font-mono"
              style={{ color: cargaHorariaColor(componente.cargaHoraria) }}
            >
              {componente.cargaHoraria} h
            </Typography.Heading>
          </View>
        ) : componente.nota !== null ? (
          <Typography.Heading type="h6" className="font-mono" style={{ color: gradeColor(nota) }}>
            {nota}
          </Typography.Heading>
        ) : null}
      </View>
    </View>
  );
}
