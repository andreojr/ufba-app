import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, JSX } from "react";
import type { ColorValue } from "react-native";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Maps the Phosphor-style icon names used in the Gradline design mockup to the
 * closest `@expo/vector-icons` (Ionicons) equivalent, since the app doesn't depend on
 * a Phosphor icon package. Keeps screen code readable and aligned with the design's
 * vocabulary without adding a new dependency.
 */
const ICON_MAP = {
  IconClock: "time-outline",
  IconPath: "footsteps-outline",
  IconFileText: "document-text-outline",
  IconCheckCircle: "checkmark-circle",
  IconEye: "eye-outline",
  IconEyeSlash: "eye-off-outline",
  IconDeviceMobile: "phone-portrait-outline",
  IconCloudCheck: "cloud-done-outline",
  IconWarningCircle: "alert-circle-outline",
  IconErrorCircle: "close-circle",
  IconCaretRight: "chevron-forward",
  IconCaretLeft: "chevron-back",
  IconArrowSquareOut: "open-outline",
  IconDownloadSimple: "download-outline",
  IconIdentificationCard: "id-card-outline",
  IconGraduationCap: "school-outline",
  IconCalendarBlank: "calendar-outline",
  IconHourglass: "hourglass-outline",
  IconLockKey: "lock-closed-outline",
  IconChartLineUp: "trending-up-outline",
  IconCheck: "checkmark",
  IconHouse: "home-outline",
  IconGear: "settings-outline",
  IconArrowsClockwise: "sync-outline",
  IconInfo: "information-circle-outline",
  IconX: "close",
} as const satisfies Record<string, IoniconName>;

export type AppIconName = keyof typeof ICON_MAP;

export function AppIcon({
  name,
  size = 20,
  color,
}: {
  name: AppIconName;
  size?: number;
  color?: ColorValue;
}): JSX.Element {
  return <Ionicons name={ICON_MAP[name]} size={size} color={color} />;
}
