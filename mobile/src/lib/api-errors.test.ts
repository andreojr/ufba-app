import { ApiError } from "./api";
import { describeApiError } from "./api-errors";

describe("describeApiError", () => {
  it("says the server is unreachable when there was no response at all", () => {
    expect(describeApiError(new Error("network request failed"))).toBe(
      "Não foi possível conectar ao servidor.",
    );
  });

  it("names invalid credentials on 401", () => {
    expect(describeApiError(new ApiError("nope", 401))).toBe("Credenciais inválidas");
  });

  it("names the actual problem, and the fix, when SIGAA is the one rejecting the password", () => {
    expect(
      describeApiError(new ApiError("nope", 401, "SIGAA_INVALID_CREDENTIALS")),
    ).toBe("Sua senha do SIGAA mudou. Atualize em Perfil › Conta acadêmica.");
  });

  it("says only that the credentials are wrong when the user just typed them", () => {
    expect(
      describeApiError(new ApiError("nope", 401, "SIGAA_INVALID_CREDENTIALS"), {
        passwordJustTyped: true,
      }),
    ).toBe("Credenciais inválidas");
  });

  it("asks to wait on 429", () => {
    expect(describeApiError(new ApiError("nope", 429))).toBe(
      "Muitas tentativas. Aguarde um momento e tente de novo.",
    );
  });

  // The backend refuses to overwrite a good cached schedule with an empty
  // SIGAA response (matrícula processing, maintenance, ...) and answers 503
  // instead of a generic 500 — name SIGAA specifically instead of the
  // generic "something broke on the server" message.
  it("names SIGAA specifically on 503", () => {
    expect(describeApiError(new ApiError("nope", 503))).toBe(
      "O SIGAA está temporariamente indisponível.",
    );
  });

  it("falls back to a generic server error for anything else", () => {
    expect(describeApiError(new ApiError("nope", 500))).toBe(
      "Algo deu errado no servidor. Tente novamente.",
    );
  });
});
