/**
 * WebDAV XML — a small, namespace-agnostic reader.
 *
 * There is no XML parser in this repo and no way to add one: the cloud sandbox
 * cannot reach the npm registry, and a dependency added under `electron/` has
 * to survive esbuild's CJS output, which is a failure that only appears at
 * `npm run desktop:build` after everything is written.
 *
 * That turns out to be fine, because DAV responses are a narrow, machine-
 * generated dialect. What they are *not* is prefix-stable: the same element is
 * `<D:href>` from one server, `<d:href>` from another, `<x0:href>` from a third
 * and `<href>` under a default `xmlns`. So this reader **matches on local names
 * only** and ignores namespaces entirely. In a `multistatus` the chance of two
 * different namespaces colliding on one local name is negligible, and the
 * alternative is a namespace-resolving parser several times this size.
 *
 * Attributes are kept because `supported-calendar-component-set` carries the
 * one fact that decides whether a collection can hold events at all:
 * `<C:comp name="VEVENT"/>`. iCloud returns Reminders lists, the inbox, the
 * outbox and notification collections in the same 207, and a VEVENT PUT into a
 * VTODO collection is a 403.
 */

export interface XmlNode {
  /** Local name, lower-cased. Namespace prefix discarded. */
  name: string;
  /** Attribute local names, lower-cased. */
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Direct text content of this element, entity-decoded. */
  text: string;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

function localName(qname: string): string {
  const colon = qname.lastIndexOf(":");
  return (colon === -1 ? qname : qname.slice(colon + 1)).toLowerCase();
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#34": '"',
};

export function decodeEntities(s: string): string {
  return String(s ?? "").replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    const key = body.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key.startsWith("#x")) {
      const code = parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (key.startsWith("#")) {
      const code = parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/** Index of the `>` closing a tag, skipping any inside quoted attributes. */
function tagEnd(s: string, from: number): number {
  let quote = "";
  for (let i = from; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ">") return i;
  }
  return -1;
}

function parseAttrs(inner: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/<>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    attrs[localName(m[1])] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * Parse a document into a tree, returning the root element.
 *
 * Tolerant by design: an unclosed tag, a stray close, or trailing junk yields
 * whatever was understood rather than throwing. A sync cycle that dies on one
 * malformed response is worse than one that skips it.
 */
export function parseXml(xml: string): XmlNode | null {
  const s = String(xml ?? "");
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let i = 0;

  const addText = (raw: string) => {
    const top = stack[stack.length - 1];
    if (top && raw) top.text += decodeEntities(raw);
  };

  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt === -1) { addText(s.slice(i)); break; }
    if (lt > i) addText(s.slice(i, lt));

    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt);
      i = end === -1 ? s.length : end + 3;
      continue;
    }
    if (s.startsWith("<![CDATA[", lt)) {
      const end = s.indexOf("]]>", lt);
      const top = stack[stack.length - 1];
      if (top) top.text += s.slice(lt + 9, end === -1 ? s.length : end);
      i = end === -1 ? s.length : end + 3;
      continue;
    }
    // <?xml …?> and <!DOCTYPE …>
    if (s.startsWith("<?", lt) || s.startsWith("<!", lt)) {
      const end = s.indexOf(">", lt);
      i = end === -1 ? s.length : end + 1;
      continue;
    }

    const gt = tagEnd(s, lt);
    if (gt === -1) break;
    const inner = s.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (!inner) continue;

    if (inner[0] === "/") {
      const closing = localName(inner.slice(1).trim());
      // Pop to the matching element, tolerating a missing close above it.
      for (let d = stack.length - 1; d >= 0; d -= 1) {
        if (stack[d].name === closing) { stack.length = d; break; }
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1).trim() : inner;
    const space = body.search(/\s/);
    const node: XmlNode = {
      name: localName(space === -1 ? body : body.slice(0, space)),
      attrs: space === -1 ? {} : parseAttrs(body.slice(space)),
      children: [],
      text: "",
    };

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (!root) root = node;

    if (!selfClosing) stack.push(node);
  }

  return root;
}

// ── Tree helpers ────────────────────────────────────────────────────────────

export function child(node: XmlNode | null | undefined, name: string): XmlNode | undefined {
  return node?.children.find(c => c.name === name);
}

export function childrenNamed(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return node?.children.filter(c => c.name === name) ?? [];
}

/** Depth-first search of the whole subtree. */
export function findAll(node: XmlNode | null | undefined, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    if (n.name === name) out.push(n);
    n.children.forEach(walk);
  };
  if (node) walk(node);
  return out;
}

/** All text in a subtree, trimmed. Used for values that may be wrapped. */
export function textOf(node: XmlNode | null | undefined): string {
  if (!node) return "";
  let out = node.text;
  for (const c of node.children) out += textOf(c);
  return out.trim();
}

/** Every `<href>` in a subtree, in document order. */
export function hrefsOf(node: XmlNode | null | undefined): string[] {
  return findAll(node, "href").map(h => textOf(h)).filter(Boolean);
}

/** `"HTTP/1.1 404 Not Found"` → `404`. */
export function parseStatusCode(status: string): number | null {
  const m = /\b([1-5]\d\d)\b/.exec(String(status ?? ""));
  return m ? Number(m[1]) : null;
}

// ── multistatus ─────────────────────────────────────────────────────────────

export interface DavResponse {
  href: string;
  /**
   * Response-level status, present instead of propstats when the server is
   * reporting the whole resource. This is how `sync-collection` announces a
   * deletion — a `<response>` with an href and a 404 and nothing else.
   */
  status: number | null;
  /** Properties the server actually returned, keyed by local name. */
  props: Record<string, XmlNode>;
  /** Property names the server reported as absent or forbidden. */
  missing: string[];
}

export interface Multistatus {
  responses: DavResponse[];
  /** Present on a `sync-collection` report. Opaque; store it verbatim. */
  syncToken: string | null;
}

export function parseMultistatus(xml: string): Multistatus {
  const root = parseXml(xml);
  const responses: DavResponse[] = [];

  for (const res of findAll(root, "response")) {
    const href = textOf(child(res, "href"));
    const own = child(res, "status");
    const props: Record<string, XmlNode> = {};
    const missing: string[] = [];

    for (const propstat of childrenNamed(res, "propstat")) {
      const code = parseStatusCode(textOf(child(propstat, "status"))) ?? 0;
      const bag = child(propstat, "prop");
      if (!bag) continue;
      for (const p of bag.children) {
        if (code >= 200 && code < 300) props[p.name] = p;
        else missing.push(p.name);
      }
    }

    responses.push({
      href,
      status: own ? parseStatusCode(textOf(own)) : null,
      props,
      missing,
    });
  }

  const token = findAll(root, "sync-token")[0];
  return { responses, syncToken: token ? textOf(token) || null : null };
}

/**
 * The precondition names inside a DAV `<error>` body.
 *
 * The one that matters is `valid-sync-token`: an expired token is routine
 * housekeeping — clear it and do a full resync — not a failure worth showing
 * the user. Telling it apart from a real error requires reading this.
 */
export function preconditionCodes(xml: string): string[] {
  const root = parseXml(xml);
  const error = root?.name === "error" ? root : findAll(root, "error")[0];
  return error ? error.children.map(c => c.name) : [];
}

/**
 * Calendar collections that can hold events.
 *
 * Two conditions, both required. `resourcetype` must contain `<calendar/>`,
 * which excludes the principal, the home set and plain collections. And the
 * component set must include VEVENT, which excludes Reminders lists — those are
 * calendars by resourcetype and reject every event you put in them.
 *
 * A collection that omits `supported-calendar-component-set` entirely is
 * treated as accepting everything, which is what RFC 4791 §5.2.3 says.
 */
export interface DavCalendar {
  href: string;
  displayName: string;
  color: string;
  ctag: string;
  components: string[];
}

export function readCalendars(xml: string): DavCalendar[] {
  const out: DavCalendar[] = [];
  for (const res of parseMultistatus(xml).responses) {
    const resourceType = res.props["resourcetype"];
    if (!child(resourceType, "calendar")) continue;

    const compSet = res.props["supported-calendar-component-set"];
    const components = compSet
      ? childrenNamed(compSet, "comp").map(c => (c.attrs.name ?? "").toUpperCase()).filter(Boolean)
      : [];
    if (components.length > 0 && !components.includes("VEVENT")) continue;

    out.push({
      href: res.href,
      displayName: textOf(res.props["displayname"]) || res.href,
      color: textOf(res.props["calendar-color"]),
      ctag: textOf(res.props["getctag"]),
      components,
    });
  }
  return out;
}
