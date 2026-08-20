const DIAS: Record<string, string> = {
  "2": "Seg",
  "3": "Ter",
  "4": "Qua",
  "5": "Qui",
  "6": "Sex",
  "7": "Sáb",
};

/** Rótulos de início de cada aula, por turno — o mesmo grid que o backend usa
 * em `backend/src/sigaa-engine/schedule-code.ts`, mas aqui só o suficiente
 * pra montar um rótulo curto de exibição, não a lista completa de intervalos. */
const GRADE: Record<string, string[]> = {
  M: ["07h00", "07h55", "08h50", "09h45", "10h40", "11h35"],
  T: ["13h00", "13h55", "14h50", "15h45", "16h40", "17h35"],
  N: ["18h30", "19h20", "20h20", "21h10"],
};

const CODIGO = /^([2-7]+)([MTN])([1-6]+)/;

function paraMinutos(rotulo: string): number {
  const [horas, minutos] = rotulo.split("h").map(Number);
  return horas * 60 + minutos;
}

function formatarMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${String(horas).padStart(2, "0")}h${String(resto).padStart(2, "0")}`;
}

/**
 * Decodifica o primeiro código de horário SIGAA embutido em `horario` (ex.:
 * "24T34" ou "24T34 (19/08/2026 - 19/12/2026)") num rótulo curto de exibição
 * — "Seg e Qua · 14h50–16h35". Cada slot dura 55 min de aula, mas o fim do
 * bloco soma 50 min ao início do último slot (o padrão de aula do SIGAA), não
 * os 55 min até o slot seguinte.
 *
 * `disciplinas.jsf` às vezes lista dois códigos separados por espaço quando o
 * docente ministra a mesma turma em dois horários da semana (ex.:
 * "3N12  5N12 (...)") — só o primeiro vira o rótulo; mostrar os dois exigiria
 * uma linha maior do que a meta-linha da disciplina tem espaço para.
 *
 * Retorna `null` quando não há código reconhecível, e a linha da disciplina
 * cai de volta pra só código · nome · carga horária.
 */
export function decodeHorario(horario: string | null | undefined): string | null {
  if (!horario) return null;

  const primeiroCodigo = horario.trim().split(/\s+/)[0] ?? "";
  const match = CODIGO.exec(primeiroCodigo);
  if (!match) return null;

  const [, diasDigitos, turno, slotsDigitos] = match;
  const grade = GRADE[turno];

  const dias = diasDigitos
    .split("")
    .map((digito) => DIAS[digito])
    .filter((dia): dia is string => Boolean(dia));
  if (dias.length === 0) return null;

  const slots = slotsDigitos
    .split("")
    .map(Number)
    .filter((slot) => slot >= 1 && slot <= grade.length);
  if (slots.length === 0) return null;

  const inicio = grade[slots[0] - 1];
  const fimDoUltimoSlot = grade[slots[slots.length - 1] - 1];
  const fim = formatarMinutos(paraMinutos(fimDoUltimoSlot) + 50);

  return `${dias.join(" e ")} · ${inicio}–${fim}`;
}
