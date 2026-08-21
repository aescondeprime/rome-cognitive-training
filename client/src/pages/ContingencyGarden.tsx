/**
 * Contingency Garden — the Strategic node's planning canvas.
 *
 * Replaces the Taskboard, which was a third list of tasks in an app that
 * already had two better ones: Kronos Keep for anything with a time on it, and
 * the Task Stabilizer for whatever you are doing right now. What neither of
 * those could do is hold a plan that has *alternatives* in it.
 *
 * So this is not a task list. Every branch is an action, contingencies hang off
 * the actions that might fail, and a plan is a route traced through the tree
 * rather than a separate document. You can grow the tree first and decide what
 * Plan A is afterwards, which is the order these things actually happen in.
 *
 * Data lives in `localStorage` via `gardenStore`. The only server contact is
 * scheduling a plan into Kronos Keep, which uses endpoints that already exist —
 * nothing had to be written twice into `server/routes.ts` and `api/index.ts`.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Download, Flag, Loader2, Plus, Sprout, Trash2, Wand2, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { playCue } from "@/lib/sound";
import GardenCanvas, { formatMinutes } from "@/components/GardenCanvas";
import {
  addBranch, addChecklistItem, addPlan, branchById, childrenOf, emptyGarden, isTerminal,
  layoutGarden, loadGarden, planDuration, planOrder, PLAN_COLORS, removeBranch,
  removeChecklistItem, removePlan, retidy, saveGarden, schedulePlan, scheduleNotes,
  setGoal, toggleBranchPlan, toggleChecklistItem, updateBranch, updatePlan,
  type Branch, type GardenState,
} from "@/lib/gardenStore";

const mono = "DM Mono, monospace";
const serif = "'Cinzel', serif";

interface Calendar { id: number; name: string }
interface ImportItem { key: string; title: string; minutes: number; origin: "kronos" | "stabilizer"; detail: string }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ContingencyGarden() {
  const [garden, setGarden] = useState<GardenState>(loadGarden);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tracer, setTracer] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "import" | "schedule">("none");

  useEffect(() => { saveGarden(garden); }, [garden]);

  const qc = useQueryClient();
  const { data: profile } = useQuery<any>({
    queryKey: ["/api/active-profile"],
    queryFn: () => apiRequest("GET", "/api/active-profile").then(r => r.json()),
  });
  const { data: calendars } = useQuery<Calendar[]>({
    queryKey: ["/kronos/calendars"],
    queryFn: () => apiRequest("GET", "/api/kronos/calendars").then(r => r.json()),
  });

  const laid = useMemo(() => layoutGarden(garden), [garden]);
  const selected = branchById(garden, selectedId) ?? null;

  function mutate(fn: (s: GardenState) => GardenState) {
    setGarden(fn);
  }

  function handleTrace(id: string) {
    if (!tracer) return;
    playCue("nodeSelect");
    mutate(s => toggleBranchPlan(s, id, tracer));
  }

  function handleSprout(parentId: string) {
    const before = garden.branches.length;
    const next = addBranch(garden, parentId, { action: "", label: "" });
    if (next.branches.length === before) return;
    setGarden(next);
    // Select the new branch so the label field is right there — a contingency
    // without a "when would I reach for this" is just another task.
    setSelectedId(next.branches[next.branches.length - 1].id);
    setPanel("none");
  }

  function plantRoot() {
    const next = addBranch(garden, null, { action: "", label: "" });
    setGarden(next);
    setSelectedId(next.branches[next.branches.length - 1].id);
  }

  return (
    <div className="max-w-[1400px] mx-auto py-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-6 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <Sprout className="w-5 h-5" style={{ color: "hsl(146 60% 52%)" }} />
          <div>
            <h1 className="text-sm font-semibold tracking-widest uppercase"
                style={{ fontFamily: serif, color: "hsl(146 60% 52%)" }}>
              Contingency Garden
            </h1>
            <p className="text-[11px] mt-0.5" style={{ color: "hsl(214 20% 42%)", fontFamily: mono }}>
              Grow the tree, then trace the plan through it
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={plantRoot} style={toolButton()}>
            <Plus className="w-2.5 h-2.5" /> Action
          </button>
          <button onClick={() => setPanel(p => (p === "import" ? "none" : "import"))} style={toolButton(panel === "import")}>
            <Download className="w-2.5 h-2.5" /> Import
          </button>
          <button onClick={() => mutate(retidy)} style={toolButton()} title="Drop every manual position">
            <Wand2 className="w-2.5 h-2.5" /> Re-tidy
          </button>
          <button onClick={() => setPanel(p => (p === "schedule" ? "none" : "schedule"))} style={toolButton(panel === "schedule")}>
            <CalendarPlus className="w-2.5 h-2.5" /> Schedule
          </button>
        </div>
      </div>

      {/* ── Plan tracers ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-[8px] tracking-[0.18em] uppercase mr-1" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 35% 40%)" }}>
          Tracers
        </span>
        {garden.plans.map(plan => {
          const armed = tracer === plan.letter;
          const count = planOrder(garden, plan.letter).length;
          return (
            <button
              key={plan.letter}
              onClick={() => setTracer(armed ? null : plan.letter)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
              style={{
                fontFamily: mono, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase",
                color: armed ? `hsl(${plan.color})` : "hsl(214 16% 46%)",
                background: armed ? `hsl(${plan.color} / 0.14)` : "hsl(222 20% 7% / 0.6)",
                border: `1px solid ${armed ? `hsl(${plan.color} / 0.65)` : "hsl(var(--accent-h) 15% 16%)"}`,
                boxShadow: armed ? `0 0 12px hsl(${plan.color} / 0.3)` : "none",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 2, background: `hsl(${plan.color})` }} />
              Plan {plan.letter} Tracer
              <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          );
        })}
        <button onClick={() => mutate(addPlan)} style={toolButton()}>
          <Plus className="w-2.5 h-2.5" /> Plan
        </button>

        {tracer && (
          <div className="flex items-center gap-2 ml-2">
            <span className="text-[8px]" style={{ fontFamily: mono, color: "hsl(214 16% 40%)" }}>
              click branches to add or remove them
            </span>
            {PLAN_COLORS.map(c => (
              <button
                key={c}
                onClick={() => mutate(s => updatePlan(s, tracer, { color: c }))}
                title="Plan colour"
                style={{
                  width: 13, height: 13, borderRadius: 3, background: `hsl(${c})`,
                  border: garden.plans.find(p => p.letter === tracer)?.color === c
                    ? "1.5px solid hsl(43 20% 92%)" : "1.5px solid transparent",
                  cursor: "pointer",
                }}
              />
            ))}
            {garden.plans.length > 1 && (
              <button
                onClick={() => { mutate(s => removePlan(s, tracer)); setTracer(null); }}
                className="opacity-40 hover:opacity-90 transition-opacity"
                title="Remove this plan"
              >
                <Trash2 className="w-3 h-3" style={{ color: "hsl(345 60% 62%)" }} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Panels ─────────────────────────────────────────────────────── */}
      {panel === "import" && (
        <ImportPanel
          profileId={profile?.id}
          calendars={calendars ?? []}
          targetId={selected && !isTerminal(selected) ? selected.id : null}
          targetLabel={selected?.action || "the selected branch"}
          onImport={items => {
            let next = garden;
            const parent = selected && !isTerminal(selected) ? selected.id : null;
            for (const item of items) {
              next = addBranch(next, parent, {
                action: item.title,
                durationMinutes: item.minutes,
                source: item.origin,
              });
            }
            setGarden(next);
            setPanel("none");
          }}
          onClose={() => setPanel("none")}
        />
      )}

      {panel === "schedule" && (
        <SchedulePanel
          garden={garden}
          calendars={calendars ?? []}
          onDone={() => { setPanel("none"); qc.invalidateQueries({ queryKey: ["kronos-today"] }); }}
          onClose={() => setPanel("none")}
        />
      )}

      {/* ── Canvas + inspector ─────────────────────────────────────────── */}
      <div className="flex gap-4 items-start flex-wrap xl:flex-nowrap">
        <div className="flex-1 min-w-[340px]">
          <GardenCanvas
            laid={laid}
            plans={garden.plans}
            selectedId={selectedId}
            tracer={tracer}
            onSelect={setSelectedId}
            onTrace={handleTrace}
            onMove={(id, pos) => mutate(s => updateBranch(s, id, { pos }))}
            onSprout={handleSprout}
          />
          <p className="text-[8px] mt-2" style={{ fontFamily: mono, color: "hsl(214 12% 30%)" }}>
            {garden.branches.length} branches ·{" "}
            {garden.plans.map(p => `Plan ${p.letter} ${formatMinutes(planDuration(garden, p.letter))}`).join("  ·  ")}
          </p>
        </div>

        {selected && (
          <Inspector
            garden={garden}
            branch={selected}
            onChange={mutate}
            onClose={() => setSelectedId(null)}
            onDeleted={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Inspector ─────────────────────────────────────────────────────────────

function Inspector({ garden, branch, onChange, onClose, onDeleted }: {
  garden: GardenState;
  branch: Branch;
  onChange: (fn: (s: GardenState) => GardenState) => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [checkDraft, setCheckDraft] = useState("");
  const hasChildren = childrenOf(garden, branch.id).length > 0;
  const terminal = isTerminal(branch);

  return (
    <div
      className="w-full xl:w-[330px] shrink-0 rounded-xl border p-4"
      style={{ background: "hsl(222 20% 5% / 0.6)", borderColor: "hsl(var(--accent-h) 15% 12%)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[8px] tracking-[0.18em] uppercase" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 40% 42%)" }}>
          Branch
        </p>
        <button onClick={onClose} className="opacity-40 hover:opacity-90 transition-opacity">
          <X className="w-3 h-3" style={{ color: "hsl(214 20% 60%)" }} />
        </button>
      </div>

      <Field label="Label — when would you take this branch?">
        <input
          autoFocus={!branch.label && branch.parentId !== null}
          value={branch.label}
          onChange={e => onChange(s => updateBranch(s, branch.id, { label: e.target.value }))}
          placeholder={branch.parentId === null ? "optional on a root" : "if the vendor stalls…"}
          style={inputStyle()}
        />
      </Field>

      <Field label="Action">
        <textarea
          value={branch.action}
          onChange={e => onChange(s => updateBranch(s, branch.id, { action: e.target.value }))}
          placeholder="What you would actually do"
          rows={2}
          style={{ ...inputStyle(), resize: "vertical" }}
        />
      </Field>

      <Field label={`Duration — ${formatMinutes(branch.durationMinutes)}`}>
        <div className="flex items-center gap-2">
          <input
            type="range" min={5} max={480} step={5}
            value={Math.min(480, branch.durationMinutes)}
            onChange={e => onChange(s => updateBranch(s, branch.id, { durationMinutes: Number(e.target.value) }))}
            style={{ flex: 1, accentColor: "hsl(var(--accent-h) var(--accent-s) var(--accent-l))", cursor: "pointer" }}
          />
          <input
            type="number" min={1} max={1440}
            value={branch.durationMinutes}
            onChange={e => onChange(s => updateBranch(s, branch.id, { durationMinutes: Number(e.target.value) }))}
            style={{ ...inputStyle(), width: 62, textAlign: "right" }}
          />
        </div>
      </Field>

      <Field label="Goal — writing one ends this line of reasoning">
        <textarea
          value={branch.goal}
          disabled={hasChildren && !terminal}
          onChange={e => onChange(s => setGoal(s, branch.id, e.target.value))}
          placeholder={hasChildren && !terminal ? "this branch has contingencies below it" : "what success looks like"}
          rows={2}
          style={{
            ...inputStyle(),
            resize: "vertical",
            opacity: hasChildren && !terminal ? 0.4 : 1,
            borderColor: terminal ? "hsl(146 45% 30%)" : undefined,
          }}
        />
        {terminal && (
          <p className="text-[8px] mt-1 flex items-center gap-1" style={{ fontFamily: mono, color: "hsl(146 55% 50%)" }}>
            <Flag className="w-2.5 h-2.5" /> terminal — no contingencies from here
          </p>
        )}
      </Field>

      {/* Checklist */}
      <p className="text-[8px] tracking-[0.16em] uppercase mt-4 mb-1.5" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 35% 44%)" }}>
        Checklist
      </p>
      <div className="space-y-1">
        {branch.checklist.map(item => (
          <div key={item.id} className="flex items-center gap-2">
            <button
              onClick={() => onChange(s => toggleChecklistItem(s, branch.id, item.id))}
              style={{
                width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                border: `1px solid ${item.done ? "hsl(146 55% 45%)" : "hsl(var(--accent-h) 20% 26%)"}`,
                background: item.done ? "hsl(146 55% 45% / 0.25)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {item.done && <Check className="w-2 h-2" style={{ color: "hsl(146 60% 60%)" }} />}
            </button>
            <span
              className="flex-1 min-w-0 truncate text-[10px]"
              style={{ color: item.done ? "hsl(214 12% 32%)" : "hsl(214 18% 56%)", textDecoration: item.done ? "line-through" : "none" }}
            >
              {item.text}
            </span>
            <button onClick={() => onChange(s => removeChecklistItem(s, branch.id, item.id))} className="opacity-25 hover:opacity-80 transition-opacity">
              <X className="w-2.5 h-2.5" style={{ color: "hsl(214 20% 60%)" }} />
            </button>
          </div>
        ))}
      </div>
      <input
        value={checkDraft}
        onChange={e => setCheckDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key !== "Enter" || !checkDraft.trim()) return;
          onChange(s => addChecklistItem(s, branch.id, checkDraft));
          setCheckDraft("");
        }}
        placeholder="Add a step, then Enter"
        style={{ ...inputStyle(), marginTop: 6 }}
      />

      {/* Plans this branch is on */}
      {branch.plans.length > 0 && (
        <p className="text-[8px] mt-3" style={{ fontFamily: mono, color: "hsl(214 14% 36%)" }}>
          On {branch.plans.slice().sort().map(l => `Plan ${l}`).join(", ")}
        </p>
      )}

      <div className="flex items-center justify-between mt-5 pt-3" style={{ borderTop: "1px solid hsl(var(--accent-h) 12% 14%)" }}>
        <span className="text-[8px]" style={{ fontFamily: mono, color: "hsl(214 12% 30%)" }}>
          {branch.source === "manual" ? "" : `imported from ${branch.source}`}
        </span>
        <button
          onClick={() => { onChange(s => removeBranch(s, branch.id)); onDeleted(); }}
          className="text-[8px] tracking-[0.14em] uppercase opacity-45 hover:opacity-95 transition-opacity"
          style={{ fontFamily: mono, color: "hsl(345 60% 62%)" }}
        >
          Delete branch{childrenOf(garden, branch.id).length ? " + below" : ""}
        </button>
      </div>
    </div>
  );
}

// ── Import ────────────────────────────────────────────────────────────────

function ImportPanel({ profileId, calendars, targetId, targetLabel, onImport, onClose }: {
  profileId: number | undefined;
  calendars: Calendar[];
  targetId: string | null;
  targetLabel: string;
  onImport: (items: ImportItem[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const { data: kronos, isLoading } = useQuery<ImportItem[]>({
    queryKey: ["garden-import", calendars.map(c => c.id).join(",")],
    enabled: calendars.length > 0,
    queryFn: async () => {
      const out: ImportItem[] = [];
      for (const cal of calendars) {
        for (const kind of ["assignments", "events", "routines"] as const) {
          try {
            const rows = await apiRequest("GET", `/api/kronos/calendars/${cal.id}/${kind}`).then(r => r.json());
            for (const row of rows ?? []) {
              out.push({
                key: `${kind}-${row.id}`,
                title: String(row.title ?? "Untitled"),
                minutes: Number(row.duration_minutes) || 30,
                origin: "kronos",
                detail: `${kind.slice(0, -1)} · ${cal.name}`,
              });
            }
          } catch { /* one missing kind should not empty the whole panel */ }
        }
      }
      return out;
    },
  });

  // The Stabilizer keeps its queue in localStorage, profile-scoped. Read it the
  // same way the widget does rather than inventing a second source of truth.
  const stabilizer = useMemo<ImportItem[]>(() => {
    try {
      const raw = (window as any)["local" + "Storage"].getItem(`rome_task_stabilizer_v1:${profileId ?? "default"}`);
      const rows = JSON.parse(raw ?? "[]");
      if (!Array.isArray(rows)) return [];
      return rows
        .filter((t: any) => !t.completedAt)
        .map((t: any) => ({
          key: `stab-${t.id}`,
          title: String(t.title ?? "Untitled"),
          minutes: t.timer?.durationSeconds ? Math.max(1, Math.round(t.timer.durationSeconds / 60)) : 25,
          origin: "stabilizer" as const,
          detail: "Task Stabilizer",
        }));
    } catch {
      return [];
    }
  }, [profileId]);

  const all = [...stabilizer, ...(kronos ?? [])];
  const chosen = all.filter(i => picked.has(i.key));

  return (
    <div className="rounded-xl border p-4 mb-3" style={{ background: "hsl(222 20% 5% / 0.7)", borderColor: "hsl(var(--accent-h) 20% 18%)" }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[8px] tracking-[0.18em] uppercase" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 40% 44%)" }}>
          Import as {targetId ? `contingencies of “${targetLabel}”` : "new root actions"}
        </p>
        <button onClick={onClose} className="opacity-40 hover:opacity-90 transition-opacity">
          <X className="w-3 h-3" style={{ color: "hsl(214 20% 60%)" }} />
        </button>
      </div>

      {isLoading && (
        <p className="text-[9px] flex items-center gap-1.5" style={{ fontFamily: mono, color: "hsl(214 14% 36%)" }}>
          <Loader2 className="w-3 h-3 animate-spin" /> reading Kronos Keep…
        </p>
      )}

      {!isLoading && all.length === 0 && (
        <p className="text-[9px]" style={{ fontFamily: mono, color: "hsl(214 14% 34%)" }}>
          Nothing to import — no open Stabilizer tasks and no Kronos items.
        </p>
      )}

      <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
        {all.map(item => {
          const on = picked.has(item.key);
          return (
            <button
              key={item.key}
              onClick={() => setPicked(prev => {
                const next = new Set(prev);
                if (next.has(item.key)) next.delete(item.key); else next.add(item.key);
                return next;
              })}
              className="text-left px-2.5 py-2 rounded-lg border transition-colors"
              style={{
                borderColor: on ? "hsl(146 50% 38%)" : "hsl(var(--accent-h) 12% 15%)",
                background: on ? "hsl(146 50% 38% / 0.1)" : "transparent",
              }}
            >
              <p className="text-[10px] truncate" style={{ color: "hsl(214 20% 62%)" }}>{item.title}</p>
              <p className="text-[8px] mt-0.5" style={{ fontFamily: mono, color: "hsl(214 12% 32%)" }}>
                {item.detail} · {formatMinutes(item.minutes)}
              </p>
            </button>
          );
        })}
      </div>

      {chosen.length > 0 && (
        <button onClick={() => onImport(chosen)} className="mt-3" style={toolButton(true)}>
          <Download className="w-2.5 h-2.5" /> Import {chosen.length}
        </button>
      )}
    </div>
  );
}

// ── Schedule ──────────────────────────────────────────────────────────────

function SchedulePanel({ garden, calendars, onDone, onClose }: {
  garden: GardenState;
  calendars: Calendar[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [letter, setLetter] = useState(garden.plans[0]?.letter ?? "A");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("09:00");
  const [calendarId, setCalendarId] = useState<number | null>(calendars[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = garden.plans.find(p => p.letter === letter);
  const actions = planOrder(garden, letter);
  const slots = schedulePlan(actions, date, time);
  const total = actions.reduce((sum, b) => sum + b.durationMinutes, 0);

  async function commit() {
    if (!actions.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      let target = calendarId;
      if (!target) {
        const created = await apiRequest("POST", "/api/kronos/calendars", { name: "My Calendar" }).then(r => r.json());
        target = created.id;
      }
      for (const slot of slots) {
        await apiRequest("POST", `/api/kronos/calendars/${target}/assignments`, {
          title: slot.branch.action || "Untitled action",
          color: `hsl(${plan?.color ?? PLAN_COLORS[0]})`,
          start_time: slot.startTime,
          duration_minutes: slot.branch.durationMinutes,
          due_date: slot.date,
          instructions: scheduleNotes(slot.branch),
        });
      }
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Could not reach Kronos Keep");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border p-4 mb-3" style={{ background: "hsl(222 20% 5% / 0.7)", borderColor: "hsl(var(--accent-h) 20% 18%)" }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[8px] tracking-[0.18em] uppercase" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 40% 44%)" }}>
          Add a plan to Kronos Keep
        </p>
        <button onClick={onClose} className="opacity-40 hover:opacity-90 transition-opacity">
          <X className="w-3 h-3" style={{ color: "hsl(214 20% 60%)" }} />
        </button>
      </div>

      <div className="flex gap-2 flex-wrap items-end mb-3">
        <Field label="Plan" inline>
          <select value={letter} onChange={e => setLetter(e.target.value)} style={{ ...inputStyle(), width: 82 }}>
            {garden.plans.map(p => <option key={p.letter} value={p.letter}>Plan {p.letter}</option>)}
          </select>
        </Field>
        <Field label="Date" inline>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle(), width: 132 }} />
        </Field>
        <Field label="Start" inline>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inputStyle(), width: 96 }} />
        </Field>
        <Field label="Calendar" inline>
          <select
            value={calendarId ?? ""}
            onChange={e => setCalendarId(e.target.value ? Number(e.target.value) : null)}
            style={{ ...inputStyle(), width: 150 }}
          >
            {calendars.length === 0 && <option value="">create “My Calendar”</option>}
            {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      {actions.length === 0 ? (
        <p className="text-[9px]" style={{ fontFamily: mono, color: "hsl(214 14% 34%)" }}>
          Plan {letter} has no branches yet. Arm its tracer and click the actions that belong to it.
        </p>
      ) : (
        <>
          {/* Each action starts when the one before it ends — which is the
              reason the durations on the branches are worth setting. */}
          <div className="space-y-1 mb-3" style={{ maxHeight: 190, overflowY: "auto" }}>
            {slots.map((slot, i) => (
              <div key={slot.branch.id} className="flex items-center gap-3 px-2.5 py-1.5 rounded-lg"
                   style={{ background: "hsl(222 20% 7% / 0.7)" }}>
                <span className="text-[8px] w-4 shrink-0" style={{ fontFamily: mono, color: "hsl(214 12% 30%)" }}>{i + 1}</span>
                <span className="text-[9px] shrink-0" style={{ fontFamily: mono, color: `hsl(${plan?.color})` }}>
                  {slot.startTime}
                </span>
                <span className="flex-1 min-w-0 truncate text-[10px]" style={{ color: "hsl(214 18% 58%)" }}>
                  {slot.branch.action || "Untitled action"}
                </span>
                <span className="text-[8px] shrink-0" style={{ fontFamily: mono, color: "hsl(214 12% 34%)" }}>
                  {formatMinutes(slot.branch.durationMinutes)}
                  {slot.date !== date ? ` · ${slot.date}` : ""}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={commit} disabled={busy} style={toolButton(true)}>
              {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CalendarPlus className="w-2.5 h-2.5" />}
              Add {actions.length} to Kronos
            </button>
            <span className="text-[8px]" style={{ fontFamily: mono, color: "hsl(214 12% 34%)" }}>
              total {formatMinutes(total)}
            </span>
            {error && <span className="text-[8px]" style={{ fontFamily: mono, color: "hsl(345 60% 62%)" }}>{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Small shared bits ─────────────────────────────────────────────────────

function Field({ label, children, inline }: { label: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <div style={{ marginBottom: inline ? 0 : 10 }}>
      <p className="text-[8px] tracking-[0.14em] uppercase mb-1" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 30% 38%)" }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "5px 8px",
    borderRadius: 6,
    background: "transparent",
    border: "1px solid hsl(var(--accent-h) 12% 17%)",
    color: "hsl(214 20% 66%)",
    fontFamily: mono,
    fontSize: 10,
    outline: "none",
  };
}

function toolButton(active = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    borderRadius: 6,
    fontFamily: mono,
    fontSize: 8,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: "pointer",
    color: active ? "hsl(var(--accent-h) 70% 66%)" : "hsl(214 16% 48%)",
    background: active ? "hsl(var(--accent-h) 60% 50% / 0.14)" : "hsl(222 20% 7% / 0.6)",
    border: `1px solid ${active ? "hsl(var(--accent-h) 50% 40%)" : "hsl(var(--accent-h) 15% 16%)"}`,
  };
}
