import { compararVersoes, haAtualizacao } from "./app-version";

describe("compararVersoes", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compararVersoes("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compararVersoes("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compararVersoes("1.0.9", "1.0.10")).toBeLessThan(0);
    expect(compararVersoes("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compararVersoes("1.2.3", "1.2.3")).toBe(0);
  });

  it("pads missing segments with zero", () => {
    expect(compararVersoes("1.2", "1.2.0")).toBe(0);
    expect(compararVersoes("1.2", "1.2.1")).toBeLessThan(0);
  });
});

describe("haAtualizacao", () => {
  it("is true only when the published version is ahead", () => {
    expect(haAtualizacao("1.0.0", "1.1.0")).toBe(true);
    expect(haAtualizacao("1.1.0", "1.1.0")).toBe(false);
  });

  it("is false when the installed build is ahead of what is published", () => {
    // A local/dev build, or a release whose environment variables were rolled
    // back. Nagging the user to "update" to an older APK would be wrong.
    expect(haAtualizacao("1.2.0", "1.1.0")).toBe(false);
  });

  it("is false when either version is unparseable", () => {
    expect(haAtualizacao("", "1.1.0")).toBe(false);
    expect(haAtualizacao("1.0.0", "banana")).toBe(false);
  });
});
