// Case: "(FISD36 E FISD42) OU (ENGJ18)" — captura o código de disciplina bruto
// (letras maiúsculas seguidas de dígitos, com uma letra final opcional para
// variantes de equivalência como "ENG295A"), ignorando por completo a
// estrutura lógica E/OU/parênteses ao redor. Usado pra achar vizinhos
// diretos (quem cita quem) em vizinhos-curriculares.ts — a fidelidade E/OU
// fica com o avaliador booleano em avaliador-prerequisito.ts.
// Aceita também códigos muito curtos (ex: A1, B1) para testes defensivos de ciclos.
const CODIGO_PATTERN = /[A-Z]{1,6}\d{1,4}[A-Z]?/g;

export function extrairCodigosCitados(texto: string | null): string[] {
  if (!texto) {
    return [];
  }
  const encontrados = texto.match(CODIGO_PATTERN) ?? [];
  return [...new Set(encontrados)];
}
