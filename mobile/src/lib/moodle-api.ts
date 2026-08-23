import { ApiError } from "./api";
import type { MoodleSession } from "./moodle-storage";

export type MoodleTokenVerdict = "valid" | "expired";
type VerdictListener = (verdict: MoodleTokenVerdict) => void;
const verdictListeners = new Set<VerdictListener>();

export function onMoodleTokenVerdict(listener: VerdictListener): () => void {
  verdictListeners.add(listener);
  return () => {
    verdictListeners.delete(listener);
  };
}

function reportVerdict(verdict: MoodleTokenVerdict): void {
  for (const listener of verdictListeners) {
    listener(verdict);
  }
}

export type MoodleSiteInfo = { userId: number };

function isMoodleException(
  body: unknown,
): body is { exception: string; errorcode: string; message: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { exception?: unknown }).exception === "string"
  );
}

export async function callMoodle<T>(
  session: MoodleSession,
  wsfunction: string,
  params: Record<string, string> = {},
): Promise<T> {
  const body = new URLSearchParams({
    wstoken: session.wstoken,
    wsfunction,
    moodlewsrestformat: "json",
    ...params,
  });

  const response = await fetch(`${session.siteUrl}/webservice/rest/server.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json: unknown = await response.json();

  if (isMoodleException(json)) {
    if (json.errorcode === "invalidtoken") {
      reportVerdict("expired");
      throw new ApiError(json.message, response.status, "MOODLE_INVALID_TOKEN");
    }
    throw new ApiError(json.message, response.status, json.errorcode);
  }

  return json as T;
}

export async function getSiteInfo(session: MoodleSession): Promise<MoodleSiteInfo> {
  const raw = await callMoodle<{ userid: number }>(
    session,
    "core_webservice_get_site_info",
  );
  return { userId: raw.userid };
}
