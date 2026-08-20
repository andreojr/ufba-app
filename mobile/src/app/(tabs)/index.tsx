import { useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor, useToast } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { LocationBadge } from "@/components/LocationBadge";
import { SemesterTrack } from "@/components/SemesterTrack";
import { UfbaCrest } from "@/components/UfbaCrest";
import { describeApiError } from "@/lib/api-errors";
import { postSchedule, postSigaaSession } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { savePeriodoCache } from "@/lib/periodo-cache";
import { isWithinPeriodo } from "@/lib/periodo-letivo";
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
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import type { PeriodoLetivo } from "@/lib/types";
import { buildGreeting, identidadeAppBar } from "@/lib/user-name";

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
  | {
      status: "ready";
      week: ScheduleBlock[][];
      periodoLetivo: PeriodoLetivo | null;
      loadedAt: Date;
    };

function relativeFreshness(loadedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - loadedAt.getTime()) / 60_000));
  if (minutes < 1) return "agora mesmo";
  if (minutes === 1) return "há 1 min";
  return `há ${minutes} min`;
}

export default function HomeTab(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const studentName = auth.status === "signedIn" ? auth.user.name : "";
  const identidade = identidadeAppBar(auth.status === "signedIn" ? auth.user : null);
  const { toast } = useToast();

  // One ticking clock for the whole screen. Read at render instead, every one of
  // these would be frozen at whatever the clock said when the screen mounted:
  // the countdown to the next class, the "Atualizado há X" line, and the
  // greeting, which would still say "Bom dia" well into the afternoon.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const greeting = buildGreeting(studentName, now);

  const days = useMemo(() => getCurrentWeekDays(), []);
  const todayIndex = days.findIndex((d) => d.isToday);
  const [selectedDay, setSelectedDay] = useState(todayIndex === -1 ? 0 : todayIndex);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const [isOpeningSigaa, setIsOpeningSigaa] = useState(false);
  const [mutedColor, dangerSoftForeground] = useThemeColor(["muted", "danger-soft-foreground"]);

  const loadSchedule = useCallback(
    async (silent = false) => {
      if (!accessToken) {
        return;
      }
      const credentials = await getSigaaCredentials();
      if (!credentials) {
        setState({ status: "error", message: "Vincule sua conta do SIGAA para ver sua semana." });
        return;
      }

      if (!silent) {
        setState({ status: "loading" });
      }
      try {
        const { turmas, periodoLetivo } = await postSchedule(accessToken, credentials);
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
          loadedAt: new Date(),
        });
      } catch (error) {
        console.warn("Failed to load SIGAA schedule", error);
        setState({ status: "error", message: describeApiError(error) });
      }
    },
    [accessToken, days]
  );

  useEffect(() => {
    if (sigaaLink.status === "linked" && accessToken) {
      loadSchedule();
    } else if (sigaaLink.status === "unlinked") {
      setState({ status: "error", message: "Vincule sua conta do SIGAA para ver sua semana." });
    }
  }, [sigaaLink.status, accessToken, loadSchedule]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSchedule(true);
    setRefreshing(false);
  }, [loadSchedule]);

  const handleOpenSigaa = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    if (sigaaLink.status !== "linked") {
      router.push("/link-account");
      return;
    }

    const credentials = await getSigaaCredentials();
    if (!credentials) {
      router.push("/link-account");
      return;
    }

    setIsOpeningSigaa(true);
    try {
      const session = await postSigaaSession(accessToken, credentials);
      router.push({
        pathname: "/sigaa-webview",
        params: { sessionCookie: session.sessionCookie, targetUrl: session.targetUrl },
      });
    } catch (error) {
      console.warn("Failed to open SIGAA", error);
      toast.show({
        variant: "danger",
        label: describeApiError(error),
        icon: <AppIcon name="IconErrorCircle" size={20} color={dangerSoftForeground} />,
      });
    } finally {
      setIsOpeningSigaa(false);
    }
  }, [accessToken, sigaaLink.status, router, toast, dangerSoftForeground]);

  const week = state.status === "ready" ? state.week : EMPTY_WEEK;
  const daySchedule = week[selectedDay] ?? [];

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
      <AppBar
        title={
          <>
            {greeting.prefix}
            {greeting.name ? (
              // Raw Text (not Typography) so it inherits the heading's size and
              // weight, overriding only the color.
              <Text testID="app-bar-greeting-name" className="text-accent">
                {greeting.name}
              </Text>
            ) : null}
            {greeting.suffix}
          </>
        }
        {...identidade}
      />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-4 pb-6"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Heading and freshness share one row — the semester moved out of this
            text and into the badge on the term track inside the grid card. */}
        <View className="flex-row items-baseline justify-between gap-3">
          <Typography.Heading type="h4">Sua semana</Typography.Heading>
          <View className="flex-row items-center gap-1.5">
            <View
              className={`w-1.5 h-1.5 rounded-full ${
                state.status === "error" ? "bg-danger" : "bg-success"
              }`}
            />
            <Typography.Paragraph testID="schedule-freshness" type="body-xs" color="muted">
              {state.status === "ready"
                ? `Atualizado ${relativeFreshness(state.loadedAt, now)}`
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
            {sigaaLink.status === "linked" && (
              <Button variant="outline" size="sm" onPress={() => loadSchedule()}>
                <Button.Label>Tentar de novo</Button.Label>
              </Button>
            )}
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
              {daySchedule.length === 0 ? (
                <View className="rounded-2xl bg-surface-secondary py-5 items-center">
                  <Typography.Paragraph type="body-sm" color="muted">
                    {selectedDayIsOutsidePeriodo
                      ? "Fora do período letivo."
                      : "Nenhuma aula neste dia."}
                  </Typography.Paragraph>
                </View>
              ) : (
                daySchedule.map((entry) => (
                  <View
                    key={entry.key}
                    className="rounded-2xl bg-surface-secondary p-3.5 flex-row items-start gap-3"
                  >
                    <View
                      className="w-1 self-stretch rounded-full"
                      style={{
                        backgroundColor: SCHEDULE_PALETTE[entry.colorIndex].bar,
                        minHeight: 36,
                      }}
                    />
                    <View className="w-14">
                      <Typography.Paragraph type="body-sm" weight="medium" className="font-mono">
                        {formatMinutes(entry.inicioMin)}
                      </Typography.Paragraph>
                      <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                        {formatMinutes(entry.fimMin)}
                      </Typography.Paragraph>
                    </View>
                    <View className="flex-1 gap-0.5">
                      <Typography.Paragraph weight="medium">{entry.nome}</Typography.Paragraph>
                      <View className="flex-row items-center gap-1.5">
                        {entry.codigo && (
                          <Typography.Paragraph type="body-xs" color="muted">
                            {entry.codigo} ·
                          </Typography.Paragraph>
                        )}
                        <LocationBadge
                          predio={entry.predio}
                          sala={entry.sala}
                          localOriginal={entry.localOriginal}
                        />
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}

        <View className="gap-2 pt-1">
          <Button
            variant="outline"
            size="lg"
            className="w-full flex-row gap-2.5"
            isDisabled={isOpeningSigaa}
            onPress={handleOpenSigaa}
          >
            {isOpeningSigaa ? <Spinner /> : <UfbaCrest size={22} />}
            <Button.Label>Abrir o SIGAA</Button.Label>
            {!isOpeningSigaa && <AppIcon name="IconArrowSquareOut" size={18} color={mutedColor} />}
          </Button>
          <Typography.Paragraph type="body-xs" color="muted" align="center">
            Abre já logado. Você não digita nada.
          </Typography.Paragraph>
        </View>
      </ScrollView>
    </View>
  );
}
