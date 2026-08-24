/**
 * MIDAS — the dashboard behind the Athena Trials node.
 *
 * Replaces the flat list of six drills that used to live at `/athena`. That
 * list was a launcher: it told you what existed and nothing about how you were
 * doing, and it had no room for anything the six drills do not measure.
 *
 * This is a profile instead. You choose which scales you are developing —
 * Gardner's eight intelligences, ROME's eight cognitive domains, or any mix —
 * and add your own skills inside them. The six drills still launch from here,
 * and the ones tied to a cognitive domain feed measured scores into it.
 *
 * Everything you add lives in `localStorage` via `midasStore`. The measured
 * side comes from the existing trial and session API; nothing new was added
 * server-side, which also means nothing had to be written twice into
 * `server/routes.ts` and `api/index.ts`.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import MidasProfile, { type ProfileScale } from "@/components/MidasProfile";
import {
  MIDAS_SCALES,
  addScale,
  addSkill,
  compositeIndex,
  loadMidas,
  profileSpread,
  removeScale,
  removeSkill,
  saveMidas,
  scaleMeta,
  scaleScore,
  skillsFor,
  updateSkill,
  type MidasScaleMeta,
  type MidasSkill,
  type MidasState,
  type ScaleScore,
} from "@/lib/midasStore";

const TRIALS = [
  { href: "/athena/dual-n-back", name: "Dual N-Back",  glyph: "⟁", accent: "hsl(210 80% 62%)", scale: "working_memory" },
  { href: "/athena/cwm",         name: "Complex WM",   glyph: "◈", accent: "hsl(270 60% 65%)", scale: "working_memory" },
  { href: "/athena/mental-math", name: "Mental Math",  glyph: "∑", accent: "hsl(var(--accent-h) 88% 60%)", scale: "problem_solving" },
  { href: "/athena/corsi",       name: "Corsi Blocks", glyph: "⊞", accent: "hsl(165 55% 48%)", scale: "working_memory" },
  { href: "/athena/memory-span", name: "Memory Span",  glyph: "◎", accent: "hsl(35 90% 62%)",  scale: "recall" },
  { href: "/athena/pasat",       name: "PASAT",        glyph: "⊕", accent: "hsl(345 60% 62%)", scale: "focus" },
  { href: "/athena/flux",        name: "Flux",         glyph: "⧉", accent: "hsl(190 75% 55%)", scale: "flexibility" },
];

const SOURCE_LABEL: Record<ScaleScore["source"], string> = {
  measured: "Measured from trials",
  self: "Self-rated from skills",
  blend: "Skills + measured trials",
  empty: "No data yet",
};

const mono = "DM Mono, monospace";
const serif = "'Cinzel', serif";

export default function MidasDashboard() {
  const [state, setState] = useState<MidasState>(loadMidas);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => { saveMidas(state); }, [state]);

  const { data: domainScores } = useQuery<any[]>({
    queryKey: ["/api/domain-scores"],
    queryFn: () => apiRequest("GET", "/api/domain-scores").then(r => r.json()),
  });
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/stats"],
    queryFn: () => apiRequest("GET", "/api/stats").then(r => r.json()),
  });

  const measured = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of domainScores ?? []) if (d?.domain) map[d.domain] = Number(d.score) || 0;
    return map;
  }, [domainScores]);

  const rows = useMemo(() => state.scales.map(id => {
    const meta = scaleMeta(id)!;
    const skills = skillsFor(state, id);
    const score = scaleScore(skills, meta.domain ? measured[meta.domain] ?? null : null);
    return { meta, skills, score };
  }), [state, measured]);

  const composite = compositeIndex(rows.map(r => r.score));
  const spread = profileSpread(rows.map(r => r.score));

  const profileScales: ProfileScale[] = rows.map(r => ({
    id: r.meta.id,
    label: r.meta.label,
    glyph: r.meta.glyph,
    accent: r.meta.accent,
    score: r.score.value,
    source: r.score.source,
    skills: r.skills.map(s => ({ id: s.id, name: s.name, level: s.level })),
  }));

  const selected = rows.find(r => r.meta.id === selectedId) ?? null;
  const available = MIDAS_SCALES.filter(s => !state.scales.includes(s.id));

  function commitSkill() {
    if (!selected || !draft.trim()) return;
    setState(s => addSkill(s, selected.meta.id, draft));
    setDraft("");
  }

  return (
    <div className="max-w-5xl mx-auto py-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-6 mb-7 flex-wrap">
        <div className="flex items-center gap-3">
          <span
            className="text-2xl leading-none"
            style={{ color: "hsl(var(--accent-h) var(--accent-s) var(--accent-l))", filter: "drop-shadow(0 0 8px hsl(var(--accent-h) 80% 50% / 0.5))" }}
          >
            ◈
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-widest uppercase"
                style={{ fontFamily: serif, color: "hsl(var(--accent-h) var(--accent-s) var(--accent-l))" }}>
              MIDAS
            </h1>
            <p className="text-[11px] mt-0.5" style={{ color: "hsl(214 20% 42%)", fontFamily: mono }}>
              Multiple Intelligences Developmental Assessment
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Stat label="Index" value={composite || "—"} />
          <Stat label="Spread" value={spread || "—"} hint="strongest minus weakest" />
          <Stat label="Scales" value={rows.length} />
          <Stat
            label="Recent accuracy"
            value={stats?.recentAccuracy ? `${Math.round(stats.recentAccuracy)}%` : "—"}
            hint="last 50 trials"
          />
          <Stat label="Sessions" value={stats?.recentSessions ?? "—"} hint="last 7" />
        </div>
      </div>

      {/* ── Profile + panel ────────────────────────────────────────────── */}
      <div className="flex gap-6 items-start flex-wrap lg:flex-nowrap">
        <div className="flex-1 min-w-[320px]">
          <MidasProfile
            scales={profileScales}
            selectedId={selectedId}
            onSelect={setSelectedId}
            composite={composite}
          />
        </div>

        <div
          className="w-full lg:w-[340px] shrink-0 rounded-xl border p-4"
          style={{ background: "hsl(222 20% 5% / 0.6)", borderColor: "hsl(var(--accent-h) 15% 12%)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[8px] tracking-[0.18em] uppercase" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 40% 42%)" }}>
              {picking ? "Add a scale" : selected ? "Scale" : "Your scales"}
            </p>
            <button
              onClick={() => { setPicking(p => !p); setSelectedId(null); }}
              className="flex items-center gap-1 px-2 py-1 rounded transition-opacity hover:opacity-100"
              style={{
                fontFamily: mono, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase",
                color: "hsl(var(--accent-h) 60% 62%)",
                border: "1px solid hsl(var(--accent-h) 25% 22%)",
                opacity: 0.8,
              }}
            >
              {picking ? <X className="w-2.5 h-2.5" /> : <Plus className="w-2.5 h-2.5" />}
              {picking ? "Close" : "Add"}
            </button>
          </div>

          {picking ? (
            <ScalePicker
              available={available}
              onAdd={id => { setState(s => addScale(s, id)); setSelectedId(id); setPicking(false); }}
            />
          ) : selected ? (
            <ScaleDetail
              meta={selected.meta}
              score={selected.score}
              measured={selected.meta.domain ? measured[selected.meta.domain] ?? null : null}
              skills={selected.skills}
              draft={draft}
              onDraft={setDraft}
              onCommit={commitSkill}
              onLevel={(id, level) => setState(s => updateSkill(s, id, { level }))}
              onRemoveSkill={id => setState(s => removeSkill(s, id))}
              onRemoveScale={() => { setState(s => removeScale(s, selected.meta.id)); setSelectedId(null); }}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <ScaleList rows={rows} onSelect={setSelectedId} />
          )}
        </div>
      </div>

      {/* ── Trials ─────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <p className="text-[8px] tracking-[0.18em] uppercase mb-3" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 40% 42%)" }}>
          Trials — seven adaptive drills, feeding the measured scales
        </p>

        {/* The Arena runs up to four of them at once, and rotates them in
            blitz mode; each drill keeps its own level wherever it is played. */}
        <Link href="/athena/arena">
          <div
            className="group flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all mb-2"
            style={{ background: "hsl(var(--accent-h) 40% 12% / 0.35)", borderColor: "hsl(var(--accent-h) 40% 30% / 0.5)" }}
          >
            <span className="text-lg w-6 text-center shrink-0" style={{ color: "hsl(var(--accent-h) 70% 62%)" }}>⧈</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold tracking-wide" style={{ fontFamily: serif, color: "hsl(var(--accent-h) 70% 62%)" }}>
                Arena
              </p>
              <p className="text-[9px] mt-0.5" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 35% 46%)" }}>
                split screen up to four · blitz mode
              </p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-40 group-hover:opacity-80 transition-opacity" style={{ color: "hsl(var(--accent-h) 70% 62%)" }} />
          </div>
        </Link>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {TRIALS.map(t => {
            const active = state.scales.includes(t.scale);
            return (
              <Link key={t.href} href={t.href}>
                <div
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all"
                  style={{ background: "hsl(222 20% 5% / 0.6)", borderColor: "hsl(var(--accent-h) 15% 12%)" }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = `${t.accent}40`;
                    (e.currentTarget as HTMLDivElement).style.background = `${t.accent}08`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "hsl(var(--accent-h) 15% 12%)";
                    (e.currentTarget as HTMLDivElement).style.background = "hsl(222 20% 5% / 0.6)";
                  }}
                >
                  <span className="text-lg w-6 text-center shrink-0" style={{ color: t.accent, filter: `drop-shadow(0 0 6px ${t.accent}80)` }}>
                    {t.glyph}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold tracking-wide truncate" style={{ fontFamily: serif, color: t.accent }}>
                      {t.name}
                    </p>
                    <p className="text-[9px] mt-0.5" style={{ fontFamily: mono, color: active ? "hsl(var(--accent-h) 35% 46%)" : "hsl(214 12% 30%)" }}>
                      {active ? `→ ${scaleMeta(t.scale)?.label}` : "scale not tracked"}
                    </p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-30 group-hover:opacity-70 transition-opacity" style={{ color: t.accent }} />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div
      className="px-3 py-1.5 rounded-lg border"
      style={{ background: "hsl(222 20% 5% / 0.6)", borderColor: "hsl(var(--accent-h) 15% 12%)" }}
      title={hint}
    >
      <p className="text-[7px] tracking-[0.16em] uppercase" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 28% 38%)" }}>{label}</p>
      <p className="text-[13px] leading-tight" style={{ fontFamily: serif, color: "hsl(var(--accent-h) 65% 64%)" }}>{value}</p>
    </div>
  );
}

interface ScaleRow {
  meta: MidasScaleMeta;
  skills: MidasSkill[];
  score: ScaleScore;
}

function ScaleList({ rows, onSelect }: { rows: ScaleRow[]; onSelect: (id: string) => void }) {
  if (!rows.length) {
    return (
      <p className="text-[10px] leading-relaxed" style={{ fontFamily: mono, color: "hsl(214 14% 34%)" }}>
        Nothing tracked yet. Add a scale to start the profile — the geometry needs at least three
        before it has a shape.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <button
          key={r.meta.id}
          onClick={() => onSelect(r.meta.id)}
          className="w-full text-left px-2.5 py-2 rounded-lg border transition-colors"
          style={{ borderColor: "hsl(var(--accent-h) 12% 14%)", background: "transparent" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${r.meta.accent}40`; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--accent-h) 12% 14%)"; }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] truncate" style={{ fontFamily: mono, color: r.meta.accent }}>
              {r.meta.glyph}  {r.meta.label}
            </span>
            <span className="text-[10px] shrink-0" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 40% 50%)" }}>
              {r.score.source === "empty" ? "—" : r.score.value}
            </span>
          </div>
          <div className="mt-1.5 h-[2px] rounded" style={{ background: "hsl(var(--accent-h) 12% 16%)" }}>
            <div className="h-full rounded" style={{ width: `${r.score.value}%`, background: r.meta.accent, opacity: 0.75 }} />
          </div>
          <p className="text-[8px] mt-1" style={{ fontFamily: mono, color: "hsl(214 12% 30%)" }}>
            {r.skills.length} skill{r.skills.length === 1 ? "" : "s"} · {SOURCE_LABEL[r.score.source].toLowerCase()}
          </p>
        </button>
      ))}
    </div>
  );
}

function ScalePicker({ available, onAdd }: { available: MidasScaleMeta[]; onAdd: (id: string) => void }) {
  if (!available.length) {
    return (
      <p className="text-[10px]" style={{ fontFamily: mono, color: "hsl(214 14% 34%)" }}>
        Every scale in the catalogue is already on your profile.
      </p>
    );
  }
  const groups: { key: "intelligence" | "cognitive"; title: string; note: string }[] = [
    { key: "intelligence", title: "Intelligences", note: "Gardner's eight — self-rated from the skills you add" },
    { key: "cognitive", title: "Cognitive domains", note: "Measured from the trials ROME already records" },
  ];
  return (
    <div className="space-y-4">
      {groups.map(g => {
        const items = available.filter(s => s.group === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key}>
            <p className="text-[8px] tracking-[0.16em] uppercase" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 35% 44%)" }}>{g.title}</p>
            <p className="text-[8px] mb-2" style={{ fontFamily: mono, color: "hsl(214 12% 30%)" }}>{g.note}</p>
            <div className="space-y-1">
              {items.map(s => (
                <button
                  key={s.id}
                  onClick={() => onAdd(s.id)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg border transition-colors"
                  style={{ borderColor: "hsl(var(--accent-h) 12% 14%)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${s.accent}40`; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--accent-h) 12% 14%)"; }}
                >
                  <span className="text-[10px]" style={{ fontFamily: mono, color: s.accent }}>{s.glyph}  {s.label}</span>
                  <p className="text-[8px] mt-0.5 leading-snug" style={{ color: "hsl(214 14% 34%)" }}>{s.description}</p>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScaleDetail(props: {
  meta: MidasScaleMeta;
  score: ScaleScore;
  measured: number | null;
  skills: MidasSkill[];
  draft: string;
  onDraft: (v: string) => void;
  onCommit: () => void;
  onLevel: (id: string, level: number) => void;
  onRemoveSkill: (id: string) => void;
  onRemoveScale: () => void;
  onBack: () => void;
}) {
  const { meta, score, measured, skills } = props;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px]" style={{ fontFamily: serif, color: meta.accent }}>{meta.glyph}  {meta.label}</p>
        <p className="text-[14px]" style={{ fontFamily: serif, color: meta.accent }}>{score.source === "empty" ? "—" : score.value}</p>
      </div>
      <p className="text-[8px] mt-0.5" style={{ fontFamily: mono, color: "hsl(214 12% 32%)" }}>{SOURCE_LABEL[score.source]}</p>
      <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "hsl(214 16% 40%)" }}>{meta.description}</p>

      {measured !== null && (
        <p className="text-[9px] mt-2" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 35% 46%)" }}>
          Trial-measured domain score: {Math.round(measured)}
        </p>
      )}

      {/* Skills */}
      <p className="text-[8px] tracking-[0.16em] uppercase mt-4 mb-2" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 35% 44%)" }}>
        Skills
      </p>
      {skills.length === 0 && (
        <p className="text-[9px] mb-2" style={{ fontFamily: mono, color: "hsl(214 12% 30%)" }}>
          None yet. A skill is whatever you decide belongs here.
        </p>
      )}
      <div className="space-y-2.5">
        {skills.map(s => (
          <div key={s.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] truncate" style={{ color: "hsl(214 18% 56%)" }}>{s.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[9px]" style={{ fontFamily: mono, color: meta.accent }}>{s.level}</span>
                <button
                  onClick={() => props.onRemoveSkill(s.id)}
                  title="Remove skill"
                  className="opacity-30 hover:opacity-80 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" style={{ color: "hsl(214 20% 60%)" }} />
                </button>
              </div>
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={s.level}
              onChange={e => props.onLevel(s.id, Number(e.target.value))}
              style={{ width: "100%", accentColor: meta.accent, cursor: "pointer" }}
            />
          </div>
        ))}
      </div>

      {/* Add a skill */}
      <div className="flex gap-1.5 mt-3">
        <input
          value={props.draft}
          onChange={e => props.onDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") props.onCommit(); }}
          placeholder="Add a skill…"
          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border bg-transparent outline-none"
          style={{
            fontFamily: mono, fontSize: 10, color: "hsl(214 20% 62%)",
            borderColor: "hsl(var(--accent-h) 12% 16%)",
          }}
        />
        <button
          onClick={props.onCommit}
          className="px-2.5 rounded-lg border transition-opacity hover:opacity-100"
          style={{ borderColor: "hsl(var(--accent-h) 25% 22%)", color: meta.accent, opacity: 0.8 }}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Practise */}
      {meta.trials?.length ? (
        <>
          <p className="text-[8px] tracking-[0.16em] uppercase mt-4 mb-1.5" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 35% 44%)" }}>
            Practise
          </p>
          <div className="flex flex-wrap gap-1.5">
            {meta.trials.map(href => {
              const trial = TRIALS.find(t => t.href === href);
              if (!trial) return null;
              return (
                <Link key={href} href={href}>
                  <span
                    className="inline-block px-2 py-1 rounded border cursor-pointer transition-colors"
                    style={{ fontFamily: mono, fontSize: 8, color: trial.accent, borderColor: `${trial.accent}33` }}
                  >
                    {trial.glyph} {trial.name}
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="flex items-center justify-between mt-5 pt-3" style={{ borderTop: "1px solid hsl(var(--accent-h) 12% 14%)" }}>
        <button onClick={props.onBack} className="text-[8px] tracking-[0.14em] uppercase opacity-50 hover:opacity-90 transition-opacity"
                style={{ fontFamily: mono, color: "hsl(214 20% 60%)" }}>
          ← All scales
        </button>
        <button onClick={props.onRemoveScale} className="text-[8px] tracking-[0.14em] uppercase opacity-40 hover:opacity-90 transition-opacity"
                style={{ fontFamily: mono, color: "hsl(345 60% 62%)" }}>
          Remove scale
        </button>
      </div>
    </div>
  );
}
