# Spec pin

This repo implements the Blygger protocol **at one fixed commit** of the spec.
The spec is pre-1.0 and revised often, so nothing here tracks `main`.

| | |
|---|---|
| Repository | https://github.com/blygger/blygger-spec |
| Document | `docs/protocol-v0.4.md` |
| **Commit** | `443f88ad0c5ea2a4d4e143c6641d02e3e18f7c3a` |
| Commit date | 2026-10-20T22:36:36-05:00 |
| Commit subject | DEVLOG session 52: end time |
| Document last changed | 2026-10-20T17:13:27-05:00 (sixth revision of 0.4) |
| SHA-256 of `docs/protocol-v0.4.md` | `ae818bf90c0071700297cffd360f7ecf1b1e803c001dc3ecbbbe47e83966782b` |

To check that a clone matches the pin:

```sh
git clone https://github.com/blygger/blygger-spec.git
git -C blygger-spec checkout 443f88ad0c5ea2a4d4e143c6641d02e3e18f7c3a
shasum -a 256 blygger-spec/docs/protocol-v0.4.md
```

## Sections implemented

§4–§6 (surface, item document, manifest, archive index), §5.1 (ids,
`content_hash`), §5.3 (kinds), §5.9 (the reference shape), §10.1 (grammar),
§10.2 (resolution, bake, partial transclusion, text content), §10.3 and §10.3a
(provenance, `links[]`), §10.6 (stubs: parse and preserve only), §12
(resolution from URL to subscription), §13.1 (reader ground rules), §14 (HTML
safety).

## Reference implementation consulted

Used only to resolve ambiguity (text-content normalization and exact bake
bytes). Where it disagrees with the spec, the spec wins; every disagreement is
listed in the README.

| | |
|---|---|
| Repository | https://github.com/blygger/blygger-studio |
| Commit | `b93ac12fb6c2abb9a2a0c3eaa9c764041c55f228` (0.48.2) |
| Licence | MIT (Copyright (c) 2026 Venkatesh Rao). No code is copied; behaviour is re-implemented from the rules it documents. |

## Moving the pin

1. Read the revision history (§17) between the old commit and the new one.
2. Change the commit and hash above.
3. Re-run `bun test`; re-run `bun run snapshot` only if the surface changed.
4. Update the README's interpretation notes and disagreement list.
