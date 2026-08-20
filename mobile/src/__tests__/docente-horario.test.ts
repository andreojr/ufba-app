import { decodeHorario } from "@/lib/docente-horario";

describe("decodeHorario", () => {
  it("decodes a single day, single slot morning code", () => {
    expect(decodeHorario("35M12")).toBe("Ter e Qui · 07h00–08h45");
  });

  it("decodes a two-day afternoon code with a slot range", () => {
    expect(decodeHorario("24T34")).toBe("Seg e Qua · 14h50–16h35");
  });

  it("decodes a night code", () => {
    expect(decodeHorario("6N12")).toBe("Sex · 18h30–20h10");
  });

  it("strips the trailing validity-range suffix disciplinas.jsf appends", () => {
    expect(decodeHorario("24T34 (19/08/2026 - 19/12/2026)")).toBe("Seg e Qua · 14h50–16h35");
  });

  // A docente teaching the same turma across two weekly meetings emits two
  // codes separated by whitespace — only the first becomes the label.
  it("uses only the first code when the schedule lists more than one", () => {
    expect(decodeHorario("3N12  5N12 (02/03/2020 - 11/07/2020)")).toBe("Ter · 18h30–20h10");
  });

  it("returns null for a code that does not match the known format", () => {
    expect(decodeHorario("não informado")).toBeNull();
  });

  it("returns null for empty or missing input", () => {
    expect(decodeHorario("")).toBeNull();
    expect(decodeHorario(null)).toBeNull();
    expect(decodeHorario(undefined)).toBeNull();
  });
});
