const DIA_MS = 24 * 60 * 60 * 1000;
const TTL_DIAS = 30;
const JITTER_DIAS = 3;

/**
 * When a freshly written Curso/EstruturaCurricular row should next be
 * resynced. Computed at write time, not read time, so the jitter doesn't
 * flip the same row between fresh and stale on every read — see
 * docentes/stale.ts for the identical rationale (this module doesn't import
 * it: two small, independently-evolvable copies over one shared dependency
 * between otherwise-unrelated features).
 */
export function calcularStaleAfter(agora: Date): Date {
  const jitter = (Math.random() * 2 - 1) * JITTER_DIAS * DIA_MS;
  return new Date(agora.getTime() + TTL_DIAS * DIA_MS + jitter);
}

/**
 * Whether the `Curso` directory (last written wholesale at `atualizadoEm`) is
 * old enough to warrant a full re-fetch of lista.jsf. Deliberately no jitter
 * here, unlike `calcularStaleAfter`: every row in the directory shares the
 * exact same `atualizadoEm` (one wholesale write), so there is no batch of
 * independently-aged rows to spread expiry across — jitter would only add
 * noise to what is a single yes/no decision.
 */
export function diretorioDesatualizado(atualizadoEm: Date, agora: Date): boolean {
  return agora.getTime() - atualizadoEm.getTime() > TTL_DIAS * DIA_MS;
}
