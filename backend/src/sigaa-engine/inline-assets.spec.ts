import { AssetFetcher, inlineSameOriginAssets } from './inline-assets';

function fetcherFrom(
  assets: Record<string, { contentType: string; bytes: Buffer }>,
): { fetch: AssetFetcher; requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    fetch: (path: string) => {
      requested.push(path);
      return Promise.resolve(assets[path] ?? null);
    },
  };
}

describe('inlineSameOriginAssets', () => {
  it('replaces a same-origin stylesheet link with an inline <style> carrying the fetched CSS', async () => {
    const { fetch } = fetcherFrom({
      '/sigaa/css/atestado_matricula.css': {
        contentType: 'text/css',
        bytes: Buffer.from('.matricula { color: red; }'),
      },
    });

    const html = await inlineSameOriginAssets(
      '<link rel="stylesheet" href="/sigaa/css/atestado_matricula.css" type="text/css" />',
      fetch,
    );

    expect(html).toContain('<style>.matricula { color: red; }</style>');
    expect(html).not.toContain('<link');
  });

  it('preserves the media attribute of a stylesheet link on the emitted <style>', async () => {
    const { fetch } = fetcherFrom({
      '/shared/css/ufrn.css': {
        contentType: 'text/css',
        bytes: Buffer.from('body{}'),
      },
    });

    const html = await inlineSameOriginAssets(
      '<link rel="stylesheet" media="all" href="/shared/css/ufrn.css"/>',
      fetch,
    );

    expect(html).toContain('<style media="all">body{}</style>');
  });

  it('drops a stylesheet link whose asset cannot be fetched, instead of leaving a dead reference', async () => {
    const { fetch } = fetcherFrom({});

    const html = await inlineSameOriginAssets(
      'A<link rel="stylesheet" href="/css/ufrn_print.css"/>B',
      fetch,
    );

    expect(html).toBe('AB');
  });

  it('rewrites a same-origin <img> src to a base64 data URI with the asset content type', async () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38]); // "GIF8"
    const { fetch } = fetcherFrom({
      '/shared/img/instituicao/ufrn.gif': {
        contentType: 'image/gif',
        bytes: gif,
      },
    });

    const html = await inlineSameOriginAssets(
      '<img src="/shared/img/instituicao/ufrn.gif" height="40"/>',
      fetch,
    );

    expect(html).toContain(
      `src="data:image/gif;base64,${gif.toString('base64')}"`,
    );
    expect(html).toContain('height="40"');
  });

  it('leaves an <img> untouched when its asset cannot be fetched', async () => {
    const { fetch } = fetcherFrom({});
    const source = '<img src="/shared/img/instituicao/ufrn.gif" height="40"/>';

    expect(await inlineSameOriginAssets(source, fetch)).toBe(source);
  });

  it('strips every <script>, inline and external, so nothing runs in the rendered page', async () => {
    const { fetch } = fetcherFrom({});

    const html = await inlineSameOriginAssets(
      'X<script type="text/javascript">window.print();</script>' +
        '<script src="/shared/jsBundles/jawr_loader.js" ></script>Y',
      fetch,
    );

    expect(html).toBe('XY');
  });

  it('only fetches same-origin (leading slash) references, leaving external URLs alone', async () => {
    const { fetch, requested } = fetcherFrom({});

    const html = await inlineSameOriginAssets(
      '<link rel="stylesheet" href="https://cdn.example.com/x.css"/>' +
        '<img src="https://cdn.example.com/x.png"/>',
      fetch,
    );

    expect(requested).toEqual([]);
    expect(html).toContain('href="https://cdn.example.com/x.css"');
    expect(html).toContain('src="https://cdn.example.com/x.png"');
  });

  it('decodes fetched CSS as ISO-8859-1 (SIGAA default) so accented content survives', async () => {
    const { fetch } = fetcherFrom({
      '/sigaa/css/x.css': {
        contentType: 'text/css;charset=ISO-8859-1',
        // 0xE7 = "ç" in ISO-8859-1
        bytes: Buffer.from([0x2f, 0x2a, 0xe7, 0x2a, 0x2f]),
      },
    });

    const html = await inlineSameOriginAssets(
      '<link rel="stylesheet" href="/sigaa/css/x.css"/>',
      fetch,
    );

    expect(html).toContain('<style>/*ç*/</style>');
  });
});
