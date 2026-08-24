/**
 * The Arena — up to four drills at once, and blitz mode.
 *
 * **Why one page rather than a mode inside each drill.** Running two drills
 * side by side is only useful if the keyboard behaves, and the keyboard can
 * only behave if something above the drills arbitrates. That something is
 * `GameInputProvider` (see `lib/gameKit.tsx`): drills declare the keys they
 * want, a key claimed by exactly one visible drill goes straight to it, and a
 * key two drills both want goes to whichever panel you last clicked. So digits
 * land in the arithmetic drill while letter keys land in the letter drill with
 * no thought from you, and when both want digits — PASAT beside Mental Math —
 * clicking the panel you mean is the whole disambiguation gesture.
 *
 * **Blitz.** Pick how many panels you want and turn it on: every time a drill
 * in a panel finishes a session, that panel is replaced by a different drill
 * drawn from the blitz pool and started immediately. Difficulty is not lost in
 * the shuffle, because level lives in `localStorage` keyed by drill rather than
 * in the component — a drill that rotates away and comes back returns at the
 * level it left. It keeps going until you turn it off.
 *
 * **The pool** is the set of drills blitz may draw from. Two panels are never
 * given the same drill: they would share one `localStorage` config and fight
 * over its level. That constraint is why the pool size caps the panel count
 * while blitz is running, rather than the two being independent settings.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Shuffle } from "lucide-react";
import {
  GameInputProvider, GamePanel, MONO, SERIF, alpha, pick,
  useGameFocused,
} from "@/lib/gameKit";
import { GAMES, INPUT_LABEL, gameById, type GameMeta } from "@/lib/gamesRegistry";

const STORE_KEY = "rome.athena.arena";
const accent = "hsl(var(--accent-h) 70% 58%)";
const blitzColor = "hsl(35 90% 62%)";

interface ArenaState {
  count: number;
  panels: string[];
  blitz: boolean;
  /** Drill ids blitz may draw from. Never empty. */
  pool: string[];
}

const ALL_IDS = GAMES.map(g => g.id);

const DEFAULT_STATE: ArenaState = {
  count: 2,
  panels: ["dual-n-back", "mental-math", "corsi", "flux"],
  blitz: false,
  pool: [...ALL_IDS],
};

function loadArena(): ArenaState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_STATE, panels: [...DEFAULT_STATE.panels] };
    const parsed = JSON.parse(raw) as Partial<ArenaState>;
    const panels = DEFAULT_STATE.panels.map((fallback, i) => {
      const candidate = parsed.panels?.[i];
      return candidate && gameById(candidate) ? candidate : fallback;
    });
    // Drills added since the config was written join the pool; ones that no
    // longer exist drop out of it.
    const savedPool = Array.isArray(parsed.pool) ? parsed.pool.filter(id => gameById(id)) : null;
    const pool = savedPool && savedPool.length ? savedPool : [...ALL_IDS];
    return {
      count: Math.min(4, Math.max(1, Number(parsed.count) || DEFAULT_STATE.count)),
      panels,
      blitz: Boolean(parsed.blitz),
      pool,
    };
  } catch {
    return { ...DEFAULT_STATE, panels: [...DEFAULT_STATE.panels] };
  }
}

/**
 * Make the first `count` panels hold distinct drills drawn from `pool`,
 * disturbing panels that are already legal as little as possible.
 */
function seedPanels(panels: string[], count: number, pool: string[]): string[] {
  const next = [...panels];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const current = next[i];
    if (pool.includes(current) && !used.has(current)) { used.add(current); continue; }
    const free = pool.find(p => !used.has(p));
    next[i] = free ?? current;
    used.add(next[i]);
  }
  return next;
}

/** Inside `GamePanel`, so it can see whether this panel owns the keyboard. */
function PanelBody({
  meta, nonce, autoStart, pending, inPool, blitz, onPick, onComplete,
}: {
  meta: GameMeta;
  nonce: number;
  autoStart: boolean;
  pending: boolean;
  inPool: boolean;
  blitz: boolean;
  onPick: (gameId: string) => void;
  onComplete: () => void;
}) {
  const focused = useGameFocused();
  const Game = meta.Component;

  return (
    <div className="relative flex flex-col h-full w-full">
      {/* Panel strip */}
      <div
        className="shrink-0 flex items-center gap-2 px-2.5 py-1.5"
        style={{ borderBottom: `1px solid ${focused ? alpha(meta.accent, 0.35) : "hsl(var(--accent-h) 15% 10%)"}` }}
      >
        <span style={{ color: meta.accent, fontSize: 13 }}>{meta.glyph}</span>
        <select
          value={meta.id}
          onChange={e => { onPick(e.target.value); e.currentTarget.blur(); }}
          className="rounded"
          style={{
            background: "hsl(222 20% 7%)",
            border: "1px solid hsl(var(--accent-h) 15% 16%)",
            color: meta.accent, fontFamily: MONO, fontSize: 11, padding: "2px 4px",
          }}
        >
          {GAMES.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <span style={{ color: "hsl(214 20% 32%)", fontFamily: MONO, fontSize: 9 }}>
          {INPUT_LABEL[meta.input]}
        </span>
        {blitz && !inPool && (
          <span
            title="Not in the blitz pool — this panel will be replaced when the session ends"
            style={{ color: blitzColor, fontFamily: MONO, fontSize: 9, opacity: 0.75 }}
          >
            off-pool
          </span>
        )}
        <span
          className="ml-auto"
          style={{ color: focused ? meta.accent : "hsl(214 20% 22%)", fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em" }}
        >
          {focused ? "◉ KEYS" : "○"}
        </span>
      </div>

      <div className="flex-1 min-h-0 relative">
        <Game
          key={`${meta.id}#${nonce}`}
          embedded
          autoStart={autoStart}
          onSessionComplete={onComplete}
        />
        {pending && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "hsl(222 22% 3% / 0.72)", backdropFilter: "blur(2px)" }}
          >
            <span style={{ fontFamily: SERIF, color: meta.accent, fontSize: 15, letterSpacing: "0.2em", textTransform: "uppercase" }}>
              Switching…
            </span>
          </div>
        )}
      </div>

      {/* Focus ring, drawn over everything and clickable through. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          border: `1px solid ${focused ? alpha(meta.accent, 0.55) : "hsl(var(--accent-h) 15% 10%)"}`,
          boxShadow: focused ? `inset 0 0 24px ${alpha(meta.accent, 0.08)}` : "none",
          transition: "border-color 0.2s",
        }}
      />
    </div>
  );
}

export default function Arena() {
  const [state, setState] = useState<ArenaState>(loadArena);
  const [nonces, setNonces] = useState<number[]>([0, 0, 0, 0]);
  const [autoStart, setAutoStart] = useState<boolean[]>([false, false, false, false]);
  const [pending, setPending] = useState<boolean[]>([false, false, false, false]);
  const [poolOpen, setPoolOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 1080);

  const blitzRef = useRef(state.blitz);
  blitzRef.current = state.blitz;
  const swapTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }, [state]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1080);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => () => {
    Object.values(swapTimers.current).forEach(clearTimeout);
  }, []);

  const bump = (i: number, start: boolean) => {
    setNonces(n => { const c = [...n]; c[i] += 1; return c; });
    setAutoStart(a => { const c = [...a]; c[i] = start; return c; });
  };

  /**
   * A session ended. In blitz that means this panel is about to become a
   * different drill — after a beat, so the result screen is readable.
   */
  const handleComplete = useCallback((i: number) => {
    if (!blitzRef.current) return;
    setPending(p => { const c = [...p]; c[i] = true; return c; });
    clearTimeout(swapTimers.current[i]);
    swapTimers.current[i] = setTimeout(() => {
      if (!blitzRef.current) { setPending(p => { const c = [...p]; c[i] = false; return c; }); return; }
      setState(s => {
        const pool = s.pool.length ? s.pool : ALL_IDS;
        const elsewhere = new Set(s.panels.slice(0, s.count).filter((_, j) => j !== i));
        // Prefer a drill that is neither on screen nor the one just finished;
        // settle for merely different; and with a one-drill pool, repeat it.
        const fresh = pool.filter(id => id !== s.panels[i] && !elsewhere.has(id));
        const different = pool.filter(id => id !== s.panels[i]);
        const chosen = fresh.length ? pick(fresh) : different.length ? pick(different) : s.panels[i];
        const panels = [...s.panels];
        panels[i] = chosen;
        return { ...s, panels };
      });
      setPending(p => { const c = [...p]; c[i] = false; return c; });
      setNonces(n => { const c = [...n]; c[i] += 1; return c; });
      setAutoStart(a => { const c = [...a]; c[i] = true; return c; });
    }, 2600);
  }, []);

  /** Picking a drill another panel already has swaps the two rather than duplicating. */
  const pickGame = (i: number, gameId: string) => {
    const other = state.panels.findIndex((p, j) => p === gameId && j !== i && j < state.count);
    setState(s => {
      const panels = [...s.panels];
      if (other >= 0) panels[other] = panels[i];
      panels[i] = gameId;
      return { ...s, panels };
    });
    bump(i, false);
    if (other >= 0) bump(other, false);
  };

  const setCount = (count: number) => {
    const next = seedPanels(state.panels, count, state.blitz ? state.pool : ALL_IDS);
    for (let i = 0; i < count; i++) if (next[i] !== state.panels[i]) bump(i, state.blitz);
    setState(s => ({ ...s, count, panels: next }));
  };

  const toggleBlitz = () => {
    const next = !state.blitz;
    blitzRef.current = next;
    if (!next) {
      Object.values(swapTimers.current).forEach(clearTimeout);
      setPending([false, false, false, false]);
      setState(s => ({ ...s, blitz: false }));
      return;
    }
    // Starting blitz: the pool caps the panel count, every panel is drawn from
    // the pool, and everything starts at once — that is the whole point of it.
    const count = Math.max(1, Math.min(state.count, state.pool.length));
    const panels = seedPanels(state.panels, count, state.pool);
    setState(s => ({ ...s, blitz: true, count, panels }));
    for (let i = 0; i < count; i++) bump(i, true);
  };

  const togglePoolGame = (id: string) => {
    const inPool = state.pool.includes(id);
    const pool = inPool ? state.pool.filter(p => p !== id) : [...state.pool, id];
    if (!pool.length) return; // never leave blitz with nothing to draw
    if (!state.blitz) { setState(s => ({ ...s, pool })); return; }

    const count = Math.max(1, Math.min(state.count, pool.length));
    const panels = seedPanels(state.panels, count, pool);
    // A panel holding the drill you just removed is replaced immediately;
    // panels still holding a pool drill are left mid-session, untouched.
    for (let i = 0; i < count; i++) if (panels[i] !== state.panels[i]) bump(i, true);
    setState(s => ({ ...s, pool, count, panels }));
  };

  const { count, pool } = state;
  const maxCount = state.blitz ? Math.min(4, pool.length) : 4;
  const cols = count === 1 ? 1 : count === 2 ? (narrow ? 1 : 2) : count === 3 ? (narrow ? 2 : 3) : 2;
  const rows = Math.ceil(count / cols);
  const showPool = poolOpen || state.blitz;

  return (
    <div className="w-full" style={{ maxWidth: 1680, margin: "0 auto" }}>
      {/* ── Bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center flex-wrap gap-3 mb-3">
        <Link href="/athena">
          <button className="opacity-40 hover:opacity-80 transition-opacity">
            <ArrowLeft className="w-4 h-4" style={{ color: accent }} />
          </button>
        </Link>
        <div className="mr-auto">
          <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: SERIF, color: accent }}>
            Arena
          </h1>
          <p style={{ color: "hsl(214 20% 40%)", fontFamily: MONO, fontSize: 10 }}>
            {count} panel{count === 1 ? "" : "s"} · keys follow the panel you click
            {state.blitz ? ` · blitz drawing from ${pool.length} drill${pool.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4].map(n => {
            const blocked = n > maxCount;
            return (
              <button key={n} onClick={() => !blocked && setCount(n)} disabled={blocked}
                title={blocked ? `Blitz needs a pool of at least ${n} drills for ${n} panels` : undefined}
                className="rounded-lg transition-all"
                style={{
                  width: 30, height: 28, fontFamily: MONO, fontSize: 12,
                  background: count === n ? alpha(accent, 0.2) : "hsl(222 20% 5%)",
                  border: `1px solid ${count === n ? accent : "hsl(var(--accent-h) 15% 14%)"}`,
                  color: count === n ? accent : "hsl(214 20% 45%)",
                  opacity: blocked ? 0.3 : 1,
                  cursor: blocked ? "not-allowed" : "pointer",
                }}>
                {n}
              </button>
            );
          })}
        </div>

        <button onClick={() => setPoolOpen(o => !o)}
          className="rounded-lg transition-all"
          style={{
            padding: "6px 10px", fontFamily: MONO, fontSize: 10,
            background: "hsl(222 20% 5%)",
            border: `1px solid ${showPool ? alpha(blitzColor, 0.5) : "hsl(var(--accent-h) 15% 14%)"}`,
            color: showPool ? blitzColor : "hsl(214 20% 45%)",
          }}>
          Pool {pool.length}/{GAMES.length}
        </button>

        <button onClick={toggleBlitz}
          className="flex items-center gap-2 rounded-lg transition-all"
          style={{
            padding: "6px 12px", fontFamily: SERIF, fontSize: 11,
            letterSpacing: "0.15em", textTransform: "uppercase",
            background: state.blitz ? alpha(blitzColor, 0.22) : "hsl(222 20% 5%)",
            border: `1px solid ${state.blitz ? blitzColor : "hsl(var(--accent-h) 15% 14%)"}`,
            color: state.blitz ? blitzColor : "hsl(214 20% 45%)",
          }}>
          <Shuffle className="w-3.5 h-3.5" />
          {state.blitz ? "Blitz on" : "Blitz"}
        </button>
      </div>

      {/* ── Blitz pool ────────────────────────────────────────────── */}
      {showPool && (
        <div
          className="flex items-center flex-wrap gap-1.5 mb-3 rounded-xl"
          style={{ padding: "8px 10px", background: "hsl(222 20% 4% / 0.7)", border: `1px solid ${alpha(blitzColor, 0.18)}` }}
        >
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(214 20% 38%)", marginRight: 4 }}>
            Blitz pool
          </span>
          {GAMES.map(g => {
            const on = pool.includes(g.id);
            const last = on && pool.length === 1;
            return (
              <button key={g.id} onClick={() => !last && togglePoolGame(g.id)} disabled={last}
                title={last ? "Blitz needs at least one drill" : on ? "Remove from the blitz draw" : "Add to the blitz draw"}
                className="flex items-center gap-1.5 rounded-lg transition-all"
                style={{
                  padding: "4px 9px", fontFamily: MONO, fontSize: 10,
                  background: on ? alpha(g.accent, 0.16) : "hsl(222 20% 6%)",
                  border: `1px solid ${on ? alpha(g.accent, 0.55) : "hsl(var(--accent-h) 15% 13%)"}`,
                  color: on ? g.accent : "hsl(214 20% 32%)",
                  cursor: last ? "not-allowed" : "pointer",
                }}>
                <span style={{ fontSize: 11 }}>{g.glyph}</span>
                {g.name}
              </button>
            );
          })}
          <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 9, color: "hsl(214 20% 30%)" }}>
            {state.blitz
              ? `${pool.length} in the draw · caps panels at ${maxCount}`
              : "these are the drills blitz will rotate through"}
          </span>
        </div>
      )}

      {/* ── Panels ────────────────────────────────────────────────── */}
      <GameInputProvider>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            gap: 12,
            height: `max(560px, calc(100vh - ${(narrow ? 210 : 190) + (showPool ? 46 : 0)}px))`,
          }}
        >
          {Array.from({ length: count }).map((_, i) => {
            const meta = gameById(state.panels[i]) ?? GAMES[0];
            return (
              <GamePanel
                key={`arena-${i}`}
                id={`arena-${i}`}
                className="relative rounded-2xl overflow-hidden"
                style={{ background: "hsl(222 22% 3.5%)", minHeight: 0, minWidth: 0 }}
              >
                <PanelBody
                  meta={meta}
                  nonce={nonces[i]}
                  autoStart={autoStart[i]}
                  pending={pending[i]}
                  inPool={pool.includes(meta.id)}
                  blitz={state.blitz}
                  onPick={id => pickGame(i, id)}
                  onComplete={() => handleComplete(i)}
                />
              </GamePanel>
            );
          })}
        </div>
      </GameInputProvider>

      <p className="mt-3" style={{ color: "hsl(214 20% 30%)", fontFamily: MONO, fontSize: 10 }}>
        Digits go to the drill that wants digits, letter keys to the drill that wants letters. When two drills want the same key,
        click the one you mean — the panel marked ◉ KEYS is the one listening.
      </p>
    </div>
  );
}
