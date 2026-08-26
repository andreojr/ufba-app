import * as cheerio from 'cheerio';

/**
 * Navegação dentro do AVA falha silenciosamente com HTTP 200: um postback de
 * seção → seção devolve a *página principal* (ou a home do portal) sem erro
 * algum — gotcha 1 de TURMA_VIRTUAL_INVESTIGATION.md. Um parser que devolve
 * `[]` nesse caso é indistinguível de "a seção está legitimamente vazia" e
 * mente pro usuário.
 *
 * `<form id="formMenu" action="/sigaa/ava/index.jsf">` é o menu da turma, e
 * está presente em toda página *dentro* da Turma Virtual (ver "Menu da turma"
 * na investigação) — e ausente na home do portal e nas cascas de erro. É o
 * marcador de identidade mais estável disponível: não depende de acentos
 * escapados como entidades numéricas (gotcha 3) nem de ids JSF gerados, que
 * variam por deploy.
 */
export function assertPaginaDaTurmaVirtual(html: string, secao: string): void {
  const $ = cheerio.load(html);
  if ($('form#formMenu').length === 0) {
    throw new Error(
      `Página inesperada ao ler ${secao} da Turma Virtual: o menu da turma (form#formMenu) não está presente — provável bounce pra home do portal ou casca de erro (ver ava-page.ts).`,
    );
  }
}
