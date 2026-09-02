/**
 * The rich text a board card holds.
 *
 * A card's content column holds HTML. Everything that ever went into it before
 * was plain text, so anything without a tag is escaped on the way out rather
 * than migrated — there is nothing to migrate to.
 *
 * This lives outside any one board because two of them now edit cards the same
 * way — the Idea Workshop and the Case Board — and a sanitiser that exists
 * twice is a sanitiser that will diverge.
 */

const KEEP  = new Set(["B", "STRONG", "I", "EM", "U", "BR", "SPAN", "DIV", "P", "FONT"]);
const PURGE = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META"]);

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (node: Element) => {
    // Unwrapping promotes grandchildren to this level, so the pass repeats
    // until the level settles. It terminates: every unwrap loses a level.
    for (let changed = true; changed; ) {
      changed = false;
      for (const child of Array.from(node.children)) {
        if (PURGE.has(child.tagName)) { child.remove(); changed = true; continue; }
        if (KEEP.has(child.tagName)) continue;
        const parent = child.parentNode;
        if (!parent) continue;
        while (child.firstChild) parent.insertBefore(child.firstChild, child);
        parent.removeChild(child);
        changed = true;
      }
    }
    for (const child of Array.from(node.children)) {
      const el = child as HTMLElement;
      const color = el.style?.color || el.getAttribute("color") || "";
      for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
      if (color) el.style.color = color;
      clean(el);
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

export const escapeHtml = (text: string) =>
  text.replace(/[&<>]/g, ch => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));

export function contentToHtml(content: string): string {
  if (!content) return "";
  return /<[a-z][^>]*>/i.test(content)
    ? sanitizeHtml(content)
    : escapeHtml(content).replace(/\n/g, "<br>");
}

/** True when an editor holds nothing but formatting scaffolding. */
export function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

/** The plain words in a card, for search and for a one-line summary. */
export function htmlToText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}
