/**
 * iCalendar — the subset ROME actually needs, and nothing else.
 *
 * This is deliberately **not** a general RFC 5545 parser. It is a property-level
 * line editor, and the distinction is the most important design decision in the
 * whole sync:
 *
 *   • On the way in, we read the handful of properties ROME understands.
 *   • On the way out, we **patch those lines inside the stored original** and
 *     leave every other byte alone.
 *
 * Regenerating a `.ics` from our own model would be simpler and would silently
 * delete the user's VALARMs, ATTENDEEs, ORGANIZER, X-APPLE-* extensions and
 * their whole VTIMEZONE — every time they edited the title in ROME. `ical_raw`
 * exists so that never happens.
 *
 * ── Things that look like details and are not ───────────────────────────────
 *
 * **Unfolding happens on bytes, not on a string.** Apple folds lines at 75
 * *octets*, which can land in the middle of a UTF-8 sequence. By the time
 * `fetch` has decoded the body to a JS string, that sequence is already two
 * U+FFFD replacement characters and the emoji in the user's event title is
 * gone. `unfoldBytes` is the only correct entry point for a network response;
 * `unfold` is for input that is already a clean string.
 *
 * **A VEVENT is not one block.** When you drag a single occurrence of a
 * repeating event in Apple Calendar, Apple writes a *second* VEVENT with the
 * same UID and a `RECURRENCE-ID` into the same file. Code that takes the first
 * VEVENT it sees will sometimes read the override and think it is the master.
 * `readVevent` skips overrides.
 *
 * **Nested components own their own properties.** A VALARM has a DESCRIPTION
 * and so does the VEVENT. Every property lookup here is depth-aware, or editing
 * an event's description would rewrite the text of its alarm.
 */

// ── Constants ───────────────────────────────────────────────────────────────

export const CRLF = "\r\n";
export const PRODID = "-//ROME//Kronos Keep//EN";

/** RFC 5545 §3.1: content lines are folded to 75 octets, excluding the CRLF. */
const FOLD_LIMIT = 75;

// ── Folding ─────────────────────────────────────────────────────────────────

/**
 * Unfold a raw response body, then decode.
 *
 * This order is not a preference. See the header: folding is defined on octets
 * and Apple exercises that, so a fold can split a multi-byte character. Decode
 * first and the character is already lost.
 */
export function unfoldBytes(bytes: Uint8Array): string {
  const out = new Uint8Array(bytes.length);
  let w = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    // CRLF + (SP | HTAB)
    if (b === 0x0d && bytes[i + 1] === 0x0a && (bytes[i + 2] === 0x20 || bytes[i + 2] === 0x09)) {
      i += 2;
      continue;
    }
    // Bare LF + (SP | HTAB) — not legal, but produced by enough tools to matter.
    if (b === 0x0a && (bytes[i + 1] === 0x20 || bytes[i + 1] === 0x09)) {
      i += 1;
      continue;
    }
    out[w] = b;
    w += 1;
  }
  return new TextDecoder("utf-8").decode(out.subarray(0, w));
}

/** String-level unfold, for input that is already decoded and known clean. */
export function unfold(text: string): string {
  return String(text ?? "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

/**
 * Fold one content line to 75 octets per physical line.
 *
 * Measured in bytes and advanced by code point, so a fold never lands inside a
 * character — the mistake this file exists to survive on the read side is not
 * one to reproduce on the write side. Continuation lines carry a leading space,
 * which costs one of the 75.
 */
export function foldLine(line: string): string {
  if (byteLength(line) <= FOLD_LIMIT) return line;
  const parts: string[] = [];
  let current = "";
  let used = 0;
  let limit = FOLD_LIMIT;
  for (const ch of line) {
    const n = byteLength(ch);
    if (used + n > limit) {
      parts.push(current);
      current = "";
      used = 0;
      limit = FOLD_LIMIT - 1; // the continuation space
    }
    current += ch;
    used += n;
  }
  if (current) parts.push(current);
  return parts.join(`${CRLF} `);
}

function byteLength(s: string): number {
  // TextEncoder rather than Buffer: this module is imported by tests that run
  // under plain node type-stripping, and by the Electron main bundle.
  return ENCODER.encode(s).length;
}
const ENCODER = new TextEncoder();

/** Join content lines into a document, folding each. */
export function foldAll(lines: string[]): string {
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ── Content lines ───────────────────────────────────────────────────────────

export interface IcalLine {
  /** Upper-cased property name. */
  name: string;
  /** Upper-cased parameter names; values as written, with quotes removed. */
  params: Record<string, string>;
  /** Everything after the first unquoted colon, unmodified. */
  value: string;
  raw: string;
}

/**
 * Split one unfolded content line.
 *
 * Written as a scanner rather than a regex because parameter values may be
 * quoted and a quoted value may contain `:` and `;` — `DTSTART;TZID="GMT+1:00":…`
 * is legal, and a regex that splits on the first colon gets it wrong.
 */
export function parseLine(raw: string): IcalLine | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let i = 0;

  while (i < raw.length && raw[i] !== ";" && raw[i] !== ":") i += 1;
  const name = raw.slice(0, i).trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  while (raw[i] === ";") {
    i += 1;
    const keyStart = i;
    while (i < raw.length && raw[i] !== "=" && raw[i] !== ";" && raw[i] !== ":") i += 1;
    const key = raw.slice(keyStart, i).trim().toUpperCase();

    let value = "";
    if (raw[i] === "=") {
      i += 1;
      while (i < raw.length) {
        if (raw[i] === '"') {
          i += 1;
          const start = i;
          while (i < raw.length && raw[i] !== '"') i += 1;
          value += raw.slice(start, i);
          if (raw[i] === '"') i += 1;
          continue;
        }
        if (raw[i] === ";" || raw[i] === ":") break;
        value += raw[i];
        i += 1;
      }
    }
    if (key) params[key] = value;
  }

  if (raw[i] === ":") i += 1;
  return { name, params, value: raw.slice(i), raw };
}

// ── TEXT escaping ───────────────────────────────────────────────────────────

/** RFC 5545 §3.3.11. Note that `:` is *not* escaped in iCalendar TEXT. */
export function escapeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Reverse of the above, deliberately lenient.
 *
 * Some clients escape `:` even though the spec does not ask for it. Treating an
 * unknown escape as "the character itself" turns `\:` into `:` instead of
 * leaving a stray backslash in the user's title.
 */
export function unescapeText(value: string): string {
  const s = String(value ?? "");
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== "\\") {
      out += s[i];
      continue;
    }
    i += 1;
    const c = s[i];
    if (c === undefined) break; // trailing backslash
    out += c === "n" || c === "N" ? "\n" : c;
  }
  return out;
}

// ── Dates and times ─────────────────────────────────────────────────────────

export interface IcalDate {
  /** `date` is a calendar day with no time and no zone: an all-day event. */
  kind: "date" | "datetime";
  /**
   * Epoch ms.
   *
   * For `date`, this is local midnight of that calendar day — chosen so that
   * `localDateOf` round-trips it, since an all-day event has no instant and
   * pretending it is UTC midnight moves it a day for anyone west of UTC.
   */
  ms: number;
  /** The property carried a trailing `Z`. */
  utc: boolean;
  /** The TZID parameter, when present and resolvable. */
  tzid?: string;
  /** True when the zone was named but this system could not resolve it. */
  unresolvedZone?: boolean;
}

const DT_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

export function parseIcalDate(line: IcalLine | null): IcalDate | null {
  if (!line) return null;
  const m = DT_RE.exec(String(line.value ?? "").trim());
  if (!m) return null;

  const [, ys, ms_, ds, hs, mins, ss, z] = m;
  const y = Number(ys), mo = Number(ms_), d = Number(ds);
  const isDateOnly = hs === undefined || String(line.params.VALUE ?? "").toUpperCase() === "DATE";

  if (isDateOnly) {
    return { kind: "date", ms: new Date(y, mo - 1, d, 0, 0, 0, 0).getTime(), utc: false };
  }

  const h = Number(hs), mi = Number(mins), s = Number(ss);

  if (z) return { kind: "datetime", ms: Date.UTC(y, mo - 1, d, h, mi, s), utc: true };

  const tzid = line.params.TZID;
  if (tzid) {
    const ms = zonedWallToUtcMs({ y, m: mo, d, h, mi, s }, tzid);
    if (ms !== null) return { kind: "datetime", ms, utc: false, tzid };
    // Apple's TZIDs are IANA names, so this is rare — but an unknown zone must
    // not throw. Treat it as floating and say so, rather than guessing UTC.
    return {
      kind: "datetime",
      ms: new Date(y, mo - 1, d, h, mi, s).getTime(),
      utc: false,
      tzid,
      unresolvedZone: true,
    };
  }

  // Floating: no zone, means "whatever local is wherever this is read".
  return { kind: "datetime", ms: new Date(y, mo - 1, d, h, mi, s).getTime(), utc: false };
}

export interface WallTime { y: number; m: number; d: number; h: number; mi: number; s: number }

/**
 * The UTC offset a named zone was at, at a given instant.
 *
 * Resolved through `Intl` rather than by walking the file's VTIMEZONE block:
 * Apple writes IANA zone names, `Intl` already has the full rule history
 * including past DST changes, and a hand-rolled VTIMEZONE interpreter is a
 * large amount of code that is wrong for exactly the dates nobody tests.
 *
 * Returns null for a zone this system does not know.
 */
export function zoneOffsetMs(tz: string, utcMs: number): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const part of dtf.formatToParts(new Date(utcMs))) {
      if (part.type !== "literal") parts[part.type] = part.value;
    }
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    return asUtc - utcMs;
  } catch {
    return null;
  }
}

/**
 * Wall-clock time in a named zone → epoch ms.
 *
 * Two passes: the offset depends on the instant, and the instant depends on the
 * offset. One correction settles everything except a wall time that falls in a
 * DST gap and therefore never happened, where it lands on a defensible instant
 * rather than looping.
 */
export function zonedWallToUtcMs(w: WallTime, tz: string): number | null {
  const naive = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    const offset = zoneOffsetMs(tz, guess);
    if (offset === null) return null;
    const next = naive - offset;
    if (next === guess) return next;
    guess = next;
  }
  return guess;
}

/** `"YYYY-MM-DD"` in the machine's local zone. */
export function localDateOf(d: IcalDate | null): string {
  if (!d) return "";
  const dt = new Date(d.ms);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** `"HH:MM"` in the machine's local zone. All-day items report `"00:00"`. */
export function localTimeOf(d: IcalDate | null): string {
  if (!d) return "";
  const dt = new Date(d.ms);
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** Local `"YYYY-MM-DD"` + `"HH:MM"` → epoch ms. */
export function localWallToUtcMs(dateStr: string, timeStr = "00:00"): number {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [h, mi] = String(timeStr || "00:00").split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, h || 0, mi || 0, 0, 0).getTime();
}

/** Epoch ms → `"20260827T120000Z"`. */
export function formatUtcStamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** `"2026-08-27"` → `"20260827"`, the VALUE=DATE form. */
export function formatDateValue(dateStr: string): string {
  return String(dateStr ?? "").replace(/-/g, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** RFC 5545 DURATION → minutes. Weeks and seconds included; sign ignored. */
export function parseDuration(value: string): number | null {
  const m = /^[+-]?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
    .exec(String(value ?? "").trim().toUpperCase());
  if (!m) return null;
  const [, w, d, h, mi, s] = m;
  if (!w && !d && !h && !mi && !s) return null;
  return (
    Number(w || 0) * 7 * 24 * 60 +
    Number(d || 0) * 24 * 60 +
    Number(h || 0) * 60 +
    Number(mi || 0) +
    Math.round(Number(s || 0) / 60)
  );
}

// ── Component structure ─────────────────────────────────────────────────────

interface Block { begin: number; end: number }

/** Split an unfolded document into lines, dropping blanks. */
export function toLines(ics: string): string[] {
  return unfold(ics).split(/\r\n|\n|\r/).filter(l => l.length > 0);
}

/**
 * Every VEVENT block, as line-index ranges.
 *
 * Depth-tracked, so a VALARM's own BEGIN/END never opens or closes a VEVENT.
 */
export function veventBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  const stack: { name: string; begin: number }[] = [];
  lines.forEach((raw, i) => {
    const line = parseLine(raw);
    if (!line) return;
    if (line.name === "BEGIN") {
      stack.push({ name: line.value.trim().toUpperCase(), begin: i });
      return;
    }
    if (line.name === "END") {
      const top = stack.pop();
      if (top && top.name === "VEVENT") blocks.push({ begin: top.begin, end: i });
    }
  });
  return blocks;
}

/**
 * Line indices belonging to this component itself — not to anything nested
 * inside it. This is what keeps a VEVENT's DESCRIPTION apart from its VALARM's.
 */
function ownLines(lines: string[], block: Block): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = block.begin + 1; i < block.end; i += 1) {
    const line = parseLine(lines[i]);
    if (!line) continue;
    if (line.name === "BEGIN") { depth += 1; continue; }
    if (line.name === "END") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) out.push(i);
  }
  return out;
}

function findOwn(lines: string[], block: Block, name: string): number {
  const target = name.toUpperCase();
  for (const i of ownLines(lines, block)) {
    const line = parseLine(lines[i]);
    if (line && line.name === target) return i;
  }
  return -1;
}

/**
 * The master VEVENT.
 *
 * Apple writes one extra same-UID VEVENT per *modified occurrence* of a
 * repeating event, each carrying a RECURRENCE-ID. Those describe one day, not
 * the series; taking the first block in the file would sometimes hand back an
 * override and report the wrong title, time and rule for the whole routine.
 */
export function masterBlock(lines: string[]): Block | null {
  const blocks = veventBlocks(lines);
  if (blocks.length === 0) return null;
  for (const block of blocks) {
    if (findOwn(lines, block, "RECURRENCE-ID") === -1) return block;
  }
  return blocks[0]; // every block is an override: malformed, but read something
}

// ── Reading ─────────────────────────────────────────────────────────────────

export interface Vevent {
  uid: string;
  summary: string;
  description: string;
  start: IcalDate | null;
  end: IcalDate | null;
  /** From DTEND when present, else DURATION, else null. */
  durationMinutes: number | null;
  /** The RRULE value as written, or "" — never parsed here. See `rrule.ts`. */
  rrule: string;
  allDay: boolean;
  /** LAST-MODIFIED, falling back to DTSTAMP. Null when neither is present. */
  lastModifiedMs: number | null;
  sequence: number;
  /** ROME's own markers, empty when the event did not come from ROME. */
  romeKind: string;
  romeId: string;
  /** How many VEVENTs the file held, including per-occurrence overrides. */
  blockCount: number;
  /** True when this event carries a rule ROME had to read past an override for. */
  hasOverrides: boolean;
}

export function readVevent(ics: string): Vevent | null {
  const lines = toLines(ics);
  const block = masterBlock(lines);
  if (!block) return null;

  const get = (name: string): IcalLine | null => {
    const i = findOwn(lines, block, name);
    return i === -1 ? null : parseLine(lines[i]);
  };

  const start = parseIcalDate(get("DTSTART"));
  const end = parseIcalDate(get("DTEND"));
  const durationLine = get("DURATION");

  let durationMinutes: number | null = null;
  if (start && end) durationMinutes = Math.max(0, Math.round((end.ms - start.ms) / 60000));
  else if (durationLine) durationMinutes = parseDuration(durationLine.value);

  const lastMod = get("LAST-MODIFIED") ?? get("DTSTAMP");
  const lastModDate = parseIcalDate(lastMod);

  const blocks = veventBlocks(lines);

  return {
    uid: get("UID")?.value.trim() ?? "",
    summary: unescapeText(get("SUMMARY")?.value ?? ""),
    description: unescapeText(get("DESCRIPTION")?.value ?? ""),
    start,
    end,
    durationMinutes,
    rrule: get("RRULE")?.value.trim() ?? "",
    allDay: start?.kind === "date",
    lastModifiedMs: lastModDate ? lastModDate.ms : null,
    sequence: Number(get("SEQUENCE")?.value ?? 0) || 0,
    romeKind: get("X-ROME-KIND")?.value.trim() ?? "",
    romeId: get("X-ROME-ID")?.value.trim() ?? "",
    blockCount: blocks.length,
    hasOverrides: blocks.length > 1,
  };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export interface VeventPatch {
  summary?: string;
  description?: string;
  /** Local calendar day. */
  date?: string;
  /** Local `"HH:MM"`. Explicit null makes the event all-day. */
  time?: string | null;
  durationMinutes?: number;
  /** RRULE value without the property name. Explicit null removes the rule. */
  rrule?: string | null;
  romeKind?: string;
  romeId?: string | number;
}

/**
 * Apply ROME's fields to an existing `.ics`, leaving everything else untouched.
 *
 * Only lines ROME owns are rewritten, and only at the master VEVENT's own
 * depth. SEQUENCE is bumped and DTSTAMP / LAST-MODIFIED are refreshed, because
 * a server that sees an unchanged SEQUENCE is entitled to treat the update as a
 * no-op and some clients will not re-notify attendees without it.
 *
 * Writing a time replaces DTSTART/DTEND with UTC values and drops any TZID: the
 * instant is preserved, so the event does not move, and ROME does not have to
 * maintain a VTIMEZONE it did not author. An existing DURATION is removed when
 * a DTEND is written — the two are mutually exclusive and a file carrying both
 * is undefined behaviour.
 */
export function patchVevent(ics: string, patch: VeventPatch, now = Date.now()): string {
  const lines = toLines(ics);
  const block = masterBlock(lines);
  if (!block) return ics;

  // Edits are collected as index → replacement (or null to delete) and applied
  // once at the end, so no index shifts underneath a later lookup.
  const replace = new Map<number, string | null>();
  const insert: string[] = [];

  const put = (name: string, line: string | null) => {
    const i = findOwn(lines, block, name);
    if (i !== -1) replace.set(i, line);
    else if (line !== null) insert.push(line);
  };

  if (patch.summary !== undefined) put("SUMMARY", `SUMMARY:${escapeText(patch.summary)}`);
  if (patch.description !== undefined) put("DESCRIPTION", `DESCRIPTION:${escapeText(patch.description)}`);
  if (patch.romeKind !== undefined) put("X-ROME-KIND", `X-ROME-KIND:${escapeText(patch.romeKind)}`);
  if (patch.romeId !== undefined) put("X-ROME-ID", `X-ROME-ID:${escapeText(String(patch.romeId))}`);

  if (patch.rrule !== undefined) put("RRULE", patch.rrule ? `RRULE:${patch.rrule}` : null);

  if (patch.date !== undefined) {
    const allDay = patch.time === null;
    const minutes = Math.max(1, Math.round(patch.durationMinutes ?? 60));
    for (const line of dateLines(patch.date, allDay ? null : (patch.time ?? "00:00"), minutes)) {
      put(line.slice(0, line.indexOf(":")).split(";")[0], line);
    }
    put("DURATION", null);
  }

  const current = findOwn(lines, block, "SEQUENCE");
  const nextSeq = current === -1 ? 1 : (Number(parseLine(lines[current])?.value ?? 0) || 0) + 1;
  put("SEQUENCE", `SEQUENCE:${nextSeq}`);
  put("DTSTAMP", `DTSTAMP:${formatUtcStamp(now)}`);
  put("LAST-MODIFIED", `LAST-MODIFIED:${formatUtcStamp(now)}`);

  const out: string[] = [];
  lines.forEach((raw, i) => {
    if (i === block.end && insert.length) out.push(...insert);
    if (replace.has(i)) {
      const value = replace.get(i);
      if (value !== null) out.push(value as string);
      return;
    }
    out.push(raw);
  });

  return foldAll(out);
}

/** DTSTART/DTEND for a local day, or the VALUE=DATE pair for an all-day item. */
function dateLines(date: string, time: string | null, minutes: number): string[] {
  if (time === null) {
    // All-day: DTEND is exclusive, so a one-day event ends on the next day.
    const startMs = localWallToUtcMs(date, "00:00");
    const endMs = startMs + Math.max(1, Math.ceil(minutes / (24 * 60))) * 24 * 60 * 60_000;
    const end = new Date(endMs);
    const endStr = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
    return [
      `DTSTART;VALUE=DATE:${formatDateValue(date)}`,
      `DTEND;VALUE=DATE:${formatDateValue(endStr)}`,
    ];
  }
  const startMs = localWallToUtcMs(date, time);
  return [
    `DTSTART:${formatUtcStamp(startMs)}`,
    `DTEND:${formatUtcStamp(startMs + minutes * 60_000)}`,
  ];
}

export interface VeventInput {
  uid: string;
  summary: string;
  description?: string;
  /** Local calendar day, `"YYYY-MM-DD"`. */
  date: string;
  /** Local `"HH:MM"`; null or omitted makes it all-day. */
  time?: string | null;
  durationMinutes?: number;
  rrule?: string | null;
  romeKind?: string;
  romeId?: string | number;
  created?: number;
}

/**
 * A complete VCALENDAR for an event ROME is creating.
 *
 * Only ever used for resources ROME originates. Anything that came from the
 * server goes through `patchVevent` instead — see the header.
 *
 * No VTIMEZONE is emitted and none is needed: times are written as UTC, and an
 * all-day item is a VALUE=DATE with no zone by definition.
 */
export function buildVevent(input: VeventInput): string {
  const now = input.created ?? Date.now();
  const minutes = Math.max(1, Math.round(input.durationMinutes ?? 60));
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${formatUtcStamp(now)}`,
    ...dateLines(input.date, input.time === undefined ? "00:00" : input.time, minutes),
    `SUMMARY:${escapeText(input.summary)}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  if (input.rrule) lines.push(`RRULE:${input.rrule}`);
  if (input.romeKind) lines.push(`X-ROME-KIND:${escapeText(input.romeKind)}`);
  if (input.romeId !== undefined) lines.push(`X-ROME-ID:${escapeText(String(input.romeId))}`);
  lines.push("SEQUENCE:0", `LAST-MODIFIED:${formatUtcStamp(now)}`, "END:VEVENT", "END:VCALENDAR");
  return foldAll(lines);
}

/** ROME's UID scheme. Recognised on the way back in as a matching fallback. */
export function romeUid(kind: string, id: number | string): string {
  return `rome-${kind}-${id}@rome.local`;
}

export function parseRomeUid(uid: string): { kind: string; id: number } | null {
  const m = /^rome-([a-z]+)-(\d+)@rome\.local$/.exec(String(uid ?? "").trim());
  return m ? { kind: m[1], id: Number(m[2]) } : null;
}
