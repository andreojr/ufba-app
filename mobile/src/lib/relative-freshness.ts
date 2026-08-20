/** "há 5 min" / "agora mesmo" — shared by every screen that shows staleness. */
export function relativeFreshness(loadedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - loadedAt.getTime()) / 60_000));
  if (minutes < 1) return "agora mesmo";
  if (minutes === 1) return "há 1 min";
  return `há ${minutes} min`;
}
