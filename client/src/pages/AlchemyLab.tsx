/**
 * AlchemyLab — Nootropics library.
 *
 * Lets the user catalog any nootropic compound with:
 *   name, category, mechanism of action, cognitive effects (tagged),
 *   dosage range, half-life, personal notes.
 *
 * All data is synced to Supabase and tied to the active profile.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  FlaskConical, Plus, Search, Trash2, PenLine, X,
  Check, Loader2, ChevronDown, ChevronRight, Zap,
  Brain, Shield, Smile, Battery,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ──────────────────────────────────────────────────────────────────
type Category =
  | "racetam"
  | "adaptogen"
  | "cholinergic"
  | "stimulant"
  | "amino_acid"
  | "vitamin"
  | "mushroom"
  | "peptide"
  | "cannabinoid"
  | "other";

interface Nootropic {
  id:         number;
  name:       string;
  category:   Category;
  mechanism:  string;
  effects:    string;   // comma-separated effect tags
  dosage:     string;
  half_life:  string;
  notes:      string;
  created_at: number;
  updated_at: number;
}

// ── Config ─────────────────────────────────────────────────────────────────
const CATEGORIES: Record<Category, { label: string; color: string; bg: string; border: string }> = {
  racetam:     { label: "Racetam",      color: "hsl(270 65% 70%)", bg: "hsl(270 40% 8%)",  border: "hsl(270 40% 22%)" },
  adaptogen:   { label: "Adaptogen",    color: "hsl(145 55% 58%)", bg: "hsl(145 30% 7%)",  border: "hsl(145 30% 20%)" },
  cholinergic: { label: "Cholinergic",  color: "hsl(210 65% 65%)", bg: "hsl(210 35% 8%)",  border: "hsl(210 35% 22%)" },
  stimulant:   { label: "Stimulant",    color: "hsl(38 80% 60%)",  bg: "hsl(38 40% 7%)",   border: "hsl(38 40% 22%)" },
  amino_acid:  { label: "Amino Acid",   color: "hsl(175 55% 55%)", bg: "hsl(175 30% 7%)",  border: "hsl(175 30% 20%)" },
  vitamin:     { label: "Vitamin",      color: "hsl(55 75% 58%)",  bg: "hsl(55 35% 7%)",   border: "hsl(55 35% 20%)" },
  mushroom:    { label: "Mushroom",     color: "hsl(20 65% 58%)",  bg: "hsl(20 35% 7%)",   border: "hsl(20 35% 20%)" },
  peptide:     { label: "Peptide",      color: "hsl(320 55% 62%)", bg: "hsl(320 30% 7%)",  border: "hsl(320 30% 20%)" },
  cannabinoid: { label: "Cannabinoid",  color: "hsl(100 50% 55%)", bg: "hsl(100 25% 7%)",  border: "hsl(100 25% 20%)" },
  other:       { label: "Other",        color: "hsl(220 25% 55%)", bg: "hsl(220 15% 8%)",  border: "hsl(220 15% 22%)" },
};

const EFFECT_TAGS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  memory:           { label: "Memory",           color: "hsl(210 70% 62%)", icon: <Brain className="w-2.5 h-2.5" /> },
  focus:            { label: "Focus",             color: "hsl(38 80% 58%)",  icon: <Zap className="w-2.5 h-2.5" /> },
  mood:             { label: "Mood",              color: "hsl(330 65% 62%)", icon: <Smile className="w-2.5 h-2.5" /> },
  neuroprotection:  { label: "Neuroprotection",   color: "hsl(145 55% 52%)", icon: <Shield className="w-2.5 h-2.5" /> },
  energy:           { label: "Energy",            color: "hsl(55 75% 55%)",  icon: <Battery className="w-2.5 h-2.5" /> },
  anxiety_reduction:{ label: "Anxiety ↓",         color: "hsl(175 55% 50%)", icon: <Smile className="w-2.5 h-2.5" /> },
  learning:         { label: "Learning",          color: "hsl(270 60% 65%)", icon: <Brain className="w-2.5 h-2.5" /> },
  neurogenesis:     { label: "Neurogenesis",      color: "hsl(100 50% 52%)", icon: <Shield className="w-2.5 h-2.5" /> },
  sleep:            { label: "Sleep",             color: "hsl(220 40% 55%)", icon: <Battery className="w-2.5 h-2.5" /> },
  motivation:       { label: "Motivation",        color: "hsl(20 70% 58%)",  icon: <Zap className="w-2.5 h-2.5" /> },
};

const ALL_EFFECTS = Object.keys(EFFECT_TAGS);

// ── Subcomponents ──────────────────────────────────────────────────────────

function CategoryBadge({ cat }: { cat: Category }) {
  const c = CATEGORIES[cat] ?? CATEGORIES.other;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono tracking-wide shrink-0"
      style={{ color: c.color, background: c.bg, border: `1px solid ${c.border}` }}
    >
      {c.label}
    </span>
  );
}

function EffectChip({ tag }: { tag: string }) {
  const t = EFFECT_TAGS[tag];
  if (!t) return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-[hsl(220_15%_10%)] text-muted-foreground border border-[hsl(220_15%_18%)]">
      {tag}
    </span>
  );
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wide"
      style={{ color: t.color, background: `${t.color}18`, border: `1px solid ${t.color}35` }}
    >
      {t.icon}
      {t.label}
    </span>
  );
}

function EffectTagPicker({
  value, onChange,
}: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (tag: string) => {
    onChange(value.includes(tag) ? value.filter(t => t !== tag) : [...value, tag]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_EFFECTS.map(tag => {
        const t = EFFECT_TAGS[tag];
        const on = value.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-all"
            style={{
              color:      on ? t.color : "hsl(220 15% 40%)",
              background: on ? `${t.color}18` : "transparent",
              border:     `1px solid ${on ? t.color + "55" : "hsl(220 15% 18%)"}`,
            }}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Form ───────────────────────────────────────────────────────────────────
const BLANK: Omit<Nootropic, "id" | "created_at" | "updated_at"> = {
  name: "", category: "other", mechanism: "", effects: "", dosage: "", half_life: "", notes: "",
};

interface FormState {
  name:      string;
  category:  Category;
  mechanism: string;
  effects:   string[];
  dosage:    string;
  half_life: string;
  notes:     string;
}

function NootropicForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Nootropic;
  onSave: (data: Omit<FormState, "effects"> & { effects: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<FormState>({
    name:      initial?.name      ?? "",
    category:  initial?.category  ?? "other",
    mechanism: initial?.mechanism ?? "",
    effects:   initial?.effects ? initial.effects.split(",").map(s => s.trim()).filter(Boolean) : [],
    dosage:    initial?.dosage    ?? "",
    half_life: initial?.half_life ?? "",
    notes:     initial?.notes     ?? "",
  });

  const field = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const inputCls = "w-full bg-[hsl(220_15%_6%)] border border-[hsl(220_15%_16%)] rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[hsl(270_40%_35%)] transition-colors placeholder:text-muted-foreground/40";
  const labelCls = "block text-[10px] font-mono tracking-widest uppercase text-muted-foreground mb-1.5";

  return (
    <div
      className="rounded-2xl border border-[hsl(270_35%_18%)] p-5 space-y-4"
      style={{ background: "hsl(220 15% 6%)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ fontFamily: "Cinzel, serif", color: "hsl(270 55% 72%)" }}>
          {initial ? "Edit Compound" : "New Compound"}
        </h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Row 1: name + category */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Name</label>
          <input value={form.name} onChange={field("name")} className={inputCls} placeholder="e.g. Lion's Mane" />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select value={form.category} onChange={field("category")} className={inputCls} style={{ appearance: "none" }}>
            {(Object.entries(CATEGORIES) as [Category, { label: string }][]).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Mechanism */}
      <div>
        <label className={labelCls}>Mechanism of Action</label>
        <textarea
          value={form.mechanism}
          onChange={field("mechanism")}
          className={cn(inputCls, "resize-none")}
          rows={2}
          placeholder="How does it work? (e.g. NGF stimulation, BDNF upregulation…)"
        />
      </div>

      {/* Effects */}
      <div>
        <label className={labelCls}>Cognitive Effects</label>
        <EffectTagPicker value={form.effects} onChange={v => setForm(f => ({ ...f, effects: v }))} />
      </div>

      {/* Row 2: dosage + half-life */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Dosage Range</label>
          <input value={form.dosage} onChange={field("dosage")} className={inputCls} placeholder="e.g. 500–1000 mg/day" />
        </div>
        <div>
          <label className={labelCls}>Half-Life</label>
          <input value={form.half_life} onChange={field("half_life")} className={inputCls} placeholder="e.g. 4–6 hours" />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls}>Personal Notes</label>
        <textarea
          value={form.notes}
          onChange={field("notes")}
          className={cn(inputCls, "resize-none")}
          rows={3}
          placeholder="Stacks, timing, subjective experience, citations…"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
        <button
          onClick={() => onSave({ ...form, effects: form.effects.join(", ") })}
          disabled={saving || !form.name.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-mono transition-all disabled:opacity-40"
          style={{ background: "hsl(270 40% 18%)", color: "hsl(270 60% 72%)", border: "1px solid hsl(270 40% 28%)" }}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Save
        </button>
      </div>
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────
function NootropicCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: Nootropic;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const effects = entry.effects ? entry.effects.split(",").map(s => s.trim()).filter(Boolean) : [];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-xl border border-[hsl(220_15%_13%)] overflow-hidden"
      style={{ background: "hsl(220 15% 7%)" }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[hsl(220_15%_9%)] transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        }

        <span className="font-semibold text-sm flex-1 truncate" style={{ fontFamily: "Cinzel, serif", color: "hsl(220 30% 82%)" }}>
          {entry.name}
        </span>

        {/* Effect chips (collapsed) — show first 3 */}
        {!open && (
          <div className="flex items-center gap-1 flex-wrap">
            {effects.slice(0, 3).map(tag => <EffectChip key={tag} tag={tag} />)}
            {effects.length > 3 && (
              <span className="text-[9px] text-muted-foreground font-mono">+{effects.length - 3}</span>
            )}
          </div>
        )}

        <CategoryBadge cat={entry.category} />

        {/* Action buttons */}
        <div className="flex items-center gap-1 ml-1" onClick={e => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1 rounded text-muted-foreground hover:text-[hsl(270_60%_65%)] transition-colors" title="Edit">
            <PenLine className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 rounded text-muted-foreground hover:text-rose-400 transition-colors" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded body */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-4 space-y-3 border-t border-[hsl(220_15%_12%)]"
              style={{ paddingTop: "12px" }}
            >
              {/* All effects */}
              {effects.length > 0 && (
                <div>
                  <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground mb-1.5">Effects</p>
                  <div className="flex flex-wrap gap-1.5">
                    {effects.map(tag => <EffectChip key={tag} tag={tag} />)}
                  </div>
                </div>
              )}

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-3">
                {entry.dosage && (
                  <div>
                    <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground mb-0.5">Dosage</p>
                    <p className="text-xs text-foreground/80">{entry.dosage}</p>
                  </div>
                )}
                {entry.half_life && (
                  <div>
                    <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground mb-0.5">Half-Life</p>
                    <p className="text-xs text-foreground/80">{entry.half_life}</p>
                  </div>
                )}
              </div>

              {/* Mechanism */}
              {entry.mechanism && (
                <div>
                  <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground mb-0.5">Mechanism</p>
                  <p className="text-xs text-foreground/70 leading-relaxed">{entry.mechanism}</p>
                </div>
              )}

              {/* Notes */}
              {entry.notes && (
                <div className="rounded-lg px-3 py-2.5" style={{ background: "hsl(220 15% 5%)", border: "1px solid hsl(220 15% 11%)" }}>
                  <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground mb-0.5">Notes</p>
                  <p className="text-xs text-foreground/60 leading-relaxed whitespace-pre-wrap">{entry.notes}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function AlchemyLab() {
  const qc = useQueryClient();
  const QK  = ["/nootropics"];

  const { data: entries = [], isLoading } = useQuery<Nootropic[]>({
    queryKey: QK,
    queryFn:  () => apiRequest("GET", "/api/nootropics").then(r => r.json()),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: QK });

  const create = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/nootropics", body).then(r => r.json()),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/nootropics/${id}`, patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/nootropics/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QK });
      const prev = qc.getQueryData<Nootropic[]>(QK);
      qc.setQueryData<Nootropic[]>(QK, old => (old ?? []).filter(e => e.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(QK, ctx.prev); },
    onSettled: invalidate,
  });

  // ── UI state ─────────────────────────────────────────────────────────
  const [showForm,    setShowForm]    = useState(false);
  const [editTarget,  setEditTarget]  = useState<Nootropic | null>(null);
  const [search,      setSearch]      = useState("");
  const [filterCat,   setFilterCat]   = useState<Category | "all">("all");
  const [filterEffect,setFilterEffect]= useState<string | "all">("all");

  // ── Filtered list ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return entries.filter(e => {
      const matchName   = e.name.toLowerCase().includes(search.toLowerCase()) || e.notes.toLowerCase().includes(search.toLowerCase());
      const matchCat    = filterCat === "all" || e.category === filterCat;
      const matchEffect = filterEffect === "all" || e.effects.toLowerCase().includes(filterEffect);
      return matchName && matchCat && matchEffect;
    });
  }, [entries, search, filterCat, filterEffect]);

  // ── Save handlers ─────────────────────────────────────────────────────
  type SavePayload = { name: string; category: Category; mechanism: string; effects: string; dosage: string; half_life: string; notes: string };

  const handleSave = (data: SavePayload) => {
    if (editTarget) {
      update.mutate({ id: editTarget.id, patch: data }, { onSuccess: () => { setEditTarget(null); } });
    } else {
      create.mutate(data, { onSuccess: () => setShowForm(false) });
    }
  };

  const selectFilter = (k: keyof typeof CATEGORIES | "all") => setFilterCat(k);

  // ── Accent colour ─────────────────────────────────────────────────────
  const ACCENT = "hsl(270 55% 62%)";

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5" style={{ color: ACCENT }} />
          <div>
            <h1 className="text-base font-bold tracking-widest uppercase"
              style={{ fontFamily: "Cinzel, serif", color: ACCENT }}>
              Alchemy Lab
            </h1>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest">
              Nootropics &amp; Cognitive Compounds
            </p>
          </div>
        </div>
        {!showForm && !editTarget && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
            style={{ border: `1px solid ${ACCENT}40`, color: ACCENT, background: `${ACCENT}12` }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Compound
          </button>
        )}
      </div>

      {/* Add form */}
      <AnimatePresence>
        {(showForm || editTarget) && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <NootropicForm
              initial={editTarget ?? undefined}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditTarget(null); }}
              saving={create.isPending || update.isPending}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search + filter bar */}
      {!showForm && !editTarget && (
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search compounds…"
              className="w-full pl-9 pr-4 py-2 bg-[hsl(220_15%_6%)] border border-[hsl(220_15%_14%)] rounded-xl text-sm focus:outline-none focus:border-[hsl(270_40%_30%)] transition-colors placeholder:text-muted-foreground/40"
            />
          </div>

          {/* Category filter chips */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => selectFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-mono tracking-wide border transition-all",
                filterCat === "all"
                  ? "bg-[hsl(220_15%_12%)] text-foreground border-[hsl(220_15%_22%)]"
                  : "text-muted-foreground border-[hsl(220_15%_14%)] hover:border-[hsl(220_15%_22%)]"
              )}
            >
              All
            </button>
            {(Object.entries(CATEGORIES) as [Category, { label: string; color: string }][]).map(([k, v]) => (
              <button
                key={k}
                onClick={() => selectFilter(k)}
                className="px-2.5 py-1 rounded-lg text-[10px] font-mono tracking-wide border transition-all"
                style={{
                  color:      filterCat === k ? v.color : "hsl(220 15% 40%)",
                  background: filterCat === k ? `${v.color}18` : "transparent",
                  borderColor:filterCat === k ? `${v.color}45` : "hsl(220 15% 14%)",
                }}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Effect filter */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilterEffect("all")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-mono border transition-all",
                filterEffect === "all" ? "text-foreground border-[hsl(220_15%_22%)] bg-[hsl(220_15%_10%)]" : "text-muted-foreground border-[hsl(220_15%_14%)]"
              )}
            >
              Any effect
            </button>
            {Object.entries(EFFECT_TAGS).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setFilterEffect(filterEffect === k ? "all" : k)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono border transition-all"
                style={{
                  color:      filterEffect === k ? v.color : "hsl(220 15% 38%)",
                  background: filterEffect === k ? `${v.color}15` : "transparent",
                  borderColor:filterEffect === k ? `${v.color}45` : "hsl(220 15% 14%)",
                }}
              >
                {v.icon}
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Entry count */}
      {!showForm && !editTarget && entries.length > 0 && (
        <p className="text-[10px] font-mono text-muted-foreground">
          {filtered.length} of {entries.length} compound{entries.length !== 1 ? "s" : ""}
          {(filterCat !== "all" || filterEffect !== "all" || search) ? " (filtered)" : ""}
        </p>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: ACCENT, opacity: 0.5 }} />
        </div>
      ) : entries.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
          <FlaskConical className="w-12 h-12 opacity-10" />
          <p className="text-sm opacity-50">No compounds yet — add your first one</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono transition-all"
            style={{ border: `1px solid ${ACCENT}35`, color: ACCENT, background: `${ACCENT}10` }}
          >
            <Plus className="w-4 h-4" />
            Add Compound
          </button>
        </div>
      ) : (
        <AnimatePresence>
          <div className="space-y-2">
            {filtered.map(entry => (
              editTarget?.id === entry.id ? (
                <motion.div key={entry.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <NootropicForm
                    initial={editTarget}
                    onSave={handleSave}
                    onCancel={() => setEditTarget(null)}
                    saving={update.isPending}
                  />
                </motion.div>
              ) : (
                <NootropicCard
                  key={entry.id}
                  entry={entry}
                  onEdit={() => { setEditTarget(entry); setShowForm(false); }}
                  onDelete={() => remove.mutate(entry.id)}
                />
              )
            ))}
            {filtered.length === 0 && entries.length > 0 && (
              <p className="text-center text-sm text-muted-foreground py-10 opacity-50">
                No compounds match your filters
              </p>
            )}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
