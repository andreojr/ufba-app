const DIA_MS = 24 * 60 * 60 * 1000;
const TTL_DIAS = 30;
const JITTER_DIAS = 3;

/**
 * When a freshly written row should next be resynced.
 *
 * Computed at write time, not at read time: a jitter re-rolled on every read
 * would make the same row flip between fresh and stale. Stored in a column so
 * the policy is inspectable in the database instead of hidden in a formula.
 *
 * The jitter matters because a term's docentes are all resolved in one burst.
 * With a flat 30 days they would all expire on the same afternoon and the first
 * screen open past that line would pay every resync at once.
 */
export function calcularStaleAfter(agora: Date): Date {
  const jitter = (Math.random() * 2 - 1) * JITTER_DIAS * DIA_MS;
  return new Date(agora.getTime() + TTL_DIAS * DIA_MS + jitter);
}
