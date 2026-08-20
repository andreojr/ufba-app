import { useSyncExternalStore } from "react";

/**
 * Tracks whether the SIGAA webview popup is currently mounted.
 *
 * The tab bar's SIGAA button (in `useOpenSigaa`) needs to know when the popup
 * it pushed has actually closed, but it lives on the other side of a
 * `router.push` from the webview screen — no shared component tree, so a
 * plain module-level store beats a context here. There's only ever one
 * webview instance at a time, and the button needs to read this before the
 * screen has even mounted, to ignore a rapid double-tap on open.
 */
let isOpen = false;
const listeners = new Set<() => void>();

export function markSigaaWebviewOpened(): void {
  isOpen = true;
  listeners.forEach((listener) => listener());
}

export function markSigaaWebviewClosed(): void {
  isOpen = false;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return isOpen;
}

export function useIsSigaaWebviewOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
