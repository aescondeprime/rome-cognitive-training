/**
 * The chrome every Athena drill wears: title row, settings drawer, instruction
 * card, play area, start button.
 *
 * It exists so the seven drills differ only in the part that is actually
 * different — the play area — and so sizing, focus highlighting and the
 * settings vocabulary stay identical across all of them. Everything here is
 * expressed in scaled units, so the same component renders a full-screen solo
 * drill and a quarter-panel Arena tile without a second layout.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Play, RotateCcw, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { MONO, SERIF, alpha, keyLabel, useScaled } from "@/lib/gameKit";

export type Setting =
  | { kind: "range"; key: string; label: string; min: number; max: number; step?: number; format?: (v: number) => string }
  | { kind: "select"; key: string; label: string; options: { value: string | number; label: string }[] }
  | { kind: "toggle"; key: string; label: string }
  | { kind: "key"; key: string; label: string };

export interface GameShellProps {
  title: string;
  subtitle: ReactNode;
  accent: string;
  embedded?: boolean;
  phase: "idle" | "running" | "result";
  onStart: () => void;
  startLabel?: string;
  settings?: Setting[];
  cfg: Record<string, any>;
  setCfg: (updater: (c: any) => any) => void;
  /** Variant pickers — shown only while idle, above the instructions. */
  variants?: ReactNode;
  instructions?: ReactNode;
  children?: ReactNode;
}

/** Rebind button: swallows the next keypress and stores it. */
function KeyCapture({ value, accent, onChange }: { value: string; accent: string; onChange: (k: string) => void }) {
  const [listening, setListening] = useState(false);
  const px = useScaled();

  useEffect(() => {
    if (!listening) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setListening(false); return; }
      onChange(e.key === " " ? "space" : e.key.length === 1 ? e.key.toLowerCase() : e.key);
      setListening(false);
    }
    // Capture phase, so the global router never sees the rebinding keystroke.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, onChange]);

  return (
    <button
      onClick={() => setListening(l => !l)}
      className="rounded transition-all"
      style={{
        minWidth: px(52), padding: `${px(3)}px ${px(8)}px`,
        fontSize: px(11), fontFamily: MONO,
        background: listening ? `${alpha(accent, 0.25)}` : "hsl(222 20% 9%)",
        border: `1px solid ${listening ? accent : "hsl(var(--accent-h) 15% 18%)"}`,
        color: listening ? accent : "hsl(214 20% 62%)",
      }}
    >
      {listening ? "press…" : keyLabel(value)}
    </button>
  );
}

export default function GameShell({
  title, subtitle, accent, embedded, phase, onStart, startLabel,
  settings = [], cfg, setCfg, variants, instructions, children,
}: GameShellProps) {
  const px = useScaled();
  const [showSettings, setShowSettings] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const set = (key: string, value: unknown) => setCfg((c: any) => ({ ...c, [key]: value }));

  return (
    <div className="flex flex-col h-full w-full min-h-0" style={{ padding: px(embedded ? 12 : 20) }}>
      {/* ── Title row ─────────────────────────────────────────────── */}
      <div className="flex items-center shrink-0" style={{ gap: px(10), marginBottom: px(14) }}>
        {!embedded && (
          <Link href="/athena">
            <button className="opacity-40 hover:opacity-80 transition-opacity">
              <ArrowLeft style={{ width: px(16), height: px(16), color: accent }} />
            </button>
          </Link>
        )}
        <div className="flex-1 min-w-0">
          <h1
            className="font-semibold tracking-widest uppercase truncate"
            style={{ fontFamily: SERIF, color: accent, fontSize: px(14) }}
          >
            {title}
          </h1>
          <p className="truncate" style={{ color: "hsl(214 20% 42%)", fontFamily: MONO, fontSize: px(10) }}>
            {subtitle}
          </p>
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="opacity-40 hover:opacity-80 transition-opacity">
          <Settings2 style={{ width: px(16), height: px(16), color: accent }} />
        </button>
      </div>

      {/* ── Settings drawer ───────────────────────────────────────── */}
      {showSettings && (
        <div
          className="shrink-0 overflow-y-auto rounded-xl border"
          style={{
            background: "hsl(222 20% 5%)", borderColor: `${alpha(accent, 0.25)}`,
            padding: px(14), marginBottom: px(14), maxHeight: "40%",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: px(9) }}>
            {settings.map(s => (
              <div key={s.key} className="flex items-center justify-between" style={{ gap: px(14) }}>
                <label style={{ color: "hsl(214 20% 52%)", fontFamily: MONO, fontSize: px(11) }}>{s.label}</label>
                {s.kind === "range" && (
                  <div className="flex items-center" style={{ gap: px(8) }}>
                    <input
                      type="range" min={s.min} max={s.max} step={s.step ?? 1}
                      value={Number(cfg[s.key])}
                      onChange={e => set(s.key, Number(e.target.value))}
                      // A focused control swallows the drill's keys — the
                      // router deliberately ignores keystrokes aimed at form
                      // elements — so hand focus back as soon as you let go.
                      onPointerUp={e => e.currentTarget.blur()}
                      style={{ width: px(110), accentColor: accent }}
                    />
                    <span
                      className="text-right tabular-nums"
                      style={{ color: accent, fontSize: px(11), width: px(46), fontFamily: MONO }}
                    >
                      {s.format ? s.format(Number(cfg[s.key])) : String(cfg[s.key])}
                    </span>
                  </div>
                )}
                {s.kind === "select" && (
                  <select
                    value={String(cfg[s.key])}
                    onChange={e => {
                      const raw = e.target.value;
                      const match = s.options.find(o => String(o.value) === raw);
                      set(s.key, match ? match.value : raw);
                      e.currentTarget.blur();
                    }}
                    className="rounded"
                    style={{
                      background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 18%)",
                      color: accent, fontSize: px(11), padding: `${px(3)}px ${px(6)}px`, fontFamily: MONO,
                    }}
                  >
                    {s.options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                  </select>
                )}
                {s.kind === "toggle" && (
                  <button
                    onClick={() => set(s.key, !cfg[s.key])}
                    className="rounded-full transition-all"
                    style={{
                      width: px(38), height: px(20), position: "relative",
                      background: cfg[s.key] ? `${alpha(accent, 0.40)}` : "hsl(222 20% 12%)",
                      border: `1px solid ${cfg[s.key] ? accent : "hsl(var(--accent-h) 15% 18%)"}`,
                    }}
                  >
                    <span
                      className="rounded-full absolute transition-all"
                      style={{
                        width: px(12), height: px(12), top: px(3),
                        left: cfg[s.key] ? px(21) : px(3),
                        background: cfg[s.key] ? accent : "hsl(214 20% 35%)",
                      }}
                    />
                  </button>
                )}
                {s.kind === "key" && (
                  <KeyCapture value={String(cfg[s.key] ?? "")} accent={accent} onChange={k => set(s.key, k)} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Variant pickers ───────────────────────────────────────── */}
      {phase === "idle" && variants && (
        <div className="shrink-0" style={{ marginBottom: px(12) }}>{variants}</div>
      )}

      {/* ── Instructions ──────────────────────────────────────────── */}
      {phase === "idle" && instructions && (
        <div
          className="shrink-0 rounded-xl border leading-relaxed overflow-y-auto"
          style={{
            background: "hsl(222 20% 4%)", borderColor: "hsl(var(--accent-h) 15% 12%)",
            color: "hsl(214 20% 52%)", fontSize: px(11), padding: px(14), marginBottom: px(14),
          }}
        >
          {instructions}
        </div>
      )}

      {/* ── Play area ─────────────────────────────────────────────── */}
      <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col items-center justify-center overflow-hidden">
        {children}
      </div>

      {/* ── Start / restart ───────────────────────────────────────── */}
      {phase !== "running" && (
        <button
          onClick={onStart}
          className="w-full shrink-0 flex items-center justify-center rounded-xl font-semibold tracking-widest uppercase transition-all active:scale-[0.99]"
          style={{
            gap: px(8), marginTop: px(14), padding: `${px(12)}px 0`, fontSize: px(12),
            background: `${alpha(accent, 0.15)}`, border: `1px solid ${alpha(accent, 0.40)}`, color: accent, fontFamily: SERIF,
          }}
        >
          {phase === "result"
            ? <RotateCcw style={{ width: px(14), height: px(14) }} />
            : <Play style={{ width: px(14), height: px(14) }} />}
          {startLabel ?? (phase === "result" ? "Run Again" : "Begin Trial")}
        </button>
      )}

    </div>
  );
}
