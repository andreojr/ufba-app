import * as cheerio from 'cheerio';

/**
 * "Produção Intelectual" (`/sigaa/public/docente/producao.jsf?siape=…`).
 *
 * The label misleads twice. In the fixtures measured, only two sections ever
 * carried data — "Trabalho de Fim de Curso" and "Orientações de
 * Pós-Graduação" — no articles, no books. And "Trabalho de Fim de Curso" is
 * not the docente's own thesis: these are the TCCs they supervised. What the
 * docente themselves studied lives in portal.jsf's "Formação acadêmica" field.
 *
 * Kept because it answers a real question: the titles map what this docente
 * will supervise, and the in-progress counts hint at whether they have room.
 */
export interface DocenteProducao {
  /** No student name, ever — see the dedupe note below. */
  tccsOrientados: { titulo: string; ano: number }[];
  orientacoes: {
    mestradoAndamento: number;
    mestradoConcluidas: number;
    doutoradoAndamento: number;
    doutoradoConcluidas: number;
  };
}

const ANO_PATTERN = /(\d{2})\/(\d{4})\s*$/;

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Each section is introduced by an <h2> heading followed by its list of rows.
// The row container's shape is not fixed across sections: the real fixture
// renders "Orientações de Pós-Graduação" as <ul><li>, while a <table
// class="listagem"><tr> is the shape documented for "Trabalho de Fim de
// Curso" — so look for either kind of container and either kind of row.
function linhasDaSecao($: cheerio.CheerioAPI, tituloParcial: string): string[] {
  const alvo = semAcento(tituloParcial);
  const linhas: string[] = [];

  $('h2').each((_, h2) => {
    if (!semAcento($(h2).text()).includes(alvo)) {
      return;
    }
    $(h2)
      .nextAll('ul, table')
      .first()
      .find('li, tr')
      .each((__, row) => {
        const texto = $(row).text().replace(/\s+/g, ' ').trim();
        if (texto) {
          linhas.push(texto);
        }
      });
  });

  return linhas;
}

export function parseDocenteProducao(html: string): DocenteProducao {
  const $ = cheerio.load(html);

  // --- supervised TCCs: "Título, ALUNO, MM/AAAA" ------------------------
  // Split from the RIGHT: a title may contain commas, the trailing two fields
  // never do. Splitting left-first corrupts every title with a comma in it.
  // Deduped on titulo+ano, for the same reason the supervisions below are:
  // SIGAA repeats rows, and dropping the student name collapses two students
  // on one theme in one year into an identical entry. Consumers key this list
  // by its contents — there is nothing left to tell those apart, so emitting
  // both only hands them an unusable duplicate.
  const tccs: { titulo: string; ano: number }[] = [];
  const tccsVistos = new Set<string>();
  for (const linha of linhasDaSecao($, 'trabalho de fim de curso')) {
    const ano = ANO_PATTERN.exec(linha);
    if (!ano) {
      continue;
    }
    const semData = linha.slice(0, ano.index).replace(/,\s*$/, '');
    const ultimaVirgula = semData.lastIndexOf(',');
    if (ultimaVirgula < 0) {
      continue;
    }
    // Everything before the student's name is the title. The name itself is
    // dropped here and never leaves this function.
    const titulo = semData.slice(0, ultimaVirgula).trim();
    if (!titulo) {
      continue;
    }
    const anoNumero = Number.parseInt(ano[2], 10);
    const chave = `${anoNumero}-${semAcento(titulo)}`;
    if (tccsVistos.has(chave)) {
      continue;
    }
    tccsVistos.add(chave);
    tccs.push({ titulo, ano: anoNumero });
  }

  // --- supervisions: "Nível, Aluno, início - fim, situação" -------------
  // The <h2> count is inflated: the same supervision is listed more than once
  // (measured: header claims 42, 5 rows are byte-identical duplicates, 37
  // distinct remain). Dedupe on the whole normalised line before counting.
  // The student name is a dedupe key in memory only — only the four totals
  // below are returned.
  const orientacoes = {
    mestradoAndamento: 0,
    mestradoConcluidas: 0,
    doutoradoAndamento: 0,
    doutoradoConcluidas: 0,
  };

  const vistas = new Set<string>();
  for (const linha of linhasDaSecao($, 'orientacoes de pos-graduacao')) {
    const chave = semAcento(linha);
    if (vistas.has(chave)) {
      continue;
    }
    vistas.add(chave);

    const doutorado = chave.includes('doutorado');
    const mestrado = chave.includes('mestrado');
    if (!doutorado && !mestrado) {
      continue;
    }
    // "Concluída" is the reliable marker; the situação field alone is not —
    // rows exist with an end date and "Orientação em Andamento", and with
    // "Concluída em " and no date.
    const concluida = chave.includes('conclu');

    if (doutorado) {
      if (concluida) orientacoes.doutoradoConcluidas += 1;
      else orientacoes.doutoradoAndamento += 1;
    } else {
      if (concluida) orientacoes.mestradoConcluidas += 1;
      else orientacoes.mestradoAndamento += 1;
    }
  }

  return { tccsOrientados: tccs, orientacoes };
}
