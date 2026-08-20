import { useRouter } from "expo-router";
import { Avatar, Button, ListGroup, Spinner, Typography, useThemeColor, useToast } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SvgUri } from "react-native-svg";

import { AppBar } from "@/components/AppBar";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { countSemestresNaUfba, formatCursoNome, formatTempoNaUfba } from "@/lib/academic-profile";
import { postSchedule } from "@/lib/api";
import { describeApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";
import { CalendarPermissionDeniedError, exportScheduleToDeviceCalendar } from "@/lib/calendar-export";
import { buildAvatarUrl } from "@/lib/dicebear";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
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

export default function AjustesTab(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const mutedColor = useThemeColor("muted");
  const { toast } = useToast();
  const [isExportingCalendar, setIsExportingCalendar] = useState(false);

  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const isSigaaLinked = sigaaLink.status === "linked";

  const handleExportCalendar = useCallback(async () => {
    if (!isSigaaLinked || !accessToken) {
      return;
    }

    setIsExportingCalendar(true);
    try {
      const credentials = await getSigaaCredentials();
      if (!credentials) {
        toast.show({ variant: "danger", label: "Vincule sua conta do SIGAA para exportar." });
        return;
      }

      const { turmas, periodoLetivo } = await postSchedule(accessToken, credentials);
      if (!periodoLetivo) {
        toast.show({
          variant: "danger",
          label: "Período letivo desconhecido — não é possível exportar ainda.",
        });
        return;
      }

      const count = await exportScheduleToDeviceCalendar(turmas, periodoLetivo);
      toast.show({
        variant: "success",
        label: `${count} aula${count === 1 ? "" : "s"} exportada${count === 1 ? "" : "s"} para o calendário "Gradline".`,
      });
    } catch (error) {
      if (error instanceof CalendarPermissionDeniedError) {
        toast.show({
          variant: "danger",
          label: "Permissão de calendário negada. Habilite o acesso nos ajustes do aparelho.",
        });
      } else {
        console.warn("Failed to export the schedule to the device calendar", error);
        toast.show({ variant: "danger", label: describeApiError(error) });
      }
    } finally {
      setIsExportingCalendar(false);
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
            Minha conta
          </Typography.Paragraph>
          <ListGroup>
            <ListGroup.Item onPress={() => router.push("/link-account")}>
              <ListGroup.ItemPrefix>
                <AppIcon name="IconIdentificationCard" size={22} color={mutedColor} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Conta acadêmica</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{linkedMeta}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
            <View className="h-px bg-white/10 mx-4" />
            <ListGroup.Item>
              <ListGroup.ItemPrefix>
                <AppIcon name="IconChartLineUp" size={22} color={mutedColor} />
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

        <View className="gap-2.5">
          <Typography.Paragraph type="body-xs" color="muted">
            Horário
          </Typography.Paragraph>
          <ListGroup>
            <ListGroup.Item
              testID="export-calendar-item"
              disabled={!isSigaaLinked || isExportingCalendar}
              onPress={handleExportCalendar}
            >
              <ListGroup.ItemPrefix>
                <AppIcon name="IconCalendarBlank" size={22} color={mutedColor} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Exportar horário para o calendário</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {isSigaaLinked
                    ? "Cria um calendário \"Gradline\" no aparelho com suas aulas do semestre"
                    : "Vincule sua conta do SIGAA para exportar"}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>{isExportingCalendar ? <Spinner size="sm" /> : null}</ListGroup.ItemSuffix>
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
