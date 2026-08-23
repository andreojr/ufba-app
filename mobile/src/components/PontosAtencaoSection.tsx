import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { Pressable, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { parseIsoDate } from "@/lib/periodo-letivo";
import { classificarUrgencia, diasAte } from "@/lib/pontos-atencao";
import { SCHEDULE_PALETTE } from "@/lib/sigaa-schedule";
import type { PontoAtencao, TipoPonto } from "@/lib/types";

const MESES_ABREV_PT = [
  "JAN",
  "FEV",
  "MAR",
  "ABR",
  "MAI",
  "JUN",
  "JUL",
  "AGO",
  "SET",
  "OUT",
  "NOV",
  "DEZ",
];

const DIAS_SEMANA_ABREV_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const ICONE_TIPO: Record<TipoPonto, AppIconName> = {
  TRABALHO: "IconFileText",
  PROVA: "IconFlag",
};

/** Rótulo curto para o chip de tipo — mesma anatomia no herói e no bloco do dia. */
function rotuloTipo(tipo: TipoPonto): string {
  return tipo === "TRABALHO" ? "Trabalho · entrega" : "Prova · avaliação";
}

function formatarDiaMes(data: string): { dia: string; mes: string } {
  const alvo = parseIsoDate(data);
  return {
    dia: String(alvo.getDate()).padStart(2, "0"),
    mes: MESES_ABREV_PT[alvo.getMonth()],
  };
}

function formatarDiaSemanaData(data: string): string {
  const alvo = parseIsoDate(data);
  const diaSemana = DIAS_SEMANA_ABREV_PT[alvo.getDay()];
  const dia = String(alvo.getDate()).padStart(2, "0");
  const mes = String(alvo.getMonth() + 1).padStart(2, "0");
  return `${diaSemana} ${dia}/${mes}`;
}

/**
 * Mapeia cada turma a uma cor da mesma paleta usada na grade semanal, na
 * ordem em que aparece nesta lista (já ordenada por data). Não tenta casar
 * com o índice que a grade atribuiu à mesma turma — os dois lêem a mesma
 * paleta, mas cada um a percorre pela ordem em que enxerga as turmas.
 */
function corPorTurma(pontos: PontoAtencao[]): Map<string, (typeof SCHEDULE_PALETTE)[number]> {
  const indicePorTurma = new Map<string, number>();
  for (const ponto of pontos) {
    if (!indicePorTurma.has(ponto.turmaId)) {
      indicePorTurma.set(ponto.turmaId, indicePorTurma.size % SCHEDULE_PALETTE.length);
    }
  }
  const corPorId = new Map<string, (typeof SCHEDULE_PALETTE)[number]>();
  for (const [turmaId, indice] of indicePorTurma) {
    corPorId.set(turmaId, SCHEDULE_PALETTE[indice]);
  }
  return corPorId;
}

interface PontosAtencaoSectionProps {
  pontos: PontoAtencao[];
  agora: Date;
  onNovo?: () => void;
  onVerTudo?: () => void;
}

/**
 * Contagem regressiva do prazo mais próximo, no topo da home, seguindo o
 * artboard "D · Síntese" (.design/home/Main.dc.html). Componente de
 * apresentação puro: quem busca os dados e decide o que fazer com "novo" e
 * "ver tudo" é o chamador.
 */
export function PontosAtencaoSection({
  pontos,
  agora,
  onNovo,
  onVerTudo,
}: PontosAtencaoSectionProps): JSX.Element {
  const mutedColor = useThemeColor("muted");
  const dangerSoftForegroundColor = useThemeColor("danger-soft-foreground");

  // Contestado é assunto só da lista completa — nunca da contagem regressiva.
  const visiveis = pontos
    .filter((ponto) => ponto.estado !== "CONTESTADO")
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data) || (a.hora ?? "").localeCompare(b.hora ?? ""));

  const [proximo, ...restantes] = visiveis;
  const cores = corPorTurma(visiveis);

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <Typography.Heading type="h4">Pontos de atenção</Typography.Heading>
          {visiveis.length > 0 && (
            <View className="rounded-full bg-danger-soft px-2 py-0.5">
              <Typography.Paragraph
                type="body-xs"
                weight="medium"
                className="text-danger-soft-foreground font-mono"
              >
                {visiveis.length}
              </Typography.Paragraph>
            </View>
          )}
        </View>
        <Pressable
          onPress={onVerTudo}
          hitSlop={12}
          className="flex-row items-center gap-0.5 py-3 -my-3"
        >
          <Typography.Paragraph type="body-xs" color="muted">
            Ver tudo
          </Typography.Paragraph>
          <AppIcon name="IconCaretRight" size={14} color={mutedColor} />
        </Pressable>
      </View>

      {!proximo ? (
        <Pressable
          testID="pontos-atencao-vazio"
          onPress={onNovo}
          className="rounded-3xl bg-surface-secondary p-5 flex-row items-center justify-between gap-3"
        >
          <Typography.Paragraph type="body-sm" color="muted">
            Nenhuma prova ou trabalho cadastrado
          </Typography.Paragraph>
          <Typography.Heading type="h6">+</Typography.Heading>
        </Pressable>
      ) : (
        <View className="gap-0.5">
          {(() => {
            const diasRestantes = diasAte(proximo.data, agora);
            const urgencia = classificarUrgencia(diasRestantes);
            const corTurma = cores.get(proximo.turmaId) ?? SCHEDULE_PALETTE[0];
            return (
              <View
                testID="pontos-atencao-hero"
                className={
                  urgencia === "critico"
                    ? `rounded-t-3xl p-4 flex-row items-center gap-4 bg-danger-soft border border-danger/30 ${
                        restantes.length > 0 ? "rounded-b-md" : "rounded-b-3xl"
                      }`
                    : `rounded-t-3xl p-4 flex-row items-center gap-4 bg-surface-secondary ${
                        restantes.length > 0 ? "rounded-b-md" : "rounded-b-3xl"
                      }`
                }
              >
                <View className="items-center w-[84px]">
                  <Typography.Paragraph
                    className={`font-mono text-[52px] leading-[52px] ${
                      urgencia === "critico" ? "text-danger-soft-foreground" : undefined
                    }`}
                    weight="medium"
                  >
                    {diasRestantes}
                  </Typography.Paragraph>
                  <Typography.Paragraph
                    type="body-sm"
                    className={urgencia === "critico" ? "text-danger-soft-foreground" : undefined}
                  >
                    dias
                  </Typography.Paragraph>
                </View>
                <View className="flex-1 gap-1">
                  <View className="flex-row items-center gap-1.5">
                    <AppIcon
                      name={ICONE_TIPO[proximo.tipo]}
                      size={14}
                      color={urgencia === "critico" ? dangerSoftForegroundColor : mutedColor}
                    />
                    <Typography.Paragraph
                      type="body-xs"
                      weight="medium"
                      className={
                        urgencia === "critico" ? "text-danger-soft-foreground" : "text-muted"
                      }
                    >
                      {rotuloTipo(proximo.tipo)}
                    </Typography.Paragraph>
                  </View>
                  <Typography.Heading type="h6">{proximo.titulo}</Typography.Heading>
                  <View className="flex-row items-center gap-2">
                    <View className="flex-row items-center gap-1.5">
                      <View
                        className="w-1.5 h-1.5 rounded-sm"
                        style={{ backgroundColor: corTurma.bar }}
                      />
                      <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                        {proximo.turmaCodigo ?? proximo.turmaNome}
                      </Typography.Paragraph>
                    </View>
                    <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                      · {formatarDiaSemanaData(proximo.data)}
                    </Typography.Paragraph>
                  </View>
                </View>
              </View>
            );
          })()}

          {restantes.length > 0 && (
            <View className="rounded-t-md rounded-b-3xl bg-surface-secondary px-4 pt-1.5 pb-3">
              <View className="py-2">
                <Typography.Paragraph type="body-xs" color="muted">
                  Depois disso
                </Typography.Paragraph>
              </View>
              <View className="gap-0.5">
                {restantes.map((ponto) => {
                  const diasRestantes = diasAte(ponto.data, agora);
                  const { dia, mes } = formatarDiaMes(ponto.data);
                  const urgencia = classificarUrgencia(diasRestantes);
                  const corTurma = cores.get(ponto.turmaId) ?? SCHEDULE_PALETTE[0];
                  return (
                    <View
                      key={ponto.id}
                      className="flex-row items-center gap-3 py-2 border-t border-white/[0.06]"
                    >
                      <View className="w-[46px] items-center">
                        <Typography.Paragraph
                          type="body-sm"
                          weight="medium"
                          className={`font-mono ${
                            urgencia === "atencao" ? "text-warning-soft-foreground" : ""
                          }`}
                        >
                          {dia}
                        </Typography.Paragraph>
                        <Typography.Paragraph type="body-xs" color="muted" className="text-[10px]">
                          {mes}
                        </Typography.Paragraph>
                      </View>
                      <View
                        className="w-[3px] rounded-full"
                        style={{ backgroundColor: corTurma.bar, minHeight: 26 }}
                      />
                      <View className="flex-1 gap-0.5">
                        <Typography.Paragraph type="body-sm" weight="medium">
                          {ponto.titulo}
                        </Typography.Paragraph>
                        <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                          {(ponto.turmaCodigo ?? ponto.turmaNome) +
                            " · " +
                            (ponto.tipo === "TRABALHO" ? "trabalho" : "prova")}
                        </Typography.Paragraph>
                      </View>
                      <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                        {diasRestantes}d
                      </Typography.Paragraph>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
