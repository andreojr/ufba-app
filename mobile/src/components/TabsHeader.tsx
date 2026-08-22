import { useRouter } from "expo-router";
import { Avatar, useThemeColor } from "heroui-native";
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgUri } from "react-native-svg";

import { AnimatedPageTitle } from "@/components/AnimatedPageTitle";
import { AppIcon } from "@/components/AppIcon";
import { useAuth } from "@/lib/auth-context";
import { buildGreeting, identidadeAppBar } from "@/lib/user-name";

// Matches heroui-native's Avatar "sm" size (--spacing * 10 = 40px) — see AppBar.
const AVATAR_SIZE_SM_PX = 40;

const STATIC_TITLES: ReadonlyArray<string> = ["", "Minha trajetória", "Insights", "Professores"];

/**
 * The header shared by all four swipeable tabs (TabsPager) — one instance,
 * rendered once above the pager, instead of each tab drawing its own AppBar.
 * The cog and avatar never remount as pages change (that was the actual
 * complaint this replaced: they used to flicker on every swipe since each
 * tab's own AppBar was a fresh instance). Only the title animates, via
 * AnimatedPageTitle — see its docstring for the transition itself.
 *
 * Início's title is the one dynamic case (a "Bom dia/Boa tarde/Boa noite,
 * Nome!" greeting) — ticked independently here, on its own minute interval,
 * rather than threading HomeTab's own clock (which it still keeps, for the
 * schedule countdown/freshness text unrelated to this header) up through
 * TabsPager. Screens other than professor/documentos/etc. that still use the
 * plain `AppBar` component are untouched — this is only for the 4 tab roots.
 */
export function TabsHeader({ activePage }: { activePage: number }): JSX.Element {
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mutedColor = useThemeColor("muted");
  const studentName = auth.status === "signedIn" ? auth.user.name : "";
  const identidade = identidadeAppBar(auth.status === "signedIn" ? auth.user : null);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const greeting = buildGreeting(studentName, now);
  const titles: ReactNode[] = [
    <>
      {greeting.prefix}
      {greeting.name ? (
        <Text testID="app-bar-greeting-name" className="text-accent">
          {greeting.name}
        </Text>
      ) : null}
      {greeting.suffix}
    </>,
    STATIC_TITLES[1],
    STATIC_TITLES[2],
    STATIC_TITLES[3],
  ];

  return (
    <View
      className="flex-row items-center justify-between px-6 pb-3.5 self-stretch"
      style={{ paddingTop: insets.top + 14 }}
    >
      <AnimatedPageTitle pageKey={activePage} title={titles[activePage]} />
      {identidade.initials || identidade.avatarUrl ? (
        <Pressable
          testID="app-bar-profile"
          onPress={() => router.push("/ajustes")}
          className="flex-row items-center gap-2"
        >
          <View testID="app-bar-settings-icon">
            <AppIcon name="IconGear" size={20} color={mutedColor} />
          </View>
          <Avatar size="sm" variant="soft" color="accent">
            {identidade.avatarUrl ? (
              <SvgUri
                testID="app-bar-avatar-image"
                uri={identidade.avatarUrl}
                width={AVATAR_SIZE_SM_PX}
                height={AVATAR_SIZE_SM_PX}
              />
            ) : (
              <Avatar.Fallback>{identidade.initials}</Avatar.Fallback>
            )}
          </Avatar>
        </Pressable>
      ) : null}
    </View>
  );
}
