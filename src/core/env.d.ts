// The only runtime globals core reaches for. Both are web-standard, present in
// browsers, bun, node and workers, and neither is a DOM API, so they are
// declared here instead of pulling the DOM lib into the purity gate.

declare const crypto: {
  getRandomValues<T extends Uint8Array | Uint16Array | Uint32Array>(array: T): T;
};

declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
  readonly origin: string;
  readonly protocol: string;
  readonly host: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}
