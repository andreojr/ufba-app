import dagre from "dagre";
import type { ArvoreDependenciasResponse } from "./types";

export interface NoLayout {
  codigo: string;
  nome: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface ArestaLayout {
  de: string;
  para: string;
  pontos: { x: number; y: number }[];
}

export interface LayoutArvore {
  nos: NoLayout[];
  arestas: ArestaLayout[];
  largura: number;
  altura: number;
}

const LARGURA_NO = 140;
// Alta o suficiente para caber duas linhas de texto (código pequeno/muted em
// cima, nome truncado embaixo) em vez de só o código bruto — ver
// arvore-dependencias.tsx.
const ALTURA_NO = 64;

/**
 * dagre é puro JS (sem dependência de DOM/Node) — só calcula posições, quem
 * desenha é o componente SVG. `rankdir: "TB"` = topo→base, mesma direção do
 * grafo lógico (raiz no topo, descendentes abaixo). Um nó com mais de um pai
 * (ex: Mecânica dos Sólidos citada tanto por Cálculo A quanto por Física B)
 * é adicionado uma única vez a `g` — dagre já trata isso como DAG nativo, não
 * como árvore, então o nó não duplica.
 */
export function construirLayout(arvore: ArvoreDependenciasResponse): LayoutArvore {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 56, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const no of arvore.nos) {
    g.setNode(no.codigo, { width: LARGURA_NO, height: ALTURA_NO });
  }
  for (const aresta of arvore.arestas) {
    g.setEdge(aresta.de, aresta.para);
  }

  dagre.layout(g);

  const porCodigo = new Map(arvore.nos.map((n) => [n.codigo, n]));
  const nos: NoLayout[] = g.nodes().map((codigo) => {
    const posicao = g.node(codigo);
    const info = porCodigo.get(codigo)!;
    return {
      codigo,
      nome: info.nome,
      x: posicao.x,
      y: posicao.y,
      largura: LARGURA_NO,
      altura: ALTURA_NO,
    };
  });
  const arestas: ArestaLayout[] = g.edges().map((e) => {
    const edge = g.edge(e);
    return { de: e.v, para: e.w, pontos: edge.points ?? [] };
  });

  const graphInfo = g.graph();
  return {
    nos,
    arestas,
    largura: graphInfo.width ?? 0,
    altura: graphInfo.height ?? 0,
  };
}
