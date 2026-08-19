import { buildGreeting, getFirstName, getInitials } from "./user-name";

function at(hour: number, minute = 0): Date {
  return new Date(2026, 7, 19, hour, minute);
}

describe("getFirstName", () => {
  it("takes the first word of a full name", () => {
    expect(getFirstName("Ana Carvalho de Souza")).toBe("Ana");
  });

  it("ignores surrounding whitespace", () => {
    expect(getFirstName("  Ana  Carvalho ")).toBe("Ana");
  });

  it("returns an empty string for an empty name", () => {
    expect(getFirstName("")).toBe("");
  });
});

describe("getInitials", () => {
  it("combines the first letter of the first two names, uppercased", () => {
    expect(getInitials("ana carvalho de souza")).toBe("AC");
  });

  it("returns a single initial when there is only one name", () => {
    expect(getInitials("Ana")).toBe("A");
  });

  it("returns an empty string for an empty name", () => {
    expect(getInitials("")).toBe("");
  });
});

describe("buildGreeting", () => {
  it("splits the name out of the greeting so it can be tinted on its own", () => {
    expect(buildGreeting("Ana Carvalho", at(9))).toEqual({
      prefix: "Bom dia, ",
      name: "Ana",
      suffix: "!",
    });
  });

  it("greets with 'Bom dia' from 5h to 11h59", () => {
    expect(buildGreeting("Ana Carvalho", at(5)).prefix).toBe("Bom dia, ");
    expect(buildGreeting("Ana Carvalho", at(11, 59)).prefix).toBe("Bom dia, ");
  });

  it("greets with 'Boa tarde' from 12h to 17h59", () => {
    expect(buildGreeting("Ana Carvalho", at(12)).prefix).toBe("Boa tarde, ");
    expect(buildGreeting("Ana Carvalho", at(17, 59)).prefix).toBe("Boa tarde, ");
  });

  it("greets with 'Boa noite' from 18h to 4h59, across midnight", () => {
    expect(buildGreeting("Ana Carvalho", at(18)).prefix).toBe("Boa noite, ");
    expect(buildGreeting("Ana Carvalho", at(23, 59)).prefix).toBe("Boa noite, ");
    expect(buildGreeting("Ana Carvalho", at(0)).prefix).toBe("Boa noite, ");
    expect(buildGreeting("Ana Carvalho", at(4, 59)).prefix).toBe("Boa noite, ");
  });

  it("drops the comma and the name when the name is not loaded yet", () => {
    expect(buildGreeting("", at(9))).toEqual({ prefix: "Bom dia!", name: null, suffix: "" });
    expect(buildGreeting("   ", at(20))).toEqual({ prefix: "Boa noite!", name: null, suffix: "" });
  });
});
