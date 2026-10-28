// §13.6: a plain RSS feed is imported as summary items plus links, best-effort.
// The only place the feed is read as content, because an L0 source has no state plane.

import { XMLParser } from "fast-xml-parser";
import { contentHash, sha256Hex, utf8 } from "../core/hash";
import { escapeHtml } from "../core/html";
import type { ItemDocument } from "../core/types";
import { textContent } from "../core/textContent";

const XML = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true });

const SUMMARY_LIMIT = 280;

const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value) return String((value as { "#text": unknown })["#text"]);
  return "";
}

function iso(date: string): string {
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? new Date(0).toISOString().replace(".000", "") : new Date(parsed).toISOString().replace(".000", "");
}

/**
 * Wrap a feed's entries as L0 rows. The id is synthetic, derived from the GUID
 * (or the link), and is never a valid blyg id: `l0:` and a hash, which no id
 * contains. Content is the title linking to the entry plus a truncated plain
 * summary; it is stored as-is and sanitized when rendered, like everything fetched.
 */
export function wrapFeed(feedUrl: string, feed: string, limit = 40): { title: string; items: ItemDocument[] } {
  const tree = XML.parse(feed) as Record<string, any>;
  const channel = tree.rss?.channel;
  const atom = tree.feed;

  const entries: Array<{ guid: string; title: string; link: string; summary: string; date: string }> = channel
    ? asArray(channel.item).map((item: any) => ({
        guid: text(item.guid) || text(item.link),
        title: text(item.title),
        link: text(item.link),
        summary: text(item.description),
        date: text(item.pubDate),
      }))
    : asArray(atom?.entry).map((entry: any) => {
        const links = asArray(entry.link);
        const alternate = links.find((l: any) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
        return {
          guid: text(entry.id) || (alternate?.["@_href"] ?? ""),
          title: text(entry.title),
          link: alternate?.["@_href"] ?? "",
          summary: text(entry.summary) || text(entry.content),
          date: text(entry.updated) || text(entry.published),
        };
      });

  const items = entries.slice(0, limit).map((entry): ItemDocument => {
    const id = `l0:${sha256Hex(utf8(entry.guid)).slice(0, 26)}`;
    const title = entry.title || entry.link || "(untitled)";
    const summary = textContent(entry.summary).replace(/\n/g, " ");
    const clipped = Array.from(summary).length > SUMMARY_LIMIT ? Array.from(summary).slice(0, SUMMARY_LIMIT).join("").trimEnd() + "…" : summary;
    const link = entry.link ? `<a href="${escapeHtml(entry.link)}">${escapeHtml(title)}</a>` : escapeHtml(title);
    const contentMd = `${entry.link ? `[${title}](${entry.link})` : title}${clipped ? `\n\n${clipped}` : ""}`;
    const when = iso(entry.date);
    return {
      blyg: "L0",
      id,
      kind: "fragment",
      origin: feedUrl,
      version: 1,
      created: when,
      updated: when,
      content_md: contentMd,
      content_html: `<p>${link}</p>${clipped ? `<p>${escapeHtml(clipped)}</p>` : ""}`,
      content_hash: contentHash(contentMd),
      changelog: [{ version: 1, at: when, note: null }],
      media: [],
      ...(entry.link ? { page: entry.link } : {}),
    };
  });

  const title = text(channel?.title) || text(atom?.title) || feedUrl;
  return { title, items };
}
