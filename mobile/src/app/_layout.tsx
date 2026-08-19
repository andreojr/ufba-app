import { useEffect, type JSX } from "react";
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from "@expo-google-fonts/poppins";
import { SourceCodePro_400Regular } from "@expo-google-fonts/source-code-pro";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { configureGoogleSignin } from "@/lib/google-signin";
import { MockAppStateProvider } from "@/lib/mock-app-state";
import { SigaaLinkProvider, useSigaaLink } from "@/lib/sigaa-link-context";

import "../global.css";

function RootNavigator(): JSX.Element | null {
  const auth = useAuth();
  const sigaaLink = useSigaaLink();

  if (auth.status === "loading") {
    return null;
  }

  if (auth.status === "signedIn" && sigaaLink.status === "loading") {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={auth.status === "signedIn"}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="link-account" options={{ presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={auth.status === "signedOut"}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout(): JSX.Element | null {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    SourceCodePro_400Regular,
  });

  useEffect(() => {
    configureGoogleSignin();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HeroUINativeProvider>
          <MockAppStateProvider>
            <AuthProvider>
              <SigaaLinkProvider>
                <RootNavigator />
              </SigaaLinkProvider>
            </AuthProvider>
          </MockAppStateProvider>
          <StatusBar style="auto" />
        </HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
