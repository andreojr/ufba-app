import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

/**
 * The public docente profile (`/sigaa/public/docente/portal.jsf?siape=…`).
 *
 * Every field is nullable on purpose. In the measured sample the entire
 * `#perfil-docente` block collapsed to "Perfil pessoal não cadastrado" for 3 of
 * 4 docentes, while `#contato` was filled for 4 of 4 — so an empty profile is
 * the normal outcome, not a parse failure.
 *
 * `departamento` is left null on purpose: this page's `#left` sidebar only
 * ever names the broad institute/school (captured in `unidade`), never the
 * specific department — that finer-grained value is only available from the
 * docente search listing (see `docente-busca.ts`).
 */
export interface DocentePortal {
  nome: string | null;
  departamento: string | null;
  unidade: string | null;
  descricaoPessoal: string | null;
  formacao: string[];
  areasInteresse: string[];
  lattesUrl: string | null;
  enderecoProfissional: string | null;
  sala: string | null;
  telefone: string | null;
  email: string | null;
}

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
}

// SIGAA fills unset contact/profile fields with a placeholder <i> element
// instead of omitting the <dd> — and it is not consistent about the
// placeholder's grammatical gender ("não informada" for descrição pessoal,
// "não informado" for endereço/sala), so compare accent- and gender-insensitively.
function ehNaoInformado(valor: string): boolean {
  return /^nao informad[oa]$/.test(
    valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase(),
  );
}

/** `<dd>a<br />b</dd>` is two values, not one string with a newline in it. */
function linhas(dd: cheerio.Cheerio<Element>): string[] {
  const clone = dd.clone();
  clone.find('br').replaceWith('\n');
  return clone
    .text()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !ehNaoInformado(line));
}

function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo && !ehNaoInformado(limpo) ? limpo : null;
}

export function parseDocentePortal(html: string): DocentePortal {
  const $ = cheerio.load(html);

  const perfil: DocentePortal = {
    nome: textoOuNulo(
      $('#left.barra_professor h3:not(.departamento):not(.situacao)')
        .first()
        .text(),
    ),
    departamento: null,
    unidade: textoOuNulo(
      $('#left.barra_professor h3.departamento').first().text(),
    ),
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: null,
    telefone: null,
    email: null,
  };

  $('#perfil-docente dl, #contato dl').each((_, dl) => {
    const label = normalizeLabel(
      $(dl).find('dt').first().clone().children('span').remove().end().text(),
    );
    const dd = $(dl).find('dd').first();

    if (label.startsWith('descricao pessoal')) {
      perfil.descricaoPessoal = linhas(dd).join(' ') || null;
    } else if (label.startsWith('formacao academica')) {
      perfil.formacao = linhas(dd);
    } else if (label.startsWith('areas de interesse')) {
      perfil.areasInteresse = linhas(dd);
    } else if (label.startsWith('curriculo lattes')) {
      perfil.lattesUrl = $(dl).find('a').attr('href')?.trim() ?? null;
    } else if (label.startsWith('endereco profissional')) {
      perfil.enderecoProfissional = linhas(dd).join(', ') || null;
    } else if (label === 'sala') {
      perfil.sala = textoOuNulo(dd.text());
    } else if (label.startsWith('telefone')) {
      perfil.telefone = textoOuNulo(dd.text());
    } else if (label.startsWith('endereco eletronico')) {
      perfil.email = textoOuNulo(dd.text());
    }
  });

  return perfil;
}
