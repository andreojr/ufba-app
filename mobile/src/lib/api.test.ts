import { ApiError, postGoogleLogin } from "./api";
import type { Session } from "./types";

const LOGIN_RESPONSE: Session = {
  accessToken: "token",
  user: { googleId: "1", email: "a@b.com", name: "A" },
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
