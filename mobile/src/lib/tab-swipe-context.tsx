import { createContext, useContext, useEffect, useRef, type JSX, type ReactNode } from "react";
import type { GestureType } from "react-native-gesture-handler";
import type { AnimatedRef } from "react-native-reanimated";
import type { View } from "react-native";

/** An area the outer tab pager's swipe must never claim, however a touch inside it drifts. */
export type AreaBloqueada = AnimatedRef<View>;

/**
 * Lets a screen inside `TabsPager` register a gesture the pager's own
 * left/right swipe must yield to — the same `requireExternalGestureToFail`
 * relationship `insights.tsx` already uses between its CR/Carga-Horária swipe
 * and the line/bar charts' native scroll gestures, just one level up. Without
 * this, dragging inside (say) Insights' own swipeable card would also be read
 * as "change tab".
 *
 * Takes any `GestureType`, not just `PanGesture` — the pager must wait on the
 * *native* scroll gestures too (charts, the "peso das notas" carousel), not
 * just the Pan gesture that sits between them. Otherwise: drag inside a
 * chart → its native ScrollView wins → that failure cascades and un-blocks
 * the Pan gesture waiting on it → which un-blocks the pager mid-drag, so
 * scrolling a chart also flips the page.
 *
 * Areas (see `useRegisterTabSwipeBlockingArea`) cover the gap that leaves:
 * a gesture race only helps once the nested gesture actually recognizes,
 * which a chart with too little content to scroll never does — so the pager
 * fails itself on touch-down for these regardless of whether anything nested
 * there ever activates, and regardless of where the finger drifts after.
 *
 * All four tab screens mount together (see TabsPager's docstring for why), so
 * a screen registers its gesture once on mount and that's stable for the
 * pager's lifetime — no need to handle a gesture disappearing mid-drag.
 */
const TabSwipeRegistryContext = createContext<{
  register: (gesture: GestureType) => void;
  registerArea: (area: AreaBloqueada) => void;
} | null>(null);

export function TabSwipeRegistryProvider({
  onGesturesChange,
  onAreasChange,
  children,
}: {
  /** Called with the full, deduplicated list every time a new gesture registers. */
  onGesturesChange: (gestures: GestureType[]) => void;
  /** Called with the full, deduplicated list every time a new area registers. */
  onAreasChange: (areas: AreaBloqueada[]) => void;
  children: ReactNode;
}): JSX.Element {
  const gesturesRef = useRef<GestureType[]>([]);
  const register = (gesture: GestureType): void => {
    if (gesturesRef.current.includes(gesture)) {
      return;
    }
    gesturesRef.current = [...gesturesRef.current, gesture];
    onGesturesChange(gesturesRef.current);
  };

  const areasRef = useRef<AreaBloqueada[]>([]);
  const registerArea = (area: AreaBloqueada): void => {
    if (areasRef.current.includes(area)) {
      return;
    }
    areasRef.current = [...areasRef.current, area];
    onAreasChange(areasRef.current);
  };

  return (
    <TabSwipeRegistryContext.Provider value={{ register, registerArea }}>
      {children}
    </TabSwipeRegistryContext.Provider>
  );
}

/** Registers `gesture` as one the outer tab pager must let win first. No-op outside a `TabsPager`. */
export function useRegisterTabSwipeBlockingGesture(gesture: GestureType): void {
  const registry = useContext(TabSwipeRegistryContext);
  useEffect(() => {
    registry?.register(gesture);
    // `gesture` is a fresh Gesture.Pan() object identity every render (built
    // inline via useMemo upstream, same as insights.tsx's existing gestures) —
    // the registry itself dedupes by identity, so re-running this on every
    // change is what actually keeps it in sync rather than stale.
  }, [registry, gesture]);
}

/**
 * Registers `area` as one the outer tab pager must never treat as "change
 * tab", no matter where a touch that started inside it ends up — see
 * `tocouDentroDaArea`, which is what actually reads this list on touch-down.
 */
export function useRegisterTabSwipeBlockingArea(area: AreaBloqueada): void {
  const registry = useContext(TabSwipeRegistryContext);
  useEffect(() => {
    registry?.registerArea(area);
  }, [registry, area]);
}
