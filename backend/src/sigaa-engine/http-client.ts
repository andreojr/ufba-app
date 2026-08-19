import * as iconv from 'iconv-lite';
import {
  SigaaHttpClient,
  SigaaHttpRequest,
  SigaaHttpResponse,
} from './session';
import { withRetry } from './retry';

export const SIGAA_BASE_URL = 'https://sigaa.ufba.br';
const BASE_URL = SIGAA_BASE_URL;

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
          const headers: Record<string, string> = {};
          if (req.cookie) headers['Cookie'] = req.cookie;
          if (req.body)
            headers['Content-Type'] = 'application/x-www-form-urlencoded';

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
