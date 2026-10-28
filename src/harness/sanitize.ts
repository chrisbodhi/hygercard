// Fetched `content_html` is stored verbatim and sanitized here, at render (§14).
// A nested snapshot is never assumed to have been sanitized by anyone.

import DOMPurify from "dompurify";

// Links open elsewhere and carry no opener.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Imported markup must not restyle this page or reach for form controls.
    FORBID_TAGS: ["style", "form", "input", "button", "select", "textarea"],
    FORBID_ATTR: ["style"],
  });
}
