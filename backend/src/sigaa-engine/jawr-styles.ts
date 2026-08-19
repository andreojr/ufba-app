/**
 * SIGAA report pages (the atestado among them) pull three stylesheets *at
 * runtime via JavaScript* rather than static `<link>`s:
 *
 *     JAWR.loader.style('/css/ufrn_print.css', 'print');
 *     JAWR.loader.style('/css/ufrn_relatorio.css', 'all');
 *     JAWR.loader.style('/bundles/css/sigaa_base.css', 'all');
 *
 * These carry the print layout — crucially `ufrn_print.css`, which hides the
 * non-printable nav (`.naoImprimir`, `.voltar` → the "Voltar"/"Imprimir"
 * buttons) and centers the document. Because we strip scripts before rendering,
 * those loader calls never run, so the buttons leak into the PDF and the header
 * loses its layout. This module resolves each loader.style() call to its real
 * (gzip-hashed, per-deploy) bundle URL and rewrites it as a static `<link>` so
 * the asset inliner picks it up — preserving the `media` so `expo-print`, which
 * renders in the print context, applies `ufrn_print.css`.
 *
 * The bundle URL is `/shared/cssBundles` + prefix + name, read from the
 * `r("<name>","/gzip_<hash>/", [...])` entries in jawr_loader.js (the logical
 * path passed to loader.style() is itself the bundle name).
 */

const CSS_BUNDLES_ROOT = '/shared/cssBundles';
const BUNDLE_ENTRY_PATTERN = /r\("([^"]+)","(\/gzip_[0-9]+\/)"/g;
const LOADER_STYLE_PATTERN =
  /JAWR\.loader\.style\(\s*'([^']+)'\s*(?:,\s*'([^']*)')?\s*\)/g;

function collapseSlashes(path: string): string {
  return path.replace(/\/{2,}/g, '/');
}

/** Maps each JAWR bundle name to its resolved same-origin URL. */
function buildJawrCssMap(loaderJs: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of loaderJs.matchAll(BUNDLE_ENTRY_PATTERN)) {
    const [, name, prefix] = match;
    map.set(name, collapseSlashes(`${CSS_BUNDLES_ROOT}/${prefix}/${name}`));
  }
  return map;
}

export function expandJawrStylesheets(html: string, loaderJs: string): string {
  const cssMap = buildJawrCssMap(loaderJs);

  const links: string[] = [];
  for (const match of html.matchAll(LOADER_STYLE_PATTERN)) {
    const [, path] = match;
    const url = cssMap.get(path);
    if (!url) continue;
    // The loader's media argument (notably 'print' for ufrn_print.css) is
    // dropped on purpose: this document exists only to be rendered to a PDF,
    // and we can't rely on the device renderer (expo-print) honoring
    // media="print". Emitting the links unconditionally makes the print layout
    // — hidden nav, centered page — apply no matter how the PDF is produced.
    links.push(`<link rel="stylesheet" href="${url}">`);
  }

  if (links.length === 0) return html;

  const injected = links.join('');
  const headClose = html.indexOf('</head>');
  if (headClose !== -1) {
    return html.slice(0, headClose) + injected + html.slice(headClose);
  }
  return injected + html;
}
