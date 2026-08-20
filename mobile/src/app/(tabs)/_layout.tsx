import { Tabs, useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { useEffect, type JSX } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { UfbaCrest } from "@/components/UfbaCrest";
import { useOpenSigaa } from "@/lib/use-open-sigaa";
import { useSigaaLink } from "@/lib/sigaa-link-context";

const UFBA_BLUE = "#2B3A8F";
const SIGAA_BUTTON_SIZE = 64;

function TabIcon({ name, color }: { name: AppIconName; color: string }): JSX.Element {
  return <AppIcon name={name} size={22} color={color} />;
}

/**
 * The tab bar's dedicated SIGAA button — a plain white circle, raised clear
 * of the bar itself (negative `marginTop`, and the bar's `overflow: "visible"`
 * below so it isn't clipped), carrying the crest and the "SIGAA" wordmark
 * together so it reads as a shortcut rather than another section.
 */
function SigaaTabIcon({ isOpening, borderColor }: { isOpening: boolean; borderColor: string }): JSX.Element {
  return (
    <View
      className="items-center justify-center bg-white"
      style={{
        width: SIGAA_BUTTON_SIZE,
        height: SIGAA_BUTTON_SIZE,
        borderRadius: SIGAA_BUTTON_SIZE / 2,
        marginTop: -SIGAA_BUTTON_SIZE * 0.1,
        borderWidth: 2,
        borderColor,
      }}
    >
      {isOpening ? (
        <ActivityIndicator color={UFBA_BLUE} />
      ) : (
        <>
          <UfbaCrest size={24} />
          <Text
            style={{
              marginTop: 2,
              fontFamily: "Poppins",
              fontSize: 10,
              fontWeight: "700",
              color: UFBA_BLUE,
            }}
          >
            SIGAA
          </Text>
        </>
      )}
    </View>
  );
}

export default function TabsLayout(): JSX.Element {
  const router = useRouter();
  const sigaaLink = useSigaaLink();
  const { isOpening: isOpeningSigaa, openSigaa } = useOpenSigaa();
  const [activeColor, inactiveColor, surfaceColor, borderColor, backgroundColor] = useThemeColor([
    "accent",
    "muted",
    "surface",
    "border",
    "background",
  ]);

  // Onboarding gate: send the user to link their SIGAA account before they can use
  // the app, matching the design's flow (Entrada → Vincular conta → Início).
  useEffect(() => {
    if (sigaaLink.status === "unlinked") {
      router.replace("/link-account");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigaaLink.status]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarStyle: {
          backgroundColor: surfaceColor,
          borderTopColor: borderColor,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          // Lets the SIGAA button's circle poke out above the bar instead of
          // being clipped at its top edge.
          overflow: "visible",
          // Android's default elevation shadow renders behind the bar using its
          // un-rounded rectangular bounds, so it peeks out past the rounded
          // corners as a light gray patch. Disable it since we already draw a
          // hairline border above for separation.
          elevation: 0,
        },
        sceneStyle: { backgroundColor },
        tabBarLabelStyle: { fontFamily: "Poppins", fontSize: 11, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Início",
          tabBarIcon: ({ color }) => <TabIcon name="IconHouse" color={color} />,
        }}
      />
      <Tabs.Screen
        name="trajetoria"
        options={{
          title: "Trajetória",
          tabBarIcon: ({ color }) => <TabIcon name="IconPath" color={color} />,
        }}
      />
      <Tabs.Screen
        name="sigaa"
        options={{
          tabBarShowLabel: false,
          tabBarLabel: () => null,
          tabBarIcon: () => <SigaaTabIcon isOpening={isOpeningSigaa} borderColor={borderColor} />,
        }}
        listeners={{
          tabPress: (e) => {
            // This tab never actually navigates — it's a shortcut button
            // wearing a tab's clothes, so the SIGAA popup can be reached
            // from any tab without leaving it.
            e.preventDefault();
            openSigaa();
          },
        }}
      />
      <Tabs.Screen
        name="documentos"
        options={{
          title: "Documentos",
          tabBarIcon: ({ color }) => <TabIcon name="IconFileText" color={color} />,
        }}
      />
      <Tabs.Screen
        name="professores"
        options={{
          title: "Professores",
          tabBarIcon: ({ color }) => <TabIcon name="IconChalkboardTeacher" color={color} />,
        }}
      />
      {/* Reachable only from the AppBar's cog now, not the tab bar itself — the
          route stays registered here (Expo Router needs it to resolve
          `/ajustes`) but `href: null` is what actually hides its tab. */}
      <Tabs.Screen
        name="ajustes"
        options={{
          title: "Ajustes",
          href: null,
        }}
      />
    </Tabs>
  );
}
