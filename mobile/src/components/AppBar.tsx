import { Avatar, Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type AppBarProps = {
  title: string;
  /** Shows a small avatar with initials on the trailing edge. Omit for no trailing content. */
  initials?: string;
};

/** Screen header used across the internal (post-login) screens, matching the design's AppBar. */
export function AppBar({ title, initials }: AppBarProps): JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center justify-between px-6 pb-3.5 self-stretch"
      style={{ paddingTop: insets.top + 14 }}
    >
      <Typography.Heading type="h4">{title}</Typography.Heading>
      {initials ? (
        <Avatar size="sm" variant="soft" color="accent">
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar>
      ) : null}
    </View>
  );
}
