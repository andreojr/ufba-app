import { Button, Spinner, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { LocationBadge } from "@/components/LocationBadge";
import { UfbaCrest } from "@/components/UfbaCrest";
import { describeApiError } from "@/lib/api-errors";
import { postSchedule } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  formatMinutes,
  getCurrentWeekDays,
  pickNextClass,
  buildWeekSchedule,
  SCHEDULE_PALETTE,
  type ScheduleBlock,
} from "@/lib/sigaa-schedule";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import type { Turma } from "@/lib/types";

const EMPTY_WEEK: ScheduleBlock[][] = [[], [], [], [], []];

// Grid covers the earliest (7h00) through the latest (22h10) possible SIGAA
// class slot, at the same 18px/hour density the design mockup used.
const GRID_START_MIN = 420;
const GRID_END_MIN = 1330;
const PX_PER_MIN = 18 / 60;
const SCHEDULE_GRID_HEIGHT = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MIN;
const HOUR_MARKS = [7, 9, 11, 13, 15, 17, 19, 21];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; week: ScheduleBlock[][]; semestre: string | null; loadedAt: Date };

function relativeFreshness(loadedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - loadedAt.getTime()) / 60_000));
  if (minutes < 1) return "agora mesmo";
  if (minutes === 1) return "há 1 min";
  return `há ${minutes} min`;
}

export default function HomeTab(): JSX.Element {
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;

  const days = useMemo(() => getCurrentWeekDays(), []);
  const todayIndex = days.findIndex((d) => d.isToday);
  const [selectedDay, setSelectedDay] = useState(todayIndex === -1 ? 0 : todayIndex);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const mutedColor = useThemeColor("muted");

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
        const turmas: Turma[] = await postSchedule(accessToken, credentials);
        setState({
          status: "ready",
          week: buildWeekSchedule(turmas),
          semestre: turmas[0]?.semestre ?? null,
          loadedAt: new Date(),
        });
      } catch (error) {
        console.warn("Failed to load SIGAA schedule", error);
        setState({ status: "error", message: describeApiError(error) });
      }
    },
    [accessToken],
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

  const week = state.status === "ready" ? state.week : EMPTY_WEEK;
  const daySchedule = week[selectedDay] ?? [];

  const nextClass = useMemo(() => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startIndex = todayIndex === -1 ? 0 : todayIndex;
    const startMinutes = todayIndex === -1 ? 0 : nowMinutes;
    return pickNextClass(week, startIndex, startMinutes);
  }, [week, todayIndex]);

  // Percentage-based left/width can't carry a fixed-px gap (no calc() in RN
  // styles), so the columns are laid out in real pixels once we know the
  // grid's measured width — a small horizontal gap between day columns reads
  // better than the old vertical gap, which made no sense for back-to-back
  // classes with no actual break in time.
  const COLUMN_GAP = 4;
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
            label: (entry.codigo ?? entry.nome).slice(0, 8),
            color: colors.fg,
            style: {
              position: "absolute" as const,
              left: dayIndex * columnWidth + COLUMN_GAP / 2,
              width: Math.max(columnWidth - COLUMN_GAP, 0),
              top,
              height,
              borderRadius: 8,
              padding: 3,
              backgroundColor: colors.fill,
              opacity: dayIndex === selectedDay ? 1 : 0.45,
            },
          };
        }),
      ),
    [week, selectedDay, columnWidth],
  );

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Início" initials="AC" />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-4 pb-6"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="gap-1">
          <Typography.Heading type="h4">Sua semana</Typography.Heading>
          <View className="flex-row items-center gap-1.5">
            <View
              className={`w-1.5 h-1.5 rounded-full ${
                state.status === "error" ? "bg-danger" : "bg-success"
              }`}
            />
            <Typography.Paragraph type="body-xs" color="muted">
              {state.status === "ready"
                ? `Atualizado ${relativeFreshness(state.loadedAt, new Date())}${
                    state.semestre ? ` · ${state.semestre}` : ""
                  }`
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
            <View className="rounded-3xl bg-accent p-4 gap-3">
              {nextClass ? (
                <>
                  <View className="flex-row items-center gap-2">
                    <View className="rounded-full bg-white/20 px-2.5 py-1">
                      <Typography.Paragraph type="body-xs" className="text-white" weight="medium">
                        {nextClass.dayIndex === todayIndex ? "Agora" : days[nextClass.dayIndex].label}
                      </Typography.Paragraph>
                    </View>
                    <Typography.Paragraph type="body-sm" className="flex-1 text-white" weight="medium">
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

            <View className="rounded-3xl bg-surface-secondary p-4 gap-3">
              <View className="flex-row gap-2">
                {/* Spacer matching the hour-label gutter below, so the day
                    buttons land exactly over their grid columns. */}
                <View style={{ width: 26 }} />
                <View className="flex-1 flex-row">
                  {days.map((day, index) => {
                    const isSelected = index === selectedDay;
                    return (
                      <Pressable
                        key={day.key}
                        onPress={() => setSelectedDay(index)}
                        style={{ width: columnWidth || undefined, flexGrow: columnWidth ? 0 : 1 }}
                        className={`items-center gap-0.5 py-2 rounded-2xl ${
                          isSelected ? "bg-surface-tertiary" : ""
                        }`}
                      >
                        <Typography.Paragraph
                          type="body-xs"
                          className={isSelected ? undefined : "text-muted"}
                        >
                          {day.label}
                        </Typography.Paragraph>
                        <Typography.Paragraph type="body-sm" weight="medium">
                          {day.num}
                        </Typography.Paragraph>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View className="flex-row gap-2">
                <View style={{ width: 26, height: SCHEDULE_GRID_HEIGHT }}>
                  {HOUR_MARKS.map((hour) => (
                    <Typography.Paragraph
                      key={hour}
                      type="body-xs"
                      color="muted"
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
                  style={{ flex: 1, height: SCHEDULE_GRID_HEIGHT, position: "relative" }}
                  onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
                >
                  {HOUR_MARKS.map((hour, index) => (
                    <View
                      key={hour}
                      className="absolute left-0 right-0 h-px bg-white/5"
                      style={{
                        top: (hour * 60 - GRID_START_MIN) * PX_PER_MIN,
                        opacity: index === 0 ? 0 : 1,
                      }}
                    />
                  ))}
                  <View
                    className="absolute bottom-0 top-0 bg-white/[0.04] rounded-lg"
                    style={{ left: selectedDay * columnWidth, width: columnWidth }}
                  />
                  {blocks.map((block) => (
                    <View key={block.key} style={block.style}>
                      <Typography.Paragraph type="body-xs" style={{ color: block.color, fontSize: 9 }}>
                        {block.label}
                      </Typography.Paragraph>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View className="gap-2.5">
              <Typography.Paragraph weight="medium">{days[selectedDay].full}</Typography.Paragraph>
              {daySchedule.length === 0 ? (
                <View className="rounded-2xl bg-surface-secondary py-5 items-center">
                  <Typography.Paragraph type="body-sm" color="muted">
                    Nenhuma aula neste dia.
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
                      style={{ backgroundColor: SCHEDULE_PALETTE[entry.colorIndex].bar, minHeight: 36 }}
                    />
                    <View className="w-14">
                      <Typography.Paragraph type="body-sm" weight="medium">
                        {formatMinutes(entry.inicioMin)}
                      </Typography.Paragraph>
                      <Typography.Paragraph type="body-xs" color="muted">
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
          <Button variant="outline" size="lg" className="w-full flex-row gap-2.5">
            <UfbaCrest size={22} />
            <Button.Label>Abrir o SIGAA</Button.Label>
            <AppIcon name="IconArrowSquareOut" size={18} color={mutedColor} />
          </Button>
          <Typography.Paragraph type="body-xs" color="muted" align="center">
            Abre já logado. Você não digita nada.
          </Typography.Paragraph>
        </View>
      </ScrollView>
    </View>
  );
}
