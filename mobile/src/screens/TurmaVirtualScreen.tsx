import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Button, Skeleton, Spinner, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import RenderHtml from "react-native-render-html";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { getFaltas, postNoticiaDetalhe, postTurmaVirtual } from "@/lib/api";
import { describeApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import type { NoticiaDetalhe, TurmaVirtualFeed } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; feed: TurmaVirtualFeed }
  | { status: "error"; message: string };

export default function TurmaVirtualScreen(): JSX.Element {
  const { id, nome, codigo, docente } = useLocalSearchParams<{
    id: string;
    nome: string;
    codigo: string;
    docente: string;
  }>();
  const router = useRouter();
  const auth = useAuth();
  // useAuth() returns a discriminated union — accessToken only exists once
  // signed in — matching ProfessoresScreen's pattern. A rota vive dentro do
  // <Stack.Protected> do _layout, então `signedOut` não chega aqui; o `?? ""`
  // é só pra satisfazer o tipo, como professor/[siape].tsx já faz.
  const accessToken = auth.status === "signedIn" ? auth.accessToken : "";
  const insets = useSafeAreaInsets();
  const mutedColor = useThemeColor("muted");
  // RenderHtml precisa da largura em pixels pra dimensionar imagens e tabelas
  // do HTML rico do professor — a da janela, menos o padding do card.
  const { width: larguraJanela } = useWindowDimensions();
  const larguraConteudo = Math.max(larguraJanela - 48, 1);
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const [noticiaAberta, setNoticiaAberta] = useState<NoticiaDetalhe | null>(null);
  const [noticiaCarregando, setNoticiaCarregando] = useState(false);
  const [noticiaErro, setNoticiaErro] = useState<string | null>(null);
  // `null` enquanto o número não chegou — o badge só aparece com um valor real,
  // pra não piscar "0 faltas" e depois corrigir pro total verdadeiro.
  const [faltas, setFaltas] = useState<number | null>(null);
  const montadoRef = useRef(true);

  useEffect(
    () => () => {
      montadoRef.current = false;
    },
    [],
  );

  const carregar = useCallback(async () => {
    setEstado({ status: "loading" });
    try {
      const credenciais = await getSigaaCredentials();
      if (!credenciais) {
        if (montadoRef.current) {
          setEstado({
            status: "error",
            message: "Vincule sua conta do SIGAA antes de abrir a turma virtual.",
          });
        }
        return;
      }
      const feed = await postTurmaVirtual(accessToken, id, credenciais);
      if (montadoRef.current) {
        setEstado({ status: "ready", feed });
      }
    } catch (error) {
      if (montadoRef.current) {
        setEstado({ status: "error", message: describeApiError(error) });
      }
    }
  }, [accessToken, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  const abrirNoticia = useCallback(
    async (noticiaId: string) => {
      setNoticiaErro(null);
      setNoticiaCarregando(true);
      try {
        const credenciais = await getSigaaCredentials();
        if (!credenciais) {
          if (montadoRef.current) {
            setNoticiaErro("Vincule sua conta do SIGAA para abrir esta notícia.");
          }
          return;
        }
        const detalhe = await postNoticiaDetalhe(accessToken, id, noticiaId, credenciais);
        if (montadoRef.current) {
          setNoticiaAberta(detalhe);
        }
      } catch (error) {
        // Sem isto a promise rejeitada só produzia um aviso no console e nada
        // na tela — o toque na notícia parecia simplesmente não fazer nada.
        if (montadoRef.current) {
          setNoticiaErro(describeApiError(error));
        }
      } finally {
        if (montadoRef.current) {
          setNoticiaCarregando(false);
        }
      }
    },
    [accessToken, id],
  );

  const fecharNoticia = useCallback(() => {
    setNoticiaAberta(null);
    setNoticiaErro(null);
  }, []);

  // Recarregado a cada foco (e não só na montagem) porque é assim que a tela
  // fica sabendo do número novo ao voltar do contador — ele salva e dá
  // router.back(), sem contexto global pra avisar ninguém. Leitura barata no
  // banco, sem SIGAA envolvido.
  const carregarFaltas = useCallback(async () => {
    try {
      const total = await getFaltas(accessToken, id);
      if (montadoRef.current) {
        setFaltas(total);
      }
    } catch (error) {
      // O contador é acessório: se falhar, a turma continua utilizável e o
      // badge simplesmente não aparece — melhor que um erro na tela inteira.
      console.warn("Failed to load faltas", error);
    }
  }, [accessToken, id]);

  useFocusEffect(
    useCallback(() => {
      void carregarFaltas();
    }, [carregarFaltas]),
  );

  // `headerShown: false` é global no _layout, então cada tela empilhada
  // desenha a própria AppBar — sem ela um iPhone só tem o edge-swipe pra
  // voltar. Mesmo padrão de professor/[siape].tsx.
  const barra = <AppBar title={nome} titleType="h5" onBack={() => router.back()} />;

  const subtitulo = [codigo, docente].filter(Boolean).join(" · ");
  const feed = estado.status === "ready" ? estado.feed : null;
  const vazio = feed !== null && feed.noticias.length === 0 && feed.topicos.length === 0;

  return (
    <View className="flex-1">
      {barra}
      <ScrollView contentContainerClassName="pb-8">
        {subtitulo ? (
          <View className="px-6 pb-4">
            <Typography.Paragraph>{subtitulo}</Typography.Paragraph>
          </View>
        ) : null}

        {noticiaErro ? (
          <View testID="noticia-erro" className="mx-6 mb-4 rounded-2xl bg-danger-soft p-4">
            <Typography.Paragraph>{noticiaErro}</Typography.Paragraph>
          </View>
        ) : null}

        {/*
          Só o miolo do feed troca entre skeleton, erro e conteúdo: a AppBar e o
          badge de faltas ficam de pé o tempo todo. Quem abriu a turma só pra
          marcar uma falta não espera o scraping do SIGAA — que encadeia 3+
          requisições e é de longe a parte mais lenta da tela.
        */}
        {estado.status === "loading" ? (
          <View testID="turma-skeleton" className="gap-2 px-6 pb-6">
            <Skeleton className="h-7 w-40 rounded-lg" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="mt-4 h-7 w-44 rounded-lg" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </View>
        ) : null}

        {estado.status === "error" ? (
          <View className="mt-6 items-center gap-4 px-8">
            <Typography.Paragraph>{estado.message}</Typography.Paragraph>
            <Button variant="outline" size="sm" onPress={() => void carregar()}>
              Tentar novamente
            </Button>
          </View>
        ) : null}

        {vazio ? (
          <View className="items-center p-8">
            <Typography.Paragraph>Nada por aqui ainda.</Typography.Paragraph>
          </View>
        ) : null}

        {feed !== null && feed.noticias.length > 0 ? (
          <View className="gap-2 px-6 pb-6">
            <Typography.Heading>Notícias</Typography.Heading>
            {feed.noticias.map((noticia) => (
              <Pressable
                key={noticia.id}
                onPress={() => void abrirNoticia(noticia.id)}
                className="rounded-2xl bg-surface-secondary p-4"
              >
                <Typography.Paragraph>{noticia.titulo}</Typography.Paragraph>
                <Typography.Paragraph>{noticia.data}</Typography.Paragraph>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/*
          Avaliações não aparecem aqui de propósito: o backend as omite do feed
          e as converte em Pontos de Atenção do tipo PROVA, que a Home já mostra.
        */}
        {feed !== null && feed.topicos.length > 0 ? (
          <View className="gap-2 px-6 pb-6">
            <Typography.Heading>Tópicos de aula</Typography.Heading>
            {feed.topicos.map((topico, index) => (
              <View
                key={`${topico.titulo}-${index}`}
                className="rounded-2xl bg-surface-secondary p-4"
              >
                <Typography.Paragraph>{topico.titulo}</Typography.Paragraph>
                <Typography.Paragraph>{topico.periodo}</Typography.Paragraph>
                {topico.conteudoHtml ? (
                  <RenderHtml
                    contentWidth={larguraConteudo}
                    source={{ html: topico.conteudoHtml }}
                  />
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {faltas !== null ? (
        <View
          className="px-6 pt-3.5 bg-background"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <Pressable
            testID="turma-faltas-badge"
            onPress={() =>
              router.push({
                pathname: "/contador-faltas",
                params: { id, faltas: String(faltas) },
              })
            }
            className="flex-row items-center justify-center gap-2 rounded-full bg-surface-secondary px-4 py-3"
          >
            <AppIcon name="IconCalendarBlank" size={18} color={mutedColor} />
            <Typography.Paragraph weight="medium">
              {faltas === 1 ? "1 falta" : `${faltas} faltas`}
            </Typography.Paragraph>
          </Pressable>
        </View>
      ) : null}

      {noticiaCarregando ? (
        <View
          testID="noticia-carregando"
          className="absolute inset-0 items-center justify-center bg-surface-primary/80"
        >
          <Spinner />
        </View>
      ) : null}

      {noticiaAberta ? (
        <View className="absolute inset-0 bg-surface-primary" style={{ paddingTop: insets.top }}>
          {/* O corpo é HTML rico do professor e pode passar de uma tela —
              sem ScrollView o fim da notícia ficava inalcançável. */}
          <ScrollView testID="noticia-scroll" contentContainerClassName="gap-2 p-6 pb-10">
            <Button variant="outline" size="sm" onPress={fecharNoticia}>
              Fechar
            </Button>
            <Typography.Heading>{noticiaAberta.titulo}</Typography.Heading>
            <Typography.Paragraph>
              {noticiaAberta.data}
              {noticiaAberta.autor ? ` · ${noticiaAberta.autor}` : ""}
            </Typography.Paragraph>
            <RenderHtml
              contentWidth={larguraConteudo}
              source={{ html: noticiaAberta.conteudoHtml }}
            />
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
