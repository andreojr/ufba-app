import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { useAuth } from "@/lib/auth-context";
import { identidadeAppBar } from "@/lib/user-name";

/**
 * Placeholder while the real Professores feature (SIGAA docente lookup —
 * see docs/superpowers/plans/2026-08-19-professores.md) is being built. The
 * tab is registered now so the icon and its position in the bar are final.
 */
export default function ProfessoresTab(): JSX.Element {
  const auth = useAuth();
  const identidade = identidadeAppBar(auth.status === "signedIn" ? auth.user : null);
  const mutedColor = useThemeColor("muted");

  return (
    <View className="flex-1">
      <AppBar title="Professores" {...identidade} />
      <View className="flex-1 items-center justify-center gap-3 px-8">
        <AppIcon name="IconChalkboardTeacher" size={40} color={mutedColor} />
        <Typography.Heading type="h4" align="center">
          Em desenvolvimento
        </Typography.Heading>
        <Typography.Paragraph color="muted" align="center">
          Em breve você vai poder ver aqui os perfis públicos dos seus professores no SIGAA.
        </Typography.Paragraph>
      </View>
    </View>
  );
}
