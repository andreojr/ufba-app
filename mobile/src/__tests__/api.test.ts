import {
  ApiError,
  deleteAccount,
  getSchedule,
  getSigaaLink,
  onSigaaCredentialsVerdict,
  postGoogleLogin,
  postScheduleSync,
  postSigaaLink,
  putPlano,
} from "../lib/api";

describe("erasing server-side data", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  /** Both endpoints answer 204 with no body at all — nothing to parse. */
  function noContent() {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("204 has no body to parse");
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("DELETEs the whole account", async () => {
    const fetchMock = noContent();

    await deleteAccount("access-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/users/me",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("surfaces a failed erasure instead of pretending the data is gone", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "boom" }),
    }) as unknown as typeof fetch;

    await expect(deleteAccount("access-token")).rejects.toThrow(ApiError);
  });
});

describe("SIGAA credential verdicts", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it("carries the backend's error code on the thrown ApiError", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        message: "SIGAA rejected the provided credentials",
        code: "SIGAA_INVALID_CREDENTIALS",
      }),
    }) as unknown as typeof fetch;

    const error: unknown = await postScheduleSync("token", {
      login: "1",
      senha: "velha",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("SIGAA_INVALID_CREDENTIALS");
  });

  it("says nothing when the rejected password was one the user just typed, not the stored one", async () => {
    const listener = jest.fn();
    const unsubscribe = onSigaaCredentialsVerdict(listener);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "nope", code: "SIGAA_INVALID_CREDENTIALS" }),
    }) as unknown as typeof fetch;

    await postSigaaLink("token", { login: "1", senha: "digitada-errado" }, false).catch(
      () => undefined,
    );

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("reports 'rejected' once for a tagged 401, wherever in the app the call came from", async () => {
    const listener = jest.fn();
    const unsubscribe = onSigaaCredentialsVerdict(listener);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "nope", code: "SIGAA_INVALID_CREDENTIALS" }),
    }) as unknown as typeof fetch;

    await postScheduleSync("token", { login: "1", senha: "velha" }).catch(() => undefined);

    expect(listener).toHaveBeenCalledWith("rejected");
    unsubscribe();
  });

  it("stays quiet on an untagged 401, so our own expired token never reads as a changed SIGAA password", async () => {
    const listener = jest.fn();
    const unsubscribe = onSigaaCredentialsVerdict(listener);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    }) as unknown as typeof fetch;

    await postScheduleSync("token", { login: "1", senha: "certa" }).catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("reports 'accepted' when a call that carries the SIGAA password succeeds", async () => {
    const listener = jest.fn();
    const unsubscribe = onSigaaCredentialsVerdict(listener);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ turmas: [], periodoLetivo: null }),
    }) as unknown as typeof fetch;

    await postScheduleSync("token", { login: "1", senha: "certa" });

    expect(listener).toHaveBeenCalledWith("accepted");
    unsubscribe();
  });

  it("says nothing about the SIGAA password on calls that never send it", async () => {
    const listener = jest.fn();
    const unsubscribe = onSigaaCredentialsVerdict(listener);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ turmas: [] }),
    }) as unknown as typeof fetch;

    await getSchedule("token");

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops calling a listener once it unsubscribes", async () => {
    const listener = jest.fn();
    onSigaaCredentialsVerdict(listener)();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ turmas: [] }),
    }) as unknown as typeof fetch;

    await postScheduleSync("token", { login: "1", senha: "certa" });

    expect(listener).not.toHaveBeenCalled();
  });
});

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

describe("getSchedule", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it("GETs the cached schedule with the bearer token", async () => {
    const schedule = {
      turmas: [
        {
          codigo: "MATA37",
          nome: "SISTEMAS OPERACIONAIS",
          docente: "BEATRIZ NUNES CAMPELO",
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
      ],
      periodoLetivo: { semestre: "2026.2", inicio: "2026-08-19", fim: "2026-12-19" },
      fetchedAt: "2026-08-19T03:35:00.000Z",
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => schedule,
    }) as unknown as typeof fetch;

    await expect(getSchedule("access-token")).resolves.toEqual(schedule);

    expect(global.fetch).toHaveBeenCalledWith("https://api.example.com/schedule", {
      method: "GET",
      headers: { Authorization: "Bearer access-token" },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it("reports the unsynced state without throwing", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sincronizado: false }),
    }) as unknown as typeof fetch;

    await expect(getSchedule("access-token")).resolves.toEqual({ sincronizado: false });
  });
});

describe("postScheduleSync", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.useRealTimers();
  });

  it("POSTs the credentials with the bearer token and returns the turmas plus the periodo letivo", async () => {
    const schedule = {
      turmas: [
        {
          codigo: "MATA37",
          nome: "SISTEMAS OPERACIONAIS",
          docente: "BEATRIZ NUNES CAMPELO",
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
      ],
      periodoLetivo: { semestre: "2026.2", inicio: "2026-08-19", fim: "2026-12-19" },
      fetchedAt: "2026-08-19T03:35:00.000Z",
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => schedule,
    }) as unknown as typeof fetch;

    await expect(
      postScheduleSync("access-token", { login: "12345678900", senha: "segredo" }),
    ).resolves.toEqual(schedule);

    expect(global.fetch).toHaveBeenCalledWith("https://api.example.com/schedule/sync", {
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
      postScheduleSync("access-token", { login: "12345678900", senha: "wrong" }),
    ).rejects.toThrow(ApiError);
  });

  it("gives the sync the long document timeout, not the default", async () => {
    // The sync makes ~7 sequential SIGAA requests server-side. The 10s default
    // aborts mid-scrape, and the fetch polyfill resolves that abort as an empty
    // response — which used to look like a successful-but-empty download.
    jest.useFakeTimers();
    const fetchMock = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const promessa = postScheduleSync("access-token", { login: "1", senha: "2" });
    const assertion = expect(promessa).rejects.toThrow();

    jest.advanceTimersByTime(45_000);
    await assertion;
  });
});

describe("putPlano", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it("putPlano manda os itens para /trajetoria/plano", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sincronizado: false }),
    }) as unknown as typeof fetch;

    await putPlano("token", [{ codigo: "MATA55", nome: "SO", cargaHoraria: 68, semestre: "2027.1" }]);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/trajetoria/plano"),
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
