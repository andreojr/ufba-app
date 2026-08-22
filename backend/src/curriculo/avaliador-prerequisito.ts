// Mesmo padrão de código de disciplina usado em arvore-dependencias.ts —
// letras maiúsculas + dígitos, com uma letra final opcional (ex: ENG295A).
const CODIGO_PATTERN = /[A-Z]{1,6}\d{1,4}[A-Z]?/g;

type Token =
  | { tipo: 'ABRE' }
  | { tipo: 'FECHA' }
  | { tipo: 'E' }
  | { tipo: 'OU' }
  | { tipo: 'CODIGO'; codigo: string };

// "(" e ")" são tokens próprios mesmo colados a um código ("(FISD36") — por
// isso o parêntese entra na mesma regex de tokenização, antes do código.
const TOKEN_PATTERN = /\(|\)|\bOU\b|\bE\b|[A-Z]{1,6}\d{1,4}[A-Z]?/g;

function tokenizar(texto: string): Token[] {
  const brutos = texto.match(TOKEN_PATTERN) ?? [];
  return brutos.map((bruto): Token => {
    if (bruto === '(') return { tipo: 'ABRE' };
    if (bruto === ')') return { tipo: 'FECHA' };
    if (bruto === 'OU') return { tipo: 'OU' };
    if (bruto === 'E') return { tipo: 'E' };
    return { tipo: 'CODIGO', codigo: bruto };
  });
}

type Expressao =
  | { tipo: 'CODIGO'; codigo: string }
  | { tipo: 'E'; esquerda: Expressao; direita: Expressao }
  | { tipo: 'OU'; esquerda: Expressao; direita: Expressao };

/**
 * Recursivo-descendente simples: `expr := termo (OU termo)*`,
 * `termo := fator (E fator)*`, `fator := CODIGO | '(' expr ')'` — E tem
 * precedência sobre OU, igual álgebra booleana comum.
 */
class ParserPreRequisito {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parsear(): Expressao {
    const expr = this.parsearOu();
    if (this.pos !== this.tokens.length) {
      throw new Error('Expressão de pré-requisito malformada: tokens sobrando ao final');
    }
    return expr;
  }

  private parsearOu(): Expressao {
    let esquerda = this.parsearE();
    while (this.atual()?.tipo === 'OU') {
      this.pos++;
      const direita = this.parsearE();
      esquerda = { tipo: 'OU', esquerda, direita };
    }
    return esquerda;
  }

  private parsearE(): Expressao {
    let esquerda = this.parsearFator();
    while (this.atual()?.tipo === 'E') {
      this.pos++;
      const direita = this.parsearFator();
      esquerda = { tipo: 'E', esquerda, direita };
    }
    return esquerda;
  }

  private parsearFator(): Expressao {
    const token = this.atual();
    if (!token) {
      throw new Error('Expressão de pré-requisito malformada: esperava código ou "("');
    }
    if (token.tipo === 'ABRE') {
      this.pos++;
      const expr = this.parsearOu();
      if (this.atual()?.tipo !== 'FECHA') {
        throw new Error('Expressão de pré-requisito malformada: parêntese não fechado');
      }
      this.pos++;
      return expr;
    }
    if (token.tipo === 'CODIGO') {
      this.pos++;
      return { tipo: 'CODIGO', codigo: token.codigo };
    }
    throw new Error(`Expressão de pré-requisito malformada: token inesperado "${token.tipo}"`);
  }

  private atual(): Token | undefined {
    return this.tokens[this.pos];
  }
}

function avaliarExpressao(expr: Expressao, aprovados: ReadonlySet<string>): boolean {
  if (expr.tipo === 'CODIGO') {
    return aprovados.has(expr.codigo);
  }
  if (expr.tipo === 'E') {
    return avaliarExpressao(expr.esquerda, aprovados) && avaliarExpressao(expr.direita, aprovados);
  }
  return avaliarExpressao(expr.esquerda, aprovados) || avaliarExpressao(expr.direita, aprovados);
}

/**
 * Avalia se `texto` (o `preRequisito` cru de um componente) está satisfeito
 * pelo conjunto de códigos que o aluno já tem aprovados (`APR` no
 * histórico). Sem pré-requisito, avalia `true` trivialmente. Um código
 * citado que o aluno nunca aprovou conta como não-satisfeito — mesmo que
 * ele não exista na grade ativa (filtrar isso é responsabilidade de quem
 * monta a lista de vizinhos exibidos, não deste avaliador).
 *
 * Um texto malformado (nunca observado num currículo real, mas o parser é
 * novo e não vale confiar 100% em texto raspado) avalia `false`
 * defensivamente — nunca mostrar "liberada" para uma satisfação que não
 * deu pra verificar de verdade.
 */
export function avaliarPreRequisito(
  texto: string | null,
  aprovados: ReadonlySet<string>,
): boolean {
  if (!texto) {
    return true;
  }
  const tokens = tokenizar(texto);
  if (tokens.length === 0) {
    // Texto presente mas sem nenhum código reconhecível (ex.: um
    // pré-requisito de carga horária mínima) — não há como verificar isso,
    // então falha fechado, igual ao caso de parênteses malformados abaixo.
    return false;
  }
  try {
    const expr = new ParserPreRequisito(tokens).parsear();
    return avaliarExpressao(expr, aprovados);
  } catch {
    return false;
  }
}
