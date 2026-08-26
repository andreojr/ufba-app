import { proximoSemestre } from "./semestre";

/** Um alvo de soltura em coordenadas de tela — ver quadradinhoNoPonto. */
export interface Retangulo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Qual retângulo contém o ponto, ou null se nenhum contém. Em sobreposição
 * (não deveria acontecer no grid real, mas a função não assume isso), o
 * último da lista ganha — a mesma regra de "o que está por cima" que
 * `posicionarQuadradinhos` usa pra desenhar.
 */
export function quadradinhoNoPonto(
  retangulos: Retangulo[],
  ponto: { x: number; y: number },
): string | null {
  let achado: string | null = null;
  for (const retangulo of retangulos) {
    const dentro =
      ponto.x >= retangulo.x &&
      ponto.x <= retangulo.x + retangulo.width &&
      ponto.y >= retangulo.y &&
      ponto.y <= retangulo.y + retangulo.height;
    if (dentro) {
      achado = retangulo.id;
    }
  }
  return achado;
}

/** Sentinela pro quadradinho de "tirar do plano" — não é um semestre real. */
export const REMOVER_DO_PLANO = "__remover_do_plano__";

export interface QuadradinhoGrid {
  id: string;
  rotulo: string;
  /** O semestre atual do card sendo arrastado — soltar aqui não faz nada. */
  desabilitado: boolean;
  /** O quadradinho extra: soltar aqui cria um semestre que ainda não existe. */
  pontilhado: boolean;
}

/**
 * Os quadradinhos do grid de arrasto: um por semestre já projetado, mais um
 * pontilhado pro próximo semestre que ainda não existe, mais (só quando a
 * matéria já foi movida manualmente) o de tirar do plano.
 */
export function quadradinhosDoGrid(
  semestresProjetados: string[],
  semestreAtual: string,
  manual: boolean,
): QuadradinhoGrid[] {
  const ultimo = semestresProjetados[semestresProjetados.length - 1] ?? semestreAtual;
  const proximo = proximoSemestre(ultimo);
  const quadradinhos: QuadradinhoGrid[] = [
    ...semestresProjetados.map((semestre) => ({
      id: semestre,
      rotulo: semestre,
      desabilitado: semestre === semestreAtual,
      pontilhado: false,
    })),
    { id: proximo, rotulo: proximo, desabilitado: false, pontilhado: true },
  ];
  if (manual) {
    quadradinhos.push({
      id: REMOVER_DO_PLANO,
      rotulo: "Tirar do plano",
      desabilitado: false,
      pontilhado: false,
    });
  }
  return quadradinhos;
}

export const TAMANHO_QUADRADINHO = 96;
export const ESPACO_QUADRADINHO = 12;
export const COLUNAS_GRID = 3;

export interface QuadradinhoPosicionado extends QuadradinhoGrid, Retangulo {}

/**
 * Posições em grid fixo de COLUNAS_GRID colunas, calculadas em JS puro — de
 * propósito, sem depender de `onLayout`/`measureInWindow`. Isso é o que
 * torna o hit-test determinístico tanto em produção quanto em teste: a
 * mesma função decide onde cada quadradinho é desenhado (SemestreDragGrid) e
 * onde ele está pra fins de colisão (quadradinhoNoPonto).
 */
export function posicionarQuadradinhos(
  quadradinhos: QuadradinhoGrid[],
  origemX: number,
  origemY: number,
): QuadradinhoPosicionado[] {
  return quadradinhos.map((quadradinho, indice) => {
    const coluna = indice % COLUNAS_GRID;
    const linha = Math.floor(indice / COLUNAS_GRID);
    return {
      ...quadradinho,
      x: origemX + coluna * (TAMANHO_QUADRADINHO + ESPACO_QUADRADINHO),
      y: origemY + linha * (TAMANHO_QUADRADINHO + ESPACO_QUADRADINHO),
      width: TAMANHO_QUADRADINHO,
      height: TAMANHO_QUADRADINHO,
    };
  });
}
