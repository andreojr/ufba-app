// Case: "(FISD36 E FISD42) OU (ENGJ18)" — captura o código de disciplina bruto
// (letras maiúsculas seguidas de dígitos, com uma letra final opcional para
// variantes de equivalência como "ENG295A"), ignorando por completo a
// estrutura lógica E/OU/parênteses ao redor. Ver spec: "Fidelidade E/OU" foi
// decidida como fora de escopo.
const CODIGO_PATTERN = /[A-Z]{2,6}\d{1,4}[A-Z]?/g;

export function extrairCodigosCitados(texto: string | null): string[] {
  if (!texto) {
    return [];
  }
  const encontrados = texto.match(CODIGO_PATTERN) ?? [];
  return [...new Set(encontrados)];
}
