import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { Linking, Pressable, View } from "react-native";

import { baixarEInstalar, InstalacaoIndisponivelError } from "@/lib/app-update-install";
import { useAppUpdate } from "@/lib/use-app-update";

/**
 * The one place the app nags. Renders nothing at all unless a strictly newer
 * version is published and the user has not dismissed that exact version.
 *
 * Unlike DownloadProgressBar — which paces a calibrated guess because the SIGAA
 * download is an opaque POST — the bar here is measured: expo-file-system 57
 * reports bytes written. When the server sends no Content-Length there is no
 * fraction, and the card says so with a spinner instead of inventing one.
 */
export function UpdateCard(): JSX.Element | null {
  const { release, temAtualizacao, dispensar } = useAppUpdate();
  /** null = idle; a number = measured fraction; NaN-free "unknown" = -1. */
  const [progresso, setProgresso] = useState<number | null>(null);
  const [baixando, setBaixando] = useState(false);

  const instalar = useCallback(async () => {
    if (!release) {
      return;
    }
    setBaixando(true);
    setProgresso(null);
    try {
      await baixarEInstalar(release.downloadUrl, release.latestVersion, setProgresso);
    } catch (erro) {
      // Whatever went wrong — no installer activity, permission refused, a
      // failed download — the manual path never stops existing.
      if (erro instanceof InstalacaoIndisponivelError) {
        void Linking.openURL(release.downloadUrl);
      }
      setBaixando(false);
      setProgresso(null);
    }
  }, [release]);

  if (!temAtualizacao || !release) {
    return null;
  }

  return (
    <View testID="update-card" className="rounded-3xl bg-surface-secondary p-5 gap-3">
      <Typography.Heading type="h5">{`Versão ${release.latestVersion} disponível`}</Typography.Heading>
      {release.releaseNotes.length > 0 && (
        <Typography.Paragraph type="body-sm" color="muted">
          {release.releaseNotes}
        </Typography.Paragraph>
      )}

      {baixando ? (
        <View className="gap-2">
          {progresso === null ? (
            <View testID="update-progress-indeterminate" className="flex-row items-center gap-3">
              <Spinner size="sm" />
            </View>
          ) : (
            <View className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <View
                testID="update-progress-fill"
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round(progresso * 100)}%` }}
              />
            </View>
          )}
          <Typography.Paragraph type="body-sm" color="muted">
            Baixando a atualização…
          </Typography.Paragraph>
        </View>
      ) : (
        <View className="flex-row items-center gap-3">
          <Button testID="update-install" size="sm" onPress={instalar}>
            Atualizar
          </Button>
          <Pressable testID="update-dismiss" onPress={dispensar}>
            <Typography.Paragraph type="body-sm" color="muted">
              Agora não
            </Typography.Paragraph>
          </Pressable>
        </View>
      )}
    </View>
  );
}
