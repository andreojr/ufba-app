import { useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Spinner, Typography, useThemeColor, useToast } from "heroui-native";
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { GoogleLogo } from "@/components/GoogleLogo";
import { UfbaCrest } from "@/components/UfbaCrest";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { dangerToast } from "@/lib/toast-helpers";

const ALLOWED_EMAIL_DOMAIN = "@ufba.br";
const UFBA_DOMAIN_TOAST = dangerToast({
  label: "Conta não autorizada",
  description: "Entre com seu e-mail institucional @ufba.br para acessar o app.",
});

type FeatureTone = "accent" | "success" | "warning";

const FEATURES: { icon: AppIconName; text: string; tone: FeatureTone }[] = [
  { icon: "IconClock", text: "Sua semana inteira em uma tela", tone: "accent" },
  { icon: "IconPath", text: "Sua trajetória completa, sempre à mão", tone: "success" },
  { icon: "IconFileText", text: "Atestado e histórico em PDF, na hora", tone: "warning" },
];

const FEATURE_TONE_STYLES: Record<FeatureTone, string> = {
  accent: "bg-accent-soft",
  success: "bg-success-soft",
  warning: "bg-warning-soft",
};

export default function LoginScreen(): JSX.Element {
  const { signIn } = useAuth();
  const { toast } = useToast();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [accentSoftForeground, successSoftForeground, warningSoftForeground] = useThemeColor([
    "accent-soft-foreground",
    "success-soft-foreground",
    "warning-soft-foreground",
  ]);
  const insets = useSafeAreaInsets();

  const featureIconColor: Record<FeatureTone, string> = {
    accent: accentSoftForeground,
    success: successSoftForeground,
    warning: warningSoftForeground,
  };

  async function handlePress(): Promise<void> {
    setIsSigningIn(true);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) {
        return;
      }

      const { idToken, user } = response.data;
      if (!idToken) {
        throw new Error("Google did not return an idToken");
      }

      if (!user.email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
        await GoogleSignin.signOut();
        toast.show(UFBA_DOMAIN_TOAST);
        return;
      }

      await signIn(idToken);
    } catch (error) {
      const wasCancelled = isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED;
      if (!wasCancelled) {
        console.warn("Google sign-in failed", error);
        if (error instanceof ApiError && error.status === 403) {
          toast.show(UFBA_DOMAIN_TOAST);
        } else {
          toast.show(dangerToast({ label: "Não foi possível entrar, tente de novo." }));
        }
      }
    } finally {
      setIsSigningIn(false);
    }
  }

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow justify-center gap-7"
        showsVerticalScrollIndicator={false}
      >
        <UfbaCrest size={56} />

        <View className="gap-3">
          <Typography.Heading type="h1">UFBA</Typography.Heading>
          <Typography.Paragraph color="muted" className="max-w-[300px]">
            Suas notas e seu horário, sem passar pelo SIGAA.
          </Typography.Paragraph>
        </View>

        <View className="gap-3.5">
          {FEATURES.map((feature) => (
            <View key={feature.icon} className="flex-row items-center gap-3">
              <View
                className={`w-[34px] h-[34px] rounded-xl items-center justify-center ${FEATURE_TONE_STYLES[feature.tone]}`}
              >
                <AppIcon name={feature.icon} size={18} color={featureIconColor[feature.tone]} />
              </View>
              <Typography.Paragraph className="flex-1">{feature.text}</Typography.Paragraph>
            </View>
          ))}
        </View>
      </ScrollView>

      <View className="gap-4">
        <Pressable
          disabled={isSigningIn}
          onPress={handlePress}
          accessibilityRole="button"
          className="h-14 rounded-full bg-white flex-row items-center justify-center gap-3"
        >
          {isSigningIn ? (
            <>
              <Spinner />
              <Typography.Paragraph weight="semibold" className="text-black">
                Entrando…
              </Typography.Paragraph>
            </>
          ) : (
            <>
              <GoogleLogo size={20} />
              <Typography.Paragraph weight="semibold" className="text-black">
                Entrar com Google
              </Typography.Paragraph>
            </>
          )}
        </Pressable>
        <Typography.Paragraph type="body-xs" color="muted" align="center">
          Use o e-mail da faculdade. Sua senha do Google fica com o Google.
        </Typography.Paragraph>
      </View>
    </View>
  );
}
