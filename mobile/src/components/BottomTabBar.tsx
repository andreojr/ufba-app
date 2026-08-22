import { useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { ActivityIndicator, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { UfbaCrest } from "@/components/UfbaCrest";
import { useOpenSigaa } from "@/lib/use-open-sigaa";

// Sized to exactly fill the bar's own top/bottom padding (see the row's style
// below) — any larger and it'd start poking above the bar again.
const SIGAA_BUTTON_SIZE = 64;
const SIGAA_SLOT_WIDTH = 72;
const BAR_HORIZONTAL_PADDING = 8;

/** One entry per swipeable page, in the same left-to-right order as `TabsPager`. */
const PAGES: ReadonlyArray<{ icon: AppIconName; label: string }> = [
  { icon: "IconHouse", label: "Início" },
  { icon: "IconPath", label: "Trajetória" },
  { icon: "IconSparkles", label: "Insights" },
  { icon: "IconChalkboardTeacher", label: "Professores" },
];

/** Width/height of the little indicator bar flush with the bar's top edge. */
const INDICATOR_WIDTH = 20;
const INDICATOR_HEIGHT = 3;

/**
 * A tab's icon+label, crossfading between its outline/muted and filled/active
 * look as `progress` (the pager's continuous page position — an integer at
 * rest, fractional mid-drag) passes through this tab's own index. Two icons
 * and two labels are stacked and faded against each other rather than
 * animating icon glyph or font weight directly — neither is something
 * Reanimated can tween (a glyph swap isn't a continuous style, and RN font
 * weight is a discrete string), so a crossfade is the standard substitute:
 * the same trick React Navigation's own tab bar icon uses internally.
 */
function AnimatedTabButton({
  index,
  icon,
  label,
  progress,
  mutedColor,
  activeForeground,
  onPress,
  selected,
}: {
  index: number;
  icon: AppIconName;
  label: string;
  progress: SharedValue<number>;
  mutedColor: string;
  activeForeground: string;
  onPress: () => void;
  selected: boolean;
}): JSX.Element {
  const focusAmount = useDerivedValue(() => 1 - Math.min(Math.abs(progress.value - index), 1));
  const activeStyle = useAnimatedStyle(() => ({ opacity: focusAmount.value }));
  const inactiveStyle = useAnimatedStyle(() => ({ opacity: 1 - focusAmount.value }));

  return (
    <Pressable
      className="flex-1 items-center justify-center"
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : {}}
      accessibilityLabel={label}
      onPress={onPress}
    >
      <View style={{ width: 22, height: 22 }}>
        <Animated.View style={[{ position: "absolute" }, inactiveStyle]}>
          <AppIcon name={icon} variant="outline" size={22} color={mutedColor} />
        </Animated.View>
        <Animated.View style={[{ position: "absolute" }, activeStyle]}>
          <AppIcon name={icon} variant="fill" size={22} color={activeForeground} />
        </Animated.View>
      </View>
      <View style={{ marginTop: 2 }}>
        <Animated.Text
          numberOfLines={1}
          style={[
            { fontFamily: "Poppins", fontSize: 11, fontWeight: "500", color: mutedColor },
            inactiveStyle,
          ]}
        >
          {label}
        </Animated.Text>
        <Animated.Text
          numberOfLines={1}
          style={[
            { position: "absolute", fontFamily: "Poppins", fontSize: 11, fontWeight: "700", color: activeForeground },
            activeStyle,
          ]}
        >
          {label}
        </Animated.Text>
      </View>
    </Pressable>
  );
}

/**
 * The tab bar's dedicated SIGAA button — a plain white circle carrying the
 * crest and the "SIGAA" wordmark together so it reads as a shortcut rather
 * than another section. Sits centered in the bar, no page of its own — it
 * never participates in `progress` at all.
 */
function SigaaTabIcon({
  isOpening,
  borderColor,
  accentColor,
}: {
  isOpening: boolean;
  borderColor: string;
  accentColor: string;
}): JSX.Element {
  return (
    <View
      className="items-center justify-center bg-white"
      style={{
        width: SIGAA_BUTTON_SIZE,
        height: SIGAA_BUTTON_SIZE,
        borderRadius: SIGAA_BUTTON_SIZE / 2,
        borderWidth: 2,
        borderColor,
      }}
    >
      {isOpening ? (
        <ActivityIndicator color={accentColor} />
      ) : (
        <>
          <UfbaCrest size={24} />
          <Text style={{ marginTop: 2, fontFamily: "Poppins", fontSize: 10, fontWeight: "700", color: accentColor }}>
            SIGAA
          </Text>
        </>
      )}
    </View>
  );
}

/**
 * The app's bottom tab bar, driven entirely by `TabsPager`'s own `progress`
 * shared value rather than React Navigation (there's no navigator behind
 * these four tabs anymore — see TabsPager's docstring). Owns: the four tab
 * buttons, the SIGAA shortcut button, and the sliding indicator bar, which
 * follows `progress` continuously instead of jumping between tabs.
 */
export function BottomTabBar({
  progress,
  activePage,
  onSelectPage,
}: {
  progress: SharedValue<number>;
  activePage: number;
  onSelectPage: (page: number) => void;
}): JSX.Element {
  const { isOpening: isOpeningSigaa, openSigaa } = useOpenSigaa();
  const insets = useSafeAreaInsets();
  const [activeColor, mutedColor, borderColor] = useThemeColor(["accent", "muted", "border"]);
  const activeTabForeground = String(useCSSVariable("--color-tab-active-foreground") ?? "");

  // The indicator's x is computed from this one measurement — the bar's own
  // width — instead of measuring each of the 4 tab buttons individually.
  // Simpler, and there's nothing to race: a single shared value, a single
  // writer. (An earlier version measured all 4 buttons via onLayout, which
  // has no defined order — all 4 fire around the same time on mount, so it's
  // possible for one callback's read-modify-write of a shared array to
  // clobber another's with a stale snapshot.)
  const barWidth = useSharedValue(0);
  const onBarLayout = (event: LayoutChangeEvent): void => {
    barWidth.value = event.nativeEvent.layout.width;
  };

  const indicatorStyle = useAnimatedStyle(() => {
    // The bar is: [padding][tab0][tab1][SIGAA][tab2][tab3][padding], the 4
    // tabs all equal width — each center derived directly from that layout
    // instead of measured.
    const tabWidth = (barWidth.value - BAR_HORIZONTAL_PADDING * 2 - SIGAA_SLOT_WIDTH) / 4;
    const centers = [
      BAR_HORIZONTAL_PADDING + tabWidth * 0.5,
      BAR_HORIZONTAL_PADDING + tabWidth * 1.5,
      BAR_HORIZONTAL_PADDING + tabWidth * 2 + SIGAA_SLOT_WIDTH + tabWidth * 0.5,
      BAR_HORIZONTAL_PADDING + tabWidth * 3 + SIGAA_SLOT_WIDTH + tabWidth * 0.5,
    ];
    const centerX = interpolate(progress.value, [0, 1, 2, 3], centers, Extrapolation.CLAMP);
    return { left: centerX - INDICATOR_WIDTH / 2 };
  });

  return (
    // No padding on this outer wrapper — it exists purely so `top: 0` below
    // means the bar's actual top edge, unambiguously. Putting the indicator
    // directly inside the padded row instead (an earlier version did this)
    // meant "flush with the top" required guessing whether RN measures an
    // absolutely-positioned child's `top: 0` from the row's border edge or
    // from inside its `paddingTop` — it's not the same in every RN version,
    // and guessing wrong put the indicator well above the bar entirely.
    <View onLayout={onBarLayout} style={{ overflow: "visible" }}>
      {/* The row (with its own opaque `bg-surface`) renders FIRST and the
          indicator SECOND — both sit at this wrapper's `top: 0`, and a later
          sibling paints over an earlier one at the same pixels. Indicator
          first (as an earlier version had it) made the row's own background
          paint straight over it, hiding it completely despite otherwise
          being positioned correctly. */}
      <View
        className="flex-row items-center bg-surface"
        style={{
          borderTopWidth: 1,
          borderTopColor: borderColor,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingTop: 10,
          paddingBottom: insets.bottom + 6,
          paddingHorizontal: BAR_HORIZONTAL_PADDING,
        }}
      >
        {PAGES.slice(0, 2).map((page, index) => (
          <AnimatedTabButton
            key={page.label}
            index={index}
            icon={page.icon}
            label={page.label}
            progress={progress}
            mutedColor={mutedColor}
            activeForeground={activeTabForeground}
            onPress={() => onSelectPage(index)}
            selected={activePage === index}
          />
        ))}

        <Pressable
          className="items-center justify-center"
          style={{ width: SIGAA_SLOT_WIDTH }}
          accessibilityRole="button"
          accessibilityLabel="SIGAA"
          onPress={openSigaa}
        >
          <SigaaTabIcon isOpening={isOpeningSigaa} borderColor={borderColor} accentColor={activeColor} />
        </Pressable>

        {PAGES.slice(2, 4).map((page, offset) => {
          const index = offset + 2;
          return (
            <AnimatedTabButton
              key={page.label}
              index={index}
              icon={page.icon}
              label={page.label}
              progress={progress}
              mutedColor={mutedColor}
              activeForeground={activeTabForeground}
              onPress={() => onSelectPage(index)}
              selected={activePage === index}
            />
          );
        })}
      </View>

      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: 0,
            width: INDICATOR_WIDTH,
            height: INDICATOR_HEIGHT,
            borderBottomLeftRadius: INDICATOR_HEIGHT / 2,
            borderBottomRightRadius: INDICATOR_HEIGHT / 2,
            backgroundColor: activeTabForeground,
          },
          indicatorStyle,
        ]}
      />
    </View>
  );
}
