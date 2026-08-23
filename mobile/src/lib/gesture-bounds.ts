import type { GestureTouchEvent } from "react-native-gesture-handler";
import { measure, type AnimatedRef } from "react-native-reanimated";
import type { View } from "react-native";

/**
 * Whether a touch's current position falls inside the on-screen bounds of
 * whatever view `ref` points to — checked in absolute (screen) coordinates,
 * so it's unaffected by any transform an ancestor applies (e.g. the
 * CR/Carga-Horária card's own sliding trilha).
 *
 * Meant to be called from `onTouchesDown`, i.e. at the touch's *origin*: a
 * gesture that fails itself here is opting out for this whole touch, even
 * once the finger has since drifted outside that area's bounds — ownership
 * is decided by where the touch started, not by where it currently is. That
 * is the one property `requireExternalGestureToFail` alone doesn't give:
 * it depends on the nested gesture actually recognizing (e.g. a chart with
 * too little content to scroll never does), where this check is unconditional
 * on geometry alone.
 */
export function tocouDentroDaArea(evento: GestureTouchEvent, ref: AnimatedRef<View>): boolean {
  "worklet";
  // `measure` is documented to return null once a view genuinely isn't
  // rendered yet, but it can also throw outright — e.g. the very first touch
  // this app ever sees, before every mounted screen's charts have committed
  // a layout pass. A crash here would take down the whole gesture (and the
  // app with it), so "couldn't tell" has to fall back to "not inside" rather
  // than propagate.
  let layout;
  try {
    layout = measure(ref);
  } catch {
    return false;
  }
  if (layout === null) {
    return false;
  }
  const toque = evento.changedTouches[0] ?? evento.allTouches[0];
  if (!toque) {
    return false;
  }
  return (
    toque.absoluteX >= layout.pageX &&
    toque.absoluteX <= layout.pageX + layout.width &&
    toque.absoluteY >= layout.pageY &&
    toque.absoluteY <= layout.pageY + layout.height
  );
}
