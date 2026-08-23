import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Alert, ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { PontoAtencaoForm } from "@/components/PontoAtencaoForm";
import { deletePontoAtencao, getPontosAtencao, patchPontoAtencao } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { EntradaPonto, PontoAtencao } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; ponto: PontoAtencao }
  // Não há GET /pontos-atencao/:id — o item pode ter sido apagado por outra
  // pessoa da turma entre a lista e o toque de "Corrigir", então esse estado
  // é distinto de um erro de rede genérico.
  | { status: "naoEncontrado" }
  | { status: "erro" };

export default function EditarPontoAtencaoScreen(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuth();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const ativoRef = useRef(true);

  useEffect(
    () => () => {
      ativoRef.current = false;
    },
    [],
  );

  // Nada de setState antes do primeiro await: o efeito abaixo chama esta
  // função na montagem, e o lint do React Compiler trata escrita síncrona de
  // estado dentro de efeito como render em cascata. O estado inicial já é
  // "loading", e a ausência de sessão é derivada no render (estadoEfetivo).
  const carregar = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    try {
      // A lista completa (incluindo vencidos) já traz o item por inteiro —
      // não existe endpoint de item único, ver brief da Task 12.
      const pontos = await getPontosAtencao(accessToken, { incluirVencidos: true });
      if (!ativoRef.current) return;
      const ponto = pontos.find((item) => item.id === id);
      setEstado(ponto ? { status: "ready", ponto } : { status: "naoEncontrado" });
    } catch {
      if (!ativoRef.current) return;
      setEstado({ status: "erro" });
    }
  }, [accessToken, id]);

  // Mesmo padrão das telas irmãs desta feature (a lista e a Home): recarrega
  // ao ganhar o foco, então o item volta atualizado se alguém da turma o
  // corrigiu enquanto esta tela estava empilhada por baixo.
  useFocusEffect(
    useCallback(() => {
      void carregar();
    }, [carregar]),
  );

  async function salvar(_turmaEscolhida: string, entrada: EntradaPonto): Promise<void> {
    if (!accessToken) return;
    await patchPontoAtencao(accessToken, id, entrada);
    router.back();
  }

  function confirmarApagar(): void {
    Alert.alert("Apagar ponto de atenção?", "Esta ação não pode ser desfeita.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Apagar",
        style: "destructive",
        onPress: () => {
          if (!accessToken) return;
          void deletePontoAtencao(accessToken, id).then(() => router.back());
        },
      },
    ]);
  }

  const estadoEfetivo: Estado = accessToken === null ? { status: "erro" } : estado;

  if (estadoEfetivo.status === "loading") {
    return (
      <View className="flex-1 bg-background">
        <AppBar title="Editar ponto de atenção" onClose={() => router.back()} />
        <View className="flex-1 items-center justify-center">
          <Spinner testID="ponto-atencao-editar-loading" />
        </View>
      </View>
    );
  }

  if (estadoEfetivo.status === "erro" || estadoEfetivo.status === "naoEncontrado") {
    return (
      <View className="flex-1 bg-background">
        <AppBar title="Editar ponto de atenção" onClose={() => router.back()} />
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Typography.Paragraph
            testID="ponto-atencao-editar-erro"
            color="muted"
            align="center"
          >
            {estadoEfetivo.status === "naoEncontrado"
              ? "Este ponto de atenção não existe mais."
              : "Não foi possível carregar este ponto de atenção agora."}
          </Typography.Paragraph>
          {estadoEfetivo.status === "erro" ? (
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                setEstado({ status: "loading" });
                void carregar();
              }}
            >
              Tentar novamente
            </Button>
          ) : null}
        </View>
      </View>
    );
  }

  const { ponto } = estadoEfetivo;

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Editar ponto de atenção" onClose={() => router.back()} />
      <ScrollView contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        <PontoAtencaoForm
          turmaId={ponto.turmaId}
          turmas={[]}
          valorInicial={{
            tipo: ponto.tipo,
            titulo: ponto.titulo,
            data: ponto.data,
            hora: ponto.hora,
            observacao: ponto.observacao,
          }}
          salvarRotulo="Salvar alterações"
          onSalvar={salvar}
          podeApagar={ponto.podeApagar}
          onApagar={confirmarApagar}
        />
      </ScrollView>
    </View>
  );
}
