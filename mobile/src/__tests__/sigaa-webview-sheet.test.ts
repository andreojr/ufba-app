import { COLLAPSED_HEIGHT_RATIO, sigaaSheetHeights } from "@/lib/sigaa-webview-sheet";

describe("sigaaSheetHeights", () => {
  it("keeps the expanded sheet clear of the top safe-area inset", () => {
    const { expanded } = sigaaSheetHeights(800, 47);

    expect(expanded).toBe(753);
  });

  it("collapses to half the window", () => {
    const { collapsed } = sigaaSheetHeights(800, 47);

    expect(collapsed).toBe(800 * COLLAPSED_HEIGHT_RATIO);
  });

  it("never lets the collapsed stop overshoot the expanded one", () => {
    const { collapsed, expanded } = sigaaSheetHeights(800, 600);

    expect(collapsed).toBeLessThanOrEqual(expanded);
  });
});
