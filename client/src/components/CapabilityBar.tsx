/**
 * CapabilityBar — the band on the MIDAS dashboard, and the ledger behind it.
 *
 * MIDAS proper is a *shape*: a polygon whose spikes and flats are the finding,
 * with no single number because a single number would flatten exactly what the
 * instrument exists to show. Capability is the other question — how much have
 * you actually finished — and it is kept next to the profile rather than inside
 * it so neither one contaminates the other.
 *
 * ── Confidence, not level. Credit, not exp. ─────────────────────────────────
 *
 * The words are load-bearing. A *level* is something a system grants you and
 * you cannot argue with. *Confidence* is a claim you are making about yourself,
 * and this panel is the evidence for it: every entry is listed, every entry's
 * credit can be edited, and removing an entry takes its credit back. That last
 * property is the whole design. A bar that only goes up would be measuring how
 * long you have had the app installed.
 *
 * Entries arrive from two places: checking off a Task Stabilizer task (the
 * credit you set when you added it), and typing one in here for work that
 * happened somewhere else.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  CAPABILITY_EVENT,
  addEntry,
  confidenceFor,
  creditToReach,
  loadCapability,
  notifyCapabilityChanged,
  removeEntry,
  saveCapability,
  tierProgress,
  totalCredit,
  updateEntry,
  type CapabilityState,
} from "@/lib/capabilityStore";

const mono = "DM Mono, monospace";
const serif = "'Cinzel', serif";

const SURFACE = "hsl(222 20% 5% / 0.6)";
const HAIRLINE = "hsl(var(--accent-h) 15% 12%)";
const EYEBROW = "hsl(var(--accent-h) 40% 42%)";
const ACCENT = "hsl(var(--accent-h) 65% 64%)";
const MUTED = "hsl(214 20% 42%)";
const FAINT = "hsl(214 14% 34%)";

function fmtDay(at: number) {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function CapabilityBar({ profileId }: { profileId: number | undefined }) {
  const [state, setState] = useState<CapabilityState>(() => loadCapability(profileId));
  const [open, setOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCredit, setDraftCredit] = useState(10);

  // Re-read on profile switch. The ledger is per-profile, like the Stabilizer's
  // task list, so this is a different ledger entirely rather than a filter.
  useEffect(() => { setState(loadCapability(profileId)); }, [profileId]);

  // The Task Stabilizer writes the same key from the constellation overlay,
  // which can be floating over this very page. Re-read rather than trying to
  // keep two React trees in step.
  useEffect(() => {
    const refresh = () => setState(loadCapability(profileId));
    window.addEventListener(CAPABILITY_EVENT, refresh);
    return () => window.removeEventListener(CAPABILITY_EVENT, refresh);
  }, [profileId]);

  const commit = useCallback((next: CapabilityState) => {
    setState(next);
    saveCapability(profileId, next);
    notifyCapabilityChanged();
  }, [profileId]);

  const total = useMemo(() => totalCredit(state), [state]);
  const conf = confidenceFor(total);
  const progress = tierProgress(conf);
  const toNext = Math.max(0, conf.span - conf.into);

  const fromStabilizer = state.entries.filter(e => e.source === "stabilizer").length;

  return (
    <div className="mt-8">
      <p className="text-[8px] tracking-[0.18em] uppercase mb-3" style={{ fontFamily: mono, color: EYEBROW }}>
        Capability — credit banked from work you finished
      </p>

      {/* ── The band ─────────────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        className="rounded-xl border px-4 py-3 cursor-pointer transition-all"
        style={{
          background: SURFACE,
          borderColor: open ? "hsl(var(--accent-h) 30% 24%)" : HAIRLINE,
          borderBottomLeftRadius: open ? 0 : undefined,
          borderBottomRightRadius: open ? 0 : undefined,
        }}
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[14px] leading-none" style={{ fontFamily: serif, color: ACCENT }}>
            Confidence {conf.tier}
          </span>
          <span className="text-[9px]" style={{ fontFamily: mono, color: MUTED }}>
            {conf.into} / {conf.span} credit this tier
          </span>
          <span className="ml-auto text-[9px]" style={{ fontFamily: mono, color: FAINT }}>
            {total} total · {toNext === 0 ? "tier complete" : `${toNext} to Confidence ${conf.tier + 1}`}
          </span>
          <ChevronDown
            className="w-3 h-3 shrink-0 transition-transform"
            style={{ color: EYEBROW, transform: open ? "rotate(180deg)" : undefined }}
          />
        </div>

        {/* Same 2px bar the scale rows use, so the page reads as one system. */}
        <div className="mt-2 h-[2px] rounded" style={{ background: "hsl(var(--accent-h) 12% 16%)" }}>
          <div
            className="h-full rounded transition-all"
            style={{ width: `${progress * 100}%`, background: ACCENT, opacity: 0.85 }}
          />
        </div>

        <p className="text-[8px] mt-2" style={{ fontFamily: mono, color: FAINT }}>
          {state.entries.length === 0
            ? "Nothing banked yet — check a task off in the Task Stabilizer, or add one below"
            : `${state.entries.length} entries · ${fromStabilizer} from the Stabilizer`}
        </p>
      </div>

      {/* ── The ledger ───────────────────────────────────────────────────── */}
      {open && (
        <div
          className="rounded-b-xl border border-t-0 px-4 py-3"
          style={{ background: "hsl(222 20% 4% / 0.6)", borderColor: "hsl(var(--accent-h) 30% 24%)" }}
        >
          {/* Add by hand — for work that did not go through the Stabilizer. */}
          <div className="flex gap-2 mb-3">
            <input
              value={draftLabel}
              onChange={e => setDraftLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key !== "Enter" || !draftLabel.trim()) return;
                commit(addEntry(state, draftLabel, draftCredit, "manual"));
                setDraftLabel("");
              }}
              placeholder="Something you finished elsewhere…"
              className="flex-1 min-w-0 rounded px-2 py-1.5 outline-none"
              style={{
                fontFamily: mono, fontSize: 9,
                background: "hsl(222 22% 3%)", border: `1px solid ${HAIRLINE}`, color: "hsl(214 18% 66%)",
              }}
            />
            <input
              type="number" min={0} max={10000}
              value={draftCredit}
              onChange={e => setDraftCredit(Math.max(0, Math.min(10000, Number(e.target.value))))}
              title="Credit"
              className="w-14 rounded px-1 py-1.5 outline-none text-center"
              style={{
                fontFamily: mono, fontSize: 9,
                background: "hsl(222 22% 3%)", border: `1px solid ${HAIRLINE}`, color: ACCENT,
              }}
            />
            <button
              onClick={() => {
                if (!draftLabel.trim()) return;
                commit(addEntry(state, draftLabel, draftCredit, "manual"));
                setDraftLabel("");
              }}
              disabled={!draftLabel.trim()}
              className="px-2 rounded transition-opacity disabled:opacity-30"
              style={{ border: "1px solid hsl(var(--accent-h) 25% 22%)", color: ACCENT }}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {state.entries.length === 0 ? (
            <p className="text-[9px] py-2" style={{ fontFamily: mono, color: FAINT }}>
              The ledger is empty. Every entry here is one you can edit or remove — that is
              what keeps the number above worth reading.
            </p>
          ) : (
            <div className="flex flex-col" style={{ maxHeight: 320, overflowY: "auto" }}>
              {state.entries.map(entry => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-2 py-1.5"
                  style={{ borderBottom: `1px solid ${HAIRLINE}` }}
                >
                  <span
                    className="w-1 h-1 rounded-full shrink-0"
                    style={{ background: entry.source === "stabilizer" ? ACCENT : "hsl(214 14% 30%)" }}
                    title={entry.source === "stabilizer" ? "Checked off in the Task Stabilizer" : "Added by hand"}
                  />
                  <input
                    value={entry.label}
                    onChange={e => commit(updateEntry(state, entry.id, { label: e.target.value }))}
                    className="flex-1 min-w-0 bg-transparent outline-none"
                    style={{ fontFamily: mono, fontSize: 9.5, color: "hsl(214 18% 66%)" }}
                  />
                  <span className="text-[8px] shrink-0" style={{ fontFamily: mono, color: FAINT }}>
                    {fmtDay(entry.at)}
                  </span>
                  <input
                    type="number" min={0} max={10000}
                    value={entry.credit}
                    onChange={e => commit(updateEntry(state, entry.id, { credit: Number(e.target.value) }))}
                    className="w-12 rounded px-1 py-0.5 outline-none text-center shrink-0"
                    style={{
                      fontFamily: mono, fontSize: 9,
                      background: "transparent", border: `1px solid ${HAIRLINE}`, color: ACCENT,
                    }}
                  />
                  <button
                    onClick={() => commit(removeEntry(state, entry.id))}
                    title="Remove — takes its credit back"
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: "hsl(0 48% 52%)" }}
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-[8px] mt-3" style={{ fontFamily: mono, color: FAINT }}>
            Tier {conf.tier} runs from {creditToReach(conf.tier - 1)} to {creditToReach(conf.tier)} credit.
            Each tier costs more than the last.
          </p>
        </div>
      )}
    </div>
  );
}
