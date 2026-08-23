/**
 * "há 5 min" / "há 3 horas" / "há 2 dias" — shared by every screen that shows
 * staleness. Scales the unit to the age instead of always counting in
 * minutes: a sync from yesterday read as "há 1203 min" forces the reader to
 * do the division themselves, which is exactly the job this function exists
 * to do for them.
 */
export function relativeFreshness(loadedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - loadedAt.getTime()) / 60_000));
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return minutes === 1 ? "há 1 min" : `há ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "há 1 hora" : `há ${hours} horas`;

  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "há 1 dia" : `há ${days} dias`;

  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? "há 1 mês" : `há ${months} meses`;

  const years = Math.round(months / 12);
  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}
