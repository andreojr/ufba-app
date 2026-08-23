import { Popover, Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { ESCALA_DENSIDADE_ORDENADA } from "@/lib/trajetoria";

/**
 * Nudge, in px, from the trigger's measured box centre to the ⓘ glyph's
 * visual centre.
 *
 * `align="center"` centres the panel on the Pressable's measured box, and the
 * drawn circle does not sit dead centre in the icon font's advance width — so
 * centring on the box lands slightly right of centring on the ink. Purely
 * empirical, calibrated by eye against the rendered header; it is not derived
 * from the panel's width, so changing the legend's contents will not
 * invalidate it. Bump it if the arrow still misses the ⓘ.
 */
const CENTRO_OTICO_DO_GLIFO = 4;

/**
 * The info button next to the trajetória page title, opening the legend for
 * the carga-horária density glyphs the matéria cards carry.
 *
 * The legend used to be a fixed line above the timeline. It reads better here:
 * the scale only needs teaching once, and a permanent line spends a row of the
 * screen on something most visits don't need. The tradeoff is real, though —
 * a legend behind a press is a legend some students never open, which is why
 * the trigger sits against the page title rather than somewhere down the
 * scroll, and why each card still carries the full rótulo as its
 * accessibilityLabel instead of relying on this to explain the glyph.
 */
export function LegendaDensidadeInfo(): JSX.Element {
  const mutedColor = useThemeColor("muted");

  return (
    <Popover>
      <Popover.Trigger testID="legenda-densidade-trigger" hitSlop={12}>
        <AppIcon name="IconInfo" size={18} color={mutedColor} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay />
        {/* `align="center"` centres the panel on the trigger, which is what
            puts it under the icon at all — the earlier `align="start"` lined
            the panel's left edge up with the icon's left edge instead.
            getHorizontalAlignPosition clamps to the screen insets, so a longer
            title pushing the trigger toward the edge cannot push the panel off
            it. The border is required for the arrow to visually connect (see
            popover.md). */}
        <Popover.Content
          presentation="popover"
          placement="bottom"
          align="center"
          alignOffset={-CENTRO_OTICO_DO_GLIFO}
          className="border border-border gap-2 p-3"
        >
          <Popover.Arrow />
          <Typography.Paragraph type="body-sm" weight="medium">
            Carga horária
          </Typography.Paragraph>
          <View testID="legenda-densidade" className="gap-1.5">
            {ESCALA_DENSIDADE_ORDENADA.map((tier) => (
              <View key={tier.nivel} className="flex-row items-center gap-2">
                <AppIcon name={tier.icone} size={15} color={mutedColor} />
                <Typography.Paragraph type="body-xs" color="muted">
                  {tier.curto}
                </Typography.Paragraph>
              </View>
            ))}
          </View>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
