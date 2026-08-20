import { useRouter } from "expo-router";
import { Button, Spinner, Typography, useToast } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { DocenteCard } from "@/components/DocenteCard";
import { getSchedule, postDocentesSemestre } from "@/lib/api";
import { describeApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";
import type { DocenteResumo } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; docentes: DocenteResumo[]; semDocente: { codigo: string; nome: string }[] }
  | { status: "empty" }
  | { status: "unsynced" }
  | { status: "error"; message: string };

export default function ProfessoresScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  // useAuth() returns a discriminated union — accessToken only exists once
  // signed in — matching how trajetoria.tsx reads it.
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const { toast } = useToast();
  const [estado, setEstado] = useState<Estado>({ status: "loading" });

  const carregar = useCallback(async () => {
    setEstado({ status: "loading" });

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

      // Cold path: every docente is resolved against SIGAA one search at a time.
      // Warm path: the backend's cache is global, so this returns immediately.
      toast.show({
        label: "Buscando os perfis no SIGAA. Isso só acontece na primeira vez.",
      });

      const docentes = await postDocentesSemestre(accessToken ?? "", comDocente);
      setEstado({ status: "ready", docentes, semDocente });
    } catch (error) {
      setEstado({ status: "error", message: describeApiError(error) });
    }
    // `toast` deliberately left out: useToast() hands back a fresh wrapper
    // object every render, so including it re-creates `carregar` on every
    // render too, which re-fires the effect below in an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <View className="flex-1">
      <AppBar title="Professores" />
      <ScrollView contentContainerClassName="px-4 pb-8">
        <Typography.Heading type="h5" className="mb-1 mt-2">
          Professores
        </Typography.Heading>

        {estado.status === "loading" ? (
          <View className="mt-6 items-center gap-3">
            <Spinner />
            {/* The toast dismisses itself long before a cold resolution ends,
                so the wait needs a line that stays put. */}
            <Typography.Paragraph type="body-sm" color="muted" align="center">
              Buscando perfis no SIGAA — só na primeira vez.
            </Typography.Paragraph>
          </View>
        ) : null}

        {estado.status === "error" ? (
          <View className="mt-6 gap-3">
            <Typography.Paragraph type="body-sm" color="muted">
              {estado.message}
            </Typography.Paragraph>
            <Button variant="outline" size="sm" onPress={() => void carregar()}>
              Tentar novamente
            </Button>
          </View>
        ) : null}

        {estado.status === "unsynced" ? (
          <Typography.Paragraph type="body-sm" color="muted" className="mt-6">
            Abra o Início para sincronizar sua grade e ver seus professores.
          </Typography.Paragraph>
        ) : null}

        {estado.status === "empty" ? (
          <Typography.Paragraph type="body-sm" color="muted" className="mt-6">
            Nenhuma matéria neste semestre.
          </Typography.Paragraph>
        ) : null}

        {estado.status === "ready" ? (
          <View className="mt-4">
            {estado.docentes.map((docente) => (
              <DocenteCard
                key={docente.perfil?.siape ?? docente.nomeOriginal}
                resumo={docente}
                onPress={(siape) => router.push(`/professor/${siape}`)}
              />
            ))}

            {estado.semDocente.map((turma) => (
              <View key={turma.codigo} className="mb-3 rounded-2xl border border-border p-4 opacity-55">
                <Typography.Paragraph type="body-sm">{turma.codigo}</Typography.Paragraph>
                <Typography.Paragraph type="body-xs" color="muted">
                  Docente não informado no atestado
                </Typography.Paragraph>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
