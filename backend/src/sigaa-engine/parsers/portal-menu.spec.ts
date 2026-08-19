import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseAtestadoMenuPostback,
  parseHistoricoMenuPostback,
} from './portal-menu';

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'portal-discente-menu.html',
);

describe('parseHistoricoMenuPostback', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf-8');

  it('extracts the hidden form id from the menu form', () => {
    const postback = parseHistoricoMenuPostback(html);

    expect(postback.id).toBe('475404');
  });

  it('extracts the full jscook_action for "Emitir Histórico" from the JSCookMenu items', () => {
    const postback = parseHistoricoMenuPostback(html);

    expect(postback.jscookAction).toBe(
      'menu_form_menu_discente_discente_menu:A]#{ portalDiscente.historico }',
    );
  });

  it('does not confuse the plain histórico with "Emitir Histórico Completo" (portalDiscente.historicoComDadosAdicionais)', () => {
    const postback = parseHistoricoMenuPostback(html);

    expect(postback.jscookAction).not.toContain('ComDadosAdicionais');
  });

  it('tolerates a self-closing hidden id input (markup varies across SIGAA instances)', () => {
    const selfClosing = html.replace(
      '<input type="hidden" name="id" value="475404">',
      '<input type="hidden" name="id" value="99"/>',
    );

    expect(parseHistoricoMenuPostback(selfClosing).id).toBe('99');
  });

  it('throws a descriptive error when the histórico menu entry is missing', () => {
    const withoutHistorico = html.replace(
      '#{ portalDiscente.historico }',
      '#{ portalDiscente.algoDiferente }',
    );

    expect(() => parseHistoricoMenuPostback(withoutHistorico)).toThrow(
      /portalDiscente\.historico/,
    );
  });

  it('throws a descriptive error when the hidden id input is missing', () => {
    const withoutId = html.replace(
      '<input type="hidden" name="id" value="475404">',
      '',
    );

    expect(() => parseHistoricoMenuPostback(withoutId)).toThrow(/name="id"/);
  });
});

describe('parseAtestadoMenuPostback', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf-8');

  it('extracts the hidden form id from the menu form', () => {
    expect(parseAtestadoMenuPostback(html).id).toBe('475404');
  });

  it('extracts the full jscook_action for "Emitir Atestado de Matrícula"', () => {
    expect(parseAtestadoMenuPostback(html).jscookAction).toBe(
      'menu_form_menu_discente_discente_menu:A]#{ portalDiscente.atestadoMatricula }',
    );
  });

  it('tolerates the per-deploy generated menu prefix (j_id_jsp_...) seen at UFBA', () => {
    const ufbaPrefix = html.replace(
      /menu_form_menu_discente_discente_menu:A\]#\{ portalDiscente\.atestadoMatricula \}/,
      'menu_form_menu_discente_j_id_jsp_315194548_99_menu:A]#{ portalDiscente.atestadoMatricula }',
    );

    expect(parseAtestadoMenuPostback(ufbaPrefix).jscookAction).toBe(
      'menu_form_menu_discente_j_id_jsp_315194548_99_menu:A]#{ portalDiscente.atestadoMatricula }',
    );
  });

  it('throws a descriptive error when the atestado menu entry is missing', () => {
    const withoutAtestado = html.replace(
      '#{ portalDiscente.atestadoMatricula }',
      '#{ portalDiscente.algoDiferente }',
    );

    expect(() => parseAtestadoMenuPostback(withoutAtestado)).toThrow(
      /portalDiscente\.atestadoMatricula/,
    );
  });
});
