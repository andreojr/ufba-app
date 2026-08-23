import { Typography } from "heroui-native";
import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/**
 * The AppBar title, swapping between pages like a conveyor: the outgoing
 * title slides down and out the bottom of a one-line-tall window, while the
 * incoming one slides down from just above it into place — both moving
 * together, in the same direction, rather than crossfading in place.
 *
 * Triggered by `pageKey` changing (the swipeable pager's settled page index)
 * — not by the title's own content changing on a fixed page. Início's
 * greeting still ticks every minute on its own; that isn't a "page change"
 * and doesn't replay this transition.
 */
export function AnimatedPageTitle({
  pageKey,
  title,
  titleType = "h3",
  trailing,
}: {
  pageKey: number;
  title: ReactNode;
  titleType?: "h1" | "h3" | "h4" | "h5" | "h6";
  /** Sits immediately after the title text, outside the animated window — so a
   * page-specific control (e.g. the density legend's info button) hugs the
   * title instead of drifting off toward the avatar, and does not slide or get
   * clipped along with the title it belongs to. */
  trailing?: ReactNode;
}): JSX.Element {
  const [rendered, setRendered] = useState<{ key: number; title: ReactNode; previousTitle: ReactNode | null }>({
    key: pageKey,
    title,
    previousTitle: null,
  });
  const trackY = useSharedValue(0);
  const [lineHeight, setLineHeight] = useState<number | undefined>(undefined);

  // Drops the outgoing title once its slide finished, identified by page index
  // alone. Deliberately takes a number and not the title itself: this runs as
  // the `withTiming` callback's `scheduleOnRN` payload, i.e. it is serialized
  // from the UI runtime back to JS, and a ReactNode cannot make that trip.
  // Início's title is a JSX Fragment (the greeting), and React elements carry
  // internals (symbols, the owner fiber) that the worklets serializer replaces
  // with a poisoned "inaccessible object" — reading any field of it throws.
  // That's what used to crash the UI runtime on every transition INTO Início:
  // "Property 'WorkletsError' doesn't exist". Every other page's title is a
  // plain string, which is why only Início blew up.
  //
  // Keying by index also makes back-to-back page changes safe: a callback from
  // a superseded transition finds a different key and does nothing, instead of
  // clobbering the current page's title with its own stale capture.
  const finalizarTransicao = useCallback((key: number) => {
    setRendered((atual) => (atual.key === key ? { ...atual, previousTitle: null } : atual));
  }, []);

  useEffect(() => {
    if (pageKey === rendered.key) {
      // Same page — just its own content changed (e.g. the greeting's clock
      // tick). Swap it in directly, no transition.
      setRendered({ key: pageKey, title, previousTitle: null });
      return;
    }

    const outgoing = rendered.title;
    setRendered({ key: pageKey, title, previousTitle: outgoing });
    trackY.value = lineHeight ? -lineHeight : 0;
    trackY.value = withTiming(0, { duration: 260 }, (finished) => {
      if (finished) {
        scheduleOnRN(finalizarTransicao, pageKey);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, title]);

  const measureLine = (event: LayoutChangeEvent): void => {
    // Measured once, off the very first render — every page's title shares
    // the same Typography.Heading type/line-height, so one measurement holds
    // for every transition afterwards.
    if (lineHeight === undefined) {
      setLineHeight(event.nativeEvent.layout.height);
    }
  };

  const incomingStyle = useAnimatedStyle(() => {
    const t = lineHeight ? 1 + trackY.value / lineHeight : 1;
    return { opacity: t };
  });
  const outgoingStyle = useAnimatedStyle(() => {
    const t = lineHeight ? 1 + trackY.value / lineHeight : 1;
    return { opacity: 1 - t };
  });
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateY: trackY.value }] }));

  return (
    <View className="flex-1 flex-row items-center gap-2">
      {/* `shrink` rather than `flex-1` when there is trailing content: the
          window sizes to the title text so the trailing control sits against
          it, while still shrinking to make room on a long title. */}
      <View
        style={{ height: lineHeight, overflow: "hidden" }}
        className={trailing ? "shrink" : "flex-1"}
      >
        <Animated.View style={trackStyle}>
          <Animated.View style={incomingStyle} onLayout={measureLine}>
            <Typography.Heading type={titleType} numberOfLines={1}>
              {rendered.title}
            </Typography.Heading>
          </Animated.View>
          {rendered.previousTitle !== null ? (
            <Animated.View style={outgoingStyle}>
              <Typography.Heading type={titleType} numberOfLines={1}>
                {rendered.previousTitle}
              </Typography.Heading>
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
      {trailing}
    </View>
  );
}
