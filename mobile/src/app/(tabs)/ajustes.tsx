import { useRouter } from "expo-router";
import { Avatar, Button, ListGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { useAuth } from "@/lib/auth-context";
import { useMockAppState } from "@/lib/mock-app-state";
import { useSigaaLink } from "@/lib/sigaa-link-context";

export default function AjustesTab(): JSX.Element {
  const router = useRouter();
  const { signOut } = useAuth();
  const { studentName } = useMockAppState();
  const sigaaLink = useSigaaLink();

  const linkedMeta =
    sigaaLink.status === "linked"
      ? sigaaLink.syncMode === "cloud"
        ? "Vinculado · sincronizado na nuvem"
        : "Vinculado · somente neste aparelho"
      : "Não vinculado";

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Ajustes" />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-5 pb-8"
        showsVerticalScrollIndicator={false}
      >
        <View className="rounded-3xl bg-surface-secondary p-4 flex-row items-center gap-3.5">
          <Avatar size="lg" variant="soft" color="accent">
            <Avatar.Fallback>AC</Avatar.Fallback>
          </Avatar>
          <View className="flex-1 gap-0.5">
            <Typography.Paragraph weight="medium">{studentName}</Typography.Paragraph>
            <Typography.Paragraph type="body-sm" color="muted">
              ana.carvalho@ufba.br
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" color="muted">
              Ciência da Computação · 2026.1
            </Typography.Paragraph>
          </View>
        </View>

        <View className="gap-2.5">
          <Typography.Paragraph type="body-xs" color="muted">
            Minha conta
          </Typography.Paragraph>
          <ListGroup>
            <ListGroup.Item onPress={() => router.push("/link-account")}>
              <ListGroup.ItemPrefix>
                <AppIcon name="IconIdentificationCard" size={22} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Conta acadêmica</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{linkedMeta}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
            <View className="h-px bg-white/10 mx-4" />
            <ListGroup.Item onPress={() => router.push("/link-account")}>
              <ListGroup.ItemPrefix>
                <AppIcon name="IconLockKey" size={22} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Editar senha do SIGAA</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  Senha usada para sincronizar com o SIGAA
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
            <View className="h-px bg-white/10 mx-4" />
            <ListGroup.Item>
              <ListGroup.ItemPrefix>
                <AppIcon name="IconChartLineUp" size={22} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Avisos de nota</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  Notificar assim que o professor lança
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
          </ListGroup>
        </View>

        <View className="flex-1 min-h-3" />

        <View className="gap-2.5">
          <Button variant="danger" size="lg" className="w-full" onPress={signOut}>
            Sair da conta
          </Button>
          <Typography.Paragraph type="body-xs" color="muted" align="center">
            Os documentos já baixados continuam neste aparelho.
          </Typography.Paragraph>
        </View>
      </ScrollView>
    </View>
  );
}
