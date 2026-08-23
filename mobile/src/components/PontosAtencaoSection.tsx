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

/**
 * Rótulo curto para o chip de tipo — mesma anatomia no herói e no bloco do
 * dia. Só o trabalho ganha o qualificador "· entrega": a data de um trabalho
 * é quando ele é ENTREGUE, distinta de quando foi criado, então o
 * qualificador desfaz uma ambiguidade real. Numa prova a data já É a
 * avaliação — "Prova · avaliação" seria só um sinônimo repetido.
 */
function rotuloTipo(tipo: TipoPonto): string {
  return tipo === "TRABALHO" ? "Trabalho · entrega" : "Prova";
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
 * Cor da barra/pontinho de uma turma, lida do MESMO mapa que colore a grade
 * semanal (ver `HomeTab`, que o constrói a partir dos `ScheduleBlock`s já
 * numerados por `buildWeekSchedule`) — nunca uma numeração própria, senão a
 * mesma turma pinta uma cor no herói e outra na grade logo abaixo. Uma turma
 * sem aula na semana mascarada (ex.: fora do período letivo já sincronizado)
 * não aparece nesse mapa; cai numa cor neutra em vez de inventar um segundo
 * índice.
 */
function corBarPorTurma(
  ponto: PontoAtencao,
  indicePorTurma: Map<string, number>,
  corNeutra: string,
): string {
  const chave = ponto.turmaCodigo ?? ponto.turmaNome;
  const indice = indicePorTurma.get(chave);
  return indice === undefined ? corNeutra : SCHEDULE_PALETTE[indice].bar;
}

interface PontosAtencaoSectionProps {
  pontos: PontoAtencao[];
  agora: Date;
  /**
   * `(codigo ?? nome) -> colorIndex` na paleta `SCHEDULE_PALETTE` — o mesmo
   * mapa que a grade semanal usa, para que a cor de uma turma bata nas duas
   * superfícies. Ver `corBarPorTurma`.
   */
  indicePorTurma: Map<string, number>;
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
  indicePorTurma,
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
          <AppIcon name="IconPlus" size={20} color={mutedColor} />
        </Pressable>
      ) : (
        <View className="gap-0.5">
          {(() => {
            const diasRestantes = diasAte(proximo.data, agora);
            const urgencia = classificarUrgencia(diasRestantes);
            const corTurma = corBarPorTurma(proximo, indicePorTurma, mutedColor);
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
                    testID="pontos-atencao-hero-dias"
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
                        testID="pontos-atencao-hero-cor"
                        className="w-1.5 h-1.5 rounded-sm"
                        style={{ backgroundColor: corTurma }}
                      />
                      <Typography.Paragraph
                        testID="pontos-atencao-hero-codigo"
                        type="body-xs"
                        color="muted"
                        className="font-mono"
                      >
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
                  const corTurma = corBarPorTurma(ponto, indicePorTurma, mutedColor);
                  return (
                    <View
                      key={ponto.id}
                      testID={`pontos-atencao-item-${ponto.id}`}
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
                        style={{ backgroundColor: corTurma, minHeight: 26 }}
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
