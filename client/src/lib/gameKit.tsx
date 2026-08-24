/**
 * Shared plumbing for the Athena drills.
 *
 * Three problems this solves, all of which used to be solved (badly, and six
 * times over) inside the individual games:
 *
 * 1. **Keyboard ownership.** Every drill used to attach its own
 *    `window.addEventListener("keydown")`. That is fine when exactly one drill
 *    is on screen and catastrophic in split screen — PASAT and Mental Math both
 *    want digits, Dual N-Back and Complex WM both want letter keys. The router
 *    below is the single listener. Games declare which keys they want; a key
 *    claimed by exactly one visible game goes straight there, and a key claimed
 *    by several goes to the focused panel. Clicking a panel focuses it, which is
 *    the "click whichever input box you want" fallback.
 *
 * 2. **Sizing.** The drills were hard-coded to `max-w-lg` and pixel constants,
 *    so they were a postage stamp on a desktop and unreadable in a quarter
 *    panel. Every panel now measures itself and publishes a scale factor; games
 *    express sizes through `useScaled()` and fit whatever box they are given.
 *
 * 3. **Persistence.** Level, thresholds and hotkeys live in `localStorage`,
 *    keyed by game id rather than by panel. That is what makes blitz mode work:
 *    a drill that rotates off screen and back keeps the difficulty it earned.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/* ── Config persistence ──────────────────────────────────────────────── */

const CFG_PREFIX = "rome.athena.cfg.";

export function loadGameConfig<T extends object>(gameId: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(CFG_PREFIX + gameId);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...defaults };
    // Spread defaults first so a config saved before a field existed still
    // gains that field rather than rendering `undefined` into a slider.
    return { ...defaults, ...(parsed as Partial<T>) };
  } catch {
    return { ...defaults };
  }
}

export function saveGameConfig<T extends object>(gameId: string, cfg: T): void {
  try { localStorage.setItem(CFG_PREFIX + gameId, JSON.stringify(cfg)); } catch { /* private mode */ }
}

/**
 * Config state that survives reloads and panel rotation.
 *
 * Adaptive level changes go through the same setter as the sliders, so the
 * level a session earns is written out with everything else.
 */
export function useGameConfig<T extends object>(gameId: string, defaults: T) {
  const [cfg, setCfg] = useState<T>(() => loadGameConfig(gameId, defaults));
  useEffect(() => { saveGameConfig(gameId, cfg); }, [gameId, cfg]);
  return [cfg, setCfg] as const;
}

/* ── Keyboard routing ────────────────────────────────────────────────── */

interface Claim {
  ownerId: string;
  keys: Set<string>;
  handler: (key: string, event: KeyboardEvent) => void;
}

interface InputApi {
  registerClaim: (claimId: string, claim: Claim) => () => void;
  registerPanel: (panelId: string) => () => void;
  setFocus: (panelId: string) => void;
}

/**
 * The API and the current focus are deliberately two contexts.
 *
 * They started as one, and it was a bug: the object's identity changed every
 * time focus moved, which re-ran every panel's registration effect, which
 * unregistered and re-registered the panels mid-click — and the unregister path
 * reassigns focus to the first remaining panel. Clicking panel B moved focus to
 * B, then immediately bounced it back to A. Registration depends only on the
 * stable half now.
 */
const InputContext = createContext<InputApi | null>(null);
const FocusContext = createContext<string | null>(null);
const InstanceContext = createContext<string>("solo");

/** Canonical key name: single characters lower-cased, everything else verbatim. */
export function normalizeKey(e: KeyboardEvent): string {
  if (e.key === " ") return "space";
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

export function GameInputProvider({ children }: { children: ReactNode }) {
  const claims = useRef(new Map<string, Claim>());
  const panels = useRef<string[]>([]);
  const focusRef = useRef<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const setFocus = useCallback((panelId: string) => {
    if (focusRef.current === panelId) return;
    focusRef.current = panelId;
    setFocusedId(panelId);
  }, []);

  const registerPanel = useCallback((panelId: string) => {
    // Idempotent: StrictMode mounts effects twice in development, and a panel
    // listed twice would survive its own unmount.
    if (!panels.current.includes(panelId)) panels.current.push(panelId);
    // Somebody must hold focus from the start, or a solo drill would ignore
    // every key until you clicked it, which reads as the game being broken.
    if (focusRef.current === null) setFocus(panelId);
    return () => {
      panels.current = panels.current.filter(p => p !== panelId);
      if (focusRef.current === panelId) {
        const next = panels.current[0] ?? null;
        focusRef.current = next;
        setFocusedId(next);
      }
    };
  }, [setFocus]);

  const registerClaim = useCallback((claimId: string, claim: Claim) => {
    claims.current.set(claimId, claim);
    return () => { claims.current.delete(claimId); };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      const key = normalizeKey(e);
      const matches: Claim[] = [];
      claims.current.forEach(c => { if (c.keys.has(key)) matches.push(c); });
      if (!matches.length) return;

      // One claimant: unambiguous, deliver regardless of focus. Several: the
      // focused panel wins, and if the focused panel is not among them the key
      // is dropped rather than guessed at.
      let chosen: Claim | undefined;
      if (matches.length === 1) {
        chosen = matches[0];
      } else {
        chosen = matches.find(c => c.ownerId === focusRef.current);
        if (!chosen) return;
      }
      e.preventDefault();
      chosen.handler(key, e);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const api = useMemo<InputApi>(
    () => ({ registerClaim, registerPanel, setFocus }),
    [registerClaim, registerPanel, setFocus],
  );

  return (
    <InputContext.Provider value={api}>
      <FocusContext.Provider value={focusedId}>{children}</FocusContext.Provider>
    </InputContext.Provider>
  );
}

export function useGameInstanceId(): string {
  return useContext(InstanceContext);
}

export function useGameFocused(): boolean {
  const ctx = useContext(InputContext);
  const focusedId = useContext(FocusContext);
  const id = useGameInstanceId();
  return ctx ? focusedId === id : true;
}

let claimSeq = 0;

/**
 * Claim a set of keys for the current panel while `active` is true.
 *
 * A game may call this several times (different keys in different phases);
 * each call is its own claim, all owned by the same panel.
 */
export function useGameKeys(keys: string[], handler: (key: string) => void, active = true): void {
  const ctx = useContext(InputContext);
  const ownerId = useGameInstanceId();
  const claimId = useRef<string>("");
  if (!claimId.current) claimId.current = `claim-${++claimSeq}`;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const signature = keys.join("|");
  useEffect(() => {
    if (!ctx || !active || !signature) return;
    return ctx.registerClaim(claimId.current, {
      ownerId,
      keys: new Set(signature.split("|")),
      handler: (k) => handlerRef.current(k),
    });
  }, [ctx, ownerId, signature, active]);
}

/* ── Sizing ──────────────────────────────────────────────────────────── */

/** The box each drill is drawn for; everything else is a multiple of this. */
const BASE_W = 560;
const BASE_H = 620;

interface GameSize { width: number; height: number; scale: number }

const SizeContext = createContext<GameSize>({ width: BASE_W, height: BASE_H, scale: 1 });

export function useGameSize(): GameSize {
  return useContext(SizeContext);
}

/** `px(24)` → 24 design pixels expressed in this panel's actual pixels. */
export function useScaled() {
  const { scale } = useGameSize();
  return useCallback((n: number) => Math.round(n * scale * 100) / 100, [scale]);
}

/* ── Panel ───────────────────────────────────────────────────────────── */

export function GamePanel({
  id,
  children,
  className,
  style,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ctx = useContext(InputContext);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: BASE_W, height: BASE_H });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => ctx?.registerPanel(id), [ctx, id]);

  const value = useMemo<GameSize>(() => {
    const raw = Math.min(size.width / BASE_W, size.height / BASE_H);
    return { ...size, scale: Math.max(0.45, Math.min(1.7, raw || 1)) };
  }, [size]);

  return (
    <InstanceContext.Provider value={id}>
      <SizeContext.Provider value={value}>
        <div
          ref={ref}
          className={className}
          style={style}
          onPointerDown={() => ctx?.setFocus(id)}
        >
          {children}
        </div>
      </SizeContext.Provider>
    </InstanceContext.Provider>
  );
}

/* ── Shared props every drill accepts ────────────────────────────────── */

export interface GameSessionSummary {
  correct: number;
  total: number;
  level: number;
}

export interface GameProps {
  /** True inside the Arena: no back link, tighter chrome. */
  embedded?: boolean;
  /** Blitz mode starts the drill the moment its panel mounts. */
  autoStart?: boolean;
  onSessionComplete?: (summary: GameSessionSummary) => void;
}

/* ── Small shared helpers ────────────────────────────────────────────── */

export const MONO = "DM Mono, monospace";
export const SERIF = "'Cinzel', serif";

export function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

export function pick<T>(arr: readonly T[]): T {
  return arr[randInt(arr.length)];
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Alpha-blend an accent colour.
 *
 * The drills used to write `${accent}35`, borrowing the hex-with-alpha shorthand
 * — but every accent in ROME is an `hsl()` string, so `hsl(210 80% 62%)35` is
 * not a colour at all and the browser dropped the whole declaration. That is why
 * the old panels had no visible borders or button fills. This produces the
 * modern slash-alpha form, which `hsl(var(--accent-h) ...)` also accepts.
 */
export function alpha(color: string, a: number): string {
  const c = color.trim();
  if ((c.startsWith("hsl(") || c.startsWith("hsla(")) && !c.includes("/")) {
    const inner = c.slice(c.indexOf("(") + 1, c.lastIndexOf(")"));
    return `hsl(${inner} / ${a})`;
  }
  return c;
}

/** Human label for a bound key, e.g. "a" → "A", "space" → "Space". */
export function keyLabel(key: string): string {
  if (!key) return "—";
  if (key === "space") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}
