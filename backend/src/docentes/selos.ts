import type { DocenteSalvo } from './docente.repository';

/**
 * What the list card advertises is inside the detail screen. Computed here,
 * server-side, from what was actually persisted — the client must never have to
 * infer "is this worth a tap" from which fields came back null.
 */
export interface DocenteSelos {
  contato: boolean;
  formacao: boolean;
  areasInteresse: boolean;
  lattes: boolean;
  orientacoes: boolean;
  semestresLecionando: number;
}

export function calcularSelos(docente: DocenteSalvo): DocenteSelos {
  const { orientacoes } = docente;
  return {
    contato: Boolean(
      docente.enderecoProfissional ||
      docente.sala ||
      docente.telefone ||
      docente.email,
    ),
    formacao: docente.formacao.length > 0,
    areasInteresse: docente.areasInteresse.length > 0,
    lattes: Boolean(docente.lattesUrl),
    orientacoes:
      docente.tccsOrientados.length > 0 ||
      orientacoes.mestradoAndamento > 0 ||
      orientacoes.mestradoConcluidas > 0 ||
      orientacoes.doutoradoAndamento > 0 ||
      orientacoes.doutoradoConcluidas > 0,
    semestresLecionando: new Set(docente.disciplinas.map((d) => d.semestre))
      .size,
  };
}
