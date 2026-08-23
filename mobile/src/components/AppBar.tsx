import { useRouter } from "expo-router";
import { Avatar, Typography, useThemeColor } from "heroui-native";
import type { JSX, ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgUri } from "react-native-svg";

import { AppIcon } from "@/components/AppIcon";

// Matches heroui-native's Avatar "sm" size (--spacing * 10 = 40px) so the SVG fills
// the circle exactly instead of leaving a gap or overflowing past the rounded clip.
const AVATAR_SIZE_SM_PX = 40;

type AppBarProps = {
  /** Plain text, or rich content when parts of the title need their own styling. */
  title: ReactNode;
  /** Heading size for the title. @default "h3" — a screen with a long, variable
   * title (e.g. a professor's name) can pass a smaller size instead. */
  titleType?: "h1" | "h3" | "h4" | "h5" | "h6";
  /** Shows a small avatar with initials on the trailing edge. Omit for no trailing content. */
  initials?: string;
  /** The student's chosen avatar. Takes over from `initials` when set. */
  avatarUrl?: string | null;
  /** Shows a leading close (X) button that calls this instead of `router.back()`
   * directly — for pushed detail screens (e.g. a professor's profile) that have
   * no tab-root avatar/settings trailing content of their own. */
  onClose?: () => void;
  /** Shows a leading back arrow instead of the close (X) — for a pushed screen
   * that's a plain "go back" (e.g. Perfil), not a modal-like flow with
   * something to explicitly dismiss. Takes over from `onClose` when both are
   * given, though a screen should only ever pass one. */
  onBack?: () => void;
};

/** Screen header used across the internal (post-login) screens, matching the design's AppBar. */
export function AppBar({
  title,
  titleType = "h3",
  initials,
  avatarUrl,
  onClose,
  onBack,
}: AppBarProps): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mutedColor = useThemeColor("muted");
  const dangerColor = useThemeColor("danger");

  return (
    <View
      className="flex-row items-center justify-between px-6 pb-3.5 self-stretch"
      style={{ paddingTop: insets.top + 14 }}
    >
      <View className="flex-1 flex-row items-center gap-3">
        {onBack ? (
          // `self-start`, not the row's own `items-center`: a long title can
          // wrap to two lines, and the back arrow should sit level with the
          // first line, not drift to the vertical middle of both.
          <Pressable testID="app-bar-back" onPress={onBack} hitSlop={12} className="self-start">
            <AppIcon name="IconCaretLeft" size={22} color={mutedColor} />
          </Pressable>
        ) : onClose ? (
          <Pressable testID="app-bar-close" onPress={onClose} hitSlop={12} className="self-start">
            <AppIcon name="IconX" size={22} color={dangerColor} />
          </Pressable>
        ) : null}
        <Typography.Heading type={titleType} className="flex-1">
          {title}
        </Typography.Heading>
      </View>
      {initials || avatarUrl ? (
        <Pressable
          testID="app-bar-profile"
          onPress={() => router.push("/ajustes")}
          className="flex-row items-center gap-2"
        >
          {/* Cog sits before the avatar so the avatar stays anchored to the
              screen edge, where it has always been. */}
          <View testID="app-bar-settings-icon">
            <AppIcon name="IconGear" size={20} color={mutedColor} />
          </View>
          <Avatar size="sm" variant="soft" color="accent">
            {avatarUrl ? (
              <SvgUri
                testID="app-bar-avatar-image"
                uri={avatarUrl}
                width={AVATAR_SIZE_SM_PX}
                height={AVATAR_SIZE_SM_PX}
              />
            ) : (
              <Avatar.Fallback>{initials}</Avatar.Fallback>
            )}
          </Avatar>
        </Pressable>
      ) : null}
    </View>
  );
}
