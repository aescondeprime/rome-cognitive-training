import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Edit2, Trash2, Plus, X, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";

type MemoryType =
  | "reflection"
  | "pattern"
  | "strength"
  | "weakness"
  | "goal"
  | "insight"
  | "preference";

interface MemoryItem {
  id: number;
  userId: number;
  type: string;
  content: string;
  source: string | null;
  confidence: number | null;
  importance: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

const TYPES: { value: MemoryType; label: string; color: string; bg: string }[] = [
  { value: "reflection", label: "Reflection",  color: "text-yellow-400",  bg: "bg-yellow-500/15 border-yellow-500/25" },
  { value: "pattern",    label: "Pattern",     color: "text-purple-400",  bg: "bg-purple-500/15 border-purple-500/25" },
  { value: "strength",   label: "Strength",    color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/25" },
  { value: "weakness",   label: "Weakness",    color: "text-red-400",     bg: "bg-red-500/15 border-red-500/25" },
  { value: "goal",       label: "Goal",        color: "text-blue-400",    bg: "bg-blue-500/15 border-blue-500/25" },
  { value: "insight",    label: "Insight",     color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/25" },
  { value: "preference", label: "Preference",  color: "text-rose-400",    bg: "bg-rose-500/15 border-rose-500/25" },
];

function getTypeInfo(type: string) {
  return TYPES.find(t => t.value === type) ?? TYPES[0];
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ConfidenceBar({ value, label }: { value: number | null; label: string }) {
  const pct = value ?? 50;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-16">{label}</span>
      <div className="flex-1 h-1 bg-cave-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gold-500/60 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground w-6 text-right">{pct}</span>
    </div>
  );
}

interface MemoryFormState {
  type: MemoryType;
  content: string;
  confidence: number;
  importance: number;
}

const defaultForm: MemoryFormState = {
  type: "reflection",
  content: "",
  confidence: 50,
  importance: 50,
};

export default function LocalMemory() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<MemoryItem | null>(null);
  const [form, setForm] = useState<MemoryFormState>(defaultForm);
  const [deleteTarget, setDeleteTarget] = useState<MemoryItem | null>(null);

  const { data: items = [] as MemoryItem[], isLoading } = useQuery<MemoryItem[]>({
    queryKey: ["/api/memory"],
  });

  const createMutation = useMutation({
    mutationFn: (data: MemoryFormState) =>
      apiRequest("POST", "/api/memory", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
      setAddOpen(false);
      setForm(defaultForm);
      toast({ title: "Memory added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MemoryFormState> }) =>
      apiRequest("PATCH", `/api/memory/${id}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
      setEditItem(null);
      toast({ title: "Memory updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/memory/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
      setDeleteTarget(null);
      toast({ title: "Memory deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openEdit = (item: MemoryItem) => {
    setEditItem(item);
    setForm({
      type: item.type as MemoryType,
      content: item.content,
      confidence: item.confidence ?? 50,
      importance: item.importance ?? 50,
    });
  };

  // Group items by type
  const grouped = TYPES.map(t => ({
    ...t,
    items: items.filter((i: MemoryItem) => i.type === t.value),
  }));

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1
            className="text-3xl font-bold gold-shimmer tracking-[0.12em] mb-1"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            MEMORY ARCHIVE
          </h1>
          <p className="text-muted-foreground text-sm">
            Profile-specific cognitive memory — reflections, patterns, and goals.
          </p>
        </div>
        <button
          onClick={() => { setForm(defaultForm); setAddOpen(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-gold-400 border border-gold-500/25 hover:bg-gold-500/8 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Memory
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-muted-foreground text-sm">Loading…</span>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <section key={group.value}>
              {/* Group header */}
              <div className="flex items-center gap-3 mb-3">
                <span
                  className={`text-xs font-semibold tracking-widest uppercase ${group.color}`}
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-cave-700/50" />
                <span className="text-[11px] text-muted-foreground">
                  {group.items.length}
                </span>
              </div>

              {group.items.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 italic pl-1">
                  No {group.label.toLowerCase()} entries yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {group.items.map((item: MemoryItem) => (
                    <MemoryCard
                      key={item.id}
                      item={item}
                      typeInfo={group}
                      onEdit={() => openEdit(item)}
                      onDelete={() => setDeleteTarget(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* Add Dialog */}
      <MemoryFormDialog
        open={addOpen}
        title="Add Memory"
        form={form}
        setForm={setForm}
        onClose={() => setAddOpen(false)}
        onSubmit={() => createMutation.mutate(form)}
        isPending={createMutation.isPending}
        submitLabel="Add"
      />

      {/* Edit Dialog */}
      <MemoryFormDialog
        open={!!editItem}
        title="Edit Memory"
        form={form}
        setForm={setForm}
        onClose={() => setEditItem(null)}
        onSubmit={() => editItem && updateMutation.mutate({ id: editItem.id, data: form })}
        isPending={updateMutation.isPending}
        submitLabel="Save"
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-cave-900 border border-cave-700">
          <DialogHeader>
            <DialogTitle
              className="text-red-400 tracking-wider"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Delete Memory
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Delete this{" "}
            <span className="text-foreground">{deleteTarget?.type}</span> memory entry?
            This cannot be undone.
          </p>
          <p className="text-xs text-muted-foreground/70 italic line-clamp-2">
            "{deleteTarget?.content}"
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-cave-600 text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              className="bg-red-900/40 border border-red-500/30 text-red-300 hover:bg-red-900/60"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MemoryCard({
  item,
  typeInfo,
  onEdit,
  onDelete,
}: {
  item: MemoryItem;
  typeInfo: { color: string; bg: string };
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rome-card rounded-xl p-4 border border-cave-700/40 group">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Type badge + date */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${typeInfo.bg} ${typeInfo.color}`}
            >
              {getTypeInfo(item.type).label}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {formatDate(item.createdAt)}
            </span>
          </div>

          {/* Content */}
          <p className="text-sm text-foreground/90 leading-relaxed">
            {item.content}
          </p>

          {/* Bars */}
          <div className="space-y-1 pt-1">
            <ConfidenceBar value={item.confidence} label="Confidence" />
            <ConfidenceBar value={item.importance} label="Importance" />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-gold-400 hover:bg-gold-500/8 transition-all"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/8 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MemoryFormDialog({
  open,
  title,
  form,
  setForm,
  onClose,
  onSubmit,
  isPending,
  submitLabel,
}: {
  open: boolean;
  title: string;
  form: MemoryFormState;
  setForm: (f: MemoryFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="bg-cave-900 border border-cave-700 max-w-md">
        <DialogHeader>
          <DialogTitle
            className="text-gold-400 tracking-wider"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Type selector */}
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-2">
              Type
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setForm({ ...form, type: t.value })}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
                    form.type === t.value
                      ? `${t.bg} ${t.color} border-opacity-60`
                      : "bg-cave-800 text-muted-foreground border-cave-700/40 hover:border-cave-600"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-2">
              Content
            </label>
            <textarea
              className="w-full h-24 bg-cave-800 border border-cave-700/60 rounded-lg px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:border-gold-500/40 transition-colors placeholder:text-muted-foreground/40"
              placeholder="Describe this memory…"
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
            />
          </div>

          {/* Confidence slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">
                Confidence
              </label>
              <span className="text-xs text-gold-400">{form.confidence}</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[form.confidence]}
              onValueChange={([v]) => setForm({ ...form, confidence: v })}
              className="w-full"
            />
          </div>

          {/* Importance slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">
                Importance
              </label>
              <span className="text-xs text-gold-400">{form.importance}</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[form.importance]}
              onValueChange={([v]) => setForm({ ...form, importance: v })}
              className="w-full"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-cave-600 text-muted-foreground"
          >
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!form.content.trim() || isPending}
            className="bg-gold-600/20 border border-gold-500/30 text-gold-400 hover:bg-gold-600/30"
          >
            <Check className="w-4 h-4 mr-2" />
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
