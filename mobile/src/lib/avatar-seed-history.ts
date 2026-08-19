/**
 * Bookkeeping for the avatar picker's "seta pra esquerda / seta pra direita" flow.
 *
 * Keeps a sliding window of seeds so navigating never feels laggy: at any point the
 * next `AVATAR_LOOKAHEAD` seeds (current + 4 ahead) already exist, so the caller can
 * kick off their fetches ahead of time instead of only once the user lands on them.
 * The full history is capped at `AVATAR_MAX_HISTORY` — once exceeded, the oldest seed
 * is dropped and the current index shifts down to match, which is why going back is
 * bounded to at most `AVATAR_MAX_HISTORY - 1` steps.
 */

export const AVATAR_LOOKAHEAD = 3;
export const AVATAR_MAX_HISTORY = 10;

export interface AvatarSeedHistoryState {
  seeds: string[];
  currentIndex: number;
}

function withLookahead(
  seeds: string[],
  currentIndex: number,
  generateSeed: () => string
): string[] {
  const next = [...seeds];
  while (next.length < currentIndex + AVATAR_LOOKAHEAD) {
    next.push(generateSeed());
  }
  return next;
}

function capHistory(seeds: string[], currentIndex: number): AvatarSeedHistoryState {
  const overflow = seeds.length - AVATAR_MAX_HISTORY;
  if (overflow <= 0) {
    return { seeds, currentIndex };
  }
  return { seeds: seeds.slice(overflow), currentIndex: currentIndex - overflow };
}

export function initAvatarSeedHistory(
  initialSeed: string,
  generateSeed: () => string
): AvatarSeedHistoryState {
  return capHistory(withLookahead([initialSeed], 0, generateSeed), 0);
}

export function goNext(
  state: AvatarSeedHistoryState,
  generateSeed: () => string
): AvatarSeedHistoryState {
  const currentIndex = state.currentIndex + 1;
  return capHistory(withLookahead(state.seeds, currentIndex, generateSeed), currentIndex);
}

export function goPrevious(state: AvatarSeedHistoryState): AvatarSeedHistoryState {
  return { ...state, currentIndex: Math.max(0, state.currentIndex - 1) };
}
