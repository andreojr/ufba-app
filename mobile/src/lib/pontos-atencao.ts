import { parseIsoDate } from "./periodo-letivo";
import type { ScheduleBlock } from "./sigaa-schedule";
import type { PontoAtencao } from "./types";

/**
 * Os limiares de urgência vivem só aqui — a home, a lista completa e o bloco
 * do dia leem desta função, então mudar a régua é mudar um lugar.
 */
export type Urgencia = "critico" | "atencao" | "distante";

const DIAS_CRITICO = 3;
const DIAS_ATENCAO = 10;

/** Prazo sem hora vence no fim do dia — é como o SIGAA e os professores tratam. */
export const MINUTO_FIM_DO_DIA = 23 * 60 + 59;

/**
 * Dias de CALENDÁRIO entre hoje e a data, não janelas de 24h: às 16h de
 * segunda, uma entrega na quinta são "3 dias" para qualquer aluno, ainda que
 * faltem 56 horas.
 */
export function diasAte(dataIso: string, agora: Date): number {
  const alvo = parseIsoDate(dataIso);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const umDia = 24 * 60 * 60 * 1000;
  return Math.round((alvo.getTime() - hoje.getTime()) / umDia);
}

/**
 * `YYYY-MM-DD` a partir dos componentes LOCAIS da data. `toISOString()` daria
 * o dia seguinte em qualquer horário noturno no Brasil, e o prazo deixaria de
 * casar com o dia selecionado na grade.
 */
export function dataIsoLocal(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

export function classificarUrgencia(diasRestantes: number): Urgencia {
  if (diasRestantes <= DIAS_CRITICO) {
    return "critico";
  }
  return diasRestantes <= DIAS_ATENCAO ? "atencao" : "distante";
}

export type ItemDoDia =
  | { kind: "aula"; inicioMin: number; aula: ScheduleBlock }
  | { kind: "ponto"; inicioMin: number; ponto: PontoAtencao };

function minutoDoPonto(ponto: PontoAtencao): number {
  if (!ponto.hora) {
    return MINUTO_FIM_DO_DIA;
  }
  const [h, m] = ponto.hora.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Mistura os prazos de uma data com as aulas daquele dia, em ordem
 * cronológica. Item contestado não entra: por definição do estado, ele só
 * existe na lista completa.
 */
export function intercalarDia(
  aulas: ScheduleBlock[],
  pontos: PontoAtencao[],
): ItemDoDia[] {
  const itens: ItemDoDia[] = [
    ...aulas.map((aula): ItemDoDia => ({ kind: "aula", inicioMin: aula.inicioMin, aula })),
    ...pontos
      .filter((ponto) => ponto.estado !== "CONTESTADO")
      .map((ponto): ItemDoDia => ({
        kind: "ponto",
        inicioMin: minutoDoPonto(ponto),
        ponto,
      })),
  ];

  return itens.sort((a, b) => a.inicioMin - b.inicioMin);
}
