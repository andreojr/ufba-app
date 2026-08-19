import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { configureGoogleSignin } from "./google-signin";

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: { configure: jest.fn() },
}));

const mockedGoogleSignin = jest.mocked(GoogleSignin);

describe("configureGoogleSignin", () => {
  const originalClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = originalClientId;
    jest.clearAllMocks();
  });

  it("configures GoogleSignin with the webClientId from env", () => {
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = "test-client-id";

    configureGoogleSignin();

    expect(mockedGoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: "test-client-id",
      hostedDomain: "ufba.br",
    });
  });

  it("throws when EXPO_PUBLIC_GOOGLE_CLIENT_ID is not configured", () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

    expect(() => configureGoogleSignin()).toThrow("EXPO_PUBLIC_GOOGLE_CLIENT_ID is not configured");
  });
});
