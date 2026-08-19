import { GoogleSignin } from "@react-native-google-signin/google-signin";

export function configureGoogleSignin(): void {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
  if (!webClientId) {
    throw new Error("EXPO_PUBLIC_GOOGLE_CLIENT_ID is not configured");
  }

  GoogleSignin.configure({ webClientId, hostedDomain: "ufba.br" });
}
