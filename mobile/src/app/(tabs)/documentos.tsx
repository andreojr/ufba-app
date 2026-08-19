import { Chip, ListGroup, Typography, useThemeColor } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { describeApiError } from "@/lib/api-errors";
import { postSigaaAtestado, postSigaaHistorico } from "@/lib/api";
import { htmlToPdfBytes } from "@/lib/html-to-pdf";
import { useAuth } from "@/lib/auth-context";
import {
  ATESTADO_STAGES,
  downloadProgress,
  HISTORICO_STAGES,
  type ProgressStage,
} from "@/lib/download-progress";
import { DOCUMENT_DEFS, type DocumentKey } from "@/lib/mock-data";
import {
  getSavedSigaaDocument,
  openSavedSigaaDocument,
  saveSigaaDocument,
  type SavedSigaaDocument,
} from "@/lib/sigaa-documents";
import { getSigaaCredentials } from "@/lib/sigaa-storage";

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

function formatDocMeta(document: SavedSigaaDocument): string {
  const kb = Math.max(1, Math.round(document.size / 1024));
  return `baixado em ${document.savedAt.toLocaleDateString("pt-BR")} · ${kb} KB`;
}

/**
 * The download is a single opaque POST, so there is no real progress signal
 * to render — instead the bar walks the backend's actual stages at their
 * typical pace (see download-progress.ts) and parks near the end if SIGAA is
 * slower than usual. Completion is signaled by the card leaving "busy", never
 * by the bar reaching 100% on its own.
 */
function DownloadProgressBar({ stages }: { stages: ProgressStage[] }): JSX.Element {
  const [progress, setProgress] = useState(() => downloadProgress(0, stages));

  useEffect(() => {
    // Elapsed time is accumulated per tick (not Date.now()) so the bar is
    // driven purely by the timer — slight drift is irrelevant for a
    // calibrated estimate, and it keeps the component testable under fake
    // timers that don't mock Date.
    const tickMs = 120;
    let elapsedMs = 0;
    const timer = setInterval(() => {
      elapsedMs += tickMs;
      setProgress(downloadProgress(elapsedMs, stages));
    }, tickMs);
    return () => clearInterval(timer);
  }, [stages]);

  return (
    <View className="gap-2">
      <View className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
        <View
          className="h-full rounded-full bg-accent"
          style={{ width: `${progress.fraction * 100}%` }}
        />
      </View>
      <Typography.Paragraph type="body-xs" color="muted">
        {progress.label}
      </Typography.Paragraph>
    </View>
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

  const savedDocuments = DOCUMENT_KEYS.map((key) => {
    const document = documentOf(states[key]);
    return document ? { key, document } : null;
  }).filter((entry): entry is { key: DocumentKey; document: SavedSigaaDocument } => entry !== null);

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
                <View className="flex-row items-center gap-2.5">
                  <AppIcon name="IconCheck" size={16} color={successSoftForeground} />
                  <Typography.Paragraph type="body-xs" color="muted" className="flex-1">
                    {formatDocMeta(state.document)}
                  </Typography.Paragraph>
                  <Pressable onPress={() => download(key)} className="h-9 px-3 justify-center">
                    <Typography.Paragraph type="body-sm" weight="medium" className="text-accent">
                      Gerar de novo
                    </Typography.Paragraph>
                  </Pressable>
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
                      <ListGroup.ItemDescription>{formatDocMeta(document)}</ListGroup.ItemDescription>
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
