import { useLocalSearchParams } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Linking, ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { getDocente } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DocenteDisciplina, DocentePerfil } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; perfil: DocentePerfil }
  | { status: "error" };

function Secao({ titulo, children }: { titulo: string; children: JSX.Element }): JSX.Element {
  return (
    <View className="mt-6">
      <Typography.Heading type="h6" className="mb-2">
        {titulo}
      </Typography.Heading>
      {children}
    </View>
  );
}

function agruparPorSemestre(disciplinas: DocenteDisciplina[]): [string, DocenteDisciplina[]][] {
  const porSemestre = new Map<string, DocenteDisciplina[]>();
  for (const disciplina of disciplinas) {
    porSemestre.set(disciplina.semestre, [
      ...(porSemestre.get(disciplina.semestre) ?? []),
      disciplina,
    ]);
  }
  // Newest term first, matching how SIGAA itself orders the page.
  return [...porSemestre.entries()].sort(([a], [b]) => b.localeCompare(a));
}

export default function ProfessorDetalhe(): JSX.Element {
  const { siape } = useLocalSearchParams<{ siape: string }>();
  const auth = useAuth();
  // useAuth() returns a discriminated union — accessToken only exists once
  // signed in — matching how trajetoria.tsx reads it.
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const [estado, setEstado] = useState<Estado>({ status: "loading" });

  // Matches how professores.tsx re-runs its own fetch: a plain useCallback
  // driven by both the mount effect and the retry button.
  const carregar = useCallback(async () => {
    setEstado({ status: "loading" });
    try {
      const perfil = await getDocente(accessToken ?? "", siape);
      setEstado({ status: "ready", perfil });
    } catch {
      setEstado({ status: "error" });
    }
  }, [accessToken, siape]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const semestres = useMemo(
    () => (estado.status === "ready" ? agruparPorSemestre(estado.perfil.disciplinas) : []),
    [estado],
  );

  if (estado.status === "loading") {
    return (
      <View className="flex-1">
        <AppBar title="Professor" />
        <View className="mt-10 items-center">
          <Spinner />
        </View>
      </View>
    );
  }

  if (estado.status === "error") {
    return (
      <View className="flex-1">
        <AppBar title="Professor" />
        <View className="mt-10 gap-3 px-4">
          <Typography.Paragraph type="body-sm" color="muted" align="center">
            Não foi possível carregar este perfil agora.
          </Typography.Paragraph>
          <Button variant="outline" size="sm" onPress={() => void carregar()}>
            Tentar novamente
          </Button>
        </View>
      </View>
    );
  }

  const { perfil } = estado;
  const contato = [
    perfil.sala ? ["Sala", perfil.sala] : null,
    perfil.telefone ? ["Telefone/Ramal", perfil.telefone] : null,
    perfil.email ? ["E-mail", perfil.email] : null,
    perfil.enderecoProfissional ? ["Endereço", perfil.enderecoProfissional] : null,
  ].filter((par): par is [string, string] => par !== null);

  const { orientacoes } = perfil;
  const totalOrientacoes =
    orientacoes.mestradoAndamento +
    orientacoes.mestradoConcluidas +
    orientacoes.doutoradoAndamento +
    orientacoes.doutoradoConcluidas;

  return (
    <View className="flex-1">
      <AppBar title={perfil.nome} />
      <ScrollView contentContainerClassName="px-4 pb-10">
        <Typography.Heading type="h5" className="mt-2">
          {perfil.nome}
        </Typography.Heading>
        {perfil.departamento ? (
          <Typography.Paragraph type="body-sm" color="muted">
            {perfil.departamento}
          </Typography.Paragraph>
        ) : null}

        {/* Contact first: it was filled for 4 of 4 docentes measured, and sala
            plus e-mail is what a student actually came looking for. */}
        {contato.length > 0 ? (
          <Secao titulo="Contato">
            <View className="gap-1">
              {contato.map(([rotulo, valor]) => (
                <View key={rotulo} className="flex-row justify-between gap-4">
                  <Typography.Paragraph type="body-xs" color="muted">
                    {rotulo}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="body-sm" align="end" className="flex-1">
                    {valor}
                  </Typography.Paragraph>
                </View>
              ))}
            </View>
          </Secao>
        ) : null}

        {semestres.length > 0 ? (
          <Secao titulo="Disciplinas ministradas">
            <View className="gap-3">
              {semestres.map(([semestre, disciplinas]) => (
                <View key={semestre}>
                  <Typography.Paragraph type="body-xs" color="muted">
                    {semestre}
                  </Typography.Paragraph>
                  {disciplinas.map((disciplina) => (
                    <Typography.Paragraph
                      key={`${semestre}-${disciplina.codigo}`}
                      type="body-sm"
                    >
                      {disciplina.codigo} · {disciplina.nome}
                    </Typography.Paragraph>
                  ))}
                </View>
              ))}
            </View>
          </Secao>
        ) : null}

        {perfil.descricaoPessoal ? (
          <Secao titulo="Sobre">
            <Typography.Paragraph type="body-sm">
              {perfil.descricaoPessoal}
            </Typography.Paragraph>
          </Secao>
        ) : null}

        {perfil.formacao.length > 0 ? (
          <Secao titulo="Formação">
            <View className="gap-1">
              {perfil.formacao.map((linha) => (
                <Typography.Paragraph key={linha} type="body-sm">
                  {linha}
                </Typography.Paragraph>
              ))}
            </View>
          </Secao>
        ) : null}

        {perfil.areasInteresse.length > 0 ? (
          <Secao titulo="Áreas de interesse">
            <View className="gap-1">
              {perfil.areasInteresse.map((area) => (
                <Typography.Paragraph key={area} type="body-sm">
                  {area}
                </Typography.Paragraph>
              ))}
            </View>
          </Secao>
        ) : null}

        {perfil.lattesUrl ? (
          <Secao titulo="Currículo Lattes">
            <Typography.Paragraph
              type="body-sm"
              className="underline"
              onPress={() => void Linking.openURL(perfil.lattesUrl as string)}
            >
              Abrir no Lattes
            </Typography.Paragraph>
          </Secao>
        ) : null}

        {/* Supervision is the closest thing this page has to "would they take
            me on": the TCC titles map what they supervise, the in-progress
            counts hint at whether they have room. */}
        {totalOrientacoes > 0 || perfil.tccsOrientados.length > 0 ? (
          <Secao titulo="Orientações">
            <View className="gap-1">
              {orientacoes.mestradoAndamento > 0 ? (
                <Typography.Paragraph type="body-sm">
                  Mestrado em andamento: {orientacoes.mestradoAndamento}
                </Typography.Paragraph>
              ) : null}
              {orientacoes.mestradoConcluidas > 0 ? (
                <Typography.Paragraph type="body-sm">
                  Mestrado concluídas: {orientacoes.mestradoConcluidas}
                </Typography.Paragraph>
              ) : null}
              {orientacoes.doutoradoAndamento > 0 ? (
                <Typography.Paragraph type="body-sm">
                  Doutorado em andamento: {orientacoes.doutoradoAndamento}
                </Typography.Paragraph>
              ) : null}
              {orientacoes.doutoradoConcluidas > 0 ? (
                <Typography.Paragraph type="body-sm">
                  Doutorado concluídas: {orientacoes.doutoradoConcluidas}
                </Typography.Paragraph>
              ) : null}
              {perfil.tccsOrientados.slice(0, 10).map((tcc) => (
                <Typography.Paragraph
                  key={`${tcc.ano}-${tcc.titulo}`}
                  type="body-xs"
                  color="muted"
                >
                  {tcc.titulo} ({tcc.ano})
                </Typography.Paragraph>
              ))}
            </View>
          </Secao>
        ) : null}
      </ScrollView>
    </View>
  );
}
