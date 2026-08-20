import type { JSX } from "react";

/**
 * Never actually shown — the tab bar's SIGAA button always intercepts
 * `tabPress` (see `_layout.tsx`) and opens the SIGAA popup instead of
 * navigating here. The route still has to exist for Expo Router to resolve
 * the tab.
 */
export default function SigaaTab(): JSX.Element | null {
  return null;
}
