import { useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { LocationBadge } from "@/components/LocationBadge";
import { PontosAtencaoSection } from "@/components/PontosAtencaoSection";
import { SemesterTrack } from "@/components/SemesterTrack";
import { describeApiError } from "@/lib/api-errors";
import { getPontosAtencao, getSchedule, postScheduleSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { savePeriodoCache } from "@/lib/periodo-cache";
import { isWithinPeriodo } from "@/lib/periodo-letivo";
import { dataIsoLocal, intercalarDia } from "@/lib/pontos-atencao";
import {
  formatMinutes,
  formatMinutesUntil,
  getCurrentWeekDays,
  GRID_TIME_MARKS,
  isClassInProgress,
  maskWeekToPeriodo,
  pickNextClass,
  buildWeekSchedule,
  SCHEDULE_END_MIN,
  SCHEDULE_PALETTE,
  SCHEDULE_START_MIN,
  type ScheduleBlock,
} from "@/lib/sigaa-schedule";
import { relativeFreshness } from "@/lib/relative-freshness";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { perfilFreshness, useSyncFreshness } from "@/lib/sync-freshness-context";
import type { PeriodoLetivo, PontoAtencao, Turma } from "@/lib/types";

const EMPTY_WEEK: ScheduleBlock[][] = [[], [], [], [], []];

// Grid covers the earliest (7h00) through the latest (22h10) possible SIGAA
// class slot, at the same 18px/hour density the design mockup used.
const GRID_START_MIN = SCHEDULE_START_MIN;
const GRID_END_MIN = SCHEDULE_END_MIN;
const PX_PER_MIN = 18 / 60;
const SCHEDULE_GRID_HEIGHT = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MIN;

// The gutter labels stay on round hours: two digits are far narrower to print
// than "08:50", and a class's exact start and end are already on its card. The
// reference *lines* are a separate thing — see GRID_TIME_MARKS.
const HOUR_LABELS = [7, 9, 11, 13, 15, 17, 19, 21];

// The day-selector row above the grid pads by the same amount, so its buttons
// stay centred over their columns — keep the two reading from this constant.
const TIME_GUTTER_WIDTH = 26;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  /** Nothing has ever been stored for this student — nothing to show yet. */
  | { status: "unsynced" }
  | {
      status: "ready";
      week: ScheduleBlock[][];
      periodoLetivo: PeriodoLetivo | null;
      loadedAt: Date;
    };

export default function HomeTab(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  // Shared with Perfil's sync item — see sync-freshness-context's docstring.
  // Início has no reason to know the histórico's own fetchedAt (it never
  // fetches it), but folding it into the one freshness line here means a
  // sync done from Perfil is reflected the moment the student swipes back.
  const { scheduleFetchedAt, historicoFetchedAt, setScheduleFetchedAt } = useSyncFreshness();

  // One ticking clock for the whole screen. Read at render instead, every one of
  // these would be frozen at whatever the clock said when the screen mounted:
  // the countdown to the next class and the "Atualizado há X" line. (The
  // greeting used to live here too, but it's now TabsHeader's own — see
  // TabsHeader's docstring for why it ticks its own separate clock instead of
  // sharing this one.)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = useMemo(() => getCurrentWeekDays(), []);
  const todayIndex = days.findIndex((d) => d.isToday);
  const [selectedDay, setSelectedDay] = useState(todayIndex === -1 ? 0 : todayIndex);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [gridWidth, setGridWidth] = useState(0);
  const mutedColor = useThemeColor("muted");

  // Applies whatever the backend returned (cache read or fresh sync) — shared
  // by both paths so the week-masking and periodo-caching logic lives in one
  // place.
  const applySchedule = useCallback(
    (turmas: Turma[], periodoLetivo: PeriodoLetivo | null, fetchedAt: Date) => {
      if (periodoLetivo) {
        // Cached for screens that never call /schedule — Trajetória reads this
        // to tell whether the term is over. Fire and forget: a failed write
        // must not turn a good schedule fetch into an error.
        void savePeriodoCache(periodoLetivo).catch((error: unknown) => {
          console.warn("Failed to cache the academic term", error);
        });
      }
      setState({
        status: "ready",
        // Masked here, before anything reads the week: a turma's slots say
        // "Segunda" without saying which Monday, so a term starting mid-week
        // would otherwise fill the days that came before it.
        week: maskWeekToPeriodo(buildWeekSchedule(turmas), days, periodoLetivo),
        periodoLetivo,
        loadedAt: fetchedAt,
      });
      setScheduleFetchedAt(fetchedAt);
    },
    [days, setScheduleFetchedAt]
  );

  // Re-scrapes the SIGAA site and persists the result — the only path that
  // actually touches the real SIGAA server. Used for the very first sync
  // (nothing cached yet) and for pull-to-refresh.
  const syncSchedule = useCallback(
    async (credentials: Awaited<ReturnType<typeof getSigaaCredentials>>, silent: boolean) => {
      if (!accessToken || !credentials) {
        return;
      }
      if (!silent) {
        setState({ status: "loading" });
      }
      try {
        const response = await postScheduleSync(accessToken, credentials);
        if (!("turmas" in response)) {
          throw new Error("O SIGAA não retornou nenhuma turma.");
        }
        applySchedule(response.turmas, response.periodoLetivo, new Date(response.fetchedAt));
      } catch (error) {
        console.warn("Failed to sync SIGAA schedule", error);
        setState({ status: "error", message: describeApiError(error) });
      }
    },
    [accessToken, applySchedule]
  );

  // Cheap read from our own database. Falls back to a live sync exactly once
  // — the first time a user opens the app after linking, before anything has
  // ever been cached for them.
  const loadSchedule = useCallback(
    async (silent = false) => {
      if (!accessToken) {
        return;
      }
      if (!silent) {
        setState({ status: "loading" });
      }
      try {
        // Read first, always: the cached schedule lives in our own database and
        // needs no SIGAA password, so an unlinked student still gets their week.
        const cached = await getSchedule(accessToken);
        if (!("turmas" in cached)) {
          const credentials = await getSigaaCredentials();
          if (!credentials) {
            setState({ status: "unsynced" });
            return;
          }
          await syncSchedule(credentials, silent);
          return;
        }
        applySchedule(cached.turmas, cached.periodoLetivo, new Date(cached.fetchedAt));
      } catch (error) {
        console.warn("Failed to load SIGAA schedule", error);
        setState({ status: "error", message: describeApiError(error) });
      }
    },
    [accessToken, applySchedule, syncSchedule]
  );

  const [pontos, setPontos] = useState<PontoAtencao[]>([]);

  // Depends on the link status only to re-read after the student links (the
  // first sync happens inside loadSchedule) — never to decide *whether* to read.
  useEffect(() => {
    if (accessToken) {
      loadSchedule();
      // O horário é a razão principal da tela — uma falha aqui não pode
      // derrubá-la, então o erro só é logado e a lista fica vazia.
      getPontosAtencao(accessToken, { incluirVencidos: false })
        .then(setPontos)
        .catch((error: unknown) => {
          console.warn("Failed to load pontos de atenção", error);
        });
    }
  }, [sigaaLink.status, accessToken, loadSchedule]);

  const week = state.status === "ready" ? state.week : EMPTY_WEEK;
  const pontosDoDia = useMemo(
    () =>
      days[selectedDay]
        ? pontos.filter((ponto) => ponto.data === dataIsoLocal(days[selectedDay].date))
        : [],
    [pontos, days, selectedDay]
  );
  const itensDoDia = useMemo(
    () => intercalarDia(week[selectedDay] ?? [], pontosDoDia),
    [week, selectedDay, pontosDoDia]
  );

  // Distinguishes "this day has no classes" from "the term hasn't reached this
  // day yet" — the same masking that emptied the column, said out loud.
  const periodoLetivo = state.status === "ready" ? state.periodoLetivo : null;
  const selectedDayIsOutsidePeriodo = Boolean(
    periodoLetivo && days[selectedDay] && !isWithinPeriodo(days[selectedDay].date, periodoLetivo)
  );

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const nextClass = useMemo(() => {
    const startIndex = todayIndex === -1 ? 0 : todayIndex;
    const startMinutes = todayIndex === -1 ? 0 : nowMinutes;
    return pickNextClass(week, startIndex, startMinutes);
  }, [week, todayIndex, nowMinutes]);

  // "Agora" only while the class is genuinely running; a class still ahead today
  // gets the wait, and one on another day gets that day's name.
  const nextClassWhen = !nextClass
    ? null
    : nextClass.dayIndex !== todayIndex
      ? days[nextClass.dayIndex].label
      : isClassInProgress(nextClass.block, nowMinutes)
        ? "Agora"
        : formatMinutesUntil(nextClass.block.inicioMin - nowMinutes);

  // Columns are laid out in real measured pixels (not percentages) so the
  // day-selector buttons above can share the exact same math and stay
  // aligned with the grid — no gap between them, same as vertically, where
  // back-to-back classes touch with no actual break in time either.
  const COLUMN_GAP = 0;
  const columnWidth = gridWidth > 0 ? gridWidth / 5 : 0;

  const blocks = useMemo(
    () =>
      week.flatMap((entries, dayIndex) =>
        entries.map((entry) => {
          const colors = SCHEDULE_PALETTE[entry.colorIndex];
          const top = (entry.inicioMin - GRID_START_MIN) * PX_PER_MIN;
          // No vertical shrink here — back-to-back classes should touch,
          // since there's genuinely no gap between them in time.
          const height = (entry.fimMin - entry.inicioMin) * PX_PER_MIN;
          return {
            key: entry.key,
            dayIndex,
            label: (entry.codigo ?? entry.nome).slice(0, 8),
            color: colors.fg,
            style: {
              position: "absolute" as const,
              left: dayIndex * columnWidth + COLUMN_GAP / 2,
              width: Math.max(columnWidth - COLUMN_GAP, 0),
              top,
              height,
              padding: 3,
              backgroundColor: colors.fill,
              opacity: dayIndex === selectedDay ? 1 : 0.45,
            },
          };
        })
      ),
    [week, selectedDay, columnWidth]
  );

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        testID="home-schedule-scroll"
        className="flex-1 px-6"
        contentContainerClassName="gap-4 pb-6"
        showsVerticalScrollIndicator={false}
      >
        <PontosAtencaoSection pontos={pontos} agora={now} />

        {/* Heading and freshness share one row — the semester moved out of this
            text and into the badge on the term track inside the grid card. */}
        <View className="flex-row items-baseline justify-between gap-3">
          <Typography.Heading type="h4">Sua semana</Typography.Heading>
          <View className="flex-row items-center gap-1.5">
            <View
              className={`w-1.5 h-1.5 rounded-full ${
                state.status === "error" || state.status === "unsynced" ? "bg-danger" : "bg-success"
              }`}
            />
            <Typography.Paragraph testID="schedule-freshness" type="body-xs" color="muted">
              {state.status === "ready"
                ? (() => {
                    // Falls back to the schedule's own instant while the
                    // histórico hasn't reported in yet this session — see
                    // perfilFreshness's docstring.
                    const freshness = perfilFreshness(scheduleFetchedAt, historicoFetchedAt) ?? state.loadedAt;
                    return `Atualizado ${relativeFreshness(freshness, now)}`;
                  })()
                : state.status === "loading"
                  ? "Carregando…"
                  : "Sem dados"}
            </Typography.Paragraph>
          </View>
        </View>

        {state.status === "loading" && (
          <View className="rounded-3xl bg-surface-secondary p-8 items-center gap-2">
            <Spinner />
            <Typography.Paragraph type="body-sm" color="muted">
              Buscando sua semana no SIGAA…
            </Typography.Paragraph>
          </View>
        )}

        {state.status === "error" && (
          <View className="rounded-3xl bg-surface-secondary p-6 items-center gap-3">
            <AppIcon name="IconWarningCircle" size={28} color={mutedColor} />
            <Typography.Paragraph type="body-sm" color="muted" align="center">
              {state.message}
            </Typography.Paragraph>
            {/* Retrying is a plain re-read of our own database, so it is
                offered whether or not the account is currently linked. */}
            <Button variant="outline" size="sm" onPress={() => loadSchedule()}>
              <Button.Label>Tentar de novo</Button.Label>
            </Button>
          </View>
        )}

        {state.status === "unsynced" && (
          <View className="rounded-3xl bg-surface-secondary p-5 gap-3">
            <Typography.Heading type="h6">Sua semana ainda não foi montada</Typography.Heading>
            <Typography.Paragraph type="body-sm" color="muted">
              {sigaaLink.status === "linked"
                ? "Sincronize sua conta em Perfil para buscar seu horário no SIGAA."
                : "Vincule sua conta em Perfil para buscar seu horário no SIGAA."}
            </Typography.Paragraph>
            <Button onPress={() => router.push("/ajustes")}>
              <Button.Label>Ir para Perfil</Button.Label>
            </Button>
          </View>
        )}

        {state.status === "ready" && (
          <>
            {/* One connected group, top to bottom: next class, semester
                countdown, weekly grid — the countdown sits between the two
                schedule-shaped cards it relates to instead of floating above
                them on its own. */}
            <View className="gap-0.5">
              <View className="rounded-t-3xl rounded-b-md bg-accent p-4 gap-3">
                {nextClass ? (
                  <>
                    <View className="flex-row items-center gap-2">
                      <View className="rounded-full bg-white/20 px-2.5 py-1">
                        <Typography.Paragraph
                          testID="next-class-when"
                          type="body-xs"
                          className="text-white"
                          weight="medium"
                        >
                          {nextClassWhen}
                        </Typography.Paragraph>
                      </View>
                      <Typography.Paragraph
                        type="body-sm"
                        className="flex-1 text-white font-mono"
                        weight="medium"
                      >
                        {formatMinutes(nextClass.block.inicioMin)} –{" "}
                        {formatMinutes(nextClass.block.fimMin)}
                      </Typography.Paragraph>
                      <AppIcon name="IconCaretRight" size={16} color="rgba(250,250,250,0.7)" />
                    </View>
                    <View className="gap-0.5">
                      <Typography.Heading type="h5" className="text-white">
                        {nextClass.block.nome}
                      </Typography.Heading>
                      <Typography.Paragraph type="body-sm" className="text-white/80">
                        {nextClass.block.codigo ?? "—"}
                        {nextClass.block.predio ? ` · ${nextClass.block.predio}` : ""}
                        {nextClass.block.sala ? ` · ${nextClass.block.sala}` : ""}
                      </Typography.Paragraph>
                    </View>
                  </>
                ) : (
                  <Typography.Paragraph type="body-sm" className="text-white">
                    Nenhuma aula agendada essa semana.
                  </Typography.Paragraph>
                )}
              </View>

              {state.periodoLetivo && (
                <View className="rounded-md bg-surface-secondary p-4">
                  <SemesterTrack periodo={state.periodoLetivo} now={now} />
                </View>
              )}

              <View className="rounded-t-md rounded-b-3xl bg-surface-secondary p-4 gap-0">
                <View className="flex-row gap-2">
                  {/* Spacer matching the time-label gutter below, so the day
                      buttons land exactly over their grid columns. */}
                  <View style={{ width: TIME_GUTTER_WIDTH }} />
                  <View className="flex-1 flex-row">
                    {days.map((day, index) => {
                      const isSelected = index === selectedDay;
                      return (
                        <Pressable
                          key={day.key}
                          testID={`weekday-${day.label}`}
                          onPress={() => setSelectedDay(index)}
                          style={{ width: columnWidth || undefined, flexGrow: columnWidth ? 0 : 1 }}
                          className={`items-center gap-0.5 py-2 ${
                            isSelected ? "bg-white/[0.04]" : ""
                          }`}
                        >
                          <Typography.Paragraph
                            type="body-xs"
                            className={isSelected ? undefined : "text-muted"}
                          >
                            {day.label}
                          </Typography.Paragraph>
                          <Typography.Paragraph
                            type="body-sm"
                            weight="medium"
                            className="font-mono"
                          >
                            {day.num}
                          </Typography.Paragraph>
                          {day.isToday && (
                            <View
                              testID="today-dot"
                              // Absolutely positioned so it never nudges the
                              // number/label — it would otherwise widen the
                              // column and break its alignment with the grid.
                              className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-accent"
                            />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View className="flex-row gap-2">
                  <View style={{ width: TIME_GUTTER_WIDTH, height: SCHEDULE_GRID_HEIGHT }}>
                    {HOUR_LABELS.map((hour) => (
                      <Typography.Paragraph
                        key={hour}
                        type="body-xs"
                        color="muted"
                        className="font-mono"
                        style={{
                          position: "absolute",
                          top: (hour * 60 - GRID_START_MIN) * PX_PER_MIN - 8,
                        }}
                      >
                        {hour < 10 ? `0${hour}` : hour}
                      </Typography.Paragraph>
                    ))}
                  </View>
                  <View
                    className="rounded-br-3xl overflow-hidden"
                    style={{ flex: 1, height: SCHEDULE_GRID_HEIGHT, position: "relative" }}
                    onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
                  >
                    {GRID_TIME_MARKS.map((mark) => (
                      <View
                        key={mark}
                        className="absolute left-0 right-0 h-px bg-white/5"
                        style={{
                          top: (mark - GRID_START_MIN) * PX_PER_MIN,
                          // 22:10 closes the last slot and is also the grid's own
                          // bottom edge, which the card already draws.
                          opacity: mark === GRID_END_MIN ? 0 : 1,
                        }}
                      />
                    ))}
                    {days.map((day, index) => (
                      <Pressable
                        key={day.key}
                        onPress={() => setSelectedDay(index)}
                        className={`absolute bottom-0 top-0 ${
                          index === selectedDay ? "bg-white/[0.04]" : ""
                        }`}
                        style={{ left: index * columnWidth, width: columnWidth }}
                      />
                    ))}
                    {blocks.map((block) => (
                      <Pressable
                        key={block.key}
                        onPress={() => setSelectedDay(block.dayIndex)}
                        style={block.style}
                      >
                        <Typography.Paragraph
                          type="body-xs"
                          style={{ color: block.color, fontSize: 9 }}
                        >
                          {block.label}
                        </Typography.Paragraph>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </View>

            <View className="gap-2.5">
              <Typography.Paragraph weight="medium">{days[selectedDay].full}</Typography.Paragraph>
              {itensDoDia.length === 0 ? (
                <View className="rounded-2xl bg-surface-secondary py-5 items-center">
                  <Typography.Paragraph type="body-sm" color="muted">
                    {selectedDayIsOutsidePeriodo
                      ? "Fora do período letivo."
                      : "Nenhuma aula neste dia."}
                  </Typography.Paragraph>
                </View>
              ) : (
                itensDoDia.map((item) =>
                  item.kind === "aula" ? (
                    <View
                      key={item.aula.key}
                      className="rounded-2xl bg-surface-secondary p-3.5 flex-row items-start gap-3"
                    >
                      <View
                        className="w-1 self-stretch rounded-full"
                        style={{
                          backgroundColor: SCHEDULE_PALETTE[item.aula.colorIndex].bar,
                          minHeight: 36,
                        }}
                      />
                      <View className="w-14">
                        <Typography.Paragraph type="body-sm" weight="medium" className="font-mono">
                          {formatMinutes(item.aula.inicioMin)}
                        </Typography.Paragraph>
                        <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                          {formatMinutes(item.aula.fimMin)}
                        </Typography.Paragraph>
                      </View>
                      <View className="flex-1 gap-0.5">
                        <Typography.Paragraph weight="medium">{item.aula.nome}</Typography.Paragraph>
                        <View className="flex-row items-center gap-1.5">
                          {item.aula.codigo && (
                            <Typography.Paragraph type="body-xs" color="muted">
                              {item.aula.codigo} ·
                            </Typography.Paragraph>
                          )}
                          <LocationBadge
                            predio={item.aula.predio}
                            sala={item.aula.sala}
                            localOriginal={item.aula.localOriginal}
                          />
                        </View>
                      </View>
                    </View>
                  ) : (
                    <View
                      key={item.ponto.id}
                      testID={`ponto-do-dia-${item.ponto.id}`}
                      className="rounded-2xl bg-danger-soft border border-danger/30 p-3.5 flex-row items-start gap-3"
                    >
                      <View
                        className="w-1 self-stretch rounded-full bg-danger"
                        style={{ minHeight: 36 }}
                      />
                      <View className="w-14">
                        <Typography.Paragraph
                          type="body-sm"
                          weight="medium"
                          className="font-mono text-danger-soft-foreground"
                        >
                          {item.ponto.hora ?? "23:59"}
                        </Typography.Paragraph>
                        <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                          prazo
                        </Typography.Paragraph>
                      </View>
                      <View className="flex-1 gap-0.5">
                        <Typography.Paragraph weight="medium">
                          {item.ponto.titulo}
                        </Typography.Paragraph>
                        <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                          {item.ponto.turmaCodigo ?? item.ponto.turmaNome}
                        </Typography.Paragraph>
                      </View>
                    </View>
                  )
                )
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
