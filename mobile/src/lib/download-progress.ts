/**
 * Calibrated (not measured — the request is a single opaque POST) progress
 * model for the document downloads. The backend walks a fixed sequence of
 * SIGAA requests with known typical timings, so the bar advances through the
 * same stages at the same pace instead of freezing at an arbitrary width:
 * honest in structure, even though no real progress signal exists until the
 * response lands.
 */
export interface ProgressStage {
  /** What the backend is typically doing during this window. */
  label: string;
  /** Typical elapsed time (ms) at which this stage ends. */
  untilMs: number;
  /** Bar fraction reached when this stage ends. */
  untilFraction: number;
}

export interface DownloadProgress {
  /** 0..CEILING — never reaches 1; completion is signaled by the response, not the clock. */
  fraction: number;
  label: string;
}

// Shape of the real flow (see HISTORICO_PDF_INVESTIGATION.md): two quick
// navigation stages, then the PDF-generating postback as the long pole —
// SIGAA builds the document server-side, so most of the wait lives in the
// last stage. The durations were tuned by watching real downloads land —
// stretch them and the bar sits mid-way while the file is already saved.
export const HISTORICO_STAGES: ProgressStage[] = [
  { label: "Entrando no SIGAA…", untilMs: 800, untilFraction: 0.2 },
  { label: "Abrindo o portal do discente…", untilMs: 1400, untilFraction: 0.35 },
  { label: "Gerando o PDF do histórico…", untilMs: 3400, untilFraction: 0.9 },
];

// The atestado is still locally faked (~1.6s) — single stage, generic label.
export const ATESTADO_STAGES: ProgressStage[] = [
  { label: "Gerando o documento…", untilMs: 1600, untilFraction: 0.9 },
];

/** The bar parks here when SIGAA takes longer than typical, still inching forward. */
const CEILING = 0.97;

export function downloadProgress(
  elapsedMs: number,
  stages: ProgressStage[],
): DownloadProgress {
  const elapsed = Math.max(0, elapsedMs);

  let stageStartMs = 0;
  let stageStartFraction = 0;
  for (const stage of stages) {
    if (elapsed <= stage.untilMs) {
      const stageProgress =
        (elapsed - stageStartMs) / (stage.untilMs - stageStartMs);
      return {
        fraction:
          stageStartFraction +
          (stage.untilFraction - stageStartFraction) * stageProgress,
        label: stage.label,
      };
    }
    stageStartMs = stage.untilMs;
    stageStartFraction = stage.untilFraction;
  }

  // Past the calibrated total: approach (but never reach) the ceiling, with a
  // time constant matching the whole calibrated duration, so a slow SIGAA
  // still reads as "working" rather than "stuck".
  const last = stages[stages.length - 1];
  const overshoot = elapsed - last.untilMs;
  const fraction =
    CEILING - (CEILING - last.untilFraction) * Math.exp(-overshoot / last.untilMs);
  return { fraction, label: last.label };
}
