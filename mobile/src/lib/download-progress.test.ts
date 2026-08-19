import {
  ATESTADO_STAGES,
  downloadProgress,
  HISTORICO_STAGES,
} from "./download-progress";

describe("downloadProgress", () => {
  it("starts at zero with the first stage's label", () => {
    const progress = downloadProgress(0, HISTORICO_STAGES);

    expect(progress.fraction).toBe(0);
    expect(progress.label).toBe("Entrando no SIGAA…");
  });

  it("advances through the calibrated stage labels as time passes", () => {
    expect(downloadProgress(500, HISTORICO_STAGES).label).toBe(
      "Entrando no SIGAA…",
    );
    expect(downloadProgress(1200, HISTORICO_STAGES).label).toBe(
      "Abrindo o portal do discente…",
    );
    expect(downloadProgress(3000, HISTORICO_STAGES).label).toBe(
      "Gerando o PDF do histórico…",
    );
  });

  it("reaches each stage's calibrated fraction exactly at its boundary", () => {
    const [first, second] = HISTORICO_STAGES;

    expect(downloadProgress(first.untilMs, HISTORICO_STAGES).fraction).toBe(
      first.untilFraction,
    );
    expect(downloadProgress(second.untilMs, HISTORICO_STAGES).fraction).toBe(
      second.untilFraction,
    );
  });

  it("interpolates linearly inside a stage", () => {
    const [first] = HISTORICO_STAGES;
    const halfway = downloadProgress(first.untilMs / 2, HISTORICO_STAGES);

    expect(halfway.fraction).toBeCloseTo(first.untilFraction / 2, 5);
  });

  it("keeps creeping forward past the calibrated total but never hits 100% (the SIGAA can always be slower than typical)", () => {
    const last = HISTORICO_STAGES[HISTORICO_STAGES.length - 1];
    const justPast = downloadProgress(last.untilMs + 1000, HISTORICO_STAGES);
    const wayPast = downloadProgress(last.untilMs + 60_000, HISTORICO_STAGES);

    expect(justPast.fraction).toBeGreaterThan(last.untilFraction);
    expect(wayPast.fraction).toBeGreaterThan(justPast.fraction);
    expect(wayPast.fraction).toBeLessThan(1);
    expect(wayPast.label).toBe("Gerando o PDF do histórico…");
  });

  it("is monotonic: more elapsed time never moves the bar backwards", () => {
    let previous = -1;
    for (let t = 0; t <= 30_000; t += 250) {
      const { fraction } = downloadProgress(t, HISTORICO_STAGES);
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    }
  });

  it("clamps negative elapsed time to the start", () => {
    expect(downloadProgress(-500, HISTORICO_STAGES).fraction).toBe(0);
  });

  it("supports the single-stage atestado calibration", () => {
    const progress = downloadProgress(800, ATESTADO_STAGES);

    expect(progress.label).toBe("Gerando o documento…");
    expect(progress.fraction).toBeGreaterThan(0);
    expect(progress.fraction).toBeLessThan(1);
  });
});
