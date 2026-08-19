export interface FetchedAsset {
  /** The asset's `Content-Type` header, used to build the image data URI. */
  contentType: string;
  /** Raw asset bytes (base64'd for images, decoded to text for CSS). */
  bytes: Buffer;
}

/**
 * Fetches a same-origin asset by its absolute path (e.g. `/shared/css/ufrn.css`),
 * or resolves to `null` when it can't be retrieved. Injected so the transform
 * stays a pure function testable without a network.
 */
export type AssetFetcher = (path: string) => Promise<FetchedAsset | null>;

const SCRIPT_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const LINK_PATTERN = /<link\b[^>]*>/gi;
const IMG_PATTERN = /<img\b[^>]*>/gi;
const HREF_PATTERN = /href="([^"]*)"/i;
const SRC_PATTERN = /src="([^"]*)"/i;
const MEDIA_PATTERN = /media="([^"]*)"/i;
const CHARSET_PATTERN = /charset=([^;]+)/i;

function isSameOrigin(url: string): boolean {
  return url.startsWith('/');
}

function decodeCss(asset: FetchedAsset): string {
  const charset = CHARSET_PATTERN.exec(asset.contentType)?.[1]
    ?.trim()
    .toLowerCase();
  // SIGAA serves its CSS as ISO-8859-1 (latin1) unless it says otherwise.
  const encoding =
    charset === 'utf-8' || charset === 'utf8' ? 'utf-8' : 'latin1';
  return asset.bytes.toString(encoding);
}

/**
 * Rewrites a SIGAA HTML document (e.g. the atestado de matrícula print page)
 * into a self-contained one a fully offline renderer — like the device's
 * `expo-print` — can turn into a faithful PDF:
 *
 * - `<script>` tags are stripped entirely (no `window.print()`, no JAWR CSS
 *   loader, no cookie-consent modal firing during rendering);
 * - same-origin stylesheet `<link>`s become inline `<style>` blocks (dropped if
 *   the CSS can't be fetched, so no dead reference is left to fail offline);
 * - same-origin `<img>`s (the institution crests) become base64 data URIs.
 *
 * External (`http(s)://`) references are left untouched — only assets SIGAA
 * serves behind the session are inlined. CSS-internal `url(...)` references are
 * not rewritten (a known cosmetic gap: background icons may not render).
 */
export async function inlineSameOriginAssets(
  html: string,
  fetchAsset: AssetFetcher,
): Promise<string> {
  let out = html.replace(SCRIPT_PATTERN, '');

  out = await replaceAsync(out, LINK_PATTERN, async (tag) => {
    if (!/rel="stylesheet"/i.test(tag)) return tag;
    const href = HREF_PATTERN.exec(tag)?.[1];
    if (!href || !isSameOrigin(href)) return tag;

    const asset = await fetchAsset(href);
    if (!asset) return '';

    const media = MEDIA_PATTERN.exec(tag)?.[1];
    const mediaAttr = media ? ` media="${media}"` : '';
    return `<style${mediaAttr}>${decodeCss(asset)}</style>`;
  });

  out = await replaceAsync(out, IMG_PATTERN, async (tag) => {
    const src = SRC_PATTERN.exec(tag)?.[1];
    if (!src || !isSameOrigin(src)) return tag;

    const asset = await fetchAsset(src);
    if (!asset) return tag;

    const dataUri = `data:${asset.contentType};base64,${asset.bytes.toString('base64')}`;
    return tag.replace(SRC_PATTERN, `src="${dataUri}"`);
  });

  return out;
}

/** `String.replace` with an async replacer — resolved match-by-match. */
async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (match: string) => Promise<string>,
): Promise<string> {
  const matches = input.match(pattern);
  if (!matches) return input;

  const replacements = await Promise.all(matches.map(replacer));
  let index = 0;
  return input.replace(pattern, () => replacements[index++]);
}
