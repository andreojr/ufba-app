import type { Session } from "./types";

export class ApiError extends Error {}

export async function postGoogleLogin(idToken: string): Promise<Session> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new ApiError(`Google login failed with status ${response.status}`);
  }

  return (await response.json()) as Session;
}
