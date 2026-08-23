import type { ComponenteCursado } from '../sigaa-engine/parsers/historico';
import type { ComponenteCurricularSalvo } from './curriculo.repository';

/**
 * Matéria abandonada no meio não conta como carga carregada: o aluno nunca
 * levou aquelas horas até um resultado. Mesma regra que a tela já aplica em
 * `componentesComCargaHorariaContada`.
 */
const SITUACOES_ABANDONADAS: readonly string[] = ['TRANC', 'CANC'];

/** Carga horária somada de cada período da grade. Optativas não têm período. */
function cargaPorPeriodo(componentes: ComponenteCurricularSalvo[]): number[] {
  const porPeriodo = new Map<number, number>();
  for (const componente of componentes) {
    if (componente.periodo === null) {
      continue;
    }
    porPeriodo.set(
      componente.periodo,
      (porPeriodo.get(componente.periodo) ?? 0) + componente.cargaHoraria,
    );
  }
  return [...porPeriodo.values()];
}

/** A maior carga horária que o aluno já fechou num único semestre. */
function recordeDoAluno(cursados: ComponenteCursado[]): number {
  const porSemestre = new Map<string, number>();
  for (const componente of cursados) {
    if (SITUACOES_ABANDONADAS.includes(componente.situacao)) {
      continue;
    }
    porSemestre.set(
      componente.semestre,
      (porSemestre.get(componente.semestre) ?? 0) + componente.cargaHoraria,
    );
  }
  return Math.max(0, ...porSemestre.values());
}

/**
 * Quanto o projetor pode empilhar num semestre futuro: o menor entre o período
 * mais pesado da grade e o recorde pessoal do aluno.
 *
 * O piso no período mais leve existe por causa de dois modos de falha do
 * recorde, que sozinhos travariam a projeção: o aluno de primeiro período não
 * tem semestre fechado nenhum, e o aluno que teve um semestre atípico de 30h
 * ficaria preso nesse teto pela projeção inteira.
 *
 * Uma grade sem obrigatórias por período (nada de onde tirar pesado/leve) cai
 * no recorde; sem recorde também, devolve zero — e aí a válvula de "matéria
 * maior que o teto ocupa o semestre sozinha", no projetor, é o que garante que
 * a fila ainda anda, um componente por semestre.
 */
export function tetoDeCarga(
  componentes: ComponenteCurricularSalvo[],
  cursados: ComponenteCursado[],
): number {
  const cargas = cargaPorPeriodo(componentes);
  const recorde = recordeDoAluno(cursados);
  if (cargas.length === 0) {
    return recorde;
  }
  const pesado = Math.max(...cargas);
  const leve = Math.min(...cargas);
  if (recorde === 0) {
    return pesado;
  }
  return Math.min(Math.max(recorde, leve), pesado);
}
