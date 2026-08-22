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
    case 503:
      // The backend refused to overwrite a good cached schedule with an empty
      // SIGAA response (maintenance, matrícula processing, etc.) — say so
      // explicitly instead of the generic "something broke" message.
      return "O SIGAA está temporariamente indisponível.";
    default:
      return "Algo deu errado no servidor. Tente novamente.";
  }
}
