import type { Session } from "./types";

export class ApiError extends Error {}

export async function postGoogleLogin(idToken: string): Promise<Session> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured");
  }

  const response = await fetch(`${baseUrl}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new ApiError(`Google login failed with status ${response.status}`);
  }

  return (await response.json()) as Session;
}
