import { Stack, useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { useEffect, type JSX } from "react";

import { useSigaaLink } from "@/lib/sigaa-link-context";

/**
 * Just two real routes now: `index` (the swipeable four-tab pager — see
 * TabsPager) and `ajustes` (Perfil, a plain full-screen push reached only
 * from the AppBar's cog, no bottom bar behind it). Everything the bottom bar
 * itself needs — the tab buttons, the SIGAA shortcut, the sliding indicator —
 * lives in TabsPager/BottomTabBar now; this layout only owns the onboarding
 * redirect and the two screens' shared options.
 */
export default function TabsLayout(): JSX.Element {
  const router = useRouter();
  const sigaaLink = useSigaaLink();
  const [backgroundColor] = useThemeColor(["background"]);

  // Onboarding gate: send the user to link their SIGAA account before they can use
  // the app, matching the design's flow (Entrada → Vincular conta → Início).
  useEffect(() => {
    if (sigaaLink.status === "unlinked") {
      router.replace("/link-account");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigaaLink.status]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="ajustes" options={{ title: "Perfil" }} />
    </Stack>
  );
}
