import { avaliarPreRequisito } from './avaliador-prerequisito';

describe('avaliarPreRequisito', () => {
  it('sem pré-requisito, avalia true trivialmente', () => {
    expect(avaliarPreRequisito(null, new Set())).toBe(true);
    expect(avaliarPreRequisito('', new Set())).toBe(true);
  });

  it('texto presente mas sem nenhum código reconhecível (ex: carga horária mínima) falha fechado', () => {
    // Distinto de null/'' acima: aqui HÁ um texto de pré-requisito, só que
    // não é do formato código-de-componente — não dá pra verificar, então
    // não pode virar "liberada" por default.
    expect(avaliarPreRequisito('CARGA HORÁRIA MÍNIMA DE 1700 HORAS', new Set())).toBe(false);
  });

  it('um único código: true se aprovado, false se não', () => {
    expect(avaliarPreRequisito('MATA02', new Set(['MATA02']))).toBe(true);
    expect(avaliarPreRequisito('MATA02', new Set())).toBe(false);
  });

  it('E: só true se AMBOS aprovados', () => {
    expect(avaliarPreRequisito('FISD36 E FISD42', new Set(['FISD36', 'FISD42']))).toBe(true);
    expect(avaliarPreRequisito('FISD36 E FISD42', new Set(['FISD36']))).toBe(false);
    expect(avaliarPreRequisito('FISD36 E FISD42', new Set())).toBe(false);
  });

  it('OU: true se PELO MENOS UM aprovado', () => {
    expect(avaliarPreRequisito('FISD36 OU FISD42', new Set(['FISD42']))).toBe(true);
    expect(avaliarPreRequisito('FISD36 OU FISD42', new Set())).toBe(false);
  });

  it('parênteses + E/OU combinados: "(A E B) OU (C)"', () => {
    const texto = '(FISD36 E FISD42) OU (ENGJ18)';
    // Só ENGJ18 aprovado — o ramo OU alternativo basta.
    expect(avaliarPreRequisito(texto, new Set(['ENGJ18']))).toBe(true);
    // Só FISD36 aprovado — falta FISD42 no ramo E, e o ramo OU não foi
    // satisfeito por nenhum dos dois lados.
    expect(avaliarPreRequisito(texto, new Set(['FISD36']))).toBe(false);
    // Os dois do ramo E aprovados — não precisa do ramo OU.
    expect(avaliarPreRequisito(texto, new Set(['FISD36', 'FISD42']))).toBe(true);
  });

  it('parênteses aninhados: "((A OU B) E C)"', () => {
    const texto = '((MATA02 OU MATA03) E FISD36)';
    expect(avaliarPreRequisito(texto, new Set(['MATA02', 'FISD36']))).toBe(true);
    expect(avaliarPreRequisito(texto, new Set(['MATA03', 'FISD36']))).toBe(true);
    expect(avaliarPreRequisito(texto, new Set(['MATA02']))).toBe(false);
    expect(avaliarPreRequisito(texto, new Set(['FISD36']))).toBe(false);
  });

  it('código citado que o aluno nunca cursou conta como não-satisfeito, mesmo que não exista na grade ativa', () => {
    // Sem filtro contra a grade aqui (isso é responsabilidade de quem monta
    // a lista de vizinhos exibidos, não do avaliador) — o avaliador só olha
    // se o código está no conjunto de aprovados.
    expect(avaliarPreRequisito('CODIGOFANTASMA99', new Set())).toBe(false);
  });

  it('texto malformado (parêntese não fechado) não lança — avalia false defensivamente', () => {
    expect(avaliarPreRequisito('(MATA02 E FISD36', new Set(['MATA02', 'FISD36']))).toBe(false);
  });
});
