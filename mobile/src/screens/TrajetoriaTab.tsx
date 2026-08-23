import { useRouter } from "expo-router";
import { Button, Menu, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";

import { AppIcon } from "@/components/AppIcon";
import { describeApiError } from "@/lib/api-errors";
import { getTrajetoria } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { useSyncFreshness } from "@/lib/sync-freshness-context";
import {
  agruparPorAno,
  agruparPorSemestre,
  densidadeCarga,
  formatarNota,
  historicoDesatualizado,
  poolPlanejavel,
  statusComponente,
  faixaComponente,
  zonasDePlanejamento,
  type AnoTrajetoria,
} from "@/lib/trajetoria";
import type {
  ComponenteCursado,
  Historico,
  ItemPlano,
  MarcosSemestralizacao,
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
      plano: ItemPlano[];
      marcos: MarcosSemestralizacao | null;
    };

/** The planner's catch-all: everything not assigned to a term sits here. */
const ZONA_SEM_PERIODO = "pool";

/** How many upcoming terms the planner offers as drop zones. */
const ZONAS_FUTURAS = 2;

/**
 * Which term each pending component was put in, keyed by código. Keyed rather
 * than a list per zone so a move is a single overwrite: a component has one
 * term by construction and cannot end up listed under two.
 */
type Plano = Record<string, string>;

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

/** The saved plan, in the shape the zones read. Unplaced items stay out of it. */
function planoSalvo(plano: ItemPlano[]): Plano {
  return Object.fromEntries(
    plano.flatMap((item) => (item.semestre ? [[item.codigo, item.semestre] as const] : [])),
  );
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
  // Moves the student made in this session, on top of the plan the server sent.
  // Persisting them is a later task, so leaving the screen drops them — but a
  // refresh must not, since nothing about the plan changed. Only a re-sync
  // clears them, and there the server's plan is the authority.
  const [movimentos, setMovimentos] = useState<Plano>({});
  const [fimDoPeriodo, setFimDoPeriodo] = useState<string | null>(null);

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
        plano: resposta.plano,
        marcos: resposta.marcos,
      });
      setHistoricoFetchedAt(fetchedAt);
      // A fresh transcript replaces the one the moves were made against, and
      // the plan the server sent back is the authority — same reset the old
      // in-screen re-sync used to do, now covering the only path left that can
      // bring in a fresh transcript: reloading after a sync done in Perfil.
      setMovimentos({});
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
      carregar();
    }
  }, [sigaaLink.status, accessToken, carregar]);

  function moverComponente(codigo: string, zona: string): void {
    setMovimentos((atual) => ({ ...atual, [codigo]: zona }));
  }

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
            {/* A plain re-read of our own database — offered linked or not. */}
            <Button variant="outline" size="sm" onPress={() => carregar()}>
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
            plano={state.plano}
            marcos={state.marcos}
            movimentos={movimentos}
            onMover={moverComponente}
            mutedColor={mutedColor}
            onAbrirVizinhos={(codigo, nome) =>
              router.push({ pathname: "/arvore-dependencias", params: { codigo, nome } })
            }
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ReadyTrajetoria({
  historico,
  fimDoPeriodo,
  plano,
  marcos,
  movimentos,
  onMover,
  mutedColor,
  onAbrirVizinhos,
}: {
  historico: Historico;
  fimDoPeriodo: string | null;
  plano: ItemPlano[];
  marcos: MarcosSemestralizacao | null;
  movimentos: Plano;
  onMover: (codigo: string, zona: string) => void;
  mutedColor: string;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
}): JSX.Element {
  const periodos = agruparPorSemestre(historico.cursados);
  const anos = agruparPorAno(periodos);
  const pendentes = poolPlanejavel(historico.pendentesObrigatorios);
  const desatualizado = historicoDesatualizado(historico.cursados, fimDoPeriodo, new Date());

  // The term in progress, or — on a transcript with nothing enrolled — the last
  // one on it, so the planner still has somewhere to count forward from.
  const semestreAtual =
    periodos.find((periodo) => periodo.emCurso)?.semestre ??
    periodos[periodos.length - 1]?.semestre;
  const zonas = semestreAtual
    ? zonasDePlanejamento(semestreAtual, historico.prazoConclusaoMaximo, ZONAS_FUTURAS)
    : [];
  const salvo = planoSalvo(plano);

  return (
    <>
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

      <LinhaDoTempo
        anos={anos}
        desatualizado={desatualizado}
        marcos={marcos}
        onAbrirVizinhos={onAbrirVizinhos}
      />

      <View className="gap-5">
        {/* Everything around the planner now reads as the student's real
            transcript — the coefficient, the grades, the periods — so a
            dragged card reads as saved too. It is not: `movimentos` is
            session-only state, and nothing here writes it back. */}
        <Typography.Paragraph type="body-xs" color="muted">
          Ainda não salva: mudar uma matéria de período aqui vale só para esta
          visita à tela — ao sair, ela volta para onde estava.
        </Typography.Paragraph>
        {[...zonas, ZONA_SEM_PERIODO].map((zona) => {
          const semPeriodo = zona === ZONA_SEM_PERIODO;
          const componentes = pendentes.filter((pendente) => {
            const atual = movimentos[pendente.codigo] ?? salvo[pendente.codigo];
            // A term the planner no longer offers (past the deadline, or beyond
            // the two it shows) falls back to the pool rather than taking its
            // component off the screen entirely.
            return atual && zonas.includes(atual) ? atual === zona : semPeriodo;
          });
          const vazia = componentes.length === 0;
          return (
            <View key={zona} className="gap-2.5">
              <View className="flex-row items-center gap-2.5">
                <Typography.Paragraph weight="medium">
                  {semPeriodo ? "Sem período" : zona}
                </Typography.Paragraph>
                <View className="rounded-full bg-white/5 px-2 py-1">
                  <Typography.Paragraph type="body-xs" color="muted">
                    {semPeriodo
                      ? `a cursar · ${componentes.length}`
                      : vazia
                        ? "vazio"
                        : `${componentes.length} ${componentes.length === 1 ? "matéria" : "matérias"}`}
                  </Typography.Paragraph>
                </View>
                <View className="flex-1 h-px bg-white/10" />
              </View>
              <View
                className={`gap-2 rounded-[20px] p-2 min-h-16 ${
                  vazia ? "border border-dashed border-white/20" : ""
                }`}
              >
                {componentes.map((componente) => (
                  <Menu key={componente.codigo}>
                    <Menu.Trigger asChild>
                      <Pressable className="rounded-2xl bg-surface-secondary p-3 flex-row items-center gap-2.5">
                        <AppIcon name="IconCheck" size={18} color={mutedColor} />
                        <View className="flex-1 gap-0.5">
                          <Typography.Paragraph weight="medium">
                            {componente.nome}
                          </Typography.Paragraph>
                          <Typography.Paragraph type="body-xs" color="muted">
                            {componente.codigo} ·{" "}
                            <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                              {componente.cargaHoraria} h
                            </Typography.Paragraph>
                          </Typography.Paragraph>
                        </View>
                      </Pressable>
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Overlay />
                      <Menu.Content presentation="popover" width={220}>
                        <Menu.Label>Mover para</Menu.Label>
                        {[...zonas, ZONA_SEM_PERIODO]
                          .filter((destino) => destino !== zona)
                          .map((destino) => (
                            <Menu.Item
                              key={destino}
                              onPress={() => onMover(componente.codigo, destino)}
                            >
                              <Menu.ItemTitle>
                                {destino === ZONA_SEM_PERIODO ? "Sem período" : destino}
                              </Menu.ItemTitle>
                            </Menu.Item>
                          ))}
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu>
                ))}
                {vazia ? (
                  <View className="py-3.5 px-1.5 items-center">
                    <Typography.Paragraph type="body-sm" color="muted">
                      {semPeriodo
                        ? "Tudo planejado."
                        : "Nenhuma matéria planejada para este período."}
                    </Typography.Paragraph>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </>
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
 * folded behind their headers. Whether a year is open is session state, like
 * the planner's `movimentos`: leaving the tab restores the default.
 */
function LinhaDoTempo({
  anos,
  desatualizado,
  marcos,
  onAbrirVizinhos,
}: {
  anos: AnoTrajetoria[];
  desatualizado: boolean;
  marcos: MarcosSemestralizacao | null;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
}): JSX.Element {
  const accentColor = useThemeColor("accent");
  const mutedColor = useThemeColor("muted");
  // Only the year in progress — or, on a transcript with nothing enrolled, the
  // last one on it, so the grid never opens with every year folded.
  const [anosAbertos, setAnosAbertos] = useState<Set<string>>(() => {
    const atual =
      anos.find((anoBloco) => anoBloco.periodos.some((periodo) => periodo.emCurso)) ??
      anos[anos.length - 1];
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
        const anoConcluido = anoBloco.periodos.every((periodo) => !periodo.emCurso);
        const aberto = anosAbertos.has(anoBloco.ano);
        const materias = anoBloco.periodos.reduce(
          (total, periodo) => total + periodo.componentes.length,
          0,
        );
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
        </View>
      </View>
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
              card. The glyph carries the tier now (uma folha → uma bandeja
              cheia) and the color ramp is free to mean only nota. Muted and
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
