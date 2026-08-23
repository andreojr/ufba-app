import { useEffect, type JSX } from "react";
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from "@expo-google-fonts/poppins";
import { SourceCodePro_400Regular } from "@expo-google-fonts/source-code-pro";
import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider, useThemeColor } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { configureGoogleSignin } from "@/lib/google-signin";
import { MockAppStateProvider } from "@/lib/mock-app-state";
import { SigaaLinkProvider, useSigaaLink } from "@/lib/sigaa-link-context";
import { SyncFreshnessProvider } from "@/lib/sync-freshness-context";
import { getThemePreference } from "@/lib/theme-preference";

import "../global.css";

function RootNavigator(): JSX.Element | null {
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const [backgroundColor] = useThemeColor(["background"]);

  // Android's root window background (behind every React view) defaults to
  // white regardless of app theme — paint it to match, so it doesn't peek
  // through gaps like the tab bar's rounded corners.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(backgroundColor);
  }, [backgroundColor]);

  if (auth.status === "loading") {
    return null;
  }

  if (auth.status === "signedIn" && sigaaLink.status === "loading") {
    return null;
  }

  // React Navigation paints its own screen/tab-bar containers using this
  // theme's `colors.background`, independent of anything we set via app
  // styles — it defaults to a light gray (rgb(242,242,242)) that peeks
  // through gaps like the tab bar's rounded corners. Override it to match.
  const navigationTheme = {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, background: backgroundColor },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={auth.status === "signedIn"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="link-account" options={{ presentation: "modal" }} />
          <Stack.Screen name="avatar-picker" options={{ presentation: "modal" }} />
          <Stack.Screen name="documentos" />
          <Stack.Screen name="arvore-dependencias" />
          <Stack.Screen name="pontos-atencao" />
          <Stack.Screen name="ponto-de-atencao/novo" />
          <Stack.Screen name="ponto-de-atencao/[id]" />
          <Stack.Screen
            name="sigaa-webview"
            options={{
              presentation: "transparentModal",
              animation: "slide_from_bottom",
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={auth.status === "signedOut"}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
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

  // Uniwind starts up following the system color scheme; apply the saved
  // preference (defaulting to "light") before the first paint the user sees.
  // Guarded by `isMounted`: in dev, React can mount → unmount → remount this
  // component in quick succession, and this effect's promise can still be
  // in flight when that happens. Without the guard, it resolves against the
  // torn-down first mount and calls Uniwind.setTheme() on views Fabric has
  // already discarded — surfacing as a native
  // "Unable to find viewState for tag N" crash.
  useEffect(() => {
    let isMounted = true;
    void getThemePreference().then((preference) => {
      if (isMounted) {
        Uniwind.setTheme(preference);
      }
    });
    return () => {
      isMounted = false;
    };
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
                <SyncFreshnessProvider>
                  <RootNavigator />
                </SyncFreshnessProvider>
              </SigaaLinkProvider>
            </AuthProvider>
          </MockAppStateProvider>
          <StatusBar style="auto" />
        </HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
