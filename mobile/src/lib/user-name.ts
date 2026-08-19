/** Helpers for showing the signed-in student's name — shared by the app bar and Ajustes. */

function words(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/** "Ana Carvalho de Souza" → "Ana". Empty when the name hasn't loaded yet. */
export function getFirstName(name: string): string {
  return words(name)[0] ?? "";
}

/** "ana carvalho de souza" → "AC", for the avatar fallback. */
export function getInitials(name: string): string {
  const [first, second] = words(name);
  return `${first?.[0] ?? ""}${second?.[0] ?? ""}`.toUpperCase();
}

/**
 * "Bom dia, Ana!" split in three so the header can tint the name on its own:
 * `prefix` + `name` + `suffix`. While the name is still loading, `prefix`
 * carries the whole bare greeting and `name` is null.
 */
export interface Greeting {
  prefix: string;
  name: string | null;
  suffix: string;
}

/** Time-of-day greeting addressed to the student. */
export function buildGreeting(name: string, now: Date): Greeting {
  const hour = now.getHours();
  const greeting = hour >= 5 && hour < 12 ? "Bom dia" : hour >= 12 && hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = getFirstName(name);
  return firstName
    ? { prefix: `${greeting}, `, name: firstName, suffix: "!" }
    : { prefix: `${greeting}!`, name: null, suffix: "" };
}
