// A dev-only read proxy for the live-data toggle: GET /__proxy?url=<url>.
// Origins that do not serve CORS cannot be read from the page directly; the dev
// server fetches them instead, with the polite fetcher.
//
// `vite --host` exposes this server on the LAN, so the proxy is deliberately not
// an open one:
//   - GET only, http(s) only;
//   - same-origin callers only (Sec-Fetch-Site), so another website cannot
//     drive it from the user's browser, and no CORS headers are sent;
//   - private, loopback and link-local addresses are refused, redirect hops
//     included (§14). A hostname is resolved before it is fetched; a DNS answer
//     that changes between the check and the fetch is not defended against, which
//     is acceptable for a local prototyping tool and not for anything else.

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { Plugin } from "vite";
import { FetchError, politeFetcher, USER_AGENT } from "./src/feeds/http";

const PRIVATE = new BlockList();
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) PRIVATE.addSubnet(net, prefix, "ipv6");

async function refusePrivate(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError(url.href, `refused: ${url.protocol} is not http(s)`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const { address, family } of addresses) {
    // An IPv4-mapped IPv6 address is the IPv4 address it wraps.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    const [ip, kind] = mapped ? [mapped[1]!, "ipv4" as const] : [address, family === 6 ? ("ipv6" as const) : ("ipv4" as const)];
    if (PRIVATE.check(ip, kind)) throw new FetchError(url.href, `refused: ${url.hostname} resolves to a private address`);
  }
}

export function blygProxy(): Plugin {
  const fetcher = politeFetcher({ userAgent: USER_AGENT, check: refusePrivate });
  return {
    name: "blyg-read-proxy",
    configureServer(server) {
      server.middlewares.use("/__proxy", async (req, res) => {
        const fail = (status: number, message: string) => {
          res.statusCode = status;
          res.setHeader("x-proxy-error", message.replace(/[^\x20-\x7e]/g, "?"));
          res.end(message);
        };
        if (req.method !== "GET") return fail(405, "GET only");
        const site = req.headers["sec-fetch-site"];
        if (site !== undefined && site !== "same-origin") return fail(403, "same-origin callers only");
        let target: URL;
        try {
          target = new URL(new URL(req.url ?? "", "http://proxy.invalid").searchParams.get("url") ?? "");
        } catch {
          return fail(400, "missing or invalid ?url=");
        }
        try {
          const result = await fetcher(target.href);
          res.statusCode = 200;
          res.setHeader("content-type", result.contentType ?? "text/plain; charset=utf-8");
          res.setHeader("x-final-url", result.url);
          res.setHeader("x-upstream-status", String(result.status));
          res.setHeader("x-redirects", String(result.redirects));
          res.end(result.text);
        } catch (error) {
          fail(502, error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}
