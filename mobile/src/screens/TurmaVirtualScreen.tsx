import { useLocalSearchParams } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import RenderHtml from "react-native-render-html";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { postNoticiaDetalhe, postTurmaVirtual } from "@/lib/api";
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
  const auth = useAuth();
  // useAuth() returns a discriminated union — accessToken only exists once
  // signed in — matching ProfessoresScreen's pattern.
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const insets = useSafeAreaInsets();
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const [noticiaAberta, setNoticiaAberta] = useState<NoticiaDetalhe | null>(null);
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
      if (!accessToken) {
        if (montadoRef.current) {
          setEstado({ status: "error", message: "Faça login para abrir a turma virtual." });
        }
        return;
      }
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
      if (!accessToken) {
        return;
      }
      const credenciais = await getSigaaCredentials();
      if (!credenciais) {
        return;
      }
      const detalhe = await postNoticiaDetalhe(accessToken, id, noticiaId, credenciais);
      if (montadoRef.current) {
        setNoticiaAberta(detalhe);
      }
    },
    [accessToken, id],
  );

  const fecharNoticia = useCallback(() => {
    setNoticiaAberta(null);
  }, []);

  if (estado.status === "loading") {
    return (
      <View className="flex-1 items-center justify-center" style={{ paddingTop: insets.top }}>
        <Spinner />
      </View>
    );
  }

  if (estado.status === "error") {
    return (
      <View
        className="flex-1 items-center justify-center gap-4 p-8"
        style={{ paddingTop: insets.top }}
      >
        <Typography.Paragraph>{estado.message}</Typography.Paragraph>
        <Button variant="outline" size="sm" onPress={() => void carregar()}>
          Tentar novamente
        </Button>
      </View>
    );
  }

  const { feed } = estado;
  const vazio =
    feed.noticias.length === 0 && feed.avaliacoes.length === 0 && feed.topicos.length === 0;
  const subtitulo = [codigo, docente].filter(Boolean).join(" · ");

  return (
    <View className="flex-1" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerClassName="pb-8">
        <View className="p-6 gap-1">
          <Typography.Heading>{nome}</Typography.Heading>
          {subtitulo ? <Typography.Paragraph>{subtitulo}</Typography.Paragraph> : null}
        </View>

        {vazio ? (
          <View className="items-center p-8">
            <Typography.Paragraph>Nada por aqui ainda.</Typography.Paragraph>
          </View>
        ) : null}

        {feed.noticias.length > 0 ? (
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

        {feed.avaliacoes.length > 0 ? (
          <View className="gap-2 px-6 pb-6">
            <Typography.Heading>Avaliações</Typography.Heading>
            {feed.avaliacoes.map((avaliacao, index) => (
              <View
                key={`${avaliacao.descricao}-${index}`}
                className="rounded-2xl bg-surface-secondary p-4"
              >
                <Typography.Paragraph>{avaliacao.descricao}</Typography.Paragraph>
                <Typography.Paragraph>{avaliacao.data}</Typography.Paragraph>
              </View>
            ))}
          </View>
        ) : null}

        {feed.topicos.length > 0 ? (
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
                  <RenderHtml contentWidth={300} source={{ html: topico.conteudoHtml }} />
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {noticiaAberta ? (
        <View className="absolute inset-0 bg-surface-primary p-6" style={{ paddingTop: insets.top }}>
          <Button variant="outline" size="sm" onPress={fecharNoticia}>
            Fechar
          </Button>
          <Typography.Heading>{noticiaAberta.titulo}</Typography.Heading>
          <Typography.Paragraph>
            {noticiaAberta.data}
            {noticiaAberta.autor ? ` · ${noticiaAberta.autor}` : ""}
          </Typography.Paragraph>
          <RenderHtml contentWidth={300} source={{ html: noticiaAberta.conteudoHtml }} />
        </View>
      ) : null}
    </View>
  );
}
