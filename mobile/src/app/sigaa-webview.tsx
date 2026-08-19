import CookieManager from "@react-native-cookies/cookies";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Spinner, Typography, useThemeColor } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { AppIcon } from "@/components/AppIcon";
import { UfbaCrest } from "@/components/UfbaCrest";

// Not the actual login domain (sigaa.ufba.br can front multiple app servers behind a
// load balancer) — just the cookie's scope, per the SIGAA investigation spike.
const SIGAA_COOKIE_DOMAIN = "sigaa.ufba.br";

/**
 * Opens the real sigaa.ufba.br already authenticated, by injecting the session
 * cookie (`sessionCookie` param, a raw `JSESSIONID=<value>` pair minted by
 * POST /sigaa/session) into the WebView's own cookie store before it loads.
 *
 * This has to be a cookie-jar injection, not a `source.headers` cookie — headers set
 * on a WebView's `source` only apply to its very first request. Once the user is
 * inside SIGAA, clicking menus/links fires JSF postbacks the WebView's own browser
 * engine drives, and those wouldn't carry a header we set. Cookies in the jar,
 * though, ride along automatically on every request that engine makes.
 */
export default function SigaaWebViewScreen(): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const foregroundColor = useThemeColor("foreground");
  const { sessionCookie, targetUrl } = useLocalSearchParams<{
    sessionCookie: string;
    targetUrl: string;
  }>();
  const [cookieReady, setCookieReady] = useState(false);
  const [cookieError, setCookieError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function injectSessionCookie(): Promise<void> {
      const separatorIndex = sessionCookie.indexOf("=");
      if (separatorIndex === -1) {
        if (!cancelled) setCookieError(true);
        return;
      }

      try {
        await CookieManager.set(targetUrl, {
          name: sessionCookie.slice(0, separatorIndex),
          value: sessionCookie.slice(separatorIndex + 1),
          domain: SIGAA_COOKIE_DOMAIN,
          path: "/",
          secure: true,
        });
        if (!cancelled) setCookieReady(true);
      } catch (error) {
        console.warn("Failed to inject SIGAA session cookie", error);
        if (!cancelled) setCookieError(true);
      }
    }

    injectSessionCookie();
    return () => {
      cancelled = true;
    };
  }, [sessionCookie, targetUrl]);

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-6 pb-3.5 self-stretch"
        style={{ paddingTop: insets.top + 14 }}
      >
        <View className="flex-row items-center gap-2">
          <UfbaCrest size={22} />
          <Typography.Heading type="h4">SIGAA | UFBA</Typography.Heading>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <AppIcon name="IconX" size={24} color={foregroundColor} />
        </Pressable>
      </View>

      {cookieError ? (
        <View className="flex-1 items-center justify-center px-8 gap-2">
          <Typography.Paragraph color="muted" align="center">
            Não foi possível abrir o SIGAA já logado. Tente novamente.
          </Typography.Paragraph>
        </View>
      ) : !cookieReady ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <WebView
          source={{ uri: targetUrl }}
          sharedCookiesEnabled
          startInLoadingState
          renderLoading={() => (
            <View className="flex-1 items-center justify-center">
              <Spinner />
            </View>
          )}
        />
      )}
    </View>
  );
}
