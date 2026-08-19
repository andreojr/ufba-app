import { ApiError, getSigaaLink, postGoogleLogin, postSchedule, postSigaaLink } from "../lib/api";

describe("postGoogleLogin", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it("throws an ApiError carrying the status and message from a rejected login", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        message: "Apenas contas @ufba.br podem entrar no Gradline",
      }),
    }) as unknown as typeof fetch;

    const error = await postGoogleLogin("some-id-token").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe(
      "Apenas contas @ufba.br podem entrar no Gradline",
    );
  });
});

describe("postSigaaLink", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it("posts the credentials with the bearer token and rememberPassword flag", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ linked: true }),
    }) as unknown as typeof fetch;

    await postSigaaLink("access-token", { login: "12345678900", senha: "segredo" }, true);

    expect(global.fetch).toHaveBeenCalledWith("https://api.example.com/sigaa/link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
      body: JSON.stringify({ login: "12345678900", senha: "segredo", rememberPassword: true }),
      signal: expect.any(AbortSignal),
    });
  });

  it("throws ApiError when the backend rejects the credentials", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(
      postSigaaLink("access-token", { login: "12345678900", senha: "wrong" }, false),
    ).rejects.toThrow(ApiError);
  });
});

describe("getSigaaLink", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it("returns linked: false when the backend reports no stored credential", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ linked: false }),
    }) as unknown as typeof fetch;

    await expect(getSigaaLink("access-token")).resolves.toEqual({ linked: false });

    expect(global.fetch).toHaveBeenCalledWith("https://api.example.com/sigaa/link", {
      method: "GET",
      headers: { Authorization: "Bearer access-token" },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it("returns the restored credential when the backend has one stored", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ linked: true, login: "12345678900", senha: "segredo" }),
    }) as unknown as typeof fetch;

    await expect(getSigaaLink("access-token")).resolves.toEqual({
      linked: true,
      login: "12345678900",
      senha: "segredo",
    });
  });

  it("throws ApiError on a non-2xx response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(getSigaaLink("access-token")).rejects.toThrow(ApiError);
  });
});

describe("postSchedule", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it("POSTs the credentials with the bearer token and returns the parsed turmas", async () => {
    const turmas = [
      {
        codigo: "MATA37",
        nome: "SISTEMAS OPERACIONAIS",
        slots: [
          {
            dia: "Terça",
            inicioMin: 1110,
            fimMin: 1220,
            predio: "PAF 1",
            sala: "208",
            localOriginal: "PAF 1 - 208 - Terça Horários 18:30 às 19:25",
          },
        ],
        vigencia: { inicio: "19/08/2026", fim: "19/12/2026" },
        semestre: "2026.2",
      },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => turmas,
    }) as unknown as typeof fetch;

    await expect(
      postSchedule("access-token", { login: "12345678900", senha: "segredo" }),
    ).resolves.toEqual(turmas);

    expect(global.fetch).toHaveBeenCalledWith("https://api.example.com/schedule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
      body: JSON.stringify({ login: "12345678900", senha: "segredo" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("throws ApiError when the backend rejects the credentials", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Credenciais inválidas" }),
    }) as unknown as typeof fetch;

    await expect(
      postSchedule("access-token", { login: "12345678900", senha: "wrong" }),
    ).rejects.toThrow(ApiError);
  });
});
