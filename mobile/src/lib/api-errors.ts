import { ApiError } from "./api";

/**
 * Maps a failed API call into a user-facing message. Shared across every
 * screen that talks to SIGAA-backed endpoints (link, schedule, ...), since
 * the failure modes (bad credentials, rate limit, offline, server error)
 * are the same regardless of which endpoint failed.
 */
export function describeApiError(
  error: unknown,
  options: {
    /**
     * The user typed the password into this very screen. A rejected password is
     * then just a wrong password — telling them it "changed" and to go fix it
     * in Perfil would be nonsense while they are standing at the form.
     */
    passwordJustTyped?: boolean;
  } = {},
): string {
  if (!(error instanceof ApiError)) {
    // The request never got a response at all (offline, timeout, DNS, etc.).
    return "Não foi possível conectar ao servidor.";
  }

  if (error.code === "SIGAA_INVALID_CREDENTIALS" && !options.passwordJustTyped) {
    // The one 401 we can be specific about: SIGAA itself said no, which in
    // practice means the student changed their password there. Saying so — and
    // where to fix it — beats a bare "credenciais inválidas" on a screen that
    // has no password field of its own.
    return "Sua senha do SIGAA mudou. Atualize em Perfil › Conta acadêmica.";
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
