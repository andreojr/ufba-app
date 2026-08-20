import { formatTempoLecionando } from "@/lib/tempo-lecionando";

describe("formatTempoLecionando", () => {
  it("keeps a single semester as-is — a fraction of a year reads stranger than the count", () => {
    expect(formatTempoLecionando(1)).toBe("Há 1 semestre");
  });

  it("converts two semesters into one whole year", () => {
    expect(formatTempoLecionando(2)).toBe("Há 1 ano");
  });

  // Floored, not rounded: 3 semestres is one complete year plus a semester
  // still running, not two — rounding up would claim an unfinished year.
  it("floors an odd semester count instead of rounding up an unfinished year", () => {
    expect(formatTempoLecionando(3)).toBe("Há 1 ano");
    expect(formatTempoLecionando(5)).toBe("Há 2 anos");
  });

  it("pluralizes years past one", () => {
    expect(formatTempoLecionando(60)).toBe("Há 30 anos");
  });
});
