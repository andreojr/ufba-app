import CookieManager from "@react-native-cookies/cookies";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Spinner, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Animated, Dimensions, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { AppIcon } from "@/components/AppIcon";
import { UfbaCrest } from "@/components/UfbaCrest";
import { markSigaaWebviewClosed, markSigaaWebviewOpened } from "@/lib/sigaa-webview-state";

// Not the actual login domain (sigaa.ufba.br can front multiple app servers behind a
// load balancer) — just the cookie's scope, per the SIGAA investigation spike.
const SIGAA_COOKIE_DOMAIN = "sigaa.ufba.br";

const SHEET_RADIUS = 24;
const COLLAPSED_HEIGHT_RATIO = 0.5;
// How far below the collapsed height the user has to drag before it's read
// as "let go of this" rather than "snap back down".
const DISMISS_DRAG_PX = 120;

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
 *
 * The resizable sheet below is hand-rolled with core `Animated` + `PanResponder`
 * instead of `@gorhom/bottom-sheet` on purpose: that library drives the sheet
 * with Reanimated, and Reanimated-driven ancestors are a known trigger for
 * react-native-webview rendering solid black on Android (the WebView's
 * hardware-accelerated surface doesn't composite under a UI-thread transform).
 * Animating `height` here is JS-driven either way (layout props can't use the
 * native driver), so there's no transform ancestor for the WebView to conflict with.
 */
export default function SigaaWebViewScreen(): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [backgroundColor, accentColor] = useThemeColor(["background", "accent"]);
  const { sessionCookie, targetUrl } = useLocalSearchParams<{
    sessionCookie: string;
    targetUrl: string;
  }>();
  const [cookieReady, setCookieReady] = useState(false);
  const [cookieError, setCookieError] = useState(false);

  const windowHeight = Dimensions.get("window").height;
  const collapsedHeight = windowHeight * COLLAPSED_HEIGHT_RATIO;
  const expandedHeight = windowHeight;

  const height = useRef(new Animated.Value(collapsedHeight)).current;
  const heightAtGestureStart = useRef(collapsedHeight);

  // Lets the tab bar's SIGAA button (a world away from here, on the other
  // side of the `router.push` that opened this screen) know a popup is up,
  // so it can stay blocked for as long as this screen is mounted instead of
  // just for the session-minting round trip.
  useEffect(() => {
    markSigaaWebviewOpened();
    return () => {
      markSigaaWebviewClosed();
    };
  }, []);

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

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const snapTo = useCallback(
    (value: number) => {
      Animated.spring(height, {
        toValue: value,
        useNativeDriver: false,
        bounciness: 4,
      }).start();
    },
    [height],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          height.stopAnimation((value) => {
            heightAtGestureStart.current = value;
          });
        },
        onPanResponderMove: (_, gesture) => {
          const next = heightAtGestureStart.current - gesture.dy;
          height.setValue(Math.min(expandedHeight, Math.max(80, next)));
        },
        onPanResponderRelease: (_, gesture) => {
          const current = heightAtGestureStart.current - gesture.dy;
          if (current < collapsedHeight - DISMISS_DRAG_PX) {
            handleClose();
            return;
          }
          const midpoint = (collapsedHeight + expandedHeight) / 2;
          snapTo(current > midpoint ? expandedHeight : collapsedHeight);
        },
      }),
    [collapsedHeight, expandedHeight, handleClose, height, snapTo],
  );

  return (
    <View className="flex-1 justify-end">
      <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />

      <Animated.View
        style={{
          height,
          backgroundColor,
          borderTopLeftRadius: SHEET_RADIUS,
          borderTopRightRadius: SHEET_RADIUS,
          overflow: "hidden",
        }}
      >
        <View
          {...panResponder.panHandlers}
          className="items-center self-stretch"
          style={{ backgroundColor: accentColor }}
        >
          <View className="w-9 h-1 rounded-full bg-white/40 mt-2.5 mb-1.5" />
          <View className="flex-row items-center justify-between px-5 pb-3.5 self-stretch">
            <View className="flex-row items-center gap-2">
              <View className="items-center justify-center rounded-full bg-white p-1">
                <UfbaCrest size={20} />
              </View>
              <Typography.Heading type="h4" style={{ color: "#FFFFFF" }}>
                SIGAA | UFBA
              </Typography.Heading>
            </View>
            <Pressable onPress={handleClose} hitSlop={12}>
              <AppIcon name="IconX" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
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
      </Animated.View>
    </View>
  );
}
