import { proximoSemestre } from "./semestre";

describe("proximoSemestre", () => {
  it("avança de .1 para .2 no mesmo ano", () => {
    expect(proximoSemestre("2026.1")).toBe("2026.2");
  });

  it("avança de .2 para .1 do ano seguinte", () => {
    expect(proximoSemestre("2026.2")).toBe("2027.1");
  });
});
