import * as iconv from 'iconv-lite';
import {
  SigaaHttpClient,
  SigaaHttpRequest,
  SigaaHttpResponse,
} from './session';
import { withRetry } from './retry';

export const SIGAA_BASE_URL = 'https://sigaa.ufba.br';
const BASE_URL = SIGAA_BASE_URL;

/**
 * O fetch do Node se anuncia como `node` e não manda mais nada. Isso é a
 * assinatura mais fácil de barrar numa regra de borda, e quando ela é barrada o
 * SIGAA devolve a página de login — que, do lado de cá, era lido como senha
 * errada. Ir com a cara de um navegador não é disfarce: é mandar os mesmos
 * cabeçalhos que o formulário que estamos preenchendo mandaria.
 */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

export class SigaaRateLimitedError extends Error {
  constructor() {
    super('SIGAA responded with 429 (rate limited)');
    this.name = 'SigaaRateLimitedError';
  }
}

export function decodeIso88591(buffer: ArrayBuffer): string {
  return iconv.decode(Buffer.from(buffer), 'ISO-8859-1');
}

export function encodeFormBody(fields: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    params.append(key, value);
  }
  return params.toString();
}

/**
 * Real SIGAA HTTP client: plain fetch, no cookie jar auto-management (SigaaSession
 * owns the JSESSIONID/ViewState state machine and passes the cookie explicitly on
 * every request), decoding every response as ISO-8859-1 per the spike's findings.
 */
export function createSigaaHttpClient(
  baseUrl: string = BASE_URL,
): SigaaHttpClient {
  return {
    async request(req: SigaaHttpRequest): Promise<SigaaHttpResponse> {
      // Retry once with backoff on network failures/timeouts; a 429 also gets a
      // single backed-off retry (per the error-handling table — no volume testing
      // done yet, so we don't attempt more than that automatically).
      return withRetry(
        async () => {
          const headers: Record<string, string> = { ...BROWSER_HEADERS };
          if (req.cookie) headers['Cookie'] = req.cookie;
          if (req.body) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            // Um POST de formulário que chega sem Referer/Origin do próprio
            // site é o padrão mais barato de barrar numa regra de borda.
            headers['Origin'] = baseUrl;
            headers['Referer'] = `${baseUrl}${req.referer ?? req.path}`;
          }

          const response = await fetch(`${baseUrl}${req.path}`, {
            method: req.method,
            headers,
            body: req.body ? encodeFormBody(req.body) : undefined,
            redirect: 'manual',
          });

          if (response.status === 429) {
            throw new SigaaRateLimitedError();
          }

          const buffer = await response.arrayBuffer();

          return {
            status: response.status,
            headers: {
              location: response.headers.get('location') ?? '',
              'set-cookie': response.headers.get('set-cookie') ?? '',
              'content-type': response.headers.get('content-type') ?? '',
            },
            body: decodeIso88591(buffer),
            bodyBuffer: Buffer.from(buffer),
          };
        },
        { retries: 1, backoffMs: 1000 },
      );
    },
  };
}
