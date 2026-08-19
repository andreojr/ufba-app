import { expandJawrStylesheets } from './jawr-styles';

// Minimal shape of jawr_loader.js: an array of r("<bundle>","/gzip_<hash>/", [...])
// entries. The logical path passed to JAWR.loader.style() is the bundle name; its
// real URL is /shared/cssBundles + prefix + name (collapsing double slashes).
const LOADER_JS = `
  var cssbundles=[
    r("/css/ufrn_print.css","/gzip_48504048/",["/css/ufrn_print.css"]),
    r("/css/ufrn_relatorio.css","/gzip_1156578952/",["/css/ufrn_relatorio.css"]),
    r("/bundles/css/sigaa_base.css","/gzip_1664710823/",["/x.css"])
  ];
`;

describe('expandJawrStylesheets', () => {
  it('expands a JAWR-loaded stylesheet into a same-origin <link> before </head>', () => {
    const html =
      '<html><head><link rel="stylesheet" href="/shared/css/ufrn.css"/></head><body>' +
      "<script>JAWR.loader.style('/css/ufrn_print.css', 'print');</script>" +
      '</body></html>';

    const out = expandJawrStylesheets(html, LOADER_JS);

    expect(out).toContain(
      '<link rel="stylesheet" href="/shared/cssBundles/gzip_48504048/css/ufrn_print.css">',
    );
    // Injected inside the head, after the existing static link.
    expect(out.indexOf('/shared/cssBundles/gzip_48504048')).toBeLessThan(
      out.indexOf('</head>'),
    );
    expect(out.indexOf('/shared/css/ufrn.css')).toBeLessThan(
      out.indexOf('/shared/cssBundles/gzip_48504048'),
    );
  });

  it('drops the loader media argument (e.g. "print") so the sheet applies unconditionally in the print-only PDF', () => {
    const html =
      "<head></head><script>JAWR.loader.style('/css/ufrn_print.css', 'print');</script>";

    const out = expandJawrStylesheets(html, LOADER_JS);

    expect(out).not.toContain('media=');
    expect(out).toContain(
      'href="/shared/cssBundles/gzip_48504048/css/ufrn_print.css"',
    );
  });

  it('resolves every JAWR.loader.style call via the loader gzip-prefix map', () => {
    const html =
      '<head></head>' +
      "<script>JAWR.loader.style('/css/ufrn_relatorio.css','all');" +
      "JAWR.loader.style('/bundles/css/sigaa_base.css','all');</script>";

    const out = expandJawrStylesheets(html, LOADER_JS);

    expect(out).toContain(
      'href="/shared/cssBundles/gzip_1156578952/css/ufrn_relatorio.css"',
    );
    expect(out).toContain(
      'href="/shared/cssBundles/gzip_1664710823/bundles/css/sigaa_base.css"',
    );
  });

  it('resolves a loader.style call that omits the media argument', () => {
    const html =
      "<head></head><script>JAWR.loader.style('/css/ufrn_print.css');</script>";

    const out = expandJawrStylesheets(html, LOADER_JS);

    expect(out).toContain(
      '<link rel="stylesheet" href="/shared/cssBundles/gzip_48504048/css/ufrn_print.css">',
    );
  });

  it('leaves a loader.style path that is not in the bundle map alone', () => {
    const html =
      "<head></head><script>JAWR.loader.style('/css/desconhecido.css','all');</script>";

    const out = expandJawrStylesheets(html, LOADER_JS);

    expect(out).not.toContain('<link');
  });

  it('returns the html unchanged when there are no JAWR.loader.style calls', () => {
    const html = '<head></head><body>no jawr here</body>';

    expect(expandJawrStylesheets(html, LOADER_JS)).toBe(html);
  });
});
