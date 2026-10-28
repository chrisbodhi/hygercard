// Small HTML string helpers shared by bake, ingest and export.

/**
 * Escape text for an HTML text node or a double-quoted attribute value. Five
 * characters, apostrophe included: that is what the reference implementation
 * emits, and §10.2 says only "escaped".
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// One start tag, with quoted attribute values allowed to contain `>`.
const START_TAG = /<[a-zA-Z][^\s/>]*(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;
const URL_ATTRIBUTE = /(\s)(href|src)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * A URL reference that is not absolute: no scheme, and not a bare `#fragment`.
 * An empty reference is relative too (RFC 3986: it names the base itself).
 */
function isRelative(url: string): boolean {
  return !url.startsWith("#") && !HAS_SCHEME.test(url);
}

/**
 * Make every `href` and `src` in `html` absolute against `base` (§5.2: "every
 * URL in it MUST be absolute"). A bare `#fragment` is left alone: it names a
 * place in the document it is read in, and there is no URL to give it.
 */
export function absolutizeHtml(html: string, base: string): string {
  return html.replace(START_TAG, (tag) =>
    tag.replace(URL_ATTRIBUTE, (whole, space: string, name: string, equals: string, dq?: string, sq?: string) => {
      const value = dq ?? sq ?? "";
      if (!isRelative(value)) return whole;
      let absolute: string;
      try {
        absolute = new URL(value, base).href;
      } catch {
        return whole;
      }
      return `${space}${name}${equals}"${absolute.replace(/"/g, "&quot;")}"`;
    }),
  );
}

/** The `href`/`src` values in `html` that are not absolute (for ingest's `relative-url` issue). */
export function relativeUrls(html: string): string[] {
  const found: string[] = [];
  for (const tag of html.match(START_TAG) ?? []) {
    for (const m of tag.matchAll(URL_ATTRIBUTE)) {
      const value = m[4] ?? m[5] ?? "";
      if (isRelative(value)) found.push(value);
    }
  }
  return found;
}

/** An item's page URL (§5.8): the document's `page` if it has one, else the reference convention. */
export function pageUrl(origin: string, kind: string, id: string, page?: string | null): string {
  if (page) return new URL(page, origin).href;
  return `${origin}${kind === "thread" ? "t" : "f"}/${id}/`;
}
