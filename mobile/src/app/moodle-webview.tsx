import { useRouter } from "expo-router";
import { Spinner, Typography, useThemeColor, useToast } from "heroui-native";
import { useCallback, useMemo, useRef, useState, type JSX } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { AppIcon } from "@/components/AppIcon";
import { UfbaCrest } from "@/components/UfbaCrest";
import { getSiteInfo } from "@/lib/moodle-api";
import {
  buildMoodleLaunchUrl,
  completeMoodleLogin,
  isMoodleReturnUrl,
  newMoodlePassport,
} from "@/lib/moodle-auth";
import { useMoodleLink } from "@/lib/moodle-link-context";
import { dangerToast } from "@/lib/toast-helpers";

/**
 * Hosts the Moodle mobile-app SSO in an embedded WebView instead of the system
 * browser. Why: the flow ends with Moodle redirecting to `ufba-app://token=...`,
 * which is the app's own Expo Router scheme — through the system browser that
 * deep link is handled by Expo Router (→ "Unmatched Route"). Keeping the flow in
 * a WebView lets `onShouldStartLoadWithRequest` catch the redirect before it ever
 * becomes an OS deep link, exactly like `sigaa-webview.tsx` drives SIGAA in-app.
 *
 * The token capture/parse/passport-verify logic lives in `moodle-auth.ts`
 * (`completeMoodleLogin`); this screen only wires it to the WebView and the
 * link context.
 */
export default function MoodleWebViewScreen(): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [backgroundColor, accentColor] = useThemeColor(["background", "accent"]);
  const { finishLink } = useMoodleLink();
  const { toast } = useToast();

  // One passport per screen instance; it must be the same value used to build
  // the launch URL and to verify the returned signature.
  // Lazy state, não `useRef(newMoodlePassport())`: o ref precisaria ser lido
  // durante o render para montar a URL, e um passaporte é exatamente o tipo de
  // valor que não pode ser recriado a cada render. O inicializador preguiçoso
  // roda uma vez e devolve um valor estável, sem leitura de ref no render.
  const [passport] = useState(newMoodlePassport);
  const launchUrl = useMemo(() => buildMoodleLaunchUrl(passport), [passport]);
  // The redirect can fire more than once; only act on the first.
  const handledRef = useRef(false);

  const showFailure = useCallback(() => {
    toast.show(dangerToast({ label: "Não foi possível conectar ao Moodle. Tente novamente." }));
  }, [toast]);

  const handleReturn = useCallback(
    async (url: string): Promise<void> => {
      if (handledRef.current) return;
      handledRef.current = true;

      const result = await completeMoodleLogin(url, passport, (wstoken, siteUrl) =>
        getSiteInfo({ wstoken, siteUrl, userId: 0 }).then((info) => info.userId),
      );

      if (result.status === "success") {
        try {
          await finishLink(result.session);
        } catch {
          showFailure();
        }
      } else if (result.status === "failed") {
        showFailure();
      }

      router.back();
    },
    [finishLink, showFailure, router, passport],
  );

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View className="flex-1" style={{ backgroundColor, paddingTop: insets.top }}>
      <View
        className="flex-row items-center justify-between px-5 py-3.5"
        style={{ backgroundColor: accentColor }}
      >
        <View className="flex-row items-center gap-2">
          <View className="items-center justify-center rounded-full bg-white p-1">
            <UfbaCrest size={20} />
          </View>
          <Typography.Heading type="h4" style={{ color: "#FFFFFF" }}>
            Moodle | AVA UFBA
          </Typography.Heading>
        </View>
        <Pressable onPress={handleClose} hitSlop={12}>
          <AppIcon name="IconX" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
        <WebView
          source={{ uri: launchUrl }}
          originWhitelist={["*"]}
          sharedCookiesEnabled
          startInLoadingState
          onShouldStartLoadWithRequest={(request) => {
            if (isMoodleReturnUrl(request.url)) {
              void handleReturn(request.url);
              return false;
            }
            return true;
          }}
          renderLoading={() => (
            <View className="flex-1 items-center justify-center">
              <Spinner />
            </View>
          )}
        />
      </View>
    </View>
  );
}
