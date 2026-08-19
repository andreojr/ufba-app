import { Popover, Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { Pressable } from "react-native";

import { AppIcon } from "./AppIcon";

interface LocationBadgeProps {
  predio: string | null;
  sala: string | null;
  localOriginal: string;
}

/**
 * Shows where a class happens. When SIGAA's free-text "Local" field couldn't
 * be split into predio/sala, dumping the raw text inline would blow up the
 * card layout (professors type anything there) — so instead this renders an
 * info icon that opens a popover with the original text on tap.
 */
export function LocationBadge({ predio, sala, localOriginal }: LocationBadgeProps): JSX.Element {
  const mutedColor = useThemeColor("muted");

  if (predio) {
    return (
      <Typography.Paragraph type="body-xs" color="muted">
        {predio}
        {sala ? ` · ${sala}` : ""}
      </Typography.Paragraph>
    );
  }

  return (
    <Popover>
      <Popover.Trigger asChild>
        <Pressable className="flex-row items-center gap-1" hitSlop={8}>
          <AppIcon name="IconInfo" size={14} color={mutedColor} />
          <Typography.Paragraph type="body-xs" color="muted">
            Local a confirmar
          </Typography.Paragraph>
        </Pressable>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay />
        <Popover.Content presentation="popover" width={280} className="gap-1 rounded-xl px-4 py-3">
          <Popover.Title>Local informado pelo SIGAA</Popover.Title>
          <Popover.Description>{localOriginal}</Popover.Description>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
