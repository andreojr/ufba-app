import { createContext, useContext, useEffect, useRef, type JSX, type ReactNode } from "react";
import type { PanGesture } from "react-native-gesture-handler";

/**
 * Lets a screen inside `TabsPager` register a gesture the pager's own
 * left/right swipe must yield to — the same `requireExternalGestureToFail`
 * relationship `insights.tsx` already uses between its CR/Carga-Horária swipe
 * and the line/bar charts' native scroll gestures, just one level up. Without
 * this, dragging inside (say) Insights' own swipeable card would also be read
 * as "change tab".
 *
 * All four tab screens mount together (see TabsPager's docstring for why), so
 * a screen registers its gesture once on mount and that's stable for the
 * pager's lifetime — no need to handle a gesture disappearing mid-drag.
 */
const TabSwipeRegistryContext = createContext<{
  register: (gesture: PanGesture) => void;
} | null>(null);

export function TabSwipeRegistryProvider({
  onGesturesChange,
  children,
}: {
  /** Called with the full, deduplicated list every time a new gesture registers. */
  onGesturesChange: (gestures: PanGesture[]) => void;
  children: ReactNode;
}): JSX.Element {
  const gesturesRef = useRef<PanGesture[]>([]);
  const register = (gesture: PanGesture): void => {
    if (gesturesRef.current.includes(gesture)) {
      return;
    }
    gesturesRef.current = [...gesturesRef.current, gesture];
    onGesturesChange(gesturesRef.current);
  };

  return (
    <TabSwipeRegistryContext.Provider value={{ register }}>{children}</TabSwipeRegistryContext.Provider>
  );
}

/** Registers `gesture` as one the outer tab pager must let win first. No-op outside a `TabsPager`. */
export function useRegisterTabSwipeBlockingGesture(gesture: PanGesture): void {
  const registry = useContext(TabSwipeRegistryContext);
  useEffect(() => {
    registry?.register(gesture);
    // `gesture` is a fresh Gesture.Pan() object identity every render (built
    // inline via useMemo upstream, same as insights.tsx's existing gestures) —
    // the registry itself dedupes by identity, so re-running this on every
    // change is what actually keeps it in sync rather than stale.
  }, [registry, gesture]);
}
