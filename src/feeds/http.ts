// Fetching. Two implementations of one small interface:
//
//   politeFetcher   for scripts and the dev proxy (bun / node): an identifying
//                   User-Agent, timeouts, a size limit, followed redirects that
//                   are counted and bounded (§12.2), and at most N concurrent
//                   requests per host.
//   browserFetcher  for the page itself, which cannot see redirects or set a
//                   User-Agent, and which only works against origins that serve CORS.
//
// Reads only. Nothing in this repo makes a network write.

export interface FetchResult {
  /** The final URL, after redirects. Subscription identity is derived from it (§12.2). */
  url: string;
  status: number;
  contentType: string | null;
  text: string;
  redirects: number;
}

/** Resolves for any HTTP response, 404 included; rejects when there is no usable response at all. */
export type Fetcher = (url: string) => Promise<FetchResult>;

export class FetchError extends Error {
  constructor(
    public readonly url: string,
    message: string,
  ) {
    super(message);
  }
}

export interface PoliteOptions {
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  perHost?: number;
  fetch?: typeof fetch;
}

export const USER_AGENT = "hygercard/0.1.0 (+read-only snapshot for interaction prototyping)";

export function politeFetcher(options: PoliteOptions): Fetcher {
  const { userAgent, timeoutMs = 15_000, maxBytes = 8_000_000, maxRedirects = 5, perHost = 4 } = options;
  const doFetch = options.fetch ?? fetch;
  const hosts = new Map<string, { active: number; waiting: Array<() => void> }>();

  const acquire = async (host: string) => {
    const slot = hosts.get(host) ?? { active: 0, waiting: [] };
    hosts.set(host, slot);
    if (slot.active >= perHost) await new Promise<void>((wake) => slot.waiting.push(wake));
    slot.active++;
    return () => {
      slot.active--;
      slot.waiting.shift()?.();
    };
  };

  return async (start) => {
    let url = start;
    for (let redirects = 0; ; redirects++) {
      const release = await acquire(new URL(url).host);
      try {
        const response = await doFetch(url, {
          redirect: "manual",
          headers: { "user-agent": userAgent, accept: "application/json, application/xml, text/html;q=0.9, */*;q=0.5" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          if (redirects >= maxRedirects) throw new FetchError(start, `more than ${maxRedirects} redirects`);
          url = new URL(location, url).href;
          continue;
        }
        return {
          url,
          status: response.status,
          contentType: response.headers.get("content-type"),
          text: await readLimited(response, maxBytes, url),
          redirects,
        };
      } catch (error) {
        if (error instanceof FetchError) throw error;
        throw new FetchError(start, error instanceof Error ? error.message : String(error));
      } finally {
        release();
      }
    }
  };
}

async function readLimited(response: Response, maxBytes: number, url: string): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) throw new FetchError(url, `response is ${length} bytes; the limit is ${maxBytes}`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchError(url, `response is larger than the ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Direct browser fetching. `response.url` is the final URL; redirects cannot be
 * counted from here, so the bound is the browser's own.
 */
export function browserFetcher(timeoutMs = 15_000): Fetcher {
  return async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return {
        url: response.url || url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        text: await response.text(),
        redirects: 0,
      };
    } catch (error) {
      throw new FetchError(url, error instanceof Error ? error.message : String(error));
    }
  };
}

/**
 * Fetching through the dev server's proxy (vite-proxy.ts), for origins that do
 * not serve CORS. The proxy follows redirects server-side and reports the final
 * URL and redirect count in headers.
 */
export function proxyFetcher(timeoutMs = 20_000): Fetcher {
  return async (url) => {
    try {
      const response = await fetch(`/__proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.headers.get("x-proxy-error")) throw new FetchError(url, response.headers.get("x-proxy-error")!);
      return {
        url: response.headers.get("x-final-url") ?? url,
        status: Number(response.headers.get("x-upstream-status") ?? response.status),
        contentType: response.headers.get("content-type"),
        text: await response.text(),
        redirects: Number(response.headers.get("x-redirects") ?? 0),
      };
    } catch (error) {
      if (error instanceof FetchError) throw error;
      throw new FetchError(url, error instanceof Error ? error.message : String(error));
    }
  };
}
