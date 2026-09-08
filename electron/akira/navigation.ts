/**
 * Where "navigate" and "open up …" can take the user.
 *
 * Kept out of the capability registry because it is a vocabulary, not a
 * capability: it is the one place that knows both ROME's own surfaces and the
 * shapes a spoken destination arrives in, and it is worth testing on its own.
 */

/**
 * Every ROME surface, and the words a person actually uses for it.
 *
 * Mirrors client/src/routes.tsx. Spoken names come in shapes no route ever
 * matches — "the calendar", "my task board", "commander center" — so the
 * spellings live here rather than in an allow-list that only accepts the
 * literal path. Anything not listed is not reachable by voice, which is the
 * point: this is also the navigation allow-list.
 */
const ROME_SURFACES: { route: string; name: string; aliases: string[] }[] = [
  { route: "/athena", name: "Athena Trials", aliases: ["athena", "athena trials", "trials", "training", "training map", "cognitive training"] },
  { route: "/athena/arena", name: "the Athena Arena", aliases: ["arena", "athena arena"] },
  { route: "/athena/dual-n-back", name: "Dual N-Back", aliases: ["dual n back", "dual nback", "n back", "dual n-back"] },
  { route: "/athena/cwm", name: "Complex WM", aliases: ["cwm", "complex wm", "complex working memory"] },
  { route: "/athena/mental-math", name: "Mental Math", aliases: ["mental math", "math", "mental calculator"] },
  { route: "/athena/corsi", name: "Corsi Blocks", aliases: ["corsi", "corsi blocks"] },
  { route: "/athena/memory-span", name: "Memory Span", aliases: ["memory span", "span"] },
  { route: "/athena/pasat", name: "PASAT", aliases: ["pasat", "paced addition"] },
  { route: "/athena/flux", name: "Flux", aliases: ["flux"] },
  { route: "/philosophy", name: "the Philosophy Chambers", aliases: ["philosophy", "philosophy chambers", "chambers"] },
  { route: "/strategic", name: "Strategic", aliases: ["strategic", "strategy"] },
  { route: "/command-center", name: "the Command Center", aliases: ["command center", "command centre", "commander center", "threats"] },
  { route: "/taskboard", name: "the Contingency Garden", aliases: ["taskboard", "task board", "tasks", "contingency garden", "garden"] },
  { route: "/kronos-keep", name: "Kronos Keep", aliases: ["kronos", "kronos keep", "chronos", "chronos keep", "calendar", "schedule", "my schedule", "agenda"] },
  { route: "/creative", name: "Creative", aliases: ["creative"] },
  { route: "/idea-workshop", name: "the Idea Workshop", aliases: ["idea workshop", "ideas", "workshop"] },
  { route: "/investigative", name: "Investigative", aliases: ["investigative", "investigation"] },
  { route: "/component-board", name: "the Component Board", aliases: ["component board", "components"] },
  { route: "/research-lab", name: "the Research Lab", aliases: ["research lab", "research", "lab"] },
  { route: "/world", name: "the World Browser", aliases: ["world", "world browser", "browser", "the web", "internet"] },
  { route: "/funding", name: "the Midas Dashboard", aliases: ["funding", "midas", "midas dashboard", "finance", "financial", "money"] },
  { route: "/academia", name: "Academia", aliases: ["academia", "academics", "study"] },
  { route: "/academia/recall", name: "the Recall State", aliases: ["recall", "recall state"] },
  { route: "/academia/flashcards", name: "the Flashcard Archive", aliases: ["flashcards", "flash cards", "flashcard archive", "archive"] },
  { route: "/settings", name: "Settings", aliases: ["settings", "preferences", "profile", "profiles"] },
];

/** Sites worth reaching by the name people say rather than by domain. */
const SITE_ALIASES: Record<string, string> = {
  youtube: "https://www.youtube.com", gmail: "https://mail.google.com", "google mail": "https://mail.google.com",
  google: "https://www.google.com", "google drive": "https://drive.google.com", drive: "https://drive.google.com",
  "google docs": "https://docs.google.com", docs: "https://docs.google.com",
  github: "https://github.com", chatgpt: "https://chatgpt.com", claude: "https://claude.ai",
  x: "https://x.com", twitter: "https://x.com", reddit: "https://www.reddit.com",
  wikipedia: "https://www.wikipedia.org", amazon: "https://www.amazon.com", netflix: "https://www.netflix.com",
  spotify: "https://open.spotify.com", linkedin: "https://www.linkedin.com", notion: "https://www.notion.so",
  maps: "https://maps.google.com", "google maps": "https://maps.google.com", "elevenlabs": "https://elevenlabs.io",
};

type Destination =
  | { kind: "surface"; route: string; name: string }
  | { kind: "web"; url: string; name: string };

/**
 * Reduce a spoken destination to the part that names it.
 *
 * "Akira, take me to my task board please" and "taskboard" have to end up at
 * the same key, so the carrier phrase, the determiner and the punctuation all
 * come off. What is left is matched literally — nothing here guesses.
 */
function spokenKey(value: string): string {
  let key = value
    .toLowerCase()
    .replace(/[^a-z0-9.\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  key = key
    .replace(/^(please|hey|ok|okay)\s+/, "")
    .replace(/^akira\s+/, "")
    .replace(/^(go to|take me to|bring up|pull up|open up|open|navigate to|navigate|show me|show|switch to|jump to|head to)\s+/, "")
    .replace(/^(the|my|our|a|an)\s+/, "")
    .replace(/\s+(please|now)$/, "")
    .trim();
  return key.replace(/[.\s]+$/, "");
}

/**
 * Decide what "open up X" means.
 *
 * ROME surfaces win over the web: "open up my calendar" is Kronos Keep, not a
 * search for the word calendar. Only once nothing internal matches is the
 * target treated as a place on the internet — a URL, a site people name rather
 * than spell, a bare domain, or, failing all of that, a search.
 */
export function resolveDestination(value: unknown): Destination {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Say where to go.");
  const key = spokenKey(raw);
  if (!key) throw new Error("Say where to go.");

  if (key.startsWith("/")) {
    const surface = ROME_SURFACES.find(entry => entry.route === key);
    if (surface) return { kind: "surface", route: surface.route, name: surface.name };
    throw new Error("That route is not an approved ROME surface.");
  }
  const surface = ROME_SURFACES.find(entry => entry.aliases.includes(key));
  if (surface) return { kind: "surface", route: surface.route, name: surface.name };

  if (/^https?:\/\//i.test(raw.trim())) {
    const url = raw.trim();
    return { kind: "web", url, name: hostLabel(url) };
  }
  const site = SITE_ALIASES[key];
  if (site) return { kind: "web", url: site, name: hostLabel(site) };

  // A bare domain: "youtube.com", "news.ycombinator.com/newest".
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(key)) {
    const url = `https://${key}`;
    return { kind: "web", url, name: hostLabel(url) };
  }
  // A single spoken word ROME does not know: almost always a site.
  if (/^[a-z0-9-]+$/.test(key)) {
    const url = `https://${key}.com`;
    return { kind: "web", url, name: hostLabel(url) };
  }
  return { kind: "web", url: raw.trim(), name: `a search for ${raw.trim().slice(0, 80)}` };
}

function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url.slice(0, 80); }
}
