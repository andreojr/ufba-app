import { useRouter } from "expo-router";
import { Button, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { LinearTransition, runOnJS } from "react-native-reanimated";

import { AppIcon } from "@/components/AppIcon";
import { SemestreDragGrid } from "@/components/SemestreDragGrid";
import { ArrastoSemestreProvider, useArrastoSemestre } from "@/lib/arrasto-semestre-context";
import { describeApiError } from "@/lib/api-errors";
import { getTrajetoria, putPlano } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { syncAll } from "@/lib/sync-all";
import { useSyncFreshness } from "@/lib/sync-freshness-context";
import {
  agruparPorSemestre,
  anosDaProjecao,
  densidadeCarga,
  formatarNota,
  historicoDesatualizado,
  statusComponente,
  faixaComponente,
  type AnoTrajetoria,
} from "@/lib/trajetoria";
import type {
  ComponenteCursado,
  ComponenteProjetado,
  Historico,
  MarcosSemestralizacao,
  ProjecaoTrajetoria,
  TrajetoriaResponse,
} from "@/lib/types";
import { gradeColor } from "@/lib/mock-data";

type LoadState =
  | { status: "loading" }
  | { status: "unsynced" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      historico: Historico;
      fetchedAt: Date;
      marcos: MarcosSemestralizacao | null;
      projecao: ProjecaoTrajetoria | null;
    };

/**
 * "Em curso" would be a lie once the term's end date has passed: the MATR rows
 * mean only that our copy of the transcript predates the grades. Naming the
 * wait is what the badge can honestly say, and it agrees with the nudge the
 * same condition puts above.
 */
function rotuloPeriodo(emCurso: boolean, desatualizado: boolean): string {
  if (!emCurso) {
    return "Concluído";
  }
  return desatualizado ? "Aguardando notas" : "Em curso";
}

export default function TrajetoriaTab(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const mutedColor = useThemeColor("muted");
  // Shared with Início's freshness badge and Perfil's sync item — see
  // sync-freshness-context's docstring.
  const { setHistoricoFetchedAt } = useSyncFreshness();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [fimDoPeriodo, setFimDoPeriodo] = useState<string | null>(null);
  // Kept separate from `state` on purpose: a failed move must not blow away
  // the loaded trajectory — the student would lose open years and scroll
  // position over a single failed PUT. This renders as an inline warning
  // instead, and clears itself on the next move that succeeds.
  const [erroAoMover, setErroAoMover] = useState<string | null>(null);

  // No request of its own: the home screen writes this cache after every
  // schedule fetch, and reading it is what lets this screen tell whether the
  // term the transcript is still showing as "em curso" has already ended.
  useEffect(() => {
    void getPeriodoCache().then((periodo) => setFimDoPeriodo(periodo?.fim ?? null));
  }, []);

  const aplicar = useCallback(
    (resposta: TrajetoriaResponse) => {
      if (!("historico" in resposta)) {
        setState({ status: "unsynced" });
        return;
      }
      const fetchedAt = new Date(resposta.fetchedAt);
      setState({
        status: "ready",
        historico: resposta.historico,
        fetchedAt,
        marcos: resposta.marcos,
        projecao: resposta.projecao,
      });
      setHistoricoFetchedAt(fetchedAt);
    },
    [setHistoricoFetchedAt],
  );

  // Reading the stored trajectory needs no SIGAA credential — sync itself
  // now only happens from Perfil, which re-scrapes both the horário and the
  // histórico in one press instead of each tab doing its own.
  const carregar = useCallback(
    async () => {
      if (!accessToken) {
        return;
      }
      setState({ status: "loading" });
      try {
        aplicar(await getTrajetoria(accessToken));
      } catch (error) {
        console.warn("Failed to load trajetória", error);
        setState({ status: "error", message: describeApiError(error) });
      }
    },
    [accessToken, aplicar],
  );

  // Depends on the link status only to re-read after the student links or
  // unlinks — never to decide *whether* to read. The stored histórico lives in
  // our own database and needs no SIGAA password to come back out.
  useEffect(() => {
    if (accessToken) {
      // Assíncrono: o setState de `carregar` acontece depois de um await, nunca no tick
      // deste efeito, então não há a cascata de renders que a regra previne.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      carregar();
    }
  }, [sigaaLink.status, accessToken, carregar]);

  // "Tentar de novo" costumava só reler o cache — se o servidor tivesse
  // caído, o aluno precisava repetir esse toque em Início, Trajetória,
  // Insights e Professores, um de cada vez. Agora sincroniza tudo de uma
  // vez (ver sync-all.ts) antes de recarregar esta tela.
  const retryTudo = useCallback(async () => {
    const credentials = accessToken ? await getSigaaCredentials() : null;
    if (accessToken && credentials) {
      await syncAll(accessToken, credentials);
    }
    await carregar();
  }, [accessToken, carregar]);

  /**
   * Moving is a pure override: save the position and apply whatever
   * reprojected trajectory the server sends back. Deliberately no local
   * optimism — the response can reorder other semestres over a pré-requisito,
   * and a screen that corrects itself half a second later is worse than one
   * that waits.
   *
   * A null `semestre` is the undo: it drops the PlanoItem and hands the
   * matéria back to automatic allocation. Same call, same reload — the only
   * way out of a position that stopped making sense.
   */
  const moverComponente = useCallback(
    async (componente: ComponenteProjetado, semestre: string | null) => {
      if (!accessToken) {
        return;
      }
      try {
        aplicar(
          await putPlano(accessToken, [
            {
              codigo: componente.codigo,
              nome: componente.nome,
              cargaHoraria: componente.cargaHoraria,
              semestre,
            },
          ]),
        );
        setErroAoMover(null);
      } catch (error) {
        console.warn("Failed to save plano", error);
        setErroAoMover(describeApiError(error));
      }
    },
    [accessToken, aplicar],
  );

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        testID="trajetoria-scroll"
        className="flex-1 px-6"
        contentContainerClassName="gap-5 pb-8"
        showsVerticalScrollIndicator={false}
      >
        {state.status === "loading" ? (
          <View className="rounded-3xl bg-surface-secondary p-8 items-center">
            <Typography.Paragraph type="body-sm" color="muted">
              Carregando sua trajetória…
            </Typography.Paragraph>
          </View>
        ) : null}

        {state.status === "error" ? (
          <View className="rounded-3xl bg-surface-secondary p-6 items-center gap-3">
            <AppIcon name="IconWarningCircle" size={28} color={mutedColor} />
            <Typography.Paragraph type="body-sm" color="muted" align="center">
              {state.message}
            </Typography.Paragraph>
            {/* Sincroniza horário, histórico e professores de uma vez (ver
                retryTudo) quando há credenciais salvas; sem vínculo, cai de
                volta para o mesmo re-read que sempre existiu aqui. */}
            <Button variant="outline" size="sm" onPress={() => void retryTudo()}>
              Tentar de novo
            </Button>
          </View>
        ) : null}

        {state.status === "unsynced" ? (
          <View className="rounded-3xl bg-surface-secondary p-5 gap-3">
            <Typography.Heading type="h6">Sua trajetória ainda não foi montada</Typography.Heading>
            <Typography.Paragraph type="body-sm" color="muted">
              {sigaaLink.status === "linked"
                ? "Sincronize sua conta em Perfil para buscar seu histórico escolar no SIGAA e montar sua trajetória."
                : "Vincule sua conta em Perfil para buscar seu histórico escolar no SIGAA e montar sua trajetória."}
            </Typography.Paragraph>
            {/* Sync now happens in one place — Perfil syncs the whole profile
                (horário + histórico) in a single press, including the
                privacy disclosure that used to sit right above this button. */}
            <Button onPress={() => router.push("/ajustes")}>Ir para Perfil</Button>
          </View>
        ) : null}

        {state.status === "ready" ? (
          <ReadyTrajetoria
            historico={state.historico}
            fimDoPeriodo={fimDoPeriodo}
            marcos={state.marcos}
            projecao={state.projecao}
            erroAoMover={erroAoMover}
            mutedColor={mutedColor}
            onAbrirVizinhos={(codigo, nome) =>
              router.push({ pathname: "/arvore-dependencias", params: { codigo, nome } })
            }
            onMover={moverComponente}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ReadyTrajetoria({
  historico,
  fimDoPeriodo,
  marcos,
  projecao,
  erroAoMover,
  mutedColor,
  onAbrirVizinhos,
  onMover,
}: {
  historico: Historico;
  fimDoPeriodo: string | null;
  marcos: MarcosSemestralizacao | null;
  projecao: ProjecaoTrajetoria | null;
  erroAoMover: string | null;
  mutedColor: string;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
  onMover: (componente: ComponenteProjetado, semestre: string | null) => void;
}): JSX.Element {
  const periodos = agruparPorSemestre(historico.cursados);
  const anos = anosDaProjecao(periodos, projecao);
  const desatualizado = historicoDesatualizado(historico.cursados, fimDoPeriodo, new Date());

  return (
    <ArrastoSemestreProvider onSoltar={onMover}>
      {/* The plain "sincronizado em" line is gone — that freshness now lives
          on Início's badge, fed by every screen that reads the histórico
          (see sync-freshness-context). Only the actionable nudge survives
          here, since it's not about freshness but about a specific
          missing-notas gap. */}
      {desatualizado ? (
        <Typography.Paragraph type="body-xs" color="muted">
          O semestre acabou e seu histórico ainda tem matérias em curso — sincronize em Perfil para ver as
          notas.
        </Typography.Paragraph>
      ) : null}

      {/* Two beats instead of one sentence: the forecast, and — only when
          there is one — the debt. The old line packed the atraso count, the
          semestre and the delta into a single muted paragraph, and the number
          the student actually came for got buried in the middle of it.
          `items-start` keeps the badge hugging its text instead of stretching
          the row. */}
      {projecao ? (
        <View className="gap-2 items-start">
          <Typography.Paragraph type="body-sm" color="muted">
            {`Neste ritmo, você conclui em ${projecao.conclusaoProjetada}.`}
          </Typography.Paragraph>
          {projecao.atrasadas > 0 ? (
            <View testID="badge-atrasadas" className="rounded-full bg-danger-soft px-2 py-1">
              <Typography.Paragraph type="body-xs" className="text-danger">
                {`${projecao.atrasadas} ${projecao.atrasadas === 1 ? "atrasada" : "atrasadas"}`}
              </Typography.Paragraph>
            </View>
          ) : null}
          {projecao.alemDoPrazoMaximo ? (
            <Typography.Paragraph type="body-sm" color="muted">
              Nesse ritmo, a conclusão passa do prazo máximo do seu histórico.
            </Typography.Paragraph>
          ) : null}
        </View>
      ) : null}

      {/* Inline, not a page-swallowing error card: a failed move must not cost
          the student their loaded trajectory — open years, scroll position,
          all of it. It clears itself the moment a move succeeds. */}
      {erroAoMover ? (
        <View className="rounded-2xl bg-danger-soft p-3 flex-row items-center gap-2.5">
          <AppIcon name="IconWarningCircle" size={18} color={mutedColor} />
          <Typography.Paragraph type="body-sm" className="text-danger flex-1">
            {erroAoMover}
          </Typography.Paragraph>
        </View>
      ) : null}

      <LinhaDoTempo
        anos={anos}
        desatualizado={desatualizado}
        marcos={marcos}
        conclusaoProjetada={projecao?.conclusaoProjetada ?? null}
        onAbrirVizinhos={onAbrirVizinhos}
      />
      <SemestreDragGrid semestresProjetados={projecao?.semestres.map((semestre) => semestre.semestre) ?? []} />
    </ArrastoSemestreProvider>
  );
}

/**
 * The trajectory grid itself: one row per year, its periods side by side,
 * connected top to bottom by the accent dots and line down the left edge —
 * chronological order top to bottom, ending in the linha de chegada card.
 *
 * Each year collapses. A transcript four years in is a very long scroll, and
 * the years the student is done with are the ones they least need open — so
 * only the year holding the período em curso starts expanded and the rest sit
 * folded behind their headers. Whether a year is open is session state and
 * nothing else: leaving the tab restores the default.
 */
function LinhaDoTempo({
  anos,
  desatualizado,
  marcos,
  conclusaoProjetada,
  onAbrirVizinhos,
}: {
  anos: AnoTrajetoria[];
  desatualizado: boolean;
  marcos: MarcosSemestralizacao | null;
  conclusaoProjetada: string | null;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
}): JSX.Element {
  const accentColor = useThemeColor("accent");
  const mutedColor = useThemeColor("muted");
  // Only the year in progress — or, failing that, the last year that actually
  // has cursado periods, so a future-only ano projetado never opens by
  // default for a student with nothing em curso. `anos` comes back oldest
  // first, so the search for "the last one with periodos" walks it reversed.
  const [anosAbertos, setAnosAbertos] = useState<Set<string>>(() => {
    const atual =
      anos.find((anoBloco) => anoBloco.periodos.some((periodo) => periodo.emCurso)) ??
      [...anos].reverse().find((anoBloco) => anoBloco.periodos.length > 0);
    return new Set(atual ? [atual.ano] : []);
  });

  function alternarAno(ano: string): void {
    setAnosAbertos((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(ano)) {
        proximo.add(ano);
      }
      return proximo;
    });
  }

  return (
    <View>
      {anos.map((anoBloco) => {
        // A year only reads as done once every period on it is — one
        // "Em curso"/"Aguardando notas" left is still a year in progress.
        // `.every()` on an empty array is vacuously true, so a year that only
        // holds projetados (no periodos at all) needs its own guard — a
        // future-only year is never "concluído".
        const anoConcluido =
          anoBloco.periodos.length > 0 && anoBloco.periodos.every((periodo) => !periodo.emCurso);
        const aberto = anosAbertos.has(anoBloco.ano);
        const materias =
          anoBloco.periodos.reduce((total, periodo) => total + periodo.componentes.length, 0) +
          anoBloco.projetados.reduce((total, semestre) => total + semestre.componentes.length, 0);
        return (
        <View key={anoBloco.ano} className="flex-row gap-3">
          <View className="w-3 items-center">
            <View
              className={`w-2.5 h-2.5 rounded-full mt-1 ${anoConcluido ? "bg-success" : "bg-accent"}`}
            />
            <View className="flex-1 w-px bg-white/15" />
          </View>
          <Animated.View layout={LinearTransition} className="flex-1 gap-2.5 pb-5">
            {/* Muted on purpose — it's here only to keep the grouping legible
                (which periods belong to which ano), not to compete with the
                período numbers below, which are the real headline of this
                grid. The whole row is the toggle, not just the caret: at this
                type size the caret alone would be a cruel tap target. */}
            <Pressable
              testID={`ano-${anoBloco.ano}`}
              accessibilityRole="button"
              accessibilityState={{ expanded: aberto }}
              accessibilityLabel={`${anoBloco.ano}, ${materias} ${
                materias === 1 ? "matéria" : "matérias"
              }`}
              onPress={() => alternarAno(anoBloco.ano)}
              className="flex-row items-center gap-2.5"
            >
              <Typography.Paragraph type="body-sm" color="muted" className="font-mono opacity-50">
                {anoBloco.ano}
              </Typography.Paragraph>
              {/* Only while folded: open, the períodos right below already say
                  it, and the pill would just be noise. Same count pill the
                  planner's zone headers use. */}
              {!aberto ? (
                <View className="rounded-full bg-white/5 px-2 py-1">
                  <Typography.Paragraph type="body-xs" color="muted">
                    {`${materias} ${materias === 1 ? "matéria" : "matérias"}`}
                  </Typography.Paragraph>
                </View>
              ) : null}
              <View className="flex-1" />
              <AppIcon
                name={aberto ? "IconCaretDown" : "IconCaretRight"}
                size={16}
                color={mutedColor}
              />
            </Pressable>
            {aberto ? (
            <View className="gap-3">
              {anoBloco.periodos.map((periodo) => (
                <View key={periodo.semestre} className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <Typography.Paragraph type="body-sm" weight="medium" className="font-mono">
                      {periodo.semestre}
                    </Typography.Paragraph>
                    <View
                      className={`rounded-full px-2 py-0.5 ${
                        periodo.emCurso ? "bg-accent-soft" : "bg-success-soft"
                      }`}
                    >
                      <Typography.Paragraph
                        type="body-xs"
                        className={periodo.emCurso ? "text-accent" : "text-success"}
                      >
                        {rotuloPeriodo(periodo.emCurso, desatualizado)}
                      </Typography.Paragraph>
                    </View>
                  </View>
                  {/* One box per período, matérias flowing left to right and
                      wrapping — not a single column anymore. Each card sets
                      its own min width below and lets flex-wrap decide how
                      many fit per row. */}
                  <View className="flex-row flex-wrap gap-2">
                    {periodo.componentes.map((componente) => (
                      <MateriaCard
                        key={`${componente.semestre}-${componente.codigo}`}
                        componente={componente}
                        marcos={marcos}
                        mutedColor={mutedColor}
                        onAbrirVizinhos={onAbrirVizinhos}
                      />
                    ))}
                  </View>
                </View>
              ))}
              {anoBloco.projetados.map((semestre) => (
                <View key={semestre.semestre} className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <Typography.Paragraph type="body-sm" weight="medium" className="font-mono">
                      {semestre.semestre}
                    </Typography.Paragraph>
                    <View className="rounded-full px-2 py-0.5 bg-white/5">
                      <Typography.Paragraph type="body-xs" color="muted">
                        projetado
                      </Typography.Paragraph>
                    </View>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {semestre.componentes.map((componente) => (
                      <CardProjetado
                        key={`${semestre.semestre}-${componente.codigo}`}
                        componente={componente}
                        semestreAtual={semestre.semestre}
                        onAbrirVizinhos={onAbrirVizinhos}
                      />
                    ))}
                    {semestre.horasOptativas > 0 ? (
                      <BlocoHoras horas={semestre.horasOptativas} rotulo="optativas" />
                    ) : null}
                    {semestre.horasComplementares > 0 ? (
                      <BlocoHoras
                        horas={semestre.horasComplementares}
                        rotulo="atividades complementares"
                      />
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
            ) : null}
          </Animated.View>
        </View>
        );
      })}

      <View className="flex-row gap-3">
        <View className="w-3 items-center">
          <View className="w-2.5 h-2.5 rounded-full bg-accent mt-1" />
        </View>
        <View className="flex-1 rounded-2xl bg-surface-secondary p-3.5 flex-row items-center gap-2.5">
          <AppIcon name="IconFlag" size={20} color={accentColor} />
          <Typography.Paragraph weight="medium">Linha de chegada</Typography.Paragraph>
          <View className="flex-1" />
          {/* The whole point of the projeção: this card used to be a plain
              decoration at the end of the list. Now it names the semestre the
              student finishes in — the one answer they came for, readable
              without a single atrasada on the screen. */}
          {conclusaoProjetada ? (
            <Typography.Paragraph
              testID="conclusao-projetada"
              weight="medium"
              className="font-mono text-accent"
            >
              {conclusaoProjetada}
            </Typography.Paragraph>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * A componente the projector placed in a future semestre: no nota to show yet
 * and no density meter — the card is a placeholder for work not yet done, not
 * a record of work already measured. An atrasada carries the same status card
 * `MateriaCard` hangs off a deviating componente, in the danger tone a
 * reprovada uses rather than the warning tone of a trancada: a matéria whose
 * período has already passed is a hole in the trajectory, not a pause the
 * student chose. The badge does not name the período it came from — the
 * student is looking at where the matéria goes now, and which período the
 * grade originally wanted it in changes nothing about that. A tap opens the
 * same árvore de dependências a cursado card would; a long-press-and-drag
 * opens the semestre grid (SemestreDragGrid) via ArrastoSemestreProvider —
 * ver docs/superpowers/specs/2026-08-26-trajetoria-drag-semestre-design.md.
 */
function CardProjetado({
  componente,
  semestreAtual,
  onAbrirVizinhos,
}: {
  componente: ComponenteProjetado;
  semestreAtual: string;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
}): JSX.Element {
  const { arrasto, iniciar, finalizar, fingerX, fingerY } = useArrastoSemestre();
  // Escondido, não desmontado: o card continua existindo (e continua sendo o
  // dono do gesto em andamento) enquanto o fantasma no grid mostra pra onde
  // ele está indo.
  const escondido = arrasto?.componente.codigo === componente.codigo;

  // withTestId is a no-op outside tests — it's what lets the integration
  // suite drive this tap through react-native-gesture-handler's jest-utils
  // instead of fireEvent.press, which the gesture never receives a
  // synthetic onPress prop to answer.
  const tap = Gesture.Tap()
    .withTestId(`tap-${componente.codigo}`)
    .onEnd(() => {
      runOnJS(onAbrirVizinhos)(componente.codigo, componente.nome);
    });
  const arrastar = Gesture.Pan()
    .withTestId(`arrasto-${componente.codigo}`)
    .activateAfterLongPress(350)
    .onStart((event) => {
      fingerX.set(event.absoluteX);
      fingerY.set(event.absoluteY);
      runOnJS(iniciar)({ componente, semestreAtual });
    })
    .onUpdate((event) => {
      fingerX.set(event.absoluteX);
      fingerY.set(event.absoluteY);
    })
    .onEnd((event) => {
      runOnJS(finalizar)(event.absoluteX, event.absoluteY);
    });
  // Race, não Simultaneous: um toque rápido não deve também começar (e
  // depois cancelar) um arrasto, e um arrasto que já começou não deve também
  // navegar quando o dedo finalmente solta.
  const gesto = Gesture.Race(tap, arrastar);

  return (
    <GestureDetector gesture={gesto}>
      <View
        testID={`card-projetado-${componente.codigo}`}
        accessible
        accessibilityRole="button"
        accessibilityLabel={componente.nome}
        className={`gap-0.5 ${escondido ? "opacity-0" : ""}`}
        style={{ minWidth: 140, flexGrow: 1, flexBasis: 140 }}
      >
        {componente.atrasada ? (
          <View
            testID={`atrasada-${componente.codigo}`}
            className="rounded-t-2xl rounded-b-md px-3 py-1.5 bg-danger-soft"
          >
            <Typography.Paragraph type="body-xs" className="text-danger">
              atrasada
            </Typography.Paragraph>
          </View>
        ) : null}
        {/* Só aparece em posição manual: o aluno arrastou a matéria pra um
            semestre em que o pré-requisito checou negativo — não é
            incerteza, é o resultado da checagem. Não bloqueia o arrasto —
            é aviso, não trava, porque o override já venceu (o aluno
            decidiu) e há casos legítimos (cursar em paralelo, equivalência
            ainda não registrada) em que a matéria cabe ali mesmo assim. */}
        {componente.preRequisitoNaoVerificado ? (
          <View
            testID={`prerequisito-nao-cursado-${componente.codigo}`}
            className={`px-3 py-1.5 bg-warning-soft ${
              componente.atrasada ? "" : "rounded-t-2xl rounded-b-md"
            }`}
          >
            <Typography.Paragraph type="body-xs" className="text-warning">
              pré-requisito não cursado
            </Typography.Paragraph>
          </View>
        ) : null}
        <View
          className={`flex-1 p-3 justify-between gap-1.5 bg-surface-secondary/40 border border-dashed border-white/20 ${
            componente.atrasada || componente.preRequisitoNaoVerificado
              ? "rounded-t-md rounded-b-2xl"
              : "rounded-2xl"
          }`}
        >
          <View className="gap-0.5">
            <View className="flex-row items-baseline gap-1.5">
              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                {componente.codigo}
              </Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                · {componente.cargaHoraria} h
              </Typography.Paragraph>
            </View>
            <Typography.Paragraph weight="medium">{componente.nome}</Typography.Paragraph>
          </View>
        </View>
      </View>
    </GestureDetector>
  );
}

/**
 * The horas genéricas a projected semestre carries — optativas or atividades
 * complementares — that never resolve to a named componente, so they get no
 * card at all: a dashed block deliberately unlike a matéria, since it isn't
 * one.
 */
function BlocoHoras({ horas, rotulo }: { horas: number; rotulo: string }): JSX.Element {
  return (
    <View
      className="rounded-2xl border border-dashed border-white/20 p-3 gap-0.5"
      style={{ minWidth: 140, flexGrow: 1, flexBasis: 140 }}
    >
      <Typography.Paragraph type="body-sm" color="muted">
        {`${horas} h de ${rotulo}`}
      </Typography.Paragraph>
    </View>
  );
}

/**
 * A matéria in the grid: código + carga horária (in gray, unrelated to density
 * — just the raw number) up top, nome below, a density meter for that carga
 * horária at the bottom-left and the nota in the bottom-right corner. The nota
 * is always shown now — this no longer alternates between grade and carga
 * horária views, that split lives in Insights instead.
 *
 * A deviating matéria gets a second, colored card sitting on top of it
 * carrying its status (see faixaComponente). The two are joined the way the
 * Insights charts join their breakdown: a hairline `gap-0.5` between them and
 * the facing corners squared off to `rounded-md`, so they read as one object
 * split in two rather than as two cards that happen to be adjacent. That is
 * also what gives the status room to spell itself out — the badge pills this
 * replaces had to share a ~140px line with the nota and could not.
 */
function MateriaCard({
  componente,
  marcos,
  mutedColor,
  onAbrirVizinhos,
}: {
  componente: ComponenteCursado;
  marcos: MarcosSemestralizacao | null;
  mutedColor: string;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
}): JSX.Element {
  const nota = formatarNota(componente.nota);
  const status = statusComponente(componente.codigo, marcos);
  const faixa = faixaComponente(componente.situacao, status);
  const densidade = densidadeCarga(componente.cargaHoraria);
  // Trancada, cancelada, etc.: no grade at all — the dashed border and faded
  // fill are what say "it's here, but it doesn't count" without needing
  // another line of text.
  const naoConta = componente.nota === null;

  return (
    // Narrow enough to sit two (or more) per row in the período box's
    // flex-wrap above — `flexBasis`/`minWidth` together are what let it grow
    // past that floor when there's room, but never shrink below it.
    <View className="gap-0.5" style={{ minWidth: 140, flexGrow: 1, flexBasis: 140 }}>
      {faixa ? (
        <View
          testID={`faixa-${componente.codigo}`}
          className={`rounded-t-2xl rounded-b-md px-3 py-1.5 ${faixa.corFundo}`}
        >
          <Typography.Paragraph type="body-xs" className={faixa.corTexto}>
            {faixa.rotulo}
          </Typography.Paragraph>
        </View>
      ) : null}
      <Pressable
        testID={`materia-card-${componente.codigo}`}
        onPress={() => onAbrirVizinhos(componente.codigo, componente.nome)}
        className={`flex-1 p-3 justify-between gap-1.5 ${
          // Squaring off the top corners is the whole trick: the status card
          // squares its bottom ones to match, and the pair reads as continuous.
          faixa ? "rounded-t-md rounded-b-2xl" : "rounded-2xl"
        } ${
          naoConta
            ? "bg-surface-secondary/40 border border-dashed border-white/20 opacity-60"
            : "bg-surface-secondary"
        }`}
      >
        {/* Its own group, separate from the densidade/nota row below: the row's
            parent stretches every card in a flex-wrap line to match the
            tallest one, and `justify-between` on that parent is what pins this
            row to the bottom of that stretched height instead of leaving it
            floating right under a short nome with dead space beneath it. */}
        <View className="gap-0.5">
          <View className="flex-row items-baseline gap-1.5">
            <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
              {componente.codigo}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
              · {componente.cargaHoraria} h
            </Typography.Paragraph>
          </View>
          <Typography.Paragraph weight="medium">{componente.nome}</Typography.Paragraph>
        </View>
        <View className="flex-row items-end justify-between gap-1.5">
          {/* A classification, not a completion percentage. This used to be an
              8x4 colored pill, which failed twice over: too small to read, and
              painted from the same verde/âmbar/vermelho ramp that gradeColor
              spends on the nota sitting in the opposite corner of this very
              card. The glyph carries the tier now (uma folha → uma estante)
              and the color ramp is free to mean only nota. Muted and
              bottom-left: still a quiet cue, not another headline number. See
              densidadeCarga for the cut points, and LegendaDensidade for the
              line that teaches the scale. */}
          <View testID={`densidade-${componente.codigo}`} accessibilityLabel={densidade.rotulo}>
            <AppIcon name={densidade.icone} size={14} color={mutedColor} />
          </View>
          {/* Bottom-right, always: the nota. A trancada/cancelada has no nota
                at all, and "—" in that slot reads as a real value gone missing
                rather than a value that was never going to exist — better to
                leave the corner blank. */}
          {componente.nota !== null ? (
            <Typography.Heading type="h6" className="font-mono" style={{ color: gradeColor(nota) }}>
              {nota}
            </Typography.Heading>
          ) : null}
        </View>
      </Pressable>
      {/* A nota 10 gets its own sticker — a blue circle poking out past the
          top-right corner. It hangs off this wrapper rather than off the
          matéria card, because with a status card stacked above, the matéria
          card's own top corner is no longer the top of the object; anchoring
          there would drop the sticker into the middle of the seam. Absolute +
          a negative offset is what lets it bleed outside the bounds instead of
          being clipped; nothing here sets `overflow-hidden`, so it's free to.
          Last child so it paints over whichever card it lands on. */}
      {componente.nota === 10 ? (
        <View
          className="absolute items-center justify-center rounded-full bg-blue-500 border-2 border-background"
          style={{ top: -6, right: -6, width: 24, height: 24 }}
        >
          <AppIcon name="IconStar" size={13} color="white" />
        </View>
      ) : null}
    </View>
  );
}
