import { useRouter } from "expo-router";
import { Button, Menu, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { DownloadProgressBar } from "@/components/DownloadProgressBar";
import { describeApiError } from "@/lib/api-errors";
import { ApiError, getTrajetoria, postTrajetoriaSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { HISTORICO_STAGES } from "@/lib/download-progress";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import {
  agruparPorAno,
  agruparPorSemestre,
  densidadeCarga,
  formatarNota,
  historicoDesatualizado,
  poolPlanejavel,
  rotuloSituacao,
  statusComponente,
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

/**
 * Sync failures need one message the shared helper cannot give. A transcript
 * the parser refuses — for breaking the document's own invariants — comes back
 * as a bare 500, indistinguishable from a server hiccup but deterministic:
 * "Tente novamente" would send the student round a loop that fails identically
 * every time. So anything other than the two statuses the shared helper names
 * gets copy that promises no retry and points at the one thing that still
 * works, the PDF download reachable from Perfil.
 *
 * Bad credentials, rate limits and a dead connection keep the shared wording —
 * those really are retryable, and they are the same failures everywhere else.
 */
function descreverErroSync(error: unknown): string {
  // A status at all means a response came back, which is the only case where
  // the document itself can be what failed.
  const status = error instanceof ApiError ? error.status : undefined;
  if (status !== undefined && status !== 401 && status !== 429) {
    return "Pode ser um problema no documento. Você ainda pode baixar o PDF em Perfil.";
  }
  return describeApiError(error);
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

  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Moves the student made in this session, on top of the plan the server sent.
  // Persisting them is a later task, so leaving the screen drops them — but a
  // refresh must not, since nothing about the plan changed. Only a re-sync
  // clears them, and there the server's plan is the authority.
  const [movimentos, setMovimentos] = useState<Plano>({});
  const [sincronizando, setSincronizando] = useState(false);
  const [erroSync, setErroSync] = useState<string | null>(null);
  const [fimDoPeriodo, setFimDoPeriodo] = useState<string | null>(null);

  // No request of its own: the home screen writes this cache after every
  // schedule fetch, and reading it is what lets this screen tell whether the
  // term the transcript is still showing as "em curso" has already ended.
  useEffect(() => {
    void getPeriodoCache().then((periodo) => setFimDoPeriodo(periodo?.fim ?? null));
  }, []);

  const aplicar = useCallback((resposta: TrajetoriaResponse) => {
    if (!("historico" in resposta)) {
      setState({ status: "unsynced" });
      return;
    }
    setState({
      status: "ready",
      historico: resposta.historico,
      fetchedAt: new Date(resposta.fetchedAt),
      plano: resposta.plano,
      marcos: resposta.marcos,
    });
    // Fresh data on screen must not keep a stale failure under it contradicting
    // what the student is now reading.
    setErroSync(null);
  }, []);

  // Reading the stored trajectory needs no SIGAA credential — the JWT already
  // scopes it to this student. Only the re-scrape below does.
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

  useEffect(() => {
    if (sigaaLink.status === "linked" && accessToken) {
      carregar();
    } else if (sigaaLink.status === "unlinked") {
      setState({ status: "error", message: "Vincule sua conta do SIGAA para ver sua trajetória." });
    }
  }, [sigaaLink.status, accessToken, carregar]);

  const sincronizar = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    const credentials = await getSigaaCredentials();
    if (!credentials) {
      // Reads as one sentence after the prefix the error line already carries.
      setErroSync("Vincule sua conta do SIGAA primeiro.");
      return;
    }

    setSincronizando(true);
    setErroSync(null);
    try {
      aplicar(
        await postTrajetoriaSync(accessToken, {
          login: credentials.login,
          senha: credentials.senha,
        }),
      );
      // Only here: a re-sync replaces the transcript the moves were made
      // against, and the plan the server sent back is the authority. A plain
      // refresh must leave them be — see onRefresh.
      setMovimentos({});
    } catch (error) {
      console.warn("Failed to sync trajetória", error);
      // The state deliberately survives the failure: a student looking at last
      // term's grades should keep seeing them when a re-sync fails.
      setErroSync(descreverErroSync(error));
    } finally {
      setSincronizando(false);
    }
  }, [accessToken, aplicar]);

  function moverComponente(codigo: string, zona: string): void {
    setMovimentos((atual) => ({ ...atual, [codigo]: zona }));
  }

  const erro = erroSync ? (
    <Typography.Paragraph type="body-xs" className="text-danger">
      Não deu para sincronizar seu histórico. {erroSync}
    </Typography.Paragraph>
  ) : null;

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
            {sigaaLink.status === "linked" ? (
              <Button variant="outline" size="sm" onPress={() => carregar()}>
                Tentar de novo
              </Button>
            ) : null}
          </View>
        ) : null}

        {state.status === "unsynced" ? (
          <View className="rounded-3xl bg-surface-secondary p-5 gap-3">
            <Typography.Heading type="h6">Sua trajetória ainda não foi montada</Typography.Heading>
            <Typography.Paragraph type="body-sm" color="muted">
              Vamos buscar seu histórico escolar no SIGAA e montar sua trajetória. Leva alguns
              segundos.
            </Typography.Paragraph>

            {/* Above the button, never below it: pressing sync is the moment the
                student hands us a document carrying their CPF, RG and date of
                birth, so both halves — what we keep and what we throw away —
                have to be readable before the press. */}
            <View className="rounded-2xl bg-white/[0.04] p-3.5 gap-1.5">
              <Typography.Paragraph type="body-xs" color="muted">
                <Typography.Paragraph type="body-xs" weight="medium">
                  O que fica guardado:{" "}
                </Typography.Paragraph>
                suas matérias, notas e carga horária — é o que monta esta tela.
              </Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted">
                <Typography.Paragraph type="body-xs" weight="medium">
                  O que não fica:{" "}
                </Typography.Paragraph>
                CPF, RG e data de nascimento. Eles estão no documento, mas são descartados na
                leitura.
              </Typography.Paragraph>
            </View>

            <Button onPress={sincronizar} isDisabled={sincronizando}>
              {sincronizando ? "Sincronizando…" : "Sincronizar histórico"}
            </Button>

            {/* The wait is ~40s of server-side scraping. A disabled button with a
                changed label is not enough feedback for that long, and the
                calibrated stage model for exactly this request already exists. */}
            {sincronizando ? <DownloadProgressBar stages={HISTORICO_STAGES} /> : null}
            {erro}
          </View>
        ) : null}

        {state.status === "ready" ? (
          <ReadyTrajetoria
            historico={state.historico}
            fetchedAt={state.fetchedAt}
            fimDoPeriodo={fimDoPeriodo}
            plano={state.plano}
            marcos={state.marcos}
            movimentos={movimentos}
            onMover={moverComponente}
            onSincronizar={sincronizar}
            sincronizando={sincronizando}
            erro={erro}
            mutedColor={mutedColor}
            onAbrirArvore={(codigo, nome) =>
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
  fetchedAt,
  fimDoPeriodo,
  plano,
  marcos,
  movimentos,
  onMover,
  onSincronizar,
  sincronizando,
  erro,
  mutedColor,
  onAbrirArvore,
}: {
  historico: Historico;
  fetchedAt: Date;
  fimDoPeriodo: string | null;
  plano: ItemPlano[];
  marcos: MarcosSemestralizacao | null;
  movimentos: Plano;
  onMover: (codigo: string, zona: string) => void;
  onSincronizar: () => void;
  sincronizando: boolean;
  erro: JSX.Element | null;
  mutedColor: string;
  onAbrirArvore: (codigo: string, nome: string) => void;
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
      <View className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Typography.Paragraph type="body-xs" color="muted" className="flex-1">
            {desatualizado ? (
              "O semestre acabou e seu histórico ainda tem matérias em curso — sincronize para ver as notas."
            ) : (
              <>
                Sincronizado em{" "}
                <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                  {fetchedAt.toLocaleDateString("pt-BR")}
                </Typography.Paragraph>
              </>
            )}
          </Typography.Paragraph>
          {sincronizando ? null : (
            <Pressable onPress={onSincronizar} className="h-9 px-1 justify-center">
              <Typography.Paragraph type="body-sm" weight="medium" className="text-accent">
                Sincronizar
              </Typography.Paragraph>
            </Pressable>
          )}
        </View>
        {sincronizando ? <DownloadProgressBar stages={HISTORICO_STAGES} /> : null}
        {erro}
      </View>

      <LinhaDoTempo
        anos={anos}
        desatualizado={desatualizado}
        marcos={marcos}
        onAbrirArvore={onAbrirArvore}
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
 */
function LinhaDoTempo({
  anos,
  desatualizado,
  marcos,
  onAbrirArvore,
}: {
  anos: AnoTrajetoria[];
  desatualizado: boolean;
  marcos: MarcosSemestralizacao | null;
  onAbrirArvore: (codigo: string, nome: string) => void;
}): JSX.Element {
  const accentColor = useThemeColor("accent");
  return (
    <View>
      {anos.map((anoBloco) => {
        // A year only reads as done once every period on it is — one
        // "Em curso"/"Aguardando notas" left is still a year in progress.
        const anoConcluido = anoBloco.periodos.every((periodo) => !periodo.emCurso);
        return (
        <View key={anoBloco.ano} className="flex-row gap-3">
          <View className="w-3 items-center">
            <View
              className={`w-2.5 h-2.5 rounded-full mt-1 ${anoConcluido ? "bg-success" : "bg-accent"}`}
            />
            <View className="flex-1 w-px bg-white/15" />
          </View>
          <View className="flex-1 gap-2.5 pb-5">
            {/* Muted on purpose — it's here only to keep the grouping legible
                (which periods belong to which ano), not to compete with the
                período numbers below, which are the real headline of this
                grid. */}
            <Typography.Paragraph type="body-sm" color="muted" className="font-mono opacity-50">
              {anoBloco.ano}
            </Typography.Paragraph>
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
                        onAbrirArvore={onAbrirArvore}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
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
 * A matéria card in the grid: código + carga horária (in gray, unrelated to
 * density — just the raw number) up top, nome below, and at the bottom a
 * density meter for that carga horária beside the situação/status badges,
 * ending with the nota in the bottom-right corner. The nota is always shown
 * now — this card no longer alternates between grade and carga horária views,
 * that split lives in Insights instead.
 */
function MateriaCard({
  componente,
  marcos,
  onAbrirArvore,
}: {
  componente: ComponenteCursado;
  marcos: MarcosSemestralizacao | null;
  onAbrirArvore: (codigo: string, nome: string) => void;
}): JSX.Element {
  const rotulo = rotuloSituacao(componente.situacao);
  const nota = formatarNota(componente.nota);
  const mutedColor = useThemeColor("muted");
  const status = statusComponente(componente.codigo, marcos);
  const densidade = densidadeCarga(componente.cargaHoraria);
  // Trancada, cancelada, etc.: no grade at all — the dashed border and faded
  // fill are what say "it's here, but it doesn't count" without needing
  // another line of text.
  const naoConta = componente.nota === null;

  return (
    // Narrow enough to sit two (or more) per row in the período box's
    // flex-wrap above — `flexBasis`/`minWidth` together are what let it grow
    // past that floor when there's room, but never shrink below it.
    <Pressable
      testID={`materia-card-${componente.codigo}`}
      onPress={() => onAbrirArvore(componente.codigo, componente.nome)}
      className={`rounded-2xl p-3 justify-between gap-1.5 ${
        naoConta
          ? "bg-surface-secondary/40 border border-dashed border-white/20 opacity-60"
          : "bg-surface-secondary"
      }`}
      style={{ minWidth: 140, flexGrow: 1, flexBasis: 140 }}
    >
      {/* A nota 10 gets its own sticker — a blue circle poking out past the
          card's own top-right corner. Absolute + a negative offset is what
          lets it bleed outside the card's bounds instead of being clipped to
          it; nothing here sets `overflow-hidden`, so it's free to. */}
      {componente.nota === 10 ? (
        <View
          className="absolute items-center justify-center rounded-full bg-blue-500 border-2 border-background"
          style={{ top: -6, right: -6, width: 24, height: 24 }}
        >
          <AppIcon name="IconStar" size={13} color="white" />
        </View>
      ) : null}
      {/* Its own group, separate from the badge/nota row below: the row's
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
      <View className="flex-row items-end justify-between">
        <View className="items-start gap-1">
          {rotulo ? (
            <View className="rounded-full bg-white/5 px-2 py-1 flex-row items-center gap-1">
              {componente.situacao === "TRANC" ? (
                <AppIcon name="IconLockKey" size={11} color={mutedColor} />
              ) : null}
              <Typography.Paragraph type="body-xs" color="muted">
                {rotulo}
              </Typography.Paragraph>
            </View>
          ) : null}
          {/* The active grade dropped this código: obsoleta with no known
              replacement, or equivalente to the componente the grade names
              instead — see statusComponente. */}
          {status ? (
            <View className="rounded-full bg-white/5 px-2 py-1">
              <Typography.Paragraph type="body-xs" color="muted">
                {status.tipo === "obsoleta" ? "Fora da grade atual" : `Equivale a ${status.equivalenteDe}`}
              </Typography.Paragraph>
            </View>
          ) : null}
          {/* A classification, not a completion percentage — the whole bar
              is solid in whichever tier's color the carga horária falls
              into, it never partially fills. Small and bottom-left,
              justify-between with the nota rather than a full-width bar —
              this is a quiet cue, not another headline number. See
              densidadeCarga for the cut points. */}
          <View
            testID={`densidade-${componente.codigo}`}
            className="h-1 w-2 rounded-full"
            style={{ backgroundColor: densidade.cor }}
          />
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
  );
}
