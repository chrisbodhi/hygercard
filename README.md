# hygercard

An interaction-prototyping harness for a native Blygger client: HyperCard meets
Xanadu's parallel streams. The centre stream is a thread draft being authored.
Side streams are imported blygs. Authoring is selecting text in a side stream
and dragging it into the centre, which writes transclusion directives into the
draft; connector bands show where each quote came from and what state it is in.

Two layers with different standards:

- **`src/core`** is a real implementation of the authoring-side constructs of
  the Blygger protocol, pinned to one commit of the spec ([SPEC_PIN.md](SPEC_PIN.md)).
  It is pure TypeScript meant to be ported to Swift. Correctness matters here.
- **`src/variants`** is disposable.

## Running

```sh
bun install
bun run dev            # vite --host; the iPad opens http://<this machine's LAN IP>:5173
```

Open `?variant=columns-baseline` (or pick it in the header). Fixtures load by
default; the header's **data** switch loads live data instead (below).

| | |
|---|---|
| `bun test` | core, feeds, harness and fixture tests (runtime-agnostic, under bun) |
| `bun run test:browser` | DOM tests in Vitest browser mode, in Chromium and WebKit |
| `bun run typecheck` | the app, scripts and tests, and `src/core` on its own, with no DOM lib |
| `bun run check:core` | the core-purity check alone (it also runs under `bun test`) |
| `bun run snapshot` | capture fixtures (below) |
| `bun run build` | production build |

`src/core` imports nothing from React, the DOM, `fetch`, `src/feeds` or
`src/harness`. Two checks enforce it, both in `src/core/purity.test.ts`: an
import scan, and the core `tsconfig.json`, which has no DOM lib and no Node
types, so `document`, `window`, `fetch` or `process` fail to compile. The test
was run against a deliberately planted `document.title` to confirm it bites.

### Live data

The header's **data → live** switch resolves a URL you give it through §12 and
reads its manifest, archive index and newest items. Origins that don't serve
CORS are read through a dev-only proxy, `/__proxy?url=…`, in `vite-proxy.ts`.
`vite --host` puts the dev server on the LAN, so the proxy is deliberately not
an open one: GET only, http(s) only, same-origin callers only (`Sec-Fetch-Site`),
and private, loopback and link-local addresses are refused on every redirect
hop. A DNS answer that changes between the check and the fetch is not defended
against; that is acceptable for a local prototyping tool and for nothing else.
There are no network writes anywhere in the repo.

## Layout

```
SPEC_PIN.md          the spec commit this implements, and the reference client consulted
src/core/            pure TS: ids, hash, grammar, textContent, store, resolve, bake, draft, anchors, export
src/feeds/           fetch allowed, no React: resolveUrl (§12), surface, read, live, l0, fixtures, findings
src/harness/         registry, variant contract, Harness.tsx, events, keymap, overlay/, domText, sanitize
src/variants/        columns-baseline (the reference variant), hello (the smallest one)
scripts/snapshot.ts  bun run snapshot
fixtures/            captured blyg surfaces, committed
test-browser/        Vitest browser-mode tests
```

## Adding a variant

Create `src/variants/<id>/index.tsx` that default-exports `defineVariant({...})`.
A glob finds it; nothing else is edited. Copy `src/variants/hello`, which is
the whole contract in under 50 lines:

```tsx
import { defineVariant, type VariantProps } from "../../harness/variant";

const schema = { size: { value: 14, min: 10, max: 32, step: 1 } };   // knobs, as plain data

function MyVariant({ knobs, store, keymap, emit }: VariantProps<typeof schema>) { /* … */ }

export default defineVariant({ id: "mine", name: "mine", description: "…", knobs: schema, Component: MyVariant });
```

A variant receives its current `knobs`, the `store` of snapshots, the `keymap`
(Emacs notation: `keymap.bind("C-/", "undo", handler)` returns an unbinder), and
`emit` for the event log. Knobs are declared as data (a number with min/max/step,
a boolean, or a string with `options`), so no variant imports the knobs library.
Knob values persist per variant in `localStorage`, guarded by try/catch; the URL
holds the variant (`?variant=<id>`).

The overlay in `src/harness/overlay` is there to reuse: `rangeRects(range, root)`,
`EndpointTracker`, `Bands`. `src/harness/domText.ts` maps a DOM selection to
offsets into a rendered item's §10.2 text content, and back.

## The reference variant, `columns-baseline`

Two imported blygs, each chosen by a picker, as cards (sanitized `content_html`,
no title, a meta line of kind, version and updated date) either side of the draft,
which is rendered as the bake preview with a toggleable raw `content_md` pane that
highlights the lines the last gesture wrote.

- **Whole quote**: drag a card's handle `⠿` to the draft.
- **Partial quote**: select text within one card, then drag the `⠿ quote selection`
  handle that appears at the end of the selection. A selection that spans several
  cards is rejected with the reason in the status line; one inside a plain RSS (L0)
  card is rejected as unquotable; one inside a baked nested quote is allowed (it is
  still a substring of the outer item's text content) and logs
  `selection.nested-quote`.
- **Drops land on block boundaries only.** A drop over the middle of a paragraph
  snaps to the nearest boundary and the indicator shows which. Dragging a draft
  block's handle reorders it the same way. Esc cancels a drag.
- **Undo / redo**: `C-/` and `C-?`. **Export item document** downloads the thread's
  JSON, and refuses a draft that has publish errors.
- **Bands** run from each quote's source (the located passage of a partial quote,
  or the whole card) to its block. A source scrolled out of its column is pinned to
  that column's edge with a chevron. Knobs: column widths, band curvature, band
  opacity, drag threshold, and visibility (always / on hover / by state).
- **Errors** show on the block that caused them. `bake.result` logs them by block.

**Band states in a draft.** A draft re-bakes against the store on every change
(the preview "resolves directives against the local snapshot store"), so the
reference it bakes is always the newest one and could never be stale. A band
therefore compares the store with the version the author last *saw*, which the
variant keeps beside `content_md` (the directive carries no version, by the
grammar). `refresh quotes` accepts the newer versions, as republishing
re-resolves every directive (§10.2). A quote whose bake fails still has a state
from that record: `drifted` (the selector no longer matches), `withdrawn`, or
`missing`, each shown as an error on its block and a chip.

## Snapshotting

```sh
bun run snapshot [--limit-items N] [--origin URL ...] [--out DIR]
```

Default sources are every `xmlUrl` in <https://blygger.com/blygs.opml> (§11: a
consumer resolves an entry's `xmlUrl` through §12) plus <https://newschematic.org/blyg/>,
newest `N` (default 40) items each by the archive index. `--origin` replaces the
defaults and merges into the existing `fixtures/index.json`.

Each source is resolved with §12 steps 1–6 inside a budget of 6 fetches and 5
bounded redirects, identity origin per §12.2. Politeness: at most 4 concurrent
requests per host, a `hygercard/0.1.0` User-Agent, 15 s timeouts, an 8 MB size
limit; every failure is recorded as an issue and none aborts the run. It writes
`fixtures/{slug}/blyg.json`, `items/index.json` and `items/{id}.json` (an L0 source
writes `l0.json`), and `fixtures/index.json` records what was captured, when,
the §12 resolution trail, and every issue found.

The committed fixtures are 26 sources: 25 blygs (693 items, 315 fragments and 378
threads, from 16 distinct `generator` strings across 14 generator names) and one real plain-RSS feed
(`simonwillison.net/atom/everything/`, 10 entries), which I added with `--origin`
so the variant has an L0 source to mark. The OPML had none. The index says 21
issues; current ingest finds 22, because one empty `href=""` was counted as
relative only after I corrected `isRelative` (an empty reference is relative,
RFC 3986). I did not re-capture to reconcile them.

## Dependency choices

Named in the brief: React 19, Vite, TypeScript (`strict`, `noUncheckedIndexedAccess`),
bun, Motion, Vitest, and the pre-approved libraries.

- **Leva, not Tweakpane.** Both are quiet. Leva's last release is 0.10.1 (Oct 2025)
  with commits through Nov 2025 and peers on React 18/19; Tweakpane's last release
  is 4.0.5 (Nov 2024), with only housekeeping commits since, and no React
  binding. The harness is React, so Leva's hook fits. Treat both as low-activity.
- **markdown-it, not micromark.** The grammar needs CommonMark's own answers about
  what is code and where a blockquote ends (lazy continuation included), and
  markdown-it's block parser reports source line ranges (`token.map`) directly,
  where micromark's positions need mdast tooling on top. The reference client also uses it, so a
  draft's prose bakes to the same bytes. markdown-it 15 turned `linkify`'s fuzzy
  links off; the reference runs 14, so `markdown.ts` turns them back on.
- **htmlparser2, not parse5.** Text content needs a stream of text and block
  boundaries, not a tree, so a SAX parser suffices, runs unchanged in bun and the
  browser, and decodes every entity. parse5 would repair malformed HTML exactly as
  a browser does; a browser test shows the two agree on all 693 real items
  (the DOM walk in `domText.ts` against htmlparser2 over the sanitized HTML).
- **fast-xml-parser** for OPML and RSS/Atom detection; the reference uses it.
- **DOMPurify** at render. `FORBID_TAGS` includes `style` and form controls, so
  imported markup cannot restyle the page.
- **diff-match-patch** for `anchors.ts` fuzzy matching only.
- RFC 6570 level-1 expansion and SHA-256 are hand-rolled (`surface.ts`, `hash.ts`).
  SHA-256 is synchronous because `crypto.subtle` is undefined on an insecure
  origin, which is where the iPad reaches the dev server; it is cross-checked
  against `node:crypto`.

**Added beyond the named list** (flagging, per "ask before adding anything else";
all are implied by the stack but not named): `@vitejs/plugin-react`,
`@vitest/browser` and `@vitest/browser-playwright` (Vitest 5 ships the Playwright
provider separately), `playwright`, and type-only packages `@types/react`,
`@types/react-dom`, `@types/markdown-it`, `@types/diff-match-patch`, `@types/bun`,
`@types/node`.

## Spec interpretation notes

Where §10.2 and §5 leave a byte or a boundary open, I followed the reference
implementation, because you asked for it to settle exactly these. Each is a place
to ask the spec author.

1. **Text content.** "Tags stripped, whitespace collapsed within a block, block
   boundaries kept as line breaks" is all the spec says. Core's rules
   (`textContent.ts`): entities decoded, numeric ones included; `<script>` and
   `<style>` contribute nothing; a boundary at the *end* of `p h1–h6 li blockquote
   pre div tr section article` and at every `<br>`; whitespace is JS `\s`; blocks
   are trimmed, empty ones dropped, the rest joined with `\n`.
   **Open question:** text directly before a block element (`Ask Claude<ul>…`)
   welds to the first item, because only block *ends* break. Breaking at block
   *starts* too is equally literal to "block boundaries". I measured it: the two
   readings give different text content for 16 of 693 real items, and all 18
   checkable real selectors pass under both, so nothing yet decides it.
2. **Bake whitespace is not normative.** §10.2's illustration shows indentation and
   newlines. Real publishers differ: of 278 baked wrappers, 215 put a newline after
   the opening tag (the reference's convention, which I emit) and 63 do not, and 7
   write `data-blyg-origin` before `data-blyg-version`. I emit class, id, version,
   origin, label; `\n` after the open tag and before the close; partial content as
   one `<p>` per line, joined by `\n`. Escaping is `& < > " '` (apostrophe too).
   "Byte for byte" therefore means the reference's bytes; no reader may depend on them.
3. **Parts are joined with `\n`, and blank lines between quotes count.** The
   reference splits `content_md` into prose chunks and quotes; a blank gap between
   two quotes, or a trailing newline after the last, is a chunk that renders to
   nothing but still takes its place in the join. I emulate this so a thread it
   published re-bakes to its bytes (see findings).
4. **A partial selection is the text content of the blockquote, rendered.** The
   quote's markdown (with its lazy lines) is rendered and normalized by the same
   function that normalizes the target, so `**bold**` in the quote is the text
   `bold`. Writing a selection into `>` lines escapes markdown punctuation
   (`*`, `_`, `#`, `[`, a leading `-` or `1.`, …) and verifies the round trip,
   falling back to escaping every ASCII punctuation mark.
5. **Directives are found by asking the renderer.** Whether `![[id]]` is inside
   code is decided by substituting a placeholder for each candidate and seeing
   whether markdown-it puts it inside a code token, so escaped backticks, fences in
   list items and spans across lines are the parser's call. A lone CR is not a line
   ending (§10.1: LF or CRLF); the parser sees it as an ordinary character.
6. **Ids.** Validation is the grammar's (26 characters of the alphabet).
   Generation is stricter, as §5.1 implies: 128 bits in 26 characters, so the first
   character is `0`–`7`. A reader that rejected a first character above 7 would be
   inventing a rule.
7. **Resolution and local ids.** Items stored under the draft's origin are local.
   A local id (draft or published) never falls through to imported items, and a
   directive naming an id held both locally and by an import is an error (decision
   #76). The closure check walks each local thread's *current* `transclusions[]`,
   where the spec says the versions actually baked; the store holds one version.
8. **Absolute URLs** are made by rewriting `href` and `src` only (§5.2: "anything an
   `href` or `src` can carry"); `srcset`, `poster`, `cite` and CSS URLs are not.
   An empty reference is relative; a bare `#fragment` is left alone, since there is
   no URL to give it.
9. **Export.** The draft is exported as version 1, published at its `created`
   instant: `updated` equals it, the changelog has the one entry, `page` is
   `t/{id}/` (the reference convention), the origin defaults to
   `http://localhost:5173/blyg/`, and every reference carries `origin`.
   `cited` is **OPTIONAL per §5.9 and is emitted here**, with `retrieved` set to
   the publish instant ("frozen at the moment the reference was made"), `source`
   from the manifest title, `author` from `author.name`, and `url` from the target's
   page. There is no `excerpt`: verbatim quotation is transclusion alone.
   An export with publish errors is refused.
10. **`[[id]]` anchor text** with no label is the target's leading heading, else a
    quoted excerpt of it; the spec leaves it to the publisher.
11. **Stubs, forks, `generated`** are parsed and preserved only: ingest keeps
    documents verbatim, unknown members included, and there is no gesture for them.
    `![[id@vN]]` is its own `reserved` block that bake rejects, as §10.1 requires.
12. **L0 rows** have synthetic ids (`l0:` plus a hash of the GUID), which are never
    valid blyg ids, and are never targets.

## Disagreements with the reference implementation

blygger-studio 0.48.2 (`b93ac12`), MIT-licensed; no code was copied, the rules
were re-implemented. Where it disagrees with the spec, the spec wins here.
"Tested" means observed on real data; "read" means from reading its source, not run.

| | Spec | Studio | Evidence |
|---|---|---|---|
| Directive label | §10.2 / decision #81: a labelled directive bakes `data-blyg-label` | never bakes it; `grammar.ts` says a label "never reaches the bake" and the string appears nowhere in the repo | **tested**: 2 of 91 comparable studio threads differ only by this attribute. 5 fixture items have a labelled directive in `content_md` and none of 278 wrappers carries the attribute. A thread on blyg.blygger.org says the label "is now baked", so this may be newer than the pinned commit |
| Partial blockquote extent | §10.1: CommonMark's, lazy continuation included | `attachedQuote` takes only lines that start with `>` | read |
| Numeric character references | the selection is text | `decodeEntities` decodes a fixed list of named entities, not `&#8217;` or `&#x2014;` | read |
| A local id that an import shares | §10.2 (decision #76): a publish error | `resolveTarget` returns the local item without looking at imports | read |
| Code spans | §10.1: inert inside code spans | its own backtick scanner, which ignores backslash escapes | read |
| Absolute URLs | §5.2: every URL | leaves `//host/x` alone and rewrites double-quoted attributes only | read |
| Writing a selection into a quote | the quote's text must equal the selection | `quoteLines` writes `> ` + the text unescaped, so `*` or `_` in a selection renders as emphasis and the publish check fails | read |

## Conformance findings from the real fixtures

All of these run on every `bun test` (`src/feeds/fixtures.test.ts`).

- **Grammar.** `serialize(parse(content_md)) === content_md` for all 693 items.
- **Ids and hashes.** No malformed ids and no `content_hash` mismatches, against an
  independent `node:crypto` computation. (The check also proves our reader reports
  exactly the set an independent check finds.)
- **Partial selectors (§10.2).** 34 thread entries carry a `selector`. For the 18
  whose target is in the fixtures at the referenced version, `selector.exact` is a
  substring of the target's text content in every case. 14 targets are not in the
  fixtures (the 40-item window, or another origin), and 2 are at a newer version.
  A one-off check, not committed, fetched those 16 live: 13 more passed, and 3 point
  at versions that have since been replaced (the "window closes" case in §10.2).
  Zero failures, so no finding against core or a publisher.
- **Re-baking the reference's threads.** For the 218 studio-published threads: 67
  carry generated spans (`blyg-tk-gen`, §5.7, preserve-only), 50 quote items outside
  the fixtures and 10 quote other versions. Of the 91 comparable, **89 re-bake to the
  published `content_html` byte for byte**, and 2 differ only by the label
  attribute above. `transclusions[]`, selectors and their 32-character context
  included, match for all 91.
- **Sanitizing never changed the text.** For all 693 items, the rendered DOM's text
  content equals the stored item's.
- **Publishers.** `blyg.jdbb.net` writes `"origin": " https://blyg.jdbb.net/"`, with
  a leading space, in all 18 items (`origin-mismatch`; we scope to the fetch origin,
  §12.2). `artlu.xyz` leaves three relative `href`s (`/path`) in `content_html`, and
  one protocol-institute item has `href=""` (§5.2). Manifests claim `0.3` (12) and
  `0.4` (13), and items `0.3` (302) and `0.4` (391).
- **The ecosystem is diverse**: 16 generator strings (14 names), among them `blygger-studio`,
  `hugo-blyg`, `soapbox-for-blygger` (WordPress, with a relocated surface),
  `goddinpotty-blyg` (whose HTML is wrapped in `<div>`s), `sig-p4b-blyg` and
  `Blynger`. None of the 693 items carries `links[]`.

## iOS and iPad Safari

**I could not test any of this on a device**; this section is what the code is
built to do and what I expect to be awkward. Verified: desktop Chromium and WebKit
(Playwright's, the closest thing to desktop Safari available here) through the
browser-mode tests, and Chromium by hand through DevTools. WebKit is not Safari.

Built for it:

- Pointer events throughout (including a test with `pointerType: "touch"`), handles
  have `touch-action: none` and `user-select: none`, and pointerdown on the
  selection handle is cancelled so it does not clear the selection it is about to quote.
- The selection handle is a separate floating element, placed from the selection's
  rect, instead of anything that relies on the native callout.
- No `crypto.subtle` (undefined over http), and "copy as JSON" falls back to
  `execCommand`, because `navigator.clipboard` needs a secure context.

Expected to be awkward, and not yet seen:

- iOS draws its own selection handles and callout, which may overlap `⠿ quote
  selection`, which sits just below the end of the selection.
- iOS can start a native drag of selected text. If it wins over our pointer events
  on the handle, the drag will not begin.
- `selectionchange` is debounced at 120 ms; while the native handles are dragged the
  selection is rewritten continuously, so the quote handle may flicker.
- Auto-scroll of the draft while dragging runs only on pointer movement.
- A long draft puts the last drop zone off screen; scroll the draft or hold the
  pointer near its edge.
- Desktop Safari has not been tried at all, only WebKit.

## Not done, by design

No visual polish or design system; no publishing, Webmention or network writes; no
`feed.xml` reading (the state plane is the content source; L0 sources are the one
place a feed is read as content, since they have none); no stub, fork or link
gestures. Core parses and preserves those constructs.
