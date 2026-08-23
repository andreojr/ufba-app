/**
 * Height math for the SIGAA webview's resizable sheet.
 *
 * Lives outside the screen so the snap points can be unit-tested without
 * mounting a WebView. The expanded stop deliberately stops short of the top
 * safe-area inset: the sheet is anchored to the bottom of a full-screen
 * transparent modal, so a stop at the full window height would slide its
 * header (and rounded corners) under the status bar / notch.
 */
export const COLLAPSED_HEIGHT_RATIO = 0.5;

export type SheetHeights = {
  collapsed: number;
  expanded: number;
};

export function sigaaSheetHeights(windowHeight: number, topInset: number): SheetHeights {
  const expanded = windowHeight - topInset;
  return {
    collapsed: Math.min(windowHeight * COLLAPSED_HEIGHT_RATIO, expanded),
    expanded,
  };
}
