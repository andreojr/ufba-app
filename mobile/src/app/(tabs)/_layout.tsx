import { Tabs, useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { useEffect, type JSX } from "react";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { useSigaaLink } from "@/lib/sigaa-link-context";

function TabIcon({ name, color }: { name: AppIconName; color: string }): JSX.Element {
  return <AppIcon name={name} size={22} color={color} />;
}

export default function TabsLayout(): JSX.Element {
  const router = useRouter();
  const sigaaLink = useSigaaLink();
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
        name="documentos"
        options={{
          title: "Documentos",
          tabBarIcon: ({ color }) => <TabIcon name="IconFileText" color={color} />,
        }}
      />
      <Tabs.Screen
        name="ajustes"
        options={{
          title: "Ajustes",
          tabBarIcon: ({ color }) => <TabIcon name="IconGear" color={color} />,
        }}
      />
    </Tabs>
  );
}
