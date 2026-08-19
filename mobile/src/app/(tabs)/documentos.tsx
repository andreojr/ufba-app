import { Chip, ListGroup, Spinner, Typography, useThemeColor } from "heroui-native";
import { useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { DOCUMENT_DEFS, DOWNLOADED_FILES, type DocumentKey } from "@/lib/mock-data";

type DocStatus = "idle" | "busy" | "ready" | "done";

const DONE_META: Record<DocumentKey, string> = {
  atestado: "baixado agora · 128 KB",
  historico: "baixado em 02/05/2026 · 312 KB",
};

export default function DocumentosTab(): JSX.Element {
  const [statuses, setStatuses] = useState<Record<DocumentKey, DocStatus>>({
    atestado: "idle",
    historico: "done",
  });
  const [accentSoftForeground, accentForeground, successSoftForeground] = useThemeColor([
    "accent-soft-foreground",
    "accent-foreground",
    "success-soft-foreground",
  ]);

  function handlePress(key: DocumentKey): void {
    const current = statuses[key];
    if (current === "ready") {
      setStatuses((prev) => ({ ...prev, [key]: "done" }));
      return;
    }
    if (current === "busy") {
      return;
    }
    setStatuses((prev) => ({ ...prev, [key]: "busy" }));
    setTimeout(() => {
      setStatuses((prev) => ({ ...prev, [key]: "ready" }));
    }, 1600);
  }

  function regenerate(key: DocumentKey): void {
    setStatuses((prev) => ({ ...prev, [key]: "busy" }));
    setTimeout(() => {
      setStatuses((prev) => ({ ...prev, [key]: "ready" }));
    }, 1600);
  }

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Documentos" />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-4 pb-8"
        showsVerticalScrollIndicator={false}
      >
        <Typography.Paragraph color="muted">
          Os dois documentos vêm direto do sistema da faculdade, em PDF.
        </Typography.Paragraph>

        {(Object.keys(DOCUMENT_DEFS) as DocumentKey[]).map((key) => {
          const def = DOCUMENT_DEFS[key];
          const status = statuses[key];
          return (
            <View key={key} className="rounded-3xl bg-surface-secondary p-4 gap-3.5">
              <View className="flex-row items-center gap-3">
                <View
                  className="w-[46px] h-[46px] rounded-2xl items-center justify-center"
                  style={{ backgroundColor: def.tint }}
                >
                  <AppIcon name="IconFileText" size={24} color={def.fg} />
                </View>
                <View className="flex-1 gap-0.5">
                  <Typography.Paragraph weight="medium">{def.title}</Typography.Paragraph>
                  <Typography.Paragraph type="body-xs" color="muted">
                    {def.description}
                  </Typography.Paragraph>
                </View>
              </View>

              {status === "idle" ? (
                <Pressable
                  onPress={() => handlePress(key)}
                  className="h-11 rounded-full bg-accent-soft flex-row items-center justify-center gap-2"
                >
                  <AppIcon name="IconDownloadSimple" size={18} color={accentSoftForeground} />
                  <Typography.Paragraph type="body-sm" weight="medium" className="text-accent">
                    Gerar PDF
                  </Typography.Paragraph>
                </Pressable>
              ) : null}

              {status === "busy" ? (
                <View className="gap-2">
                  <View className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <View className="h-full w-[36%] rounded-full bg-accent" />
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Spinner size="sm" />
                    <Typography.Paragraph type="body-xs" color="muted">
                      Buscando no sistema da faculdade…
                    </Typography.Paragraph>
                  </View>
                </View>
              ) : null}

              {status === "ready" ? (
                <View className="flex-row items-center gap-2.5">
                  <Chip variant="soft" color="success" size="sm">
                    Pronto
                  </Chip>
                  <View className="flex-1" />
                  <Pressable
                    onPress={() => handlePress(key)}
                    className="h-11 px-4.5 rounded-full bg-accent flex-row items-center gap-2"
                  >
                    <AppIcon name="IconDownloadSimple" size={18} color={accentForeground} />
                    <Typography.Paragraph type="body-sm" weight="medium" className="text-white">
                      Baixar
                    </Typography.Paragraph>
                  </Pressable>
                </View>
              ) : null}

              {status === "done" ? (
                <View className="flex-row items-center gap-2.5">
                  <AppIcon name="IconCheck" size={16} color={successSoftForeground} />
                  <Typography.Paragraph type="body-xs" color="muted" className="flex-1">
                    {DONE_META[key]}
                  </Typography.Paragraph>
                  <Pressable onPress={() => regenerate(key)} className="h-9 px-3 justify-center">
                    <Typography.Paragraph type="body-sm" weight="medium" className="text-accent">
                      Gerar de novo
                    </Typography.Paragraph>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}

        <Typography.Paragraph type="body-xs" color="muted" className="pt-1">
          No aparelho
        </Typography.Paragraph>
        <ListGroup>
          {DOWNLOADED_FILES.map((file, index) => (
            <View key={file.title}>
              <ListGroup.Item>
                <ListGroup.ItemPrefix>
                  <AppIcon name="IconDownloadSimple" size={20} />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>{file.title}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>{file.description}</ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
              {index < DOWNLOADED_FILES.length - 1 ? <View className="h-px bg-white/10 mx-4" /> : null}
            </View>
          ))}
        </ListGroup>
      </ScrollView>
    </View>
  );
}
