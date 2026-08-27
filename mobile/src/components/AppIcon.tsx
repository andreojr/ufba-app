import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, JSX } from "react";
import type { ColorValue } from "react-native";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Maps the Phosphor-style icon names used in the UFBA design mockup to the
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
  IconCaretDown: "chevron-down",
  IconArrowSquareOut: "open-outline",
  IconDownloadSimple: "download-outline",
  IconIdentificationCard: "id-card-outline",
  IconGraduationCap: "school-outline",
  IconCalendarBlank: "calendar-outline",
  IconHourglass: "hourglass-outline",
  IconLockKey: "lock-closed-outline",
  IconLockKeyOpen: "lock-open-outline",
  IconChartLineUp: "trending-up-outline",
  IconCheck: "checkmark",
  IconHouse: "home-outline",
  IconGear: "settings-outline",
  IconTrash: "trash-outline",
  IconArrowsClockwise: "sync-outline",
  IconInfo: "information-circle-outline",
  IconX: "close",
  IconFlag: "flag-outline",
  IconStar: "star",
  // Ionicons has no chalkboard glyph; `easel-outline` is the closest, and
  // `school-outline` is already taken by IconGraduationCap.
  IconChalkboardTeacher: "easel-outline",
  IconSparkles: "sparkles-outline",
  IconSun: "sunny-outline",
  IconMoon: "moon-outline",
  IconContrast: "contrast-outline",
  // The carga-horária density scale — see ESCALA_DENSIDADE. Deliberately not
  // reusing IconFileText (document-text-outline) for the lightest tier: a
  // blank page pairs with documents-outline as the same object multiplied,
  // which is the whole reason the first two steps read in order.
  IconPaper: "document-outline",
  IconPapers: "documents-outline",
  IconBook: "book-outline",
  IconTrayFull: "file-tray-full-outline",
  IconPlus: "add",
  // Par do IconPlus, usado no contador de faltas.
  IconMinus: "remove",
  IconGithubLogo: "logo-github",
  IconLibrary: "library-outline",
} as const satisfies Record<string, IoniconName>;

export type AppIconName = keyof typeof ICON_MAP;

/**
 * Filled counterparts for the handful of icons that need a "selected" look
 * (currently just the bottom tab bar). Only covers names actually used that
 * way — everything else keeps rendering its one mapped glyph regardless of
 * `variant`, same as before this existed.
 */
const FILLED_ICON_MAP: Partial<Record<AppIconName, IoniconName>> = {
  IconHouse: "home",
  IconPath: "footsteps",
  IconSparkles: "sparkles",
  IconChalkboardTeacher: "easel",
};

export function AppIcon({
  name,
  size = 20,
  color,
  variant = "outline",
}: {
  name: AppIconName;
  size?: number;
  color?: ColorValue;
  /** "fill" falls back to the outline glyph for names with no filled entry above. */
  variant?: "outline" | "fill";
}): JSX.Element {
  const iconName = variant === "fill" ? (FILLED_ICON_MAP[name] ?? ICON_MAP[name]) : ICON_MAP[name];
  return <Ionicons name={iconName} size={size} color={color} />;
}
