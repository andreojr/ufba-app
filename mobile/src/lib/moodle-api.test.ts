import { ApiError } from "./api";
import { callMoodle, getSiteInfo, onMoodleTokenVerdict } from "./moodle-api";
import type { MoodleSession } from "./moodle-storage";

const session: MoodleSession = {
  wstoken: "tok",
  siteUrl: "https://ava.ufba.br",
  userId: 42,
};

function mockFetchOnce(body: unknown): void {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as typeof fetch;
}

afterEach(() => jest.restoreAllMocks());

describe("callMoodle", () => {
  it("posts wstoken, wsfunction and json format", async () => {
    mockFetchOnce({ ok: true });
    await callMoodle(session, "core_webservice_get_site_info");

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://ava.ufba.br/webservice/rest/server.php");
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get("wstoken")).toBe("tok");
    expect(sent.get("wsfunction")).toBe("core_webservice_get_site_info");
    expect(sent.get("moodlewsrestformat")).toBe("json");
  });

  it("throws MOODLE_INVALID_TOKEN and notifies listeners on invalidtoken", async () => {
    mockFetchOnce({ exception: "moodle_exception", errorcode: "invalidtoken", message: "x" });
    const listener = jest.fn();
    const unsub = onMoodleTokenVerdict(listener);

    await expect(callMoodle(session, "core_webservice_get_site_info")).rejects.toMatchObject({
      code: "MOODLE_INVALID_TOKEN",
    });
    expect(listener).toHaveBeenCalledWith("expired");
    unsub();
  });

  it("throws a generic ApiError on other exceptions", async () => {
    mockFetchOnce({ exception: "moodle_exception", errorcode: "nopermission", message: "no" });
    await expect(callMoodle(session, "whatever")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getSiteInfo", () => {
  it("maps the user id", async () => {
    mockFetchOnce({ userid: 7, functions: [{ name: "core_course_get_contents" }] });
    await expect(getSiteInfo(session)).resolves.toEqual({ userId: 7 });
  });
});
