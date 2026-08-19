import { useRouter } from "expo-router";
import { cpf as cpfValidator } from "cpf-cnpj-validator";
import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Spinner,
  TextField,
  Typography,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { isSyncModeSelectable, SyncModeSelector } from "@/components/SyncModeSelector";
import { describeApiError } from "@/lib/api-errors";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import type { SyncMode } from "@/lib/types";

// "000.000.000-00" — the longest a masked CPF can ever get, used as the
// Input's native maxLength so the 12th digit never flashes on screen before
// formatCpf() truncates it on the next render.
const CPF_MASKED_MAX_LENGTH = 14;

function formatCpf(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  let out = digits.slice(0, 3);
  if (digits.length > 3) out += "." + digits.slice(3, 6);
  if (digits.length > 6) out += "." + digits.slice(6, 9);
  if (digits.length > 9) out += "-" + digits.slice(9, 11);
  return out;
}

export default function LinkAccountScreen(): JSX.Element {
  const router = useRouter();
  const sigaaLink = useSigaaLink();
  const { toast } = useToast();
  const isLinked = sigaaLink.status === "linked";
  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Um vínculo antigo pode ter sido salvo num modo que hoje está indisponível —
  // nesse caso a edição volta para o único modo que o seletor deixa escolher.
  const [syncMode, setSyncMode] = useState<SyncMode>(
    sigaaLink.status === "linked" && isSyncModeSelectable(sigaaLink.syncMode) ? sigaaLink.syncMode : "device"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accentSoftForeground, successSoftForeground, dangerSoftForeground] = useThemeColor([
    "accent-soft-foreground",
    "success-soft-foreground",
    "danger-soft-foreground",
  ]);
  const insets = useSafeAreaInsets();
  // Not a HeroUI semantic token (useThemeColor only knows its fixed list), so this
  // one's read straight off the CSS custom property registered in global.css.
  const accentShadeRaw = useCSSVariable("--color-accent-shade");
  const accentShade = typeof accentShadeRaw === "string" ? accentShadeRaw : undefined;

  const linkedMeta =
    syncMode === "cloud" ? "Vinculado · sincronizado na nuvem" : "Vinculado · somente neste aparelho";

  const cpfDigits = cpf.replace(/\D/g, "");
  const isCpfComplete = cpfDigits.length === 11;
  const isCpfInvalid = isCpfComplete && !cpfValidator.isValid(cpf);
  const canSubmit = isCpfComplete && !isCpfInvalid && senha.length > 0 && !isSubmitting;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    try {
      // SIGAA at UFBA authenticates by CPF — this IS the `login` value the
      // backend's SigaaLinkDto expects, sent unformatted (digits only).
      await sigaaLink.link(cpfDigits, senha, syncMode);
      router.replace("/(tabs)");
    } catch (error) {
      console.warn("SIGAA link failed", error);
      toast.show({
        variant: "danger",
        label: describeApiError(error),
        icon: <AppIcon name="IconErrorCircle" size={20} color={dangerSoftForeground} />,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUnlink(): Promise<void> {
    await sigaaLink.unlink();
  }

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Conta Acadêmica" />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-4 pt-2 pb-4"
        showsVerticalScrollIndicator={false}
      >
        {isLinked ? (
          <View className="flex-row items-center gap-3 rounded-3xl bg-success-soft px-4 py-3.5">
            <AppIcon name="IconCheckCircle" size={24} color={successSoftForeground} />
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph weight="medium">Conta vinculada</Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted">
                {linkedMeta}
              </Typography.Paragraph>
            </View>
          </View>
        ) : null}

        <Typography.Paragraph color="muted">
          Entre com os mesmos dados que você usa no sistema da faculdade. O Gradline usa isso só
          para buscar suas informações.
        </Typography.Paragraph>

        <TextField isRequired isInvalid={isCpfInvalid}>
          <Label>CPF</Label>
          <Input
            placeholder="000.000.000-00"
            keyboardType="number-pad"
            maxLength={CPF_MASKED_MAX_LENGTH}
            value={cpf}
            onChangeText={(value) => setCpf(formatCpf(value))}
          />
          {isCpfInvalid ? <FieldError>CPF inválido</FieldError> : null}
        </TextField>

        <View className="gap-2">
          <TextField isRequired>
            <Label>Senha do SIGAA</Label>
            <View className="w-full flex-row items-center">
              <Input
                className="flex-1"
                placeholder="Sua senha do sistema"
                secureTextEntry={!showPassword}
                value={senha}
                onChangeText={setSenha}
              />
            </View>
            <Description>A senha continua a mesma do sistema da faculdade</Description>
          </TextField>
          <Pressable
            className="flex-row items-center gap-1.5 self-start"
            onPress={() => setShowPassword((v) => !v)}
          >
            <AppIcon name={showPassword ? "IconEyeSlash" : "IconEye"} size={16} color={accentSoftForeground} />
            <Typography.Paragraph type="body-xs" className="text-accent">
              {showPassword ? "Esconder senha" : "Mostrar senha"}
            </Typography.Paragraph>
          </Pressable>
        </View>

        <SyncModeSelector value={syncMode} onChange={setSyncMode} />
      </ScrollView>

      <View
        className="gap-2.5 px-6 pt-3.5 bg-background"
        style={{ paddingBottom: insets.bottom + 24 }}
      >
        {isSubmitting ? (
          <View className="h-14 rounded-full bg-accent-soft flex-row items-center justify-center gap-2.5">
            <Spinner />
            <Typography.Paragraph className="text-accent" weight="medium">
              Conferindo no SIGAA…
            </Typography.Paragraph>
          </View>
        ) : (
          <Button
            testID="link-submit-button"
            size="lg"
            className="w-full flex-row gap-2"
            isDisabled={!canSubmit}
            onPress={handleSubmit}
          >
            <AppIcon name="IconArrowsClockwise" size={20} color={accentShade} />
            <Button.Label>{isLinked ? "Salvar alterações" : "Vincular conta"}</Button.Label>
          </Button>
        )}
        {isLinked ? (
          <Button
            testID="link-unlink-button"
            variant="danger-soft"
            className="w-full"
            onPress={handleUnlink}
          >
            Desvincular conta
          </Button>
        ) : null}
      </View>
    </View>
  );
}
