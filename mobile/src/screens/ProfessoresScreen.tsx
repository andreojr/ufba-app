import { useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor, useToast } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { ScrollView, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { DocenteCard } from "@/components/DocenteCard";
import { getSchedule, postDocentesSemestre } from "@/lib/api";
import { describeApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import type { DocenteResumo, PeriodoLetivo } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | {
      status: "ready";
      docentes: DocenteResumo[];
      semDocente: { codigo: string; nome: string }[];
      periodoLetivo: PeriodoLetivo | null;
    }
  | { status: "empty" }
  | { status: "unsynced" }
  | { status: "error"; message: string };

// The backend's docente cache is global, not per-user: only the very first
// student to open a course pays the SIGAA resolution, everyone after gets a
// database read in well under this. Below it, the request is the steady
// state and gets no banner at all — above it, it's plausibly a cold
// resolution and the wait deserves an explanation.
const AVISO_LENTO_MS = 400;

export default function ProfessoresScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const mutedColor = useThemeColor("muted");
  // useAuth() returns a discriminated union — accessToken only exists once
  // signed in — matching how trajetoria.tsx reads it.
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const { toast } = useToast();
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const [avisoLento, setAvisoLento] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const montadoRef = useRef(true);

  useEffect(
    () => () => {
      montadoRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const carregar = useCallback(async () => {
    setEstado({ status: "loading" });
    setAvisoLento(false);

    try {
      // The backend persists the schedule, so this is a cached read: no
      // credentials, no SIGAA round trip, same source the home screen uses.
      const horario = await getSchedule(accessToken ?? "");
      if (!("turmas" in horario)) {
        setEstado({ status: "unsynced" });
        return;
      }
      if (horario.turmas.length === 0) {
        setEstado({ status: "empty" });
        return;
      }

      // A turma whose atestado named no docente is a different empty state from
      // a docente with no public profile — it never goes to the backend.
      const semDocente = horario.turmas
        .filter((t) => !t.docente)
        .map((t) => ({ codigo: t.codigo ?? t.nome, nome: t.nome }));
      const comDocente = horario.turmas
        .filter((t) => Boolean(t.docente))
        .map((t) => ({ codigo: t.codigo ?? "", nome: t.nome, docente: t.docente as string }));

      // Cold path: every docente is resolved against SIGAA one search at a
      // time — slow enough to deserve an explanation. Warm path: the
      // backend's cache is global, so this returns immediately and neither
      // the toast nor the fixed line below should ever appear. Only announce
      // the wait once there actually is one.
      const timer = setTimeout(() => {
        if (!montadoRef.current) return;
        setAvisoLento(true);
        toast.show({
          label: "Buscando os perfis no SIGAA. Isso só acontece na primeira vez.",
        });
      }, AVISO_LENTO_MS);
      timerRef.current = timer;

      const docentes = await postDocentesSemestre(accessToken ?? "", comDocente);
      clearTimeout(timer);
      timerRef.current = null;
      setEstado({ status: "ready", docentes, semDocente, periodoLetivo: horario.periodoLetivo });
    } catch (error) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setEstado({ status: "error", message: describeApiError(error) });
    }
    // `toast` deliberately left out: useToast() hands back a fresh wrapper
    // object every render, so including it re-creates `carregar` on every
    // render too, which re-fires the effect below in an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    // O analisador não enxerga através da fronteira assíncrona: `carregar` só
    // chama setState depois de um await, então nada atualiza no mesmo tick deste
    // efeito e a cascata que a regra previne não existe aqui.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  return (
    <View className="flex-1">
      <ScrollView contentContainerClassName="px-4 pb-8 pt-2">
        {/* All four non-ready states use the same card the other three tabs
            use (see HomeTab/TrajetoriaTab/InsightsTab) — same radius, same
            paddings, same button labels. This screen used to render bare
            paragraphs with an `mt-6`, which read as a different app. */}
        {estado.status === "loading" ? (
          <View className="rounded-3xl bg-surface-secondary p-8 items-center gap-3">
            <Spinner />
            {/* Only rendered once the 400ms timer has actually fired — the
                warm, steady-state read never reaches this. The toast
                dismisses itself long before a cold resolution ends, so this
                line stays put to sustain the wait past that point. */}
            {avisoLento ? (
              <Typography.Paragraph type="body-sm" color="muted" align="center">
                Buscando perfis no SIGAA. Isso acontece só na primeira vez.
              </Typography.Paragraph>
            ) : null}
          </View>
        ) : null}

        {estado.status === "error" ? (
          <View className="rounded-3xl bg-surface-secondary p-6 items-center gap-3">
            <AppIcon name="IconWarningCircle" size={28} color={mutedColor} />
            <Typography.Paragraph type="body-sm" color="muted" align="center">
              {estado.message}
            </Typography.Paragraph>
            <Button variant="outline" size="sm" onPress={() => void carregar()}>
              Tentar de novo
            </Button>
          </View>
        ) : null}

        {estado.status === "unsynced" ? (
          <View className="rounded-3xl bg-surface-secondary p-5 gap-3">
            <Typography.Heading type="h6">
              Sua lista de professores ainda não foi montada
            </Typography.Heading>
            <Typography.Paragraph type="body-sm" color="muted">
              {sigaaLink.status === "linked"
                ? "Sincronize sua conta em Perfil para buscar seu horário no SIGAA e ver seus professores."
                : "Vincule sua conta em Perfil para buscar seu horário no SIGAA e ver seus professores."}
            </Typography.Paragraph>
            <Button onPress={() => router.push("/ajustes")}>Ir para Perfil</Button>
          </View>
        ) : null}

        {/* Distinct from `unsynced`: the horário is here, it just has no
            turmas. Still offers Perfil, because a matrícula that landed after
            the last sync looks exactly like this until the next one. */}
        {estado.status === "empty" ? (
          <View className="rounded-3xl bg-surface-secondary p-5 gap-3">
            <Typography.Heading type="h6">Nenhuma matéria neste semestre</Typography.Heading>
            <Typography.Paragraph type="body-sm" color="muted">
              Seus professores aparecem aqui quando você tiver turmas no semestre. Se você se
              matriculou agora, sincronize em Perfil para buscar o horário novo.
            </Typography.Paragraph>
            <Button onPress={() => router.push("/ajustes")}>Ir para Perfil</Button>
          </View>
        ) : null}

        {estado.status === "ready" ? (
          <View className="mt-4">
            {estado.docentes.length > 0 ? (
              <Typography.Paragraph type="body-sm" weight="medium" color="muted" className="mb-3">
                <Text className="font-mono text-foreground">{estado.docentes.length}</Text>{" "}
                {estado.docentes.length === 1 ? "docente" : "docentes"}
                {estado.periodoLetivo ? (
                  <>
                    {" em "}
                    <Text className="font-mono">{estado.periodoLetivo.semestre}</Text>
                  </>
                ) : null}
              </Typography.Paragraph>
            ) : null}

            {estado.docentes.map((docente) => (
              <DocenteCard
                key={docente.perfil?.siape ?? docente.nomeOriginal}
                resumo={docente}
                onPress={(siape) => router.push(`/professor/${siape}`)}
              />
            ))}

            {estado.semDocente.length > 0 ? (
              <View className="mt-1 gap-2">
                <Typography.Paragraph type="body-xs" weight="medium" color="muted">
                  Turmas sem docente no atestado
                </Typography.Paragraph>
                {estado.semDocente.map((turma) => (
                  <View
                    key={turma.codigo}
                    className="rounded-2xl bg-surface-secondary p-4 opacity-55 flex-row items-center gap-3"
                  >
                    <Typography.Paragraph type="body-sm" weight="medium" className="font-mono">
                      {turma.codigo}
                    </Typography.Paragraph>
                    <Typography.Paragraph type="body-xs" color="muted" className="flex-1">
                      Docente não informado no atestado
                    </Typography.Paragraph>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
