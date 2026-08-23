import { useRouter } from "expo-router";
import {
  Avatar,
  Button,
  Chip,
  Dialog,
  ListGroup,
  Spinner,
  Tabs,
  Typography,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { Uniwind, useUniwind } from "uniwind";

import { AppBar } from "@/components/AppBar";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { ClassroomIcon } from "@/components/ClassroomIcon";
import { MoodleIcon } from "@/components/MoodleIcon";
import { countSemestresNaUfba, formatCursoNome, formatTempoNaUfba } from "@/lib/academic-profile";
import {
  ApiError,
  deleteAccount,
  getSchedule,
  getTrajetoria,
  postScheduleSync,
  postTrajetoriaSync,
} from "@/lib/api";
import { describeApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";
import { CalendarPermissionDeniedError, exportScheduleToDeviceCalendar } from "@/lib/calendar-export";
import { DownloadProgressBar } from "@/components/DownloadProgressBar";
import { buildAvatarUrl } from "@/lib/dicebear";
import { HISTORICO_STAGES } from "@/lib/download-progress";
import { useMoodleLink } from "@/lib/moodle-link-context";
import { relativeFreshness } from "@/lib/relative-freshness";
import type { ScheduleResponse } from "@/lib/types";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { perfilFreshness, useSyncFreshness } from "@/lib/sync-freshness-context";
import { useAppUpdate } from "@/lib/use-app-update";
import { clearPeriodoCache } from "@/lib/periodo-cache";
import {
  clearSigaaCredentials,
  forgetSigaaWasLinked,
  getSigaaCredentials,
} from "@/lib/sigaa-storage";
import { saveThemePreference, type ThemePreference } from "@/lib/theme-preference";
import { dangerToast } from "@/lib/toast-helpers";
import { getInitials } from "@/lib/user-name";

// Matches heroui-native's Avatar "lg" size (--spacing * 16 = 64px) so the SVG fills
// the circle exactly instead of leaving a gap or overflowing past the rounded clip.
const AVATAR_SIZE_LG_PX = 64;

// Fixed (not random) seeds for the "escolha um avatar" showcase — a preview of what's
// waiting in the picker, so a first-time visitor knows there's something fun there
// instead of just seeing a bare "avatar" label with no idea what it means.
const AVATAR_SHOWCASE_SEEDS = ["gradline-vitrine-1", "gradline-vitrine-2", "gradline-vitrine-3"];
const AVATAR_SHOWCASE_SIZE_PX = 36;
const AVATAR_SHOWCASE_OVERLAP_PX = 14;


function AcademicRow({
  icon,
  tint,
  label,
  value,
  mono = false,
}: {
  icon: AppIconName;
  tint: string;
  label: string;
  value: string;
  /** The value is a numeric value (a period, a count), not a name — Source Code Pro. */
  mono?: boolean;
}): JSX.Element {
  return (
    <View className="flex-row items-start gap-3">
      {/* 26% ≈ 0x42 alpha — soft tinted disc behind the full-strength icon */}
      <View
        className="w-9 h-9 rounded-full items-center justify-center"
        style={{ backgroundColor: `${tint}42` }}
      >
        <AppIcon name={icon} size={18} color={tint} />
      </View>
      <View className="flex-1 gap-0.5">
        <Typography.Paragraph type="body-xs" color="muted">
          {label}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-sm" weight="medium" className={mono ? "font-mono" : undefined}>
          {value}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

/**
 * Histórico sync failures need one message the shared helper cannot give —
 * moved here from Trajetória's old in-screen re-sync (see the roadmap note in
 * its history for the full rationale). A transcript the parser refuses — for
 * breaking the document's own invariants — comes back as a bare 500,
 * indistinguishable from a server hiccup but deterministic: "tente
 * novamente" would send the student round a loop that fails identically
 * every time. So anything other than the two statuses the shared helper
 * names gets copy that promises no retry and points at the one thing that
 * still works, the PDF download reachable from Meus documentos.
 *
 * Bad credentials, rate limits and a dead connection keep the shared
 * wording — those really are retryable, and they are the same failures the
 * horário sync can hit too.
 */
function descreverErroHistorico(error: unknown): string {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status !== undefined && status !== 401 && status !== 429) {
    return "Pode ser um problema no documento. Você ainda pode baixar o PDF em Meus documentos.";
  }
  return describeApiError(error);
}

export default function AjustesTab(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const { versaoInstalada, release, temAtualizacao } = useAppUpdate();
  const descricaoVersao = temAtualizacao
    ? `Nova versão disponível: ${release?.latestVersion}`
    : release
      ? "Você está na versão mais recente"
      : null;
  const moodle = useMoodleLink();
  const [mutedColor, segmentForegroundColor, successColor, dangerColor] = useThemeColor([
    "muted",
    "segment-foreground",
    "success",
    "danger",
  ]);
  const { toast } = useToast();
  const { theme, hasAdaptiveThemes } = useUniwind();
  const themePreference: ThemePreference = hasAdaptiveThemes ? "system" : (theme as ThemePreference);
  const [isExportingCalendar, setIsExportingCalendar] = useState(false);
  const [isSyncingPerfil, setIsSyncingPerfil] = useState(false);
  const [isConfirmandoExclusao, setIsConfirmandoExclusao] = useState(false);
  const [confirmMoodleUnlink, setConfirmMoodleUnlink] = useState(false);
  const [isApagando, setIsApagando] = useState(false);
  // Shared with Início's freshness badge and with Insights/Trajetória, which
  // write into the same two timestamps whenever they read the histórico —
  // this screen is a pushed Stack route, not one of the four tabs that stay
  // mounted (see TabsPager's docstring), so local state here would reset
  // every time the student navigates back to it. Two separate timestamps —
  // the sync button below re-scrapes both the horário and the histórico in
  // one press (see handleSyncPerfil), but they remain two independent
  // documents on the SIGAA side with their own ages.
  const { scheduleFetchedAt, historicoFetchedAt, setScheduleFetchedAt, setHistoricoFetchedAt } =
    useSyncFreshness();

  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const isSigaaLinked = sigaaLink.status === "linked";

  // Cache reads, both of them: they hit our own database, never SIGAA, so
  // unlinking must not blank out the freshness lines.
  useEffect(() => {
    if (!accessToken) {
      return;
    }
    getSchedule(accessToken)
      .then((response: ScheduleResponse) => {
        if ("turmas" in response) {
          setScheduleFetchedAt(new Date(response.fetchedAt));
        }
      })
      .catch((error: unknown) => {
        console.warn("Failed to read the cached schedule", error);
      });
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    getTrajetoria(accessToken)
      .then((response) => {
        if ("historico" in response) {
          setHistoricoFetchedAt(new Date(response.fetchedAt));
        }
      })
      .catch((error: unknown) => {
        console.warn("Failed to read the cached trajetória", error);
      });
  }, [accessToken]);

  // Reads the cache first — this is the one place that must never bypass it
  // for a routine export — and falls back to a live sync only the first time,
  // when the user has never synced at all.
  const readOrSyncSchedule = useCallback(async (): Promise<
    Extract<ScheduleResponse, { turmas: unknown }> | null
  > => {
    if (!accessToken) {
      return null;
    }
    const cached = await getSchedule(accessToken);
    if ("turmas" in cached) {
      return cached;
    }
    const credentials = await getSigaaCredentials();
    if (!credentials) {
      return null;
    }
    const synced = await postScheduleSync(accessToken, {
      login: credentials.login,
      senha: credentials.senha,
    });
    if ("turmas" in synced) {
      setScheduleFetchedAt(new Date(synced.fetchedAt));
      return synced;
    }
    return null;
  }, [accessToken]);

  const handleExportCalendar = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsExportingCalendar(true);
    try {
      const schedule = await readOrSyncSchedule();
      if (!schedule) {
        // No cache to export from. Which fix to point at depends on why:
        // an unlinked student has to link first, a linked one just never synced.
        toast.show(
          dangerToast({
            label: isSigaaLinked
              ? "Sincronize seu horário em Perfil antes de exportar."
              : "Vincule sua conta do SIGAA para exportar.",
          }),
        );
        return;
      }
      if (!schedule.periodoLetivo) {
        toast.show(dangerToast({ label: "Período letivo desconhecido — não é possível exportar ainda." }));
        return;
      }

      const count = await exportScheduleToDeviceCalendar(schedule.turmas, schedule.periodoLetivo);
      toast.show({
        variant: "success",
        label: `${count} aula${count === 1 ? "" : "s"} exportada${count === 1 ? "" : "s"} para o calendário "UFBA".`,
      });
    } catch (error) {
      if (error instanceof CalendarPermissionDeniedError) {
        toast.show(
          dangerToast({ label: "Permissão de calendário negada. Habilite o acesso nos ajustes do aparelho." })
        );
      } else {
        console.warn("Failed to export the schedule to the device calendar", error);
        toast.show(dangerToast({ label: describeApiError(error) }));
      }
    } finally {
      setIsExportingCalendar(false);
    }
  }, [isSigaaLinked, accessToken, readOrSyncSchedule, toast]);

  // The one explicit "sincronizar agora" gesture left in the app — Insights
  // and Trajetória used to each carry their own, but re-scraping the same
  // histórico from three different screens was the same action three times
  // over. This re-scrapes both documents (horário, histórico) in one press;
  // either can fail without the other since they're independent SIGAA
  // requests, so both run and each is reported on its own terms.
  const handleSyncPerfil = useCallback(async () => {
    if (!isSigaaLinked || !accessToken) {
      return;
    }

    setIsSyncingPerfil(true);
    try {
      const credentials = await getSigaaCredentials();
      if (!credentials) {
        toast.show(dangerToast({ label: "Vincule sua conta do SIGAA para sincronizar." }));
        return;
      }

      const credenciaisSigaa = { login: credentials.login, senha: credentials.senha };
      const [horario, historico] = await Promise.allSettled([
        postScheduleSync(accessToken, credenciaisSigaa),
        postTrajetoriaSync(accessToken, credenciaisSigaa),
      ]);

      const horarioOk = horario.status === "fulfilled" && "turmas" in horario.value;
      const historicoOk = historico.status === "fulfilled" && "historico" in historico.value;
      if (horario.status === "fulfilled" && "turmas" in horario.value) {
        setScheduleFetchedAt(new Date(horario.value.fetchedAt));
      }
      if (historico.status === "fulfilled" && "historico" in historico.value) {
        setHistoricoFetchedAt(new Date(historico.value.fetchedAt));
      }

      if (horarioOk && historicoOk) {
        toast.show({ variant: "success", label: "Dados sincronizados com o SIGAA." });
      } else if (horarioOk) {
        // The histórico is the one with a document to parse — its own failure
        // copy names that instead of promising a retry that won't help.
        const motivo = historico.status === "rejected" ? descreverErroHistorico(historico.reason) : undefined;
        toast.show(
          dangerToast({
            label: `Horário sincronizado, mas o histórico não pôde ser atualizado.${motivo ? ` ${motivo}` : ""}`,
          }),
        );
      } else if (historicoOk) {
        toast.show(dangerToast({ label: "Histórico sincronizado, mas o horário não pôde ser atualizado." }));
      } else if (historico.status === "rejected") {
        toast.show(dangerToast({ label: descreverErroHistorico(historico.reason) }));
      } else {
        const falha = horario.status === "rejected" ? horario.reason : undefined;
        toast.show(dangerToast({ label: describeApiError(falha) }));
      }
    } catch (error) {
      console.warn("Failed to sync the SIGAA profile", error);
      toast.show(dangerToast({ label: describeApiError(error) }));
    } finally {
      setIsSyncingPerfil(false);
    }
  }, [isSigaaLinked, accessToken, toast]);

  const user = auth.status === "signedIn" ? auth.user : null;
  const { name: studentName = "", email: studentEmail = "", avatarUrl = null } = user ?? {};
  const matricula = user?.matricula ?? null;
  const curso = user?.curso ?? null;
  const periodoIngresso = user?.periodoIngresso ?? null;
  const semestresNaUfba = countSemestresNaUfba(periodoIngresso, new Date());
  const hasAcademicInfo = Boolean(curso || periodoIngresso);

  // The academic fields only reach the backend on schedule fetches, so the
  // locally stored user can lag behind — sync it up whenever this screen
  // opens. Mount-only on purpose: refreshUser's identity changes with the
  // auth state it just updated, so listing it would loop.
  const { refreshUser } = auth;
  useEffect(() => {
    void refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleThemePreferenceChange = useCallback((value: string) => {
    const preference = value as ThemePreference;
    Uniwind.setTheme(preference);
    saveThemePreference(preference).catch((error: unknown) => {
      console.warn("Failed to persist the theme preference", error);
    });
  }, []);

  // Três estados, e a diferença entre eles é para ser lembrada de longe: um
  // check verde quando está tudo certo, um X vermelho quando o app não
  // consegue entrar no SIGAA — ou porque a senha mudou lá, ou porque não há
  // vínculo nenhum. A senha nunca vai para a nuvem em nenhum deles: quem fala
  // com o SIGAA é sempre este aparelho.
  const vinculoOk = sigaaLink.status === "linked" && !sigaaLink.senhaDesatualizada;
  const linkedMeta =
    sigaaLink.status !== "linked"
      ? "Não vinculado"
      : sigaaLink.senhaDesatualizada
        ? "Senha desatualizada · toque para atualizar"
        : "Vinculado · senha só neste aparelho";

  /**
   * Hard deletion, no soft delete anywhere behind it — the point is being able
   * to promise the data is actually gone. Both variants share this handler
   * because the only difference is which endpoint runs and what has to be
   * cleaned up on the device afterwards.
   */
  /**
   * Hard deletion of the whole account, no soft delete anywhere behind it —
   * the point is being able to promise the data is actually gone. Coming back
   * costs one Google sign-in, which is why there is no gentler variant: a
   * partial erasure would add a choice without adding any safety.
   */
  const handleApagar = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsApagando(true);
    try {
      await deleteAccount(accessToken);
      await clearSigaaCredentials();
      // The account is gone server-side, so this device must forget it ever
      // linked — otherwise the next sign-in is "unlinked but already
      // onboarded": empty tabs with no prompt to link. See sigaa-storage.
      await forgetSigaaWasLinked();
      await clearPeriodoCache();
      setIsConfirmandoExclusao(false);
      await auth.signOut();
    } catch (error) {
      // Nothing local is cleared and no one is signed out on failure: saying
      // "apagado" when the server still has the data would be the one lie
      // this feature cannot afford.
      console.warn("Failed to erase the account", error);
      toast.show(dangerToast({ label: describeApiError(error) }));
    } finally {
      setIsApagando(false);
    }
  }, [accessToken, auth, toast]);

  const handleMoodlePress = (): void => {
    if (moodle.status === "linked") {
      setConfirmMoodleUnlink(true);
      return;
    }
    if (moodle.status === "unlinked") {
      // Opens the in-app SSO WebView; success/failure feedback (and the state
      // change) happen there via the link context, not here.
      moodle.link();
    }
  };

  const perfilFetchedAt = perfilFreshness(scheduleFetchedAt, historicoFetchedAt);

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Perfil" onBack={() => router.back()} />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-5 pb-8"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile + academic info render as one visually connected group:
            a hairline gap and matching soft inner corners join the two cards. */}
        <View className="gap-0.5">
          <View
            className={`bg-surface-secondary p-4 flex-row items-center gap-3.5 ${
              hasAcademicInfo ? "rounded-t-3xl rounded-b-md" : "rounded-3xl"
            }`}
          >
            <Pressable testID="avatar-touchable" onPress={() => router.push("/avatar-picker")}>
              <Avatar size="lg" variant="soft" color="accent">
                {avatarUrl ? (
                  <SvgUri testID="avatar-image" uri={avatarUrl} width={AVATAR_SIZE_LG_PX} height={AVATAR_SIZE_LG_PX} />
                ) : (
                  <Avatar.Fallback>{getInitials(studentName)}</Avatar.Fallback>
                )}
              </Avatar>
            </Pressable>
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph weight="medium" truncate>
                {studentName}
              </Typography.Paragraph>
              <View className="flex-row items-center">
                <Typography.Paragraph type="body-sm" color="muted" truncate className="shrink">
                  {studentEmail}
                </Typography.Paragraph>
                {matricula ? (
                  <Typography.Paragraph type="body-sm" color="muted" className="font-mono">
                    {` · ${matricula}`}
                  </Typography.Paragraph>
                ) : null}
              </View>
            </View>
          </View>

          {hasAcademicInfo ? (
            <View testID="academic-card" className="rounded-t-md rounded-b-3xl bg-surface-secondary p-4 gap-3.5">
              {curso ? (
                <AcademicRow icon="IconGraduationCap" tint="#3B82F6" label="Curso" value={formatCursoNome(curso)} />
              ) : null}
              {periodoIngresso ? (
                <AcademicRow
                  icon="IconCalendarBlank"
                  tint="#10B981"
                  label="Ingresso na UFBA"
                  value={periodoIngresso}
                  mono
                />
              ) : null}
              {semestresNaUfba !== null ? (
                <AcademicRow
                  icon="IconHourglass"
                  tint="#F59E0B"
                  label="Tempo de casa"
                  value={formatTempoNaUfba(semestresNaUfba)}
                  mono
                />
              ) : null}
            </View>
          ) : null}
        </View>

        {avatarUrl ? null : (
          <Pressable
            testID="avatar-cta"
            onPress={() => router.push("/avatar-picker")}
            className="rounded-3xl bg-accent-soft p-4 flex-row items-center gap-3.5"
          >
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph weight="medium">Escolha um avatar</Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted">
                Deixe seu perfil com a sua cara
              </Typography.Paragraph>
            </View>
            <View className="items-center gap-2">
              <View className="flex-row items-center">
                {AVATAR_SHOWCASE_SEEDS.map((seed, index) => (
                  <View
                    key={seed}
                    className="rounded-full overflow-hidden border-2 border-accent-soft"
                    style={{
                      width: AVATAR_SHOWCASE_SIZE_PX,
                      height: AVATAR_SHOWCASE_SIZE_PX,
                      marginLeft: index === 0 ? 0 : -AVATAR_SHOWCASE_OVERLAP_PX,
                      zIndex: AVATAR_SHOWCASE_SEEDS.length - index,
                    }}
                  >
                    <SvgUri
                      uri={buildAvatarUrl(seed)}
                      width={AVATAR_SHOWCASE_SIZE_PX}
                      height={AVATAR_SHOWCASE_SIZE_PX}
                    />
                  </View>
                ))}
              </View>
              <View className="rounded-full bg-accent px-3 py-1.5">
                <Typography.Paragraph type="body-xs" weight="medium" className="text-accent-foreground">
                  Experimente
                </Typography.Paragraph>
              </View>
            </View>
          </Pressable>
        )}

        <View className="gap-2.5">
          <Typography.Paragraph type="body-xs" color="muted">
            Aparência
          </Typography.Paragraph>
          <Tabs value={themePreference} onValueChange={handleThemePreferenceChange} variant="primary">
            <Tabs.List className="w-full">
              <Tabs.Indicator />
              <Tabs.Trigger value="light" testID="theme-light-trigger" className="flex-1">
                {({ isSelected }) => (
                  <>
                    <AppIcon name="IconSun" size={16} color={isSelected ? segmentForegroundColor : mutedColor} />
                    <Tabs.Label>Claro</Tabs.Label>
                  </>
                )}
              </Tabs.Trigger>
              <Tabs.Trigger value="dark" testID="theme-dark-trigger" className="flex-1">
                {({ isSelected }) => (
                  <>
                    <AppIcon name="IconMoon" size={16} color={isSelected ? segmentForegroundColor : mutedColor} />
                    <Tabs.Label>Escuro</Tabs.Label>
                  </>
                )}
              </Tabs.Trigger>
              <Tabs.Trigger value="system" testID="theme-system-trigger" className="flex-1">
                {({ isSelected }) => (
                  <>
                    <AppIcon name="IconContrast" size={16} color={isSelected ? segmentForegroundColor : mutedColor} />
                    <Tabs.Label>Sistema</Tabs.Label>
                  </>
                )}
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </View>

        <View className="gap-2.5">
          <Typography.Paragraph type="body-xs" color="muted">
            Minha conta
          </Typography.Paragraph>
          <ListGroup>
            <ListGroup.Item onPress={() => router.push("/link-account")}>
              <ListGroup.ItemPrefix>
                <AppIcon name="IconIdentificationCard" size={22} color={mutedColor} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Conta acadêmica</ListGroup.ItemTitle>
                <View className="flex-row items-center gap-1.5">
                  <AppIcon
                    name={vinculoOk ? "IconCheckCircle" : "IconErrorCircle"}
                    size={14}
                    color={vinculoOk ? successColor : dangerColor}
                  />
                  <ListGroup.ItemDescription
                    testID={vinculoOk ? "vinculo-status-ok" : "vinculo-status-alerta"}
                    className={vinculoOk ? "text-success" : "text-danger"}
                  >
                    {linkedMeta}
                  </ListGroup.ItemDescription>
                </View>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
            <View className="h-px bg-white/10 mx-4" />
            <ListGroup.Item testID="documentos-item" onPress={() => router.push("/documentos")}>
              <ListGroup.ItemPrefix>
                <AppIcon name="IconFileText" size={22} color={mutedColor} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Meus documentos</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  Histórico escolar e atestado de matrícula em PDF
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
            <View className="h-px bg-white/10 mx-4" />
            <ListGroup.Item
              testID="sync-profile-item"
              disabled={!isSigaaLinked || isSyncingPerfil}
              // Dimmed only for the unavailable case, matching the "Em breve"
              // integrations below — a sync already in flight has its own
              // spinner and progress bar saying so, and fading it then would
              // read as "broken" rather than "busy".
              className={!isSigaaLinked ? "opacity-50" : undefined}
              onPress={handleSyncPerfil}
            >
              <ListGroup.ItemPrefix>
                <AppIcon name="IconArrowsClockwise" size={22} color={mutedColor} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Sincronizar dados com o SIGAA</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {!isSigaaLinked
                    ? "Vincule sua conta do SIGAA para sincronizar"
                    : perfilFetchedAt
                      ? `Dados sincronizados ${relativeFreshness(perfilFetchedAt, new Date())}`
                      : "Nunca sincronizado"}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              {isSyncingPerfil ? (
                <ListGroup.ItemSuffix>
                  <Spinner size="sm" />
                </ListGroup.ItemSuffix>
              ) : null}
            </ListGroup.Item>
            <View className="h-px bg-white/10 mx-4" />
            <ListGroup.Item
              testID="apagar-dados-item"
              disabled={isApagando}
              onPress={() => setIsConfirmandoExclusao(true)}
            >
              <ListGroup.ItemPrefix>
                <AppIcon name="IconTrash" size={22} color={dangerColor} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Apagar todos os meus dados</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  Inclusive a conta. Sem volta e sem cópia guardada.
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              {isApagando ? (
                <ListGroup.ItemSuffix>
                  <Spinner size="sm" />
                </ListGroup.ItemSuffix>
              ) : null}
            </ListGroup.Item>
          </ListGroup>
        </View>

        {/* The row is the only way in, so this is purely the confirmation: the
            two places, each with what goes from it. The password's line says
            "celular" and not "servidor" because that is where it is — the
            linking screen already made that promise, and re-arguing it here
            would only cast doubt on it. */}
        <Dialog isOpen={isConfirmandoExclusao} onOpenChange={setIsConfirmandoExclusao}>
          <Dialog.Portal>
            <Dialog.Overlay />
            <Dialog.Content>
              {/* `self-end`: the close button is a plain block in the content
                  column, so left to itself it lands beside the title and the
                  two fight for the same line. */}
              <Dialog.Close className="self-end" />
              {/* HeroUI's dialog parts carry no margins of their own — title,
                  description and actions all sit flush unless spaced here. */}
              <View className="gap-2.5 pb-1">
                <Dialog.Title>Apagar tudo e sair?</Dialog.Title>
                {/* Overrides the component's own `text-left`. */}
                <Dialog.Description className="text-justify">
                  Suas notas, matérias, horário e a própria conta, com email e nome, serão apagados
                  do servidor. A senha do SIGAA será apagada do celular. Entrar de novo com o
                  Google começa uma conta vazia.
                </Dialog.Description>
              </View>
              {/* A wide gap before the actions on purpose: the two buttons are
                  the decision, and they should not read as a fourth line of
                  the paragraph above them. */}
              <View className="gap-3 pt-7">
                <Button
                  testID="confirmar-exclusao-button"
                  variant="danger"
                  isDisabled={isApagando}
                  onPress={() => void handleApagar()}
                >
                  <Button.Label>{isApagando ? "Apagando…" : "Apagar tudo"}</Button.Label>
                </Button>
                <Button
                  testID="cancelar-exclusao-button"
                  variant="tertiary"
                  isDisabled={isApagando}
                  onPress={() => setIsConfirmandoExclusao(false)}
                >
                  <Button.Label>Cancelar</Button.Label>
                </Button>
              </View>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog>

        <Dialog isOpen={confirmMoodleUnlink} onOpenChange={setConfirmMoodleUnlink}>
          <Dialog.Portal>
            <Dialog.Overlay />
            <Dialog.Content>
              <Dialog.Close className="self-end" />
              <View className="gap-2.5 pb-1">
                <Dialog.Title>Desvincular Moodle?</Dialog.Title>
                <Dialog.Description className="text-justify">
                  Você deixará de ver materiais e avisos das suas salas do Moodle neste aparelho.
                </Dialog.Description>
              </View>
              <View className="gap-3 pt-7">
                <Button
                  testID="confirmar-desvincular-moodle-button"
                  variant="danger"
                  onPress={() => {
                    setConfirmMoodleUnlink(false);
                    void moodle.unlink();
                  }}
                >
                  <Button.Label>Desvincular</Button.Label>
                </Button>
                <Button
                  testID="cancelar-desvincular-moodle-button"
                  variant="tertiary"
                  onPress={() => setConfirmMoodleUnlink(false)}
                >
                  <Button.Label>Cancelar</Button.Label>
                </Button>
              </View>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog>

        <View className="gap-2.5">
          <Typography.Paragraph type="body-xs" color="muted">
            Integrações
          </Typography.Paragraph>
          <ListGroup>
            <ListGroup.Item
              testID="export-calendar-item"
              disabled={isExportingCalendar}
              onPress={handleExportCalendar}
            >
              <ListGroup.ItemPrefix>
                <AppIcon name="IconCalendarBlank" size={22} color={mutedColor} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Exportar horário para o calendário</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {'Cria um calendário "UFBA" no aparelho com suas aulas do semestre'}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              {isExportingCalendar ? (
                <ListGroup.ItemSuffix>
                  <Spinner size="sm" />
                </ListGroup.ItemSuffix>
              ) : null}
            </ListGroup.Item>
            <View className="h-px bg-white/10 mx-4" />
            <ListGroup.Item testID="link-moodle-item" onPress={() => handleMoodlePress()}>
              <ListGroup.ItemPrefix>
                <MoodleIcon size={22} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Vincular Moodle</ListGroup.ItemTitle>
                {moodle.status === "linked" ? (
                  // Vinculado: espelha o item da Conta acadêmica — check verde +
                  // "Vinculado" no lugar da descrição. moodle.expired só viraria
                  // true por veredito de token, inalcançável nesta build
                  // somente-conexão; o ramo de alerta fica pronto para quando a
                  // leitura de conteúdo (turma virtual) puder disparar o veredito.
                  <View className="flex-row items-center gap-1.5">
                    <AppIcon
                      name={moodle.expired ? "IconErrorCircle" : "IconCheckCircle"}
                      size={14}
                      color={moodle.expired ? dangerColor : successColor}
                    />
                    <ListGroup.ItemDescription
                      testID={moodle.expired ? "moodle-status-alerta" : "moodle-status-ok"}
                      className={moodle.expired ? "text-danger" : "text-success"}
                    >
                      {moodle.expired ? "Reconectar" : "Vinculado"}
                    </ListGroup.ItemDescription>
                  </View>
                ) : (
                  <ListGroup.ItemDescription>Materiais e avisos das suas salas</ListGroup.ItemDescription>
                )}
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
            <View className="h-px bg-white/10 mx-4" />
            <ListGroup.Item testID="link-classroom-item" disabled className="opacity-50">
              <ListGroup.ItemPrefix>
                <ClassroomIcon size={22} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Vincular Classroom</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>Materiais e avisos das suas salas</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <Chip variant="secondary" size="sm">
                  Em breve
                </Chip>
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          </ListGroup>
        </View>

        <View className="gap-2.5">
          <Typography.Paragraph type="body-xs" color="muted">
            Sobre
          </Typography.Paragraph>
          <ListGroup>
            <ListGroup.Item testID="app-version-item" disabled>
              <ListGroup.ItemPrefix>
                <AppIcon name="IconInfo" size={22} color={mutedColor} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Versão do app</ListGroup.ItemTitle>
                {/* Sem descrição, e não uma descrição vazia: até a checagem
                    voltar — o estado de toda primeira abertura — não há o que
                    dizer, e uma ItemDescription com string vazia ainda ocupa a
                    linha, empurrando o título para o topo como se faltasse
                    texto. Silêncio também é a resposta certa quando o app está
                    offline: afirmar "você está na versão mais recente" seria
                    uma garantia que ele não tem como dar. */}
                {descricaoVersao === null ? null : (
                  <ListGroup.ItemDescription testID="app-version-description">
                    {descricaoVersao}
                  </ListGroup.ItemDescription>
                )}
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <Typography.Paragraph type="body-sm" color="muted">
                  {versaoInstalada}
                </Typography.Paragraph>
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          </ListGroup>
        </View>

        <View className="flex-1 min-h-3" />

        <View className="gap-2.5">
          <Button variant="danger" size="lg" className="w-full" onPress={auth.signOut}>
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
