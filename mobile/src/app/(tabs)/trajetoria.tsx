import { Menu, Typography, useThemeColor } from "heroui-native";
import { useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import {
  INITIAL_PLAN,
  PENDING_COURSES,
  PERIODS,
  PLAN_ZONES,
  TRANSCRIPT_SUMMARY,
  gradeColor,
  type PendingCourseId,
  type PlanZoneKey,
} from "@/lib/mock-data";

export default function TrajetoriaTab(): JSX.Element {
  const [plan, setPlan] = useState(INITIAL_PLAN);
  const mutedColor = useThemeColor("muted");

  function movePendingCourse(id: PendingCourseId, targetZone: PlanZoneKey): void {
    setPlan((current) => {
      const next: Record<PlanZoneKey, PendingCourseId[]> = { p262: [], p271: [], pool: [] };
      (Object.keys(current) as PlanZoneKey[]).forEach((zone) => {
        next[zone] = current[zone].filter((courseId) => courseId !== id);
      });
      next[targetZone] = [...next[targetZone], id];
      return next;
    });
  }

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Minha trajetória" />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-5 pb-8"
        showsVerticalScrollIndicator={false}
      >
        <View className="rounded-3xl bg-surface-secondary p-4 gap-3.5">
          <View className="flex-row items-stretch gap-4">
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph type="body-xs" color="muted">
                Coeficiente
              </Typography.Paragraph>
              <Typography.Heading type="h5">{TRANSCRIPT_SUMMARY.gpa}</Typography.Heading>
            </View>
            <View className="w-px bg-white/10" />
            <View className="flex-[1.3] gap-0.5">
              <Typography.Paragraph type="body-xs" color="muted">
                Carga horária
              </Typography.Paragraph>
              <Typography.Heading type="h5">
                {TRANSCRIPT_SUMMARY.completedHours}/{TRANSCRIPT_SUMMARY.totalHours}
              </Typography.Heading>
            </View>
          </View>
          <View className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
            <View
              className="h-full rounded-full bg-accent"
              style={{ width: `${TRANSCRIPT_SUMMARY.progressPercent}%` }}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Typography.Paragraph type="body-xs" color="muted">
              {TRANSCRIPT_SUMMARY.progressPercent}% do curso concluído
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" color="muted">
              faltam {TRANSCRIPT_SUMMARY.remainingCourses} matérias
            </Typography.Paragraph>
          </View>
        </View>

        {PERIODS.map((period) => (
          <View key={period.label} className="gap-2.5">
            <View className="flex-row items-center gap-2.5">
              <Typography.Paragraph weight="medium">{period.label}</Typography.Paragraph>
              <View
                className={`rounded-full px-2 py-1 ${
                  period.tone === "now" ? "bg-accent-soft" : "bg-white/5"
                }`}
              >
                <Typography.Paragraph
                  type="body-xs"
                  className={period.tone === "now" ? "text-accent" : undefined}
                  color={period.tone === "now" ? undefined : "muted"}
                >
                  {period.meta}
                </Typography.Paragraph>
              </View>
              <View className="flex-1 h-px bg-white/10" />
            </View>
            {period.rows.map((row) => (
              <View
                key={row.code}
                className="rounded-2xl bg-surface-secondary p-3.5 flex-row items-center gap-3"
              >
                <View className="flex-1 gap-0.5">
                  <Typography.Paragraph weight="medium">{row.name}</Typography.Paragraph>
                  <Typography.Paragraph type="body-xs" color="muted">
                    {row.code}
                  </Typography.Paragraph>
                </View>
                <Typography.Heading type="h6" style={{ color: gradeColor(row.grade) }}>
                  {row.grade}
                </Typography.Heading>
              </View>
            ))}
          </View>
        ))}

        <View className="gap-5">
          {PLAN_ZONES.map((zone) => {
            const courseIds = plan[zone.key];
            const isEmpty = courseIds.length === 0;
            return (
              <View key={zone.key} className="gap-2.5">
                <View className="flex-row items-center gap-2.5">
                  <Typography.Paragraph weight="medium">{zone.label}</Typography.Paragraph>
                  <View className="rounded-full bg-white/5 px-2 py-1">
                    <Typography.Paragraph type="body-xs" color="muted">
                      {zone.key === "pool"
                        ? `a cursar · ${courseIds.length}`
                        : isEmpty
                          ? "vazio"
                          : `${courseIds.length} ${courseIds.length === 1 ? "matéria" : "matérias"}`}
                    </Typography.Paragraph>
                  </View>
                  <View className="flex-1 h-px bg-white/10" />
                </View>
                <View
                  className={`gap-2 rounded-[20px] p-2 min-h-16 ${
                    isEmpty ? "border border-dashed border-white/20" : ""
                  }`}
                >
                  {courseIds.map((courseId) => {
                    const course = PENDING_COURSES[courseId];
                    const otherZones = PLAN_ZONES.filter((z) => z.key !== zone.key);
                    return (
                      <Menu key={courseId}>
                        <Menu.Trigger asChild>
                          <Pressable className="rounded-2xl bg-surface-secondary p-3 flex-row items-center gap-2.5">
                            <AppIcon name="IconCheck" size={18} color={mutedColor} />
                            <View className="flex-1 gap-0.5">
                              <Typography.Paragraph weight="medium">
                                {course.name}
                              </Typography.Paragraph>
                              <Typography.Paragraph type="body-xs" color="muted">
                                {courseId} · {course.workload}
                              </Typography.Paragraph>
                            </View>
                          </Pressable>
                        </Menu.Trigger>
                        <Menu.Portal>
                          <Menu.Overlay />
                          <Menu.Content presentation="popover" width={220}>
                            <Menu.Label>Mover para</Menu.Label>
                            {otherZones.map((target) => (
                              <Menu.Item
                                key={target.key}
                                onPress={() => movePendingCourse(courseId, target.key)}
                              >
                                <Menu.ItemTitle>{target.label}</Menu.ItemTitle>
                              </Menu.Item>
                            ))}
                          </Menu.Content>
                        </Menu.Portal>
                      </Menu>
                    );
                  })}
                  {isEmpty ? (
                    <View className="py-3.5 px-1.5 items-center">
                      <Typography.Paragraph type="body-sm" color="muted">
                        {zone.hint}
                      </Typography.Paragraph>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
