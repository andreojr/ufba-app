import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, Tabs, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { getDocente } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { decodeHorario } from "@/lib/docente-horario";
import { iniciais } from "@/lib/iniciais";
import { formatTempoLecionando } from "@/lib/tempo-lecionando";
import type { DocenteDisciplina, DocentePerfil } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; perfil: DocentePerfil }
  | { status: "error" };

/**
 * SIGAA's "Disciplinas Ministradas" page has one row per turma, so a docente
 * teaching two turmas of the same course in one term shows up twice, differing
 * only by `horario`. This screen prints just codigo and nome, so those rows
 * would render as identical duplicate lines — and, keyed on semestre+codigo,
 * as a duplicate React key. Keying by codigo inside each term collapses them.
 */
function agruparPorSemestre(disciplinas: DocenteDisciplina[]): [string, DocenteDisciplina[]][] {
  const porSemestre = new Map<string, Map<string, DocenteDisciplina>>();
  for (const disciplina of disciplinas) {
    const doSemestre = porSemestre.get(disciplina.semestre) ?? new Map();
    if (!doSemestre.has(disciplina.codigo)) {
      doSemestre.set(disciplina.codigo, disciplina);
    }
    porSemestre.set(disciplina.semestre, doSemestre);
  }
  // Newest term first, matching how SIGAA itself orders the page.
  return [...porSemestre.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([semestre, doSemestre]) => [semestre, [...doSemestre.values()]]);
}

/**
 * The backend already drops indistinguishable TCCs, but profiles cached before
 * that fix keep serving them until they go stale — and titulo+ano is all this
 * list has to key on, so a duplicate pair crashes the screen. Deduping here
 * too costs nothing and makes the screen independent of which backend version
 * wrote the cached row.
 */
function tccsDistintos(tccs: DocentePerfil["tccsOrientados"]): DocentePerfil["tccsOrientados"] {
  const porChave = new Map<string, DocentePerfil["tccsOrientados"][number]>();
  for (const tcc of tccs) {
    const chave = `${tcc.ano}-${tcc.titulo}`;
    if (!porChave.has(chave)) {
      porChave.set(chave, tcc);
    }
  }
  return [...porChave.values()];
}

/** Código · nome · (horário decodificado · carga horária), pulando a parte de
 * horário quando o código não bate com o formato conhecido. */
function metaDaDisciplina(disciplina: DocenteDisciplina): string {
  const partes = [decodeHorario(disciplina.horario), `${disciplina.cargaHoraria} h`].filter(
    (parte): parte is string => Boolean(parte),
  );
  return partes.join(" · ");
}

function DisciplinaRow({ disciplina, ultima }: { disciplina: DocenteDisciplina; ultima: boolean }): JSX.Element {
  return (
    <View className={`py-2.5 gap-0.5 ${ultima ? "" : "border-b border-white/10"}`}>
      <View className="flex-row items-baseline gap-2">
        <Typography.Paragraph type="body-xs" weight="medium" className="text-accent font-mono">
          {disciplina.codigo}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-sm" weight="medium" className="flex-1">
          {disciplina.nome}
        </Typography.Paragraph>
      </View>
      <Typography.Paragraph type="body-xs" color="muted">
        {metaDaDisciplina(disciplina)}
      </Typography.Paragraph>
    </View>
  );
}

/** O semestre mais recente do docente fica sempre aberto; os demais entram
 * num acordeão colapsado — quem leciona há muitos semestres não rola uma
 * lista inteira pra chegar às disciplinas atuais. */
function SemestreAnteriorRow({
  semestre,
  disciplinas,
  aberto,
  onToggle,
}: {
  semestre: string;
  disciplinas: DocenteDisciplina[];
  aberto: boolean;
  onToggle: () => void;
}): JSX.Element {
  const mutedColor = useThemeColor("muted");
  return (
    <View>
      {/* `Typography.Paragraph` renders a plain RN `Text` — Text does not lay
          out its children in a flexbox, so the row itself must be a `View`
          (via `Pressable`, for the toggle), with `Text` only around the
          actual words. */}
      <Pressable
        testID={`semestre-anterior-${semestre}`}
        onPress={onToggle}
        className="flex-row items-center gap-2 py-2.5"
      >
        <Typography.Paragraph type="body-sm" weight="medium" className="font-mono">
          {semestre}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-sm" color="muted" className="flex-1">
          {disciplinas.length === 1 ? "1 disciplina" : `${disciplinas.length} disciplinas`}
        </Typography.Paragraph>
        <AppIcon name={aberto ? "IconCaretDown" : "IconCaretRight"} size={16} color={mutedColor} />
      </Pressable>
      {aberto ? (
        <View className="pb-1">
          {disciplinas.map((disciplina, indice) => (
            <DisciplinaRow
              key={disciplina.codigo}
              disciplina={disciplina}
              ultima={indice === disciplinas.length - 1}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Mestrado and Doutorado each render even when empty — an omitted level
 * reads as "not loaded", not "zero"; saying "Nenhuma orientação" is the only
 * way to tell the two apart. */
function NivelOrientacao({
  titulo,
  andamento,
  concluidas,
}: {
  titulo: string;
  andamento: number;
  concluidas: number;
}): JSX.Element {
  const temAlgo = andamento > 0 || concluidas > 0;
  return (
    <View className="flex-1 gap-3">
      <Typography.Paragraph type="body-sm" weight="medium">
        {titulo}
      </Typography.Paragraph>
      {temAlgo ? (
        <Typography.Paragraph type="body-xs" color="muted">
          <Text className="font-mono text-accent">{andamento}</Text> em andamento ·{" "}
          <Text className="font-mono">{concluidas}</Text>{" "}
          {concluidas === 1 ? "concluída" : "concluídas"}
        </Typography.Paragraph>
      ) : (
        <Typography.Paragraph type="body-xs" color="muted">
          Nenhuma orientação
        </Typography.Paragraph>
      )}
    </View>
  );
}

function Secao({ titulo, children }: { titulo: string; children: JSX.Element }): JSX.Element {
  return (
    <View className="gap-2">
      <Typography.Heading type="h6">{titulo}</Typography.Heading>
      {children}
    </View>
  );
}

function LinhaContato({
  rotulo,
  valor,
  onPress,
  ultima,
}: {
  rotulo: string;
  valor: string;
  onPress?: () => void;
  ultima: boolean;
}): JSX.Element {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      className={`flex-row items-center gap-3 py-2.5 ${ultima ? "" : "border-b border-white/10"}`}
    >
      <Typography.Paragraph type="body-sm" color="muted" className="flex-none">
        {rotulo}
      </Typography.Paragraph>
      <Typography.Paragraph
        type="body-sm"
        weight={onPress ? "medium" : undefined}
        className={`flex-1 text-right ${onPress ? "text-accent" : ""}`}
      >
        {valor}
      </Typography.Paragraph>
    </Wrapper>
  );
}

export default function ProfessorDetalhe(): JSX.Element {
  const { siape } = useLocalSearchParams<{ siape: string }>();
  const router = useRouter();
  const auth = useAuth();
  // useAuth() returns a discriminated union — accessToken only exists once
  // signed in — matching how trajetoria.tsx reads it.
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  // Guards every setEstado in `carregar` against firing after the screen is
  // gone — a student can back out while getDocente is still in flight, and a
  // retry pressed before that in-flight request settles must not let its
  // stale response resurrect a now-abandoned attempt. Mirrors professores.tsx's
  // montadoRef (added alongside this screen's retry button).
  const montadoRef = useRef(true);
  const [aba, setAba] = useState<string | null>(null);
  const [semestresAbertos, setSemestresAbertos] = useState<Record<string, boolean>>({});
  // Older terms start collapsed behind a single "ver N anteriores" summary —
  // a docente teaching for 27 semesters would otherwise dump two dozen
  // accordion headers on screen before showing a single course.
  const [mostrarAnteriores, setMostrarAnteriores] = useState(false);
  const accentColor = useThemeColor("accent");
  const mutedColor = useThemeColor("muted");
  const insets = useSafeAreaInsets();

  useEffect(
    () => () => {
      montadoRef.current = false;
    },
    [],
  );

  // Matches how professores.tsx re-runs its own fetch: a plain useCallback
  // driven by both the mount effect and the retry button.
  const carregar = useCallback(async () => {
    setEstado({ status: "loading" });
    try {
      const perfil = await getDocente(accessToken ?? "", siape);
      if (!montadoRef.current) return;
      setEstado({ status: "ready", perfil });
    } catch {
      if (!montadoRef.current) return;
      setEstado({ status: "error" });
    }
  }, [accessToken, siape]);

  useEffect(() => {
    // O analisador não enxerga através da fronteira assíncrona: `carregar` só
    // chama setState depois de um await, então nada atualiza no mesmo tick deste
    // efeito e a cascata que a regra previne não existe aqui.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  const semestres = useMemo(
    () => (estado.status === "ready" ? agruparPorSemestre(estado.perfil.disciplinas) : []),
    [estado],
  );

  if (estado.status === "loading") {
    return (
      <View className="flex-1">
        <AppBar title="Professor" onClose={() => router.back()} />
        <View className="mt-10 items-center">
          <Spinner />
        </View>
      </View>
    );
  }

  if (estado.status === "error") {
    return (
      <View className="flex-1">
        <AppBar title="Professor" onClose={() => router.back()} />
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
  type LinhaContatoTupla = [string, string, (() => void) | undefined];
  const contato: LinhaContatoTupla[] = (
    [
      perfil.sala ? ["Sala", perfil.sala, undefined] : null,
      perfil.telefone ? ["Telefone/Ramal", perfil.telefone, undefined] : null,
      perfil.email
        ? ["E-mail", perfil.email, () => void Linking.openURL(`mailto:${perfil.email}`)]
        : null,
      perfil.enderecoProfissional ? ["Endereço", perfil.enderecoProfissional, undefined] : null,
    ] as (LinhaContatoTupla | null)[]
  ).filter((linha): linha is LinhaContatoTupla => linha !== null);

  const { orientacoes } = perfil;
  const totalOrientacoes =
    orientacoes.mestradoAndamento +
    orientacoes.mestradoConcluidas +
    orientacoes.doutoradoAndamento +
    orientacoes.doutoradoConcluidas;
  const tccs = tccsDistintos(perfil.tccsOrientados);

  const [semestreAtual, ...semestresAnteriores] = semestres;
  const totalDisciplinasAnteriores = semestresAnteriores.reduce(
    (soma, [, disciplinas]) => soma + disciplinas.length,
    0,
  );

  const temDisciplinas = perfil.disciplinas.length > 0;
  const temPerfilExtra =
    Boolean(perfil.descricaoPessoal) ||
    perfil.formacao.length > 0 ||
    perfil.areasInteresse.length > 0 ||
    Boolean(perfil.lattesUrl);
  const temOrientacoes = totalOrientacoes > 0 || tccs.length > 0;

  // Uma seção com conteúdo real vira aba só quando há mais de uma — o caso
  // comum (só Contato + Disciplinas, roadmap 2026-08-19) fica com tudo
  // empilhado, sem abas à toa.
  const secoes = [
    temDisciplinas ? { valor: "disciplinas", rotulo: "Disciplinas" } : null,
    temPerfilExtra ? { valor: "perfil", rotulo: "Perfil" } : null,
    temOrientacoes ? { valor: "orientacoes", rotulo: "Orientações" } : null,
  ].filter((secao): secao is { valor: string; rotulo: string } => secao !== null);
  const usaAbas = secoes.length > 1;
  const abaAtiva = aba ?? secoes[0]?.valor ?? null;

  const conteudoDisciplinas = temDisciplinas ? (
    <View className="gap-1">
      {semestreAtual ? (
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="font-mono text-accent-soft-foreground bg-accent-soft px-2.5 py-1 rounded-full text-xs">
              {semestreAtual[0]}
            </Text>
            <Text className="text-muted text-xs">semestre atual</Text>
          </View>
          {semestreAtual[1].map((disciplina, indice) => (
            <DisciplinaRow
              key={disciplina.codigo}
              disciplina={disciplina}
              ultima={indice === semestreAtual[1].length - 1}
            />
          ))}
        </View>
      ) : null}
      {semestresAnteriores.length > 0 ? (
        <View className="mt-2">
          <Pressable
            testID="toggle-semestres-anteriores"
            onPress={() => setMostrarAnteriores((atual) => !atual)}
            className="flex-row items-center gap-2 py-2.5"
          >
            <Typography.Paragraph type="body-sm" weight="medium" className="text-accent flex-1">
              {mostrarAnteriores
                ? "Ocultar semestres anteriores"
                : `Ver ${
                    totalDisciplinasAnteriores === 1
                      ? "1 disciplina anterior"
                      : `${totalDisciplinasAnteriores} disciplinas anteriores`
                  }`}
            </Typography.Paragraph>
            <AppIcon
              name={mostrarAnteriores ? "IconCaretDown" : "IconCaretRight"}
              size={16}
              color={accentColor}
            />
          </Pressable>
          {mostrarAnteriores ? (
            <View className="gap-1">
              {semestresAnteriores.map(([semestre, disciplinas]) => (
                <SemestreAnteriorRow
                  key={semestre}
                  semestre={semestre}
                  disciplinas={disciplinas}
                  aberto={Boolean(semestresAbertos[semestre])}
                  onToggle={() =>
                    setSemestresAbertos((atual) => ({ ...atual, [semestre]: !atual[semestre] }))
                  }
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  ) : null;

  const conteudoPerfil = temPerfilExtra ? (
    <View className="gap-5">
      {perfil.descricaoPessoal ? (
        <Secao titulo="Sobre">
          <Typography.Paragraph type="body-sm">{perfil.descricaoPessoal}</Typography.Paragraph>
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
        <Typography.Paragraph
          type="body-sm"
          weight="medium"
          className="text-accent"
          onPress={() => void Linking.openURL(perfil.lattesUrl as string)}
        >
          Abrir no Lattes
        </Typography.Paragraph>
      ) : null}
    </View>
  ) : null;

  // Supervision is the closest thing this page has to "would they take me
  // on": the TCC titles map what they supervise, the in-progress counts hint
  // at whether they have room.
  const conteudoOrientacoes = temOrientacoes ? (
    <View className="gap-5">
      <View className="flex-row gap-6">
        <NivelOrientacao
          titulo="Mestrado"
          andamento={orientacoes.mestradoAndamento}
          concluidas={orientacoes.mestradoConcluidas}
        />
        <NivelOrientacao
          titulo="Doutorado"
          andamento={orientacoes.doutoradoAndamento}
          concluidas={orientacoes.doutoradoConcluidas}
        />
      </View>

      {tccs.length > 0 ? (
        <View className="gap-1">
          <Typography.Paragraph type="body-xs" weight="medium" color="muted">
            Trabalhos de conclusão orientados
          </Typography.Paragraph>
          {/* Deduped before the slice, so repeats cannot eat the 10 slots. */}
          {tccs.slice(0, 10).map((tcc, indice, lista) => (
            <View
              key={`${tcc.ano}-${tcc.titulo}`}
              className={`flex-row items-baseline gap-2 py-2.5 ${
                indice === lista.length - 1 ? "" : "border-b border-white/10"
              }`}
            >
              <Typography.Paragraph type="body-sm" className="flex-1">
                {tcc.titulo}
              </Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                {tcc.ano}
              </Typography.Paragraph>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  ) : null;

  const conteudoPorValor: Record<string, JSX.Element | null> = {
    disciplinas: conteudoDisciplinas,
    perfil: conteudoPerfil,
    orientacoes: conteudoOrientacoes,
  };

  return (
    <View className="flex-1">
      {/* No onClose here — unlike the loading/error states above, the title
          is the professor's own (potentially long) name, and the leading X
          crowded it. Closing this screen happens via the "Fechar" button at
          the bottom of the scroll instead. */}
      <AppBar title={perfil.nome} titleType="h5" />
      <ScrollView contentContainerClassName="px-4 pb-10 gap-6">
        {/* `items-start`, not `items-center`: the department/SIAPE block is
            two lines, and centering the avatar against both drifted it away
            from the department name it is meant to sit beside. */}
        <View className="flex-row items-start gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft">
            <Typography.Paragraph
              type="body-sm"
              weight="semibold"
              className="text-accent-soft-foreground"
            >
              {iniciais(perfil.nome)}
            </Typography.Paragraph>
          </View>
          <View className="flex-1 gap-0.5">
            {perfil.departamento || perfil.unidade ? (
              <Typography.Paragraph type="body-sm" color="muted">
                {[perfil.departamento, perfil.unidade].filter(Boolean).join(" · ")}
              </Typography.Paragraph>
            ) : null}
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                SIAPE {perfil.siape}
              </Typography.Paragraph>
              {semestres.length > 0 ? (
                <>
                  <Typography.Paragraph type="body-xs" color="muted">
                    ·
                  </Typography.Paragraph>
                  <View className="flex-row items-center gap-1">
                    <AppIcon name="IconClock" size={12} color={mutedColor} />
                    <Typography.Paragraph type="body-xs" color="muted">
                      {formatTempoLecionando(semestres.length)}
                    </Typography.Paragraph>
                  </View>
                </>
              ) : null}
            </View>
          </View>
        </View>

        {contato.length > 0 ? (
          <Secao titulo="Contato">
            <View className="rounded-3xl bg-surface-secondary px-4">
              {contato.map(([rotulo, valor, onPress], indice) => (
                <LinhaContato
                  key={rotulo}
                  rotulo={rotulo}
                  valor={valor}
                  onPress={onPress}
                  ultima={indice === contato.length - 1}
                />
              ))}
            </View>
          </Secao>
        ) : null}

        {usaAbas ? (
          <Tabs
            value={abaAtiva ?? secoes[0].valor}
            onValueChange={(valor) => setAba(valor as string)}
            variant="primary"
          >
            <Tabs.List>
              <Tabs.Indicator />
              {secoes.map((secao) => (
                <Tabs.Trigger key={secao.valor} value={secao.valor}>
                  <Tabs.Label>{secao.rotulo}</Tabs.Label>
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {secoes.map((secao) => (
              <Tabs.Content key={secao.valor} value={secao.valor}>
                <View className="mt-4">{conteudoPorValor[secao.valor]}</View>
              </Tabs.Content>
            ))}
          </Tabs>
        ) : (
          secoes.map((secao) => (
            <View key={secao.valor}>{conteudoPorValor[secao.valor]}</View>
          ))
        )}
      </ScrollView>

      {/* Fixed footer, outside the ScrollView — same pattern as
          link-account.tsx's "Desvincular conta": a `danger-soft` close
          action stays reachable at the bottom of the screen instead of
          scrolling away with the profile content. */}
      <View className="px-4 pt-3.5 bg-background" style={{ paddingBottom: insets.bottom + 16 }}>
        <Button variant="danger-soft" onPress={() => router.back()}>
          Fechar
        </Button>
      </View>
    </View>
  );
}
