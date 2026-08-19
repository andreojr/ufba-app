import { ApiError } from "./api";

/**
 * Maps a failed API call into a user-facing message. Shared across every
 * screen that talks to SIGAA-backed endpoints (link, schedule, ...), since
 * the failure modes (bad credentials, rate limit, offline, server error)
 * are the same regardless of which endpoint failed.
 */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    // The request never got a response at all (offline, timeout, DNS, etc.).
    return "Não foi possível conectar ao servidor.";
  }

  switch (error.status) {
    case 401:
      return "Credenciais inválidas";
    case 429:
      return "Muitas tentativas. Aguarde um momento e tente de novo.";
    default:
      return "Algo deu errado no servidor. Tente novamente.";
  }
}
