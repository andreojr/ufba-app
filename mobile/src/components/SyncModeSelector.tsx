import { Chip, Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { Pressable, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import type { SyncMode } from "@/lib/types";

type SyncOption = {
  mode: SyncMode;
  icon: "IconDeviceMobile" | "IconCloudCheck";
  title: string;
  description: string;
  // Nada no app consome a sincronização na nuvem ainda — o cartão fica visível
  // como prévia, mas não é selecionável. Para liberar, basta remover o flag.
  comingSoon?: boolean;
};

const SYNC_OPTIONS: SyncOption[] = [
  {
    mode: "device",
    icon: "IconDeviceMobile",
    title: "Somente neste aparelho",
    description:
      "Os documentos que você já baixou aparecem em qualquer aparelho onde você entrar com o Google. Para buscar informação nova, é preciso estar com este celular em mãos.",
  },
  {
    mode: "cloud",
    icon: "IconCloudCheck",
    title: "Sincronizar na nuvem",
    description:
      "Seu acesso fica sempre atualizado em qualquer aparelho, e o app avisa assim que o professor lança uma nota.",
    comingSoon: true,
  },
];

export function SyncModeSelector({
  value,
  onChange,
  title = "Onde guardar esses dados",
}: {
  value: SyncMode;
  onChange: (mode: SyncMode) => void;
  title?: string;
}): JSX.Element {
  const [accentSoftForeground, warningSoftForeground, mutedColor] = useThemeColor([
    "accent-soft-foreground",
    "warning-soft-foreground",
    "muted",
  ]);

  return (
    <>
      <Typography.Paragraph weight="medium" className="pt-1">
        {title}
      </Typography.Paragraph>

      {SYNC_OPTIONS.map((option) => {
        const isComingSoon = option.comingSoon === true;
        const isSelected = !isComingSoon && value === option.mode;
        return (
          <Pressable
            key={option.mode}
            testID={`sync-option-${option.mode}`}
            disabled={isComingSoon}
            accessibilityState={{ disabled: isComingSoon, selected: isSelected }}
            onPress={() => {
              if (isComingSoon) return;
              onChange(option.mode);
            }}
            className={`gap-3 rounded-3xl p-4 border-2 ${
              isComingSoon
                ? "bg-surface-secondary border-transparent opacity-50"
                : isSelected
                  ? "bg-accent-soft border-accent"
                  : "bg-surface-secondary border-transparent"
            }`}
          >
            <View className="flex-row items-center gap-2.5">
              <AppIcon name={option.icon} size={24} color={isSelected ? accentSoftForeground : mutedColor} />
              <Typography.Paragraph weight="medium" className="flex-1" color={isComingSoon ? "muted" : undefined}>
                {option.title}
              </Typography.Paragraph>
              {isComingSoon ? (
                <Chip variant="secondary" size="sm">
                  Em breve
                </Chip>
              ) : isSelected ? (
                <AppIcon name="IconCheckCircle" size={20} color={accentSoftForeground} />
              ) : null}
            </View>
            <Typography.Paragraph type="body-xs" color="muted">
              {option.description}
            </Typography.Paragraph>
            {option.mode === "device" ? (
              <View className="gap-1.5">
                <View className="flex-row items-center gap-2">
                  <AppIcon name="IconWarningCircle" size={16} color={warningSoftForeground} />
                  <Typography.Paragraph type="body-xs" className="text-warning-soft-foreground">
                    Sem aviso de nota lançada
                  </Typography.Paragraph>
                </View>
                <View className="flex-row items-center gap-2">
                  <AppIcon name="IconWarningCircle" size={16} color={warningSoftForeground} />
                  <Typography.Paragraph type="body-xs" className="text-warning-soft-foreground">
                    Sem atualização em segundo plano
                  </Typography.Paragraph>
                </View>
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                <Chip variant="soft" color="accent" size="sm">
                  Criptografado
                </Chip>
                <Chip variant="soft" color="success" size="sm">
                  Avisos de nota
                </Chip>
                <Chip variant="secondary" size="sm">
                  Qualquer aparelho
                </Chip>
              </View>
            )}
            {isComingSoon ? (
              <View className="flex-row items-center gap-2">
                <AppIcon name="IconClock" size={16} color={mutedColor} />
                <Typography.Paragraph type="body-xs" color="muted">
                  Ainda estamos preparando essa opção — em breve ela fica disponível.
                </Typography.Paragraph>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </>
  );
}

/** Um modo só é escolhível enquanto não estiver marcado como `comingSoon`. */
export function isSyncModeSelectable(mode: SyncMode): boolean {
  return SYNC_OPTIONS.some((option) => option.mode === mode && option.comingSoon !== true);
}
