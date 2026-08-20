import { Chip, ListGroup, Typography, useThemeColor } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { DownloadProgressBar } from "@/components/DownloadProgressBar";
import { describeApiError } from "@/lib/api-errors";
import { postSigaaAtestado, postSigaaHistorico } from "@/lib/api";
import { htmlToPdfBytes } from "@/lib/html-to-pdf";
import { useAuth } from "@/lib/auth-context";
import { ATESTADO_STAGES, HISTORICO_STAGES } from "@/lib/download-progress";
import { DOCUMENT_DEFS, type DocumentKey } from "@/lib/mock-data";
import {
  deleteSigaaDocument,
  getSavedSigaaDocument,
  openSavedSigaaDocument,
  saveSigaaDocument,
  type SavedSigaaDocument,
} from "@/lib/sigaa-documents";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { identidadeAppBar } from "@/lib/user-name";

/**
 * Every state but `idle` carries the copy already on the device (when there is
 * one): downloading again must not make the existing file vanish from the UI
 * — having it on the device is precisely what spares the user the wait. The
 * pointer only moves once new bytes have landed.
 */
type DocState =
  | { status: "idle" }
  | { status: "busy"; document: SavedSigaaDocument | null }
  | { status: "done"; document: SavedSigaaDocument }
  | { status: "error"; message: string; document: SavedSigaaDocument | null };

const DOCUMENT_KEYS = Object.keys(DOCUMENT_DEFS) as DocumentKey[];

function documentOf(state: DocState): SavedSigaaDocument | null {
  return state.status === "idle" ? null : state.document;
}

/**
 * "<data> · <tamanho>" — no "baixado em" here: the card above already says
 * "Baixado" next to the checkmark, so repeating it in this row (which only
 * shows once the doc is on the device, in the "No aparelho" list) would be
 * the same fact twice. Both values are numeric, so both render in the
 * monospace font; the separator stays in the surrounding text's own font.
 */
function DocMeta({ document }: { document: SavedSigaaDocument }): JSX.Element {
  const kb = Math.max(1, Math.round(document.size / 1024));
  return (
    <>
      <Text className="font-mono">{document.savedAt.toLocaleDateString("pt-BR")}</Text> ·{" "}
      <Text className="font-mono">{kb} KB</Text>
    </>
  );
}

/**
 * Both documents come from SIGAA behind the student's credentials, differing
 * only in shape: histórico is a real PDF byte stream, while the atestado is a
 * print-ready HTML page (assets inlined by the backend) that the device renders
 * to a PDF via expo-print (see ATESTADO_MATRICULA_INVESTIGATION.md). Either way
 * the result is PDF bytes we persist and list identically.
 */
async function generateDocument(
  key: DocumentKey,
  accessToken: string,
  credentials: { login: string; senha: string },
): Promise<Uint8Array> {
  if (key === "historico") {
    return postSigaaHistorico(accessToken, credentials);
  }
  const html = await postSigaaAtestado(accessToken, credentials);
  return htmlToPdfBytes(html);
}

export default function DocumentosTab(): JSX.Element {
  const auth = useAuth();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const identidade = identidadeAppBar(auth.status === "signedIn" ? auth.user : null);

  const [states, setStates] = useState<Record<DocumentKey, DocState>>({
    atestado: { status: "idle" },
    historico: { status: "idle" },
  });
  const [accentForeground, successSoftForeground, mutedColor] = useThemeColor([
    "accent-foreground",
    "success-soft-foreground",
    "muted",
  ]);

  useEffect(() => {
    setStates((prev) => {
      const next = { ...prev };
      for (const key of DOCUMENT_KEYS) {
        const saved = getSavedSigaaDocument(key);
        if (saved) {
          next[key] = { status: "done", document: saved };
        }
      }
      return next;
    });
  }, []);

  async function download(key: DocumentKey): Promise<void> {
    // Whatever is already on the device rides along through this download, so
    // it stays listed (and openable) the whole time — only a successful save
    // replaces it.
    const previous = documentOf(states[key]);
    const fail = (message: string): void =>
      setStates((prev) => ({ ...prev, [key]: { status: "error", message, document: previous } }));

    setStates((prev) => ({ ...prev, [key]: { status: "busy", document: previous } }));

    if (!accessToken) {
      fail("Faça login para baixar documentos.");
      return;
    }
    const credentials = await getSigaaCredentials();
    if (!credentials) {
      fail("Vincule sua conta do SIGAA para baixar documentos.");
      return;
    }

    try {
      const bytes = await generateDocument(key, accessToken, {
        login: credentials.login,
        senha: credentials.senha,
      });
      const document = saveSigaaDocument(key, bytes);
      setStates((prev) => ({ ...prev, [key]: { status: "done", document } }));
    } catch (error) {
      console.warn(`Failed to download ${key}`, error);
      fail(describeApiError(error));
    }
  }

  function confirmDelete(key: DocumentKey): void {
    Alert.alert(
      "Excluir documento?",
      `${DOCUMENT_DEFS[key].title} será removido do aparelho. Você pode gerar de novo quando quiser.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => {
            deleteSigaaDocument(key);
            setStates((prev) => ({ ...prev, [key]: { status: "idle" } }));
          },
        },
      ],
    );
  }

  const savedDocuments = DOCUMENT_KEYS.map((key) => {
    const document = documentOf(states[key]);
    return document ? { key, document } : null;
  }).filter((entry): entry is { key: DocumentKey; document: SavedSigaaDocument } => entry !== null);

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Documentos" {...identidade} />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-4 pb-8"
        showsVerticalScrollIndicator={false}
      >
        <Typography.Paragraph color="muted">
          Os dois documentos vêm direto do sistema da faculdade, em PDF.
        </Typography.Paragraph>

        {DOCUMENT_KEYS.map((key) => {
          const def = DOCUMENT_DEFS[key];
          const state = states[key];
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

              {state.status === "idle" ? (
                <Pressable
                  onPress={() => download(key)}
                  className="h-11 rounded-full bg-accent flex-row items-center justify-center gap-2"
                >
                  <AppIcon name="IconDownloadSimple" size={18} color={accentForeground} />
                  <Typography.Paragraph type="body-sm" weight="medium" className="text-white">
                    Baixar
                  </Typography.Paragraph>
                </Pressable>
              ) : null}

              {state.status === "busy" ? (
                <DownloadProgressBar
                  stages={key === "historico" ? HISTORICO_STAGES : ATESTADO_STAGES}
                />
              ) : null}

              {state.status === "done" ? (
                <View className="gap-2.5">
                  <View className="flex-row items-center gap-2.5">
                    <AppIcon name="IconCheck" size={16} color={successSoftForeground} />
                    <Typography.Paragraph type="body-xs" color="muted" className="flex-1">
                      Baixado
                    </Typography.Paragraph>
                  </View>
                  <View className="flex-row items-center gap-3">
                    <Pressable onPress={() => confirmDelete(key)} className="h-11 px-3 justify-center">
                      <Typography.Paragraph type="body-sm" weight="medium" className="text-danger">
                        Excluir
                      </Typography.Paragraph>
                    </Pressable>
                    <Pressable
                      onPress={() => download(key)}
                      className="flex-1 h-11 rounded-full bg-accent flex-row items-center justify-center gap-2"
                    >
                      <Typography.Paragraph type="body-sm" weight="medium" className="text-white">
                        Gerar de novo
                      </Typography.Paragraph>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {state.status === "error" ? (
                <View className="gap-2">
                  <Chip variant="soft" color="danger" size="sm">
                    {state.message}
                  </Chip>
                  <Pressable
                    onPress={() => download(key)}
                    className="h-11 rounded-full bg-accent flex-row items-center justify-center gap-2"
                  >
                    <AppIcon name="IconDownloadSimple" size={18} color={accentForeground} />
                    <Typography.Paragraph type="body-sm" weight="medium" className="text-white">
                      Tentar de novo
                    </Typography.Paragraph>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}

        {savedDocuments.length > 0 ? (
          <>
            <Typography.Paragraph type="body-xs" color="muted" className="pt-1">
              No aparelho
            </Typography.Paragraph>
            <ListGroup>
              {savedDocuments.map(({ key, document }, index) => (
                <View key={key}>
                  <ListGroup.Item onPress={() => openSavedSigaaDocument(document)}>
                    <ListGroup.ItemPrefix>
                      <AppIcon name="IconDownloadSimple" size={20} color={mutedColor} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{DOCUMENT_DEFS[key].title}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>
                        <DocMeta document={document} />
                      </ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix />
                  </ListGroup.Item>
                  {index < savedDocuments.length - 1 ? <View className="h-px bg-white/10 mx-4" /> : null}
                </View>
              ))}
            </ListGroup>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
