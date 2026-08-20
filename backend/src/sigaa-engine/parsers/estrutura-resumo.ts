import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export interface ComponenteResumoMatriz {
  idSigaa: string;
  codigo: string;
  nome: string;
  cargaHoraria: number;
  natureza: 'OBRIGATORIA' | 'OPTATIVA' | 'COMPLEMENTAR';
  periodo: number | null;
}

export interface EstruturaResumo {
  anoPeriodoImplementacao: string;
  cargaHorariaTotal: number;
  cargaHorariaObrigatoria: number;
  cargaHorariaOptativaMinima: number;
  cargaHorariaComplementarMinima: number;
  prazoMinimoSemestres: number;
  prazoMedioSemestres: number;
  prazoMaximoSemestres: number;
  componentes: ComponenteResumoMatriz[];
}

// "ENG295 - HIGIENE E SEGURANÇA NO TRABALHO - 60h"
const COMPONENTE_ROW_PATTERN = /^(\S+)\s*-\s*(.+?)\s*-\s*(\d+)h$/;
const ID_PARAM_PATTERN = /'id':'(\d+)'/;
const HORAS_PATTERN = /(\d+)h/;

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
}

function horasDe(texto: string): number {
  const match = texto.match(HORAS_PATTERN);
  if (!match) {
    throw new Error(`No "Nh" workload found in "${texto}"`);
  }
  return Number(match[1]);
}

/**
 * table.formulario carries the structure's own label/value stats (código,
 * matriz, prazos, cargas horárias) as plain th/td rows — same shape
 * discente-perfil.ts already relies on elsewhere in this codebase.
 *
 * table.formulario is not closed until the very end of the page (all the
 * per-período table.subFormulario blocks sit nested inside one of its
 * <td>s), so `table.formulario tr` also matches every component row deeper
 * in the page. Those rows only ever have plain <td>s (no <th>), including
 * the "Carga Horária Total: NNNh" rows per período — the one real
 * collision risk the fixture could have posed for a bare "Total:" label —
 * so the `!th.length` guard below excludes them without needing to scope
 * more narrowly to direct children.
 */
function parseResumoStats(
  $: CheerioAPI,
): Omit<EstruturaResumo, 'componentes'> {
  const stats: Record<string, string> = {};
  $('table.formulario tr').each((_, row) => {
    const $row = $(row);
    const th = $row.find('th').first();
    const td = $row.find('td').first();
    if (!th.length || !td.length) {
      return;
    }
    const label = normalizeLabel(th.text());
    if (label && !(label in stats)) {
      stats[label] = td.text().trim();
    }
  });

  const prazoRow = $('table.formulario tr')
    .filter((_, row) =>
      normalizeLabel($(row).find('th').first().text()).startsWith(
        'prazo para conclusao',
      ),
    )
    .first();
  const prazos = prazoRow.find('td table td');

  return {
    anoPeriodoImplementacao: stats['periodo letivo de entrada em vigor'],
    cargaHorariaTotal: horasDe(stats['total minima']),
    cargaHorariaObrigatoria: horasDe(stats['total']),
    cargaHorariaOptativaMinima: horasDe(stats['carga horaria optativa minima']),
    cargaHorariaComplementarMinima: horasDe(
      stats['carga horaria complementar minima'],
    ),
    prazoMinimoSemestres: Number($(prazos[0]).text().trim()),
    prazoMedioSemestres: Number($(prazos[1]).text().trim()),
    prazoMaximoSemestres: Number($(prazos[2]).text().trim()),
  };
}

/**
 * The components live in `table.subFormulario` blocks: one per período
 * (`<div id="semestreN">`, caption "Nº Nível") plus one each for optativas and
 * complementares. Every row packs código/nome/carga horária into a single
 * cell ("CODIGO - NOME - NNNh") and carries the component's own SIGAA id in
 * the "Visualizar Detalhes do Componente" link's onclick.
 */
function parseComponentes($: CheerioAPI): ComponenteResumoMatriz[] {
  const componentes: ComponenteResumoMatriz[] = [];

  $('table.subFormulario').each((_, table) => {
    const $table = $(table);
    const periodoMatch = $table
      .closest('div[id^="semestre"]')
      .attr('id')
      ?.match(/semestre(\d+)/);
    const periodo = periodoMatch ? Number(periodoMatch[1]) : null;

    $table.find('tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 2) {
        return;
      }

      const rowMatch = $(cells[0]).text().trim().match(COMPONENTE_ROW_PATTERN);
      if (!rowMatch) {
        return;
      }
      const naturezaTexto = normalizeLabel($(cells[1]).text());
      const natureza: ComponenteResumoMatriz['natureza'] = naturezaTexto.startsWith(
        'obrigat',
      )
        ? 'OBRIGATORIA'
        : naturezaTexto.startsWith('optat')
          ? 'OPTATIVA'
          : 'COMPLEMENTAR';

      const onclick =
        $row
          .find('a[title="Visualizar Detalhes do Componente"]')
          .attr('onclick') ?? '';
      const idMatch = onclick.match(ID_PARAM_PATTERN);
      if (!idMatch) {
        return;
      }

      componentes.push({
        idSigaa: idMatch[1],
        codigo: rowMatch[1],
        nome: rowMatch[2],
        cargaHoraria: Number(rowMatch[3]),
        natureza,
        periodo,
      });
    });
  });

  return componentes;
}

export function parseEstruturaResumo(html: string): EstruturaResumo {
  const $ = cheerio.load(html);
  return {
    ...parseResumoStats($),
    componentes: parseComponentes($),
  };
}
