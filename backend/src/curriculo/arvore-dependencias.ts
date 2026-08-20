// Case: "(FISD36 E FISD42) OU (ENGJ18)" — captura o código de disciplina bruto
// (letras maiúsculas seguidas de dígitos, com uma letra final opcional para
// variantes de equivalência como "ENG295A"), ignorando por completo a
// estrutura lógica E/OU/parênteses ao redor. Ver spec: "Fidelidade E/OU" foi
// decidida como fora de escopo.
// Aceita também códigos muito curtos (ex: A1, B1) para testes defensivos de ciclos.
const CODIGO_PATTERN = /[A-Z]{1,6}\d{1,4}[A-Z]?/g;

export function extrairCodigosCitados(texto: string | null): string[] {
  if (!texto) {
    return [];
  }
  const encontrados = texto.match(CODIGO_PATTERN) ?? [];
  return [...new Set(encontrados)];
}

export interface NoArvore {
  codigo: string;
  nome: string;
  periodo: number | null;
}

export interface ArestaArvore {
  de: string;
  para: string;
}

export interface ArvoreDependencias {
  nos: NoArvore[];
  arestas: ArestaArvore[];
}

export interface ComponenteParaArvore {
  codigo: string;
  nome: string;
  periodo: number | null;
  preRequisito: string | null;
}

/**
 * A partir do código raiz, coleta via BFS todo componente alcançável no
 * índice reverso "quem cita este código no próprio pré-requisito" — ou seja,
 * a árvore de quem *depende* da raiz, não o inverso.
 *
 * Um código citado no texto que não bate com nenhum `codigo` desta mesma
 * lista de componentes (referência a currículo antigo/outro curso/optativa
 * fora da grade) é descartado silenciosamente — nunca vira nó nem aresta.
 * Ver spec, seção "Extração de códigos e filtro contra a grade".
 */
export function construirArvoreDependencias(
  componentes: ComponenteParaArvore[],
  codigoRaiz: string,
): ArvoreDependencias {
  const porCodigo = new Map(componentes.map((c) => [c.codigo, c]));
  if (!porCodigo.has(codigoRaiz)) {
    return { nos: [], arestas: [] };
  }

  const filhosDe = new Map<string, Set<string>>();
  for (const componente of componentes) {
    const citados = extrairCodigosCitados(componente.preRequisito).filter((codigo) =>
      porCodigo.has(codigo),
    );
    for (const citado of citados) {
      if (!filhosDe.has(citado)) {
        filhosDe.set(citado, new Set());
      }
      filhosDe.get(citado)!.add(componente.codigo);
    }
  }

  const visitados = new Set<string>([codigoRaiz]);
  const arestas: ArestaArvore[] = [];
  const fila = [codigoRaiz];
  while (fila.length > 0) {
    const atual = fila.shift()!;
    for (const filho of filhosDe.get(atual) ?? []) {
      arestas.push({ de: atual, para: filho });
      if (!visitados.has(filho)) {
        visitados.add(filho);
        fila.push(filho);
      }
    }
  }

  const nos: NoArvore[] = [...visitados].map((codigo) => {
    const c = porCodigo.get(codigo)!;
    return { codigo: c.codigo, nome: c.nome, periodo: c.periodo };
  });

  return { nos, arestas };
}
