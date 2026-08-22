import {
  ApiError,
  getDocente,
  getMe,
  getTrajetoria,
  getVizinhosCurriculares,
  postAvatar,
  postDocentesSemestre,
  postGoogleLogin,
  postSigaaAtestado,
  postSigaaHistorico,
  postTrajetoriaSync,
} from "./api";
import type { Session } from "./types";

const LOGIN_RESPONSE: Session = {
  accessToken: "token",
  user: { id: "1", email: "a@b.com", name: "A", avatarUrl: null },
};

describe("postGoogleLogin", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("posts the idToken and returns the parsed login response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => LOGIN_RESPONSE,
    });

    await expect(postGoogleLogin("id-token")).resolves.toEqual(LOGIN_RESPONSE);

    expect(global.fetch).toHaveBeenCalledWith("http://192.168.1.10:3000/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "id-token" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("throws ApiError when the backend responds with a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    await expect(postGoogleLogin("bad-token")).rejects.toThrow(ApiError);
  });

  it("throws ApiError when EXPO_PUBLIC_API_URL is not configured", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;

    await expect(postGoogleLogin("id-token")).rejects.toThrow(ApiError);
  });

  it("propagates a network failure", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network request failed"));

    await expect(postGoogleLogin("id-token")).rejects.toThrow();
  });
});

describe("postSigaaHistorico", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("posts the credentials and returns the PDF bytes", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => pdfBytes.buffer,
    });

    const result = await postSigaaHistorico("token", { login: "123", senha: "segredo" });

    expect(result).toEqual(pdfBytes);
    expect(global.fetch).toHaveBeenCalledWith("http://192.168.1.10:3000/sigaa/historico", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
      body: JSON.stringify({ login: "123", senha: "segredo" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("throws ApiError when the backend responds with a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });

    await expect(postSigaaHistorico("token", { login: "123", senha: "wrong" })).rejects.toThrow(ApiError);
  });

  it("throws ApiError when EXPO_PUBLIC_API_URL is not configured", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;

    await expect(postSigaaHistorico("token", { login: "123", senha: "segredo" })).rejects.toThrow(ApiError);
  });

  it("throws ApiError when the response body is empty despite a 2xx status (e.g. an aborted fetch resolving instead of rejecting)", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await expect(postSigaaHistorico("token", { login: "123", senha: "segredo" })).rejects.toThrow(ApiError);
  });
});

describe("postSigaaAtestado", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("posts the credentials and returns the self-contained HTML", async () => {
    const html = "<html><body>MATRICULADO</body></html>";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await postSigaaAtestado("token", { login: "123", senha: "segredo" });

    expect(result).toBe(html);
    expect(global.fetch).toHaveBeenCalledWith("http://192.168.1.10:3000/sigaa/atestado", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
      body: JSON.stringify({ login: "123", senha: "segredo" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("throws ApiError when the backend responds with a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });

    await expect(postSigaaAtestado("token", { login: "123", senha: "wrong" })).rejects.toThrow(ApiError);
  });

  it("throws ApiError when EXPO_PUBLIC_API_URL is not configured", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;

    await expect(postSigaaAtestado("token", { login: "123", senha: "segredo" })).rejects.toThrow(ApiError);
  });

  it("throws ApiError when the response body is empty despite a 2xx status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });

    await expect(postSigaaAtestado("token", { login: "123", senha: "segredo" })).rejects.toThrow(ApiError);
  });
});

describe("postAvatar", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("posts the avatar URL and returns it back", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ avatarUrl: "https://api.dicebear.com/9.x/open-peeps/png?seed=abc" }),
    });

    await expect(
      postAvatar("token", "https://api.dicebear.com/9.x/open-peeps/png?seed=abc"),
    ).resolves.toEqual({ avatarUrl: "https://api.dicebear.com/9.x/open-peeps/png?seed=abc" });

    expect(global.fetch).toHaveBeenCalledWith("http://192.168.1.10:3000/users/me/avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
      body: JSON.stringify({ avatarUrl: "https://api.dicebear.com/9.x/open-peeps/png?seed=abc" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("throws ApiError when the backend responds with a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });

    await expect(postAvatar("token", "https://evil.example.com/x.png")).rejects.toThrow(ApiError);
  });
});

describe("getMe", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("fetches the current user record with the access token", async () => {
    const me = {
      id: "1",
      email: "a@b.com",
      name: "A",
      avatarUrl: null,
      matricula: "223116037",
      curso: "ENGENHARIA DE COMPUTAÇÃO",
      periodoIngresso: "2022.1",
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => me,
    });

    await expect(getMe("token")).resolves.toEqual(me);

    expect(global.fetch).toHaveBeenCalledWith("http://192.168.1.10:3000/users/me", {
      method: "GET",
      headers: { Authorization: "Bearer token" },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it("throws ApiError when the backend responds with a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    await expect(getMe("token")).rejects.toThrow(ApiError);
  });
});

describe("trajetória endpoints", () => {
  // Same boilerplate every other block in this file has. Without it the URL is
  // unset by the time this block runs (the preceding block's afterEach restores
  // it to the unset value it had at load time), so `request()` throws before
  // reaching fetch — the first test would reject and the second would crash
  // reading `fetchMock.mock.calls[0]` on a fetch that never happened.
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    // Leaked fake timers break every later test in this file (each render
    // stays pending in the mocked scheduler), which is a hard-to-diagnose
    // cascade — a bare call at the end of one test only protects the tests
    // after it if nothing throws first. Unconditional in afterEach instead.
    jest.useRealTimers();
  });

  it("reports the unsynced state without throwing", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ sincronizado: false }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getTrajetoria("token")).resolves.toEqual({ sincronizado: false });

    expect(fetchMock).toHaveBeenCalledWith("http://192.168.1.10:3000/trajetoria", {
      method: "GET",
      headers: { Authorization: "Bearer token" },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
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

    const promessa = postTrajetoriaSync("token", { login: "1", senha: "2" });
    const assertion = expect(promessa).rejects.toThrow();

    expect(fetchMock.mock.calls[0][0]).toBe("http://192.168.1.10:3000/trajetoria/sync");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
      body: JSON.stringify({ login: "1", senha: "2" }),
    });

    jest.advanceTimersByTime(20_000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);

    jest.advanceTimersByTime(30_000);
    await assertion;
  });
});

describe("postDocentesSemestre", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("posts the turmas and returns the parsed resumos", async () => {
    const resumos = [{ nomeOriginal: "FULANO", componentes: [], perfil: null }];
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resumos,
    });

    const turmas = [{ codigo: "MATA65", nome: "CG", docente: "FULANO" }];
    await expect(postDocentesSemestre("token", turmas)).resolves.toEqual(resumos);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.10:3000/docentes/semestre",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
        body: JSON.stringify({ turmas }),
      }),
    );
  });

  it("surfaces a failed response as an ApiError", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ message: "SIGAA fora do ar" }),
    });
    await expect(postDocentesSemestre("token", [])).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getDocente", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("gets the profile by siape", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ siape: "1815041" }),
    });

    await expect(getDocente("token", "1815041")).resolves.toMatchObject({
      siape: "1815041",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.10:3000/docentes/1815041",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("getVizinhosCurriculares", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("faz GET em /curriculo/meu-curso/componentes/:codigo/vizinhos com o curso na query", async () => {
    const mockResponse = {
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [],
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const resultado = await getVizinhosCurriculares("token-123", "ENGENHARIA/PGCOMP - Salvador", "MATA03");

    expect(resultado).toEqual(mockResponse);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/curriculo/meu-curso/componentes/MATA03/vizinhos");
    expect(url).toContain(`curso=${encodeURIComponent("ENGENHARIA/PGCOMP - Salvador")}`);
    expect(options.headers.Authorization).toBe("Bearer token-123");
  });

  it("gives the request the long document timeout, not the default 10s", async () => {
    // resolverCurso/resolverPorNomeUsuario behind this endpoint can trigger a
    // full live SIGAA scrape when the course structure is missing or stale —
    // same slow flow as postTrajetoriaSync, which is why it needs the same
    // budget instead of the default that aborts mid-scrape.
    jest.useFakeTimers();
    const fetchMock = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const promessa = getVizinhosCurriculares("token-123", "ENGENHARIA/PGCOMP - Salvador", "MATA03");
    const assertion = expect(promessa).rejects.toThrow();

    jest.advanceTimersByTime(20_000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);

    jest.advanceTimersByTime(30_000);
    await assertion;

    jest.useRealTimers();
  });
});
