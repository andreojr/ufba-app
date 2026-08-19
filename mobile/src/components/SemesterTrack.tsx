import { Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { describePeriodo } from "@/lib/periodo-letivo";
import type { PeriodoLetivo } from "@/lib/types";

interface SemesterTrackProps {
  periodo: PeriodoLetivo;
  now?: Date;
}

const TRACK_HEIGHT = 3;
const MARKER_SIZE = 9;

/**
 * Where the displayed week sits inside the academic term: the months it spans
 * at the ends, the countdown in the middle, and a marker on the track for
 * today. Lives at the top of the schedule grid so the two read together — the
 * grid shows *a* week, this shows *which* week.
 */
export function SemesterTrack({ periodo, now }: SemesterTrackProps): JSX.Element {
  const status = describePeriodo(periodo, now ?? new Date());

  return (
    <View testID="semester-track" className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <Typography.Paragraph type="body-xs" color="muted">
          {status.inicioLabel}
        </Typography.Paragraph>

        {/* Soft accent rather than a solid fill: the progress bar right below is
            solid accent, and two solid blocks of the same purple would merge
            into one, costing the bar the contrast it needs to read as progress. */}
        <View
          testID="periodo-badge"
          className="flex-row items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1"
        >
          <Typography.Paragraph
            type="body-xs"
            weight="medium"
            className="text-accent-soft-foreground"
          >
            {periodo.semestre}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-accent-soft-foreground">
            {status.countdown}
          </Typography.Paragraph>
        </View>

        <Typography.Paragraph type="body-xs" color="muted">
          {status.fimLabel}
        </Typography.Paragraph>
      </View>

      <View style={{ height: MARKER_SIZE, justifyContent: "center" }}>
        <View className="rounded-full bg-white/10" style={{ height: TRACK_HEIGHT }} />
        <View
          className="absolute left-0 rounded-full bg-accent"
          style={{ height: TRACK_HEIGHT, width: `${status.progress * 100}%` }}
        />
        {/* Pinned by its left edge at 0% and by its right edge at 100%, so the
            marker never overhangs either end of the track. */}
        <View
          testID="semester-track-marker"
          className="absolute rounded-full bg-accent"
          style={{
            width: MARKER_SIZE,
            height: MARKER_SIZE,
            left: `${status.progress * 100}%`,
            marginLeft: -status.progress * MARKER_SIZE,
          }}
        />
      </View>
    </View>
  );
}
