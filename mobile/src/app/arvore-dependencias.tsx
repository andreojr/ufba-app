import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { ApiError, getVizinhosCurriculares } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type {
  SituacaoVizinho,
  VizinhoCurricular,
  VizinhosCurricularesResponse,
} from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; dados: VizinhosCurricularesResponse }
  | { status: "erro" }
  // Distinta de erro genérico: o próprio código raiz não existe na grade
  // ativa do curso (ex: optativa, ou matéria de um currículo antigo, vinda
  // do histórico do aluno). A API devolve 404 (ComponenteDesconhecidoError,
  // cuja mensagem cita o código) pra diferenciar de um 404 de curso não
  // encontrado, que cai no estado de erro genérico.
  | { status: "naoNaGrade" };

const ICONE_POR_SITUACAO: Record<SituacaoVizinho, AppIconName> = {
  cursada: "IconCheck",
  emCurso: "IconClock",
  liberada: "IconLockKeyOpen",
  bloqueada: "IconLockKey",
};

const ROTULO_POR_SITUACAO: Record<SituacaoVizinho, string> = {
  cursada: "aprovada",
  emCurso: "em curso",
  liberada: "liberada",
  bloqueada: "bloqueada",
};

/**
 * Um card na linha do tempo, com o pontinho de status à esquerda (mesmo
 * vocabulário do `LinhaDoTempo` da Trajetória) e uma linha vertical
 * conectando ao próximo item — exceto no último de cada bloco (`comLinha`).
 * `destaque` marca a matéria atual (card maior, borda accent).
 */
function CardVizinho({
  vizinho,
  destaque = false,
  comLinha = true,
  onPress,
}: {
  vizinho: VizinhoCurricular;
  destaque?: boolean;
  comLinha?: boolean;
  onPress?: () => void;
}): JSX.Element {
  const [accentColor, successColor, mutedColor, foregroundColor] = useThemeColor([
    "accent",
    "success",
    "muted",
    "foreground",
  ]);
  const bloqueada = vizinho.situacao === "bloqueada";
  const preenchido = vizinho.situacao === "cursada" || vizinho.situacao === "emCurso";
  const corPonto =
    vizinho.situacao === "cursada"
      ? successColor
      : vizinho.situacao === "emCurso"
        ? accentColor
        : vizinho.situacao === "bloqueada"
          ? mutedColor
          : foregroundColor;

  const conteudo = (
    <View
      className={`flex-1 rounded-2xl p-3 flex-row items-center justify-between gap-2 ${
        destaque
          ? "bg-accent-soft border-2 border-accent"
          : bloqueada
            ? "bg-surface-secondary/40 border border-dashed border-white/20 opacity-60"
            : "bg-surface-secondary"
      }`}
    >
      <View className="gap-0.5">
        <Typography.Paragraph weight="medium" className={destaque ? "text-accent" : undefined}>
          {vizinho.nome}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="body-xs"
          color="muted"
          className={`font-mono ${destaque ? "text-accent" : ""}`}
        >
          {vizinho.codigo} · {ROTULO_POR_SITUACAO[vizinho.situacao]}
        </Typography.Paragraph>
      </View>
      <AppIcon name={ICONE_POR_SITUACAO[vizinho.situacao]} size={20} color={corPonto} />
    </View>
  );

  return (
    <View className="flex-row gap-3">
      <View className="w-3 items-center">
        <View
          className="rounded-full mt-1"
          style={{
            width: destaque ? 14 : 10,
            height: destaque ? 14 : 10,
            backgroundColor: preenchido ? corPonto : "transparent",
            borderWidth: preenchido ? 0 : 2,
            borderColor: corPonto,
            borderStyle: bloqueada ? "dashed" : "solid",
          }}
        />
        {comLinha ? <View className="flex-1 w-px bg-white/15 mt-1" /> : null}
      </View>
      {onPress ? (
        <Pressable testID={`vizinho-card-${vizinho.codigo}`} onPress={onPress} className="flex-1 mb-3">
          {conteudo}
        </Pressable>
      ) : (
        <View testID={`vizinho-card-${vizinho.codigo}`} className="flex-1 mb-3">
          {conteudo}
        </View>
      )}
    </View>
  );
}

/**
 * Tela de navegação em cascata: matéria atual em destaque, pré-requisitos
 * diretos acima, o que ela desbloqueia diretamente abaixo — conectados por
 * uma linha do tempo vertical. Tocar num card de qualquer bloco empurra
 * uma nova instância desta mesma tela, recentrada naquela matéria.
 */
export default function VizinhosCurricularesScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { codigo, nome } = useLocalSearchParams<{ codigo: string; nome?: string }>();
  const [foregroundColor] = useThemeColor(["foreground"]);
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  // Guards against setEstado firing after the modal is dismissed while the
  // fetch is still in flight (same pattern as professor/[siape].tsx).
  const ativoRef = useRef(true);

  useEffect(
    () => () => {
      ativoRef.current = false;
    },
    []
  );

  const carregar = useCallback(async () => {
    const curso = auth.status === "signedIn" ? auth.user.curso : null;
    if (auth.status !== "signedIn" || !curso || !codigo) {
      setEstado({ status: "erro" });
      return;
    }

    setEstado({ status: "loading" });
    try {
      const dados = await getVizinhosCurriculares(auth.accessToken, curso, codigo);
      if (!ativoRef.current) return;
      setEstado({ status: "ready", dados });
    } catch (error) {
      if (!ativoRef.current) return;
      // Ver o comentário do tipo Estado: distingue ComponenteDesconhecidoError
      // (a mensagem cita o código) de CursoDesconhecidoError (não cita).
      if (error instanceof ApiError && error.status === 404 && error.message.includes(codigo)) {
        setEstado({ status: "naoNaGrade" });
        return;
      }
      setEstado({ status: "erro" });
    }
  }, [auth, codigo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrirVizinho(vizinho: VizinhoCurricular): void {
    router.push({
      pathname: "/arvore-dependencias",
      params: { codigo: vizinho.codigo, nome: vizinho.nome },
    });
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-6 pb-3.5"
        style={{ paddingTop: insets.top + 14 }}
      >
        <Typography.Heading type="h4">{nome ?? codigo}</Typography.Heading>
        <Pressable testID="vizinhos-curriculares-close" onPress={() => router.back()} hitSlop={12}>
          <AppIcon name="IconX" size={24} color={foregroundColor} />
        </Pressable>
      </View>

      {estado.status === "loading" ? (
        <View className="flex-1 items-center justify-center">
          <Spinner testID="vizinhos-curriculares-loading" />
        </View>
      ) : estado.status === "erro" ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Typography.Paragraph testID="vizinhos-curriculares-erro" color="muted" align="center">
            Não foi possível carregar a trilha curricular.
          </Typography.Paragraph>
          <Button variant="outline" size="sm" onPress={() => void carregar()}>
            Tentar novamente
          </Button>
        </View>
      ) : estado.status === "naoNaGrade" ? (
        <View className="flex-1 items-center justify-center px-6">
          <Typography.Paragraph testID="vizinhos-curriculares-nao-na-grade" color="muted" align="center">
            Essa matéria não está na grade curricular ativa do curso.
          </Typography.Paragraph>
        </View>
      ) : (
        <ScrollView
          testID="vizinhos-curriculares-scroll"
          className="flex-1 px-6"
          contentContainerClassName="pb-8"
        >
          {estado.dados.preRequisitos.length > 0 ? (
            <>
              <Typography.Paragraph type="body-xs" color="muted" className="mb-2 ml-9">
                Pré-requisito
              </Typography.Paragraph>
              {estado.dados.preRequisitos.map((vizinho) => (
                <CardVizinho key={vizinho.codigo} vizinho={vizinho} onPress={() => abrirVizinho(vizinho)} />
              ))}
            </>
          ) : null}

          <Typography.Paragraph type="body-xs" color="muted" className="mb-2 ml-9">
            Você está aqui
          </Typography.Paragraph>
          <CardVizinho
            vizinho={estado.dados.atual}
            destaque
            comLinha={estado.dados.desbloqueia.length > 0}
          />

          {estado.dados.desbloqueia.length > 0 ? (
            <>
              <Typography.Paragraph type="body-xs" color="muted" className="mb-2 ml-9">
                Desbloqueia
              </Typography.Paragraph>
              {estado.dados.desbloqueia.map((vizinho, i) => (
                <CardVizinho
                  key={vizinho.codigo}
                  vizinho={vizinho}
                  comLinha={i < estado.dados.desbloqueia.length - 1}
                  onPress={() => abrirVizinho(vizinho)}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
