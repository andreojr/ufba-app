import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor, useToast } from "heroui-native";
import { useState, type JSX } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { putFaltas } from "@/lib/api";
import { describeApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";
import { dangerToast } from "@/lib/toast-helpers";

/** Mesmo teto do DefinirFaltasDto no backend — passar disso ele responderia 400. */
const MAXIMO = 999;

/**
 * Contador manual de faltas de uma turma. Desenhado igual ao AvatarPickerScreen
 * (header com X, conteúdo centralizado, dois botões secundários lado a lado e o
 * "Salvar" full-width no rodapé), trocando as setas por "−" e "+".
 *
 * As faltas não vêm do SIGAA — ele não expõe frequência parcial — então este é
 * o único lugar onde o número nasce.
 */
export default function ContadorFaltasScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const [foregroundColor, dangerForeground] = useThemeColor(["foreground", "danger-foreground"]);
  // A rota vive dentro do <Stack.Protected>, então `signedOut` não chega aqui;
  // o `?? ""` é só pra satisfazer o tipo, como turma/[id].tsx já faz.
  const accessToken = auth.status === "signedIn" ? auth.accessToken : "";

  const { id, faltas: faltasIniciais } = useLocalSearchParams<{
    id: string;
    faltas: string;
  }>();
  // O valor de partida chega pela rota já carregado pela tela da turma, pra
  // abrir o contador sem um segundo GET (e sem piscar um "0" antes do número
  // real). Um param ausente ou corrompido cai em 0, nunca em NaN.
  const [faltas, setFaltas] = useState(() => {
    const parsed = Number.parseInt(faltasIniciais ?? "", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, MAXIMO) : 0;
  });
  const [isSaving, setIsSaving] = useState(false);

  function diminuir(): void {
    setFaltas((atual) => Math.max(atual - 1, 0));
  }

  function aumentar(): void {
    setFaltas((atual) => Math.min(atual + 1, MAXIMO));
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      await putFaltas(accessToken, id, faltas);
      router.back();
    } catch (error) {
      console.warn("Failed to save faltas", error);
      toast.show(
        dangerToast({
          label: describeApiError(error),
          icon: <AppIcon name="IconErrorCircle" size={20} color={dangerForeground} />,
        }),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-6 pb-3.5 self-stretch"
        style={{ paddingTop: insets.top + 14 }}
      >
        <Typography.Heading type="h4">Faltas</Typography.Heading>
        <Pressable testID="contador-faltas-close" onPress={() => router.back()} hitSlop={12}>
          <AppIcon name="IconX" size={24} color={foregroundColor} />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center gap-6 px-6">
        <Typography.Heading testID="contador-faltas-valor" type="h1">
          {faltas}
        </Typography.Heading>
        <Typography.Paragraph color="muted" align="center">
          Conte suas faltas nesta turma. O SIGAA não informa esse número.
        </Typography.Paragraph>
        <View className="flex-row gap-3">
          <Button
            testID="contador-faltas-menos"
            variant="secondary"
            isDisabled={faltas === 0}
            onPress={diminuir}
          >
            <AppIcon name="IconMinus" size={20} color={foregroundColor} />
          </Button>
          <Button
            testID="contador-faltas-mais"
            variant="secondary"
            isDisabled={faltas === MAXIMO}
            onPress={aumentar}
          >
            <AppIcon name="IconPlus" size={20} color={foregroundColor} />
          </Button>
        </View>
      </View>

      <View
        className="gap-2.5 px-6 pt-3.5 bg-background"
        style={{ paddingBottom: insets.bottom + 24 }}
      >
        {isSaving ? (
          <View className="h-14 rounded-full bg-accent-soft flex-row items-center justify-center gap-2.5">
            <Spinner />
            <Typography.Paragraph className="text-accent" weight="medium">
              Salvando…
            </Typography.Paragraph>
          </View>
        ) : (
          <Button size="lg" className="w-full" onPress={handleSave}>
            Salvar
          </Button>
        )}
      </View>
    </View>
  );
}
