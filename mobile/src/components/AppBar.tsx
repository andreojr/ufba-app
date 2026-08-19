import { useRouter } from "expo-router";
import { Avatar, Typography, useThemeColor } from "heroui-native";
import type { JSX, ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgUri } from "react-native-svg";

import { AppIcon } from "@/components/AppIcon";

// Matches heroui-native's Avatar "sm" size (--spacing * 8 = 32px) so the SVG fills
// the circle exactly instead of leaving a gap or overflowing past the rounded clip.
const AVATAR_SIZE_SM_PX = 32;

type AppBarProps = {
  /** Plain text, or rich content when parts of the title need their own styling. */
  title: ReactNode;
  /** Shows a small avatar with initials on the trailing edge. Omit for no trailing content. */
  initials?: string;
  /** The student's chosen avatar. Takes over from `initials` when set. */
  avatarUrl?: string | null;
};

/** Screen header used across the internal (post-login) screens, matching the design's AppBar. */
export function AppBar({ title, initials, avatarUrl }: AppBarProps): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mutedColor = useThemeColor("muted");

  return (
    <View
      className="flex-row items-center justify-between px-6 pb-3.5 self-stretch"
      style={{ paddingTop: insets.top + 14 }}
    >
      <Typography.Heading type="h3">{title}</Typography.Heading>
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
