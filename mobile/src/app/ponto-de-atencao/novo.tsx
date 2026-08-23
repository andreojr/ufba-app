import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { PontoAtencaoForm } from "@/components/PontoAtencaoForm";
import { getSchedule, postPontoAtencao } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { EntradaPonto, Turma } from "@/lib/types";

export default function NovoPontoAtencaoScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const { turmaId } = useLocalSearchParams<{ turmaId?: string }>();
  const [turmas, setTurmas] = useState<Turma[]>([]);
  // Evita setTurmas depois que a tela some com a busca ainda em voo — mesmo
  // guard usado em vizinhos-curriculares.tsx e professor/[siape].tsx.
  const ativoRef = useRef(true);

  useEffect(
    () => () => {
      ativoRef.current = false;
    },
    [],
  );

  useEffect(() => {
    // O seletor de turma só existe quando a tela não veio de dentro de uma
    // turma específica — nesse caso não há por que buscar a grade inteira.
    if (turmaId || !accessToken) {
      return;
    }
    void getSchedule(accessToken).then((resposta) => {
      if (!ativoRef.current) return;
      setTurmas("turmas" in resposta ? resposta.turmas : []);
    });
  }, [turmaId, accessToken]);

  async function salvar(turmaEscolhida: string, entrada: EntradaPonto): Promise<void> {
    if (!accessToken) return;
    await postPontoAtencao(accessToken, turmaEscolhida, entrada);
    router.back();
  }

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Novo ponto de atenção" onClose={() => router.back()} />
      <ScrollView contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        <PontoAtencaoForm turmaId={turmaId} turmas={turmas} onSalvar={salvar} />
      </ScrollView>
    </View>
  );
}
