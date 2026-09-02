/**
 * Command Center — the Strategic node's situation room.
 *
 * Two independent boards, one surface each, sharing exactly one thing.
 *
 * **Threats** are what could go wrong. **Directives** are what you are aiming
 * at — goals, not counter-measures. A directive is not filed under the threat
 * that prompted it and does not need one to exist; the two boards are read for
 * different reasons and answer different questions. What they share is what
 * they can be attached to: a threat links to the projects it endangers, a goal
 * to the projects that advance it, through one `command_links` table.
 *
 * **The grid** is for threats. A threat has no natural order and no parent, so
 * it gets a free position you place by hand: proximity, clustering and the
 * empty space between markers are yours to mean whatever you decide. Position
 * is stored as a percentage of the surface rather than pixels, so a board laid
 * out on the large display still reads on the laptop.
 *
 * **The tree** is for objectives. A goal *does* have a shape — it is a sub-goal
 * of another, or it is top-level — so its position is computed, not dragged.
 * Laying it out by hand would mean maintaining a picture of a hierarchy the
 * data already knows. That difference is the whole reason there are two
 * surfaces rather than one board with two colours of marker.
 *
 * Four things worth knowing before changing anything here.
 *
 * **Threats are the constellation widget's rows.** This page does not own a
 * threat list of its own; it reads and writes `/api/threats`, the same table
 * `ThreatsWidget` writes, under the same query key. Adding a threat from the
 * widget makes it appear here, and the reverse. All this page adds to a threat
 * is a position and a body of text.
 *
 * **An unplaced threat is scattered, not written.** A threat added from the
 * widget arrives with `pos_x`/`pos_y` null. Rendering it would either stack
 * every such marker at the origin or make loading the page write to every row
 * that had never been placed. Neither is acceptable, so an unplaced marker gets
 * a deterministic spiral position derived from its index — stable across
 * reloads, and replaced by a real number the first time it is dragged.
 *
 * **A parent's progress is its children's.** A goal with sub-goals reports the
 * mean of theirs and ignores its own column; only a leaf carries a hand-set
 * number. See `buildProgress` for why, and for the cycle guard.
 *
 * **A link's target label is a snapshot.** `command_links.target_label` holds
 * the board's title as it was when it was attached, so a board deleted later
 * leaves a legible dead edge rather than a bare id. The live title wins when
 * the target still exists; the snapshot is the fallback, marked MISSING.
 *
 * Needs `script/sql/2026-09-command-center.sql`. The threats it shows come from
 * a table that already exists, so the grid renders before the migration runs —
 * but nothing is placed, no objective can be created, and no link persists.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Crosshair, Plus, Trash2, X, Link2, ExternalLink, Search,
  ChevronRight, Radar, GitBranch, Loader2, Check,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { playCue } from "@/lib/sound";
import { loadGarden } from "@/lib/gardenStore";

const mono = "DM Mono, monospace";
const serif = "'Cinzel', serif";

// ── The two record types ───────────────────────────────────────────────────

type Priority = 1 | 2 | 3;
type Status = "planned" | "active" | "achieved" | "shelved";

interface Threat {
  id: number;
  title: string;
  detail: string | null;
  priority: Priority;
  resolved: boolean;
  pos_x: number | null;
  pos_y: number | null;
  created_at: number;
}

interface Directive {
  id: number;
  title: string;
  detail: string | null;
  status: Status;
  priority: Priority;
  parent_id: number | null;
  /** 0-100, hand-set on a leaf only. See `buildProgress`. */
  progress: number;
  /** 'YYYY-MM-DD', or empty for a goal with no horizon. */
  target_date: string | null;
  pos_x: number | null;
  pos_y: number | null;
  created_at: number;
}

interface CommandLink {
  id: number;
  source_kind: "threat" | "directive";
  source_id: number;
  target_kind: TargetKind;
  target_ref: string;
  target_label: string;
  label: string;
  created_at: number;
}

/** What is selected, if anything. One shape for both surfaces. */
type Selection = { kind: "threat" | "directive"; id: number } | null;

// ── Link targets ───────────────────────────────────────────────────────────
//
// Every kind of work a marker can point at, in one table. `board` marks the
// kinds whose `target_ref` is a row id in `boards` — those are the ones that
// deep-link, by the same sessionStorage handshake `ProjectsWidget` uses.

type TargetKind =
  | "idea_workshop" | "component_board" | "science_board" | "experiment_board"
  | "kronos_routine" | "kronos_assignment" | "kronos_event" | "kronos_general"
  | "garden_plan";

interface TargetMeta {
  label: string;
  group: string;
  code: string;
  color: string;
  route: string;
  board: boolean;
}

const TARGETS: Record<TargetKind, TargetMeta> = {
  idea_workshop:    { label: "Project",          group: "Projects",           code: "PRJ", color: "hsl(192 100% 62%)", route: "/idea-workshop",   board: true  },
  component_board:  { label: "Caseboard",        group: "Caseboards",         code: "CSE", color: "hsl(38 85% 58%)",   route: "/component-board", board: true  },
  science_board:    { label: "Science Board",    group: "Research Lab",       code: "SCI", color: "hsl(210 65% 62%)",  route: "/research-lab",    board: true  },
  experiment_board: { label: "Experiment Board", group: "Research Lab",       code: "EXP", color: "hsl(145 55% 50%)",  route: "/research-lab",    board: true  },
  kronos_routine:   { label: "Routine",          group: "Kronos Keep",        code: "RTN", color: "hsl(43 88% 60%)",   route: "/kronos-keep",     board: false },
  kronos_assignment:{ label: "Assignment",       group: "Kronos Keep",        code: "ASG", color: "hsl(210 65% 62%)",  route: "/kronos-keep",     board: false },
  kronos_event:     { label: "Event",            group: "Kronos Keep",        code: "EVT", color: "hsl(270 60% 72%)",  route: "/kronos-keep",     board: false },
  kronos_general:   { label: "Item",             group: "Kronos Keep",        code: "GEN", color: "hsl(145 55% 50%)",  route: "/kronos-keep",     board: false },
  garden_plan:      { label: "Plan",             group: "Contingency Garden", code: "PLN", color: "hsl(146 80% 50%)",  route: "/taskboard",       board: false },
};

const TARGET_GROUPS = ["Projects", "Caseboards", "Research Lab", "Kronos Keep", "Contingency Garden"] as const;

// ── Palette ────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<Priority, string> = {
  1: "hsl(45 95% 58%)",
  2: "hsl(22 90% 55%)",
  3: "hsl(0 75% 55%)",
};
const PRIORITY_LABEL: Record<Priority, string> = { 1: "LOW", 2: "MED", 3: "HIGH" };

const STATUS_META: Record<Status, { label: string; color: string }> = {
  planned:  { label: "Planned",     color: "hsl(210 70% 62%)" },
  active:   { label: "In Progress", color: "hsl(var(--accent-h) 88% 60%)" },
  achieved: { label: "Achieved",    color: "hsl(145 55% 50%)" },
  shelved:  { label: "Shelved",     color: "hsl(0 8% 45%)" },
};
const STATUS_ORDER: Status[] = ["planned", "active", "achieved", "shelved"];

// ── Helpers ────────────────────────────────────────────────────────────────

const clampPct = (v: number) => Math.max(3, Math.min(97, v));

/**
 * Where an unplaced marker goes. A golden-angle spiral out from the centre,
 * indexed by the marker's position in creation order — deterministic, so the
 * same threat lands in the same place on every load without a row being
 * written, and evenly spread, so a widget that has never seen the grid does
 * not pile ten markers on one another.
 */
function scatter(index: number): { x: number; y: number } {
  const angle = index * 2.399963;              // golden angle, radians
  const radius = 9 + Math.sqrt(index + 1) * 11;
  return {
    x: clampPct(50 + Math.cos(angle) * radius * 1.35),
    y: clampPct(50 + Math.sin(angle) * radius),
  };
}

interface Progress { value: number; derived: boolean }

/**
 * A goal's completion, and whether it is its own claim or its children's.
 *
 * A leaf reports the number you set on it. A goal with sub-goals reports the
 * mean of theirs and ignores its own column entirely — a parent that claims 40%
 * while its three children are untouched is a contradiction, and the children
 * are the more honest source. That is also why the dossier disables the control
 * the moment a goal acquires a child: offering a number that is never read is
 * worse than not offering one.
 *
 * The `seen` set is a cycle guard. Both API twins refuse to write one, but a
 * row from before that guard existed should degrade to a leaf reading rather
 * than recurse until the stack gives out.
 */
function buildProgress(directives: Directive[]): (id: number) => Progress {
  const children = new Map<number, number[]>();
  const byId = new Map<number, Directive>();
  for (const directive of directives) {
    byId.set(directive.id, directive);
    if (directive.parent_id === null) continue;
    const siblings = children.get(directive.parent_id) ?? [];
    siblings.push(directive.id);
    children.set(directive.parent_id, siblings);
  }
  const cache = new Map<number, Progress>();
  const walk = (id: number, seen: Set<number>): Progress => {
    const hit = cache.get(id);
    if (hit) return hit;
    const kids = children.get(id) ?? [];
    let result: Progress;
    if (kids.length === 0 || seen.has(id)) {
      result = { value: Math.max(0, Math.min(100, byId.get(id)?.progress ?? 0)), derived: false };
    } else {
      seen.add(id);
      const total = kids.reduce((sum, kid) => sum + walk(kid, seen).value, 0);
      result = { value: Math.round(total / kids.length), derived: true };
    }
    cache.set(id, result);
    return result;
  };
  return (id: number) => walk(id, new Set());
}

/** True for a goal whose horizon has passed and which is still open. */
function overdue(directive: Directive): boolean {
  if (!directive.target_date) return false;
  if (directive.status === "achieved" || directive.status === "shelved") return false;
  return directive.target_date < new Date().toISOString().slice(0, 10);
}

/** `T-04` / `D-11`. Position in creation order, not the row id — ids have gaps. */
function designation(prefix: string, index: number) {
  return `${prefix}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * Translucent variant of one of ROME's `hsl(H S% L%)` colours.
 *
 * The last paren, not the first: several of these are written
 * `hsl(var(--accent-h) 88% 60%)` so they track the live accent, and replacing
 * the first `)` would land inside `var(...)` and produce nothing renderable.
 */
function alpha(color: string, a: number) {
  return color.replace(/\)\s*$/, ` / ${a})`);
}

function pill(color: string) {
  return {
    fontFamily: mono, fontSize: 7, letterSpacing: "0.16em", textTransform: "uppercase" as const,
    padding: "1px 5px", borderRadius: 2, color,
    background: alpha(color, 0.1),
    border: `1px solid ${alpha(color, 0.3)}`,
  };
}

// ── Board rows, for resolving a link's live title ──────────────────────────

interface BoardRow { id: number; type: string; title: string }

// ═══════════════════════════════════════════════════════════════════════════
// The page
// ═══════════════════════════════════════════════════════════════════════════

export default function CommandCenter() {
  const qc = useQueryClient();
  // Wouter's own hook, not `useHashLocation`: split screen renders this route
  // table inside a per-pane Router whose location hook is that pane's, and
  // going straight to the window hash would move the wrong surface.
  const [, navigate] = useLocation();

  const [view, setView]         = useState<"grid" | "chain">("grid");
  const [selected, setSelected] = useState<Selection>(null);
  const [showAllLinks, setShow] = useState(false);
  const [picking, setPicking]   = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────
  // The threats key is shared with `ThreatsWidget` on purpose: one list, two
  // surfaces, and a threat added from the constellation appears here without
  // either component knowing about the other.
  const { data: threats = [] } = useQuery<Threat[]>({
    queryKey: ["threats"],
    queryFn:  () => apiRequest("GET", "/api/threats").then(r => r.json()),
    staleTime: 15_000,
  });

  const directivesQuery = useQuery<Directive[]>({
    queryKey: ["directives"],
    queryFn:  () => apiRequest("GET", "/api/directives").then(r => r.json()),
    staleTime: 15_000,
    retry: false,
  });
  const directives = directivesQuery.data ?? [];

  const { data: links = [] } = useQuery<CommandLink[]>({
    queryKey: ["command-links"],
    queryFn:  () => apiRequest("GET", "/api/command-links").then(r => r.json()),
    staleTime: 15_000,
    retry: false,
  });

  const { data: boards = [] } = useQuery<BoardRow[]>({
    queryKey: ["/boards", "command-center"],
    queryFn:  () => apiRequest("GET", "/api/boards").then(r => r.json()),
    staleTime: 30_000,
  });

  // The Garden lives in localStorage, so its plans are read rather than
  // fetched. Re-read on mount only — a plan renamed in another tab is a
  // refresh away, which is what every other Garden consumer does too.
  const gardenPlans = useMemo(() => {
    try { return loadGarden().plans; } catch { return []; }
  }, []);

  const invalidate = useCallback((...keys: string[]) => {
    for (const key of keys) qc.invalidateQueries({ queryKey: [key] });
  }, [qc]);

  // ── Mutations ───────────────────────────────────────────────────────────

  const addThreat = useMutation({
    mutationFn: (body: Partial<Threat>) => apiRequest("POST", "/api/threats", body).then(r => r.json()),
    onSuccess: (row: Threat) => { invalidate("threats"); if (row?.id) setSelected({ kind: "threat", id: row.id }); },
  });

  const patchThreat = useMutation({
    mutationFn: ({ id, ...patch }: Partial<Threat> & { id: number }) =>
      apiRequest("PATCH", `/api/threats/${id}`, patch).then(r => r.json()),
    // Optimistic, because dragging a marker must not wait on a round trip.
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: ["threats"] });
      const previous = qc.getQueryData<Threat[]>(["threats"]);
      qc.setQueryData<Threat[]>(["threats"], old => old?.map(t => t.id === id ? { ...t, ...patch } : t) ?? []);
      return { previous };
    },
    onError: (_e, _v, ctx) => { if (ctx?.previous) qc.setQueryData(["threats"], ctx.previous); },
    onSettled: () => invalidate("threats"),
  });

  const removeThreat = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/threats/${id}`).then(r => r.json()),
    onSuccess: () => { invalidate("threats", "directives", "command-links"); setSelected(null); },
  });

  const addDirective = useMutation({
    mutationFn: (body: Partial<Directive>) => apiRequest("POST", "/api/directives", body).then(r => r.json()),
    onSuccess: (row: Directive) => { invalidate("directives"); if (row?.id) setSelected({ kind: "directive", id: row.id }); },
  });

  const patchDirective = useMutation({
    mutationFn: ({ id, ...patch }: Partial<Directive> & { id: number }) =>
      apiRequest("PATCH", `/api/directives/${id}`, patch).then(r => r.json()),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: ["directives"] });
      const previous = qc.getQueryData<Directive[]>(["directives"]);
      qc.setQueryData<Directive[]>(["directives"], old => old?.map(d => d.id === id ? { ...d, ...patch } : d) ?? []);
      return { previous };
    },
    onError: (_e, _v, ctx) => { if (ctx?.previous) qc.setQueryData(["directives"], ctx.previous); },
    onSettled: () => invalidate("directives"),
  });

  const removeDirective = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/directives/${id}`).then(r => r.json()),
    onSuccess: () => { invalidate("directives", "command-links"); setSelected(null); },
  });

  const addLink = useMutation({
    mutationFn: (body: Partial<CommandLink>) => apiRequest("POST", "/api/command-links", body).then(r => r.json()),
    onSuccess: () => invalidate("command-links"),
  });

  const removeLink = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/command-links/${id}`).then(r => r.json()),
    onSuccess: () => invalidate("command-links"),
  });

  // ── Derived ─────────────────────────────────────────────────────────────

  // Creation order, oldest first — the order designations are numbered in, and
  // the order the scatter walks. `/api/threats` returns newest first.
  const threatOrder = useMemo(
    () => [...threats].sort((a, b) => a.created_at - b.created_at),
    [threats]);
  const threatIndex = useMemo(
    () => new Map(threatOrder.map((t, i) => [t.id, i])),
    [threatOrder]);
  const directiveIndex = useMemo(
    () => new Map([...directives].sort((a, b) => a.created_at - b.created_at).map((d, i) => [d.id, i])),
    [directives]);

  const progressOf = useMemo(() => buildProgress(directives), [directives]);

  const linksOf = useCallback(
    (kind: "threat" | "directive", id: number) =>
      links.filter(l => l.source_kind === kind && l.source_id === id),
    [links]);

  const boardById = useMemo(() => new Map(boards.map(b => [b.id, b])), [boards]);

  /**
   * The live title of a link's target, or the snapshot taken when it was
   * attached. Only board targets can be resolved live — a Kronos item would
   * cost four more queries to look up, and a Garden plan is not on the server
   * at all, so those keep their snapshot and are never marked missing.
   */
  const resolveTarget = useCallback((link: CommandLink): { title: string; missing: boolean } => {
    if (TARGETS[link.target_kind]?.board) {
      const board = boardById.get(Number(link.target_ref));
      if (board) return { title: board.title, missing: false };
      return { title: link.target_label || `#${link.target_ref}`, missing: true };
    }
    return { title: link.target_label || `#${link.target_ref}`, missing: false };
  }, [boardById]);

  const openTarget = useCallback((link: CommandLink) => {
    const meta = TARGETS[link.target_kind];
    if (!meta) return;
    // Same handshake `ProjectsWidget` uses: the board id is left where the
    // destination's shell picks it up on mount.
    if (meta.board) sessionStorage.setItem("rome_open_board_id", link.target_ref);
    playCue("domainEnter");
    navigate(meta.route);
  }, [navigate]);

  const selectedThreat    = selected?.kind === "threat"    ? threats.find(t => t.id === selected.id) ?? null : null;
  const selectedDirective = selected?.kind === "directive" ? directives.find(d => d.id === selected.id) ?? null : null;

  // A selection that was deleted elsewhere leaves the dossier showing a ghost.
  useEffect(() => {
    if (!selected) return;
    const alive = selected.kind === "threat"
      ? threats.some(t => t.id === selected.id)
      : directives.some(d => d.id === selected.id);
    if (!alive && (threats.length || directives.length)) setSelected(null);
  }, [selected, threats, directives]);

  // Escape clears the selection before anything else can act on it. The
  // constellation's own Escape handler closes the overlay, which is not open
  // here, so there is nothing to fight over.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picking) { setPicking(false); return; }
      if (selected) setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, selected]);

  const active   = threats.filter(t => !t.resolved);
  const highest  = active.reduce<Priority>((m, t) => (t.priority > m ? t.priority : m), 1 as Priority);
  const inMotion = directives.filter(d => d.status === "active").length;
  const overdueCount = directives.filter(overdue).length;
  // Top-level objectives only. Averaging every node would count a sub-goal
  // twice — once on its own and once inside its parent's derived reading.
  const roots = directives.filter(d => d.parent_id === null || !directives.some(o => o.id === d.parent_id));
  const completion = roots.length
    ? Math.round(roots.reduce((sum, d) => sum + progressOf(d.id).value, 0) / roots.length)
    : 0;

  const schemaMissing = directivesQuery.isError;

  return (
    <div className="flex h-full min-h-[calc(100vh-120px)] flex-col" style={{ fontFamily: mono }}>
      <Header
        view={view} onView={v => { playCue("domainShift"); setView(v); }}
        activeCount={active.length}
        highest={highest}
        neutralised={threats.length - active.length}
        directiveCount={directives.length}
        inMotion={inMotion}
        overdueCount={overdueCount}
        completion={completion}
        onNewThreat={() => {
          playCue("nodeSelect");
          const spot = scatter(threats.length);
          addThreat.mutate({ title: "New threat", priority: 2, pos_x: spot.x, pos_y: spot.y });
        }}
        onNewDirective={() => {
          playCue("nodeSelect");
          // Filed under the selected objective when there is one: "break this
          // goal down" is the common case, and the dossier's parent select is
          // where you undo it.
          addDirective.mutate({
            title: "New objective",
            status: "planned",
            priority: 2,
            parent_id: selectedDirective?.id ?? null,
          });
          setView("chain");
        }}
        showAllLinks={showAllLinks}
        onShowAllLinks={setShow}
        busy={addThreat.isPending || addDirective.isPending}
      />

      {schemaMissing && <SchemaNotice />}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 relative">
          {view === "grid" ? (
            <ThreatGrid
              threats={threatOrder}
              selected={selected}
              onSelect={setSelected}
              onMove={(id, x, y) => patchThreat.mutate({ id, pos_x: x, pos_y: y })}
              onCreateAt={(x, y) => addThreat.mutate({ title: "New threat", priority: 2, pos_x: x, pos_y: y })}
              designationOf={id => designation("T", threatIndex.get(id) ?? 0)}
              linksOf={linksOf}
              resolveTarget={resolveTarget}
              onOpenTarget={openTarget}
              showAllLinks={showAllLinks}
            />
          ) : (
            <DirectiveChain
              directives={directives}
              selected={selected}
              onSelect={setSelected}
              designationOf={id => designation("D", directiveIndex.get(id) ?? 0)}
              linkCountOf={id => linksOf("directive", id).length}
              progressOf={progressOf}
            />
          )}
        </div>

        <Dossier
          threat={selectedThreat}
          directive={selectedDirective}
          designation={
            selectedThreat    ? designation("T", threatIndex.get(selectedThreat.id) ?? 0) :
            selectedDirective ? designation("D", directiveIndex.get(selectedDirective.id) ?? 0) : ""
          }
          directives={directives}
          directiveDesignationOf={id => designation("D", directiveIndex.get(id) ?? 0)}
          progressOf={progressOf}
          links={selected ? linksOf(selected.kind, selected.id) : []}
          resolveTarget={resolveTarget}
          onOpenTarget={openTarget}
          onDetach={id => removeLink.mutate(id)}
          onAttach={() => setPicking(true)}
          onPatchThreat={patch => selectedThreat && patchThreat.mutate({ id: selectedThreat.id, ...patch })}
          onPatchDirective={patch => selectedDirective && patchDirective.mutate({ id: selectedDirective.id, ...patch })}
          onDelete={() => {
            if (selectedThreat) removeThreat.mutate(selectedThreat.id);
            else if (selectedDirective) removeDirective.mutate(selectedDirective.id);
          }}
          onSelect={setSelected}
        />
      </div>

      {picking && selected && (
        <AssetPicker
          boards={boards}
          gardenPlans={gardenPlans}
          existing={linksOf(selected.kind, selected.id)}
          onClose={() => setPicking(false)}
          onPick={(kind, ref, label) => {
            addLink.mutate({
              source_kind: selected.kind, source_id: selected.id,
              target_kind: kind, target_ref: ref, target_label: label,
            });
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Header rail
// ═══════════════════════════════════════════════════════════════════════════

function Header({
  view, onView, activeCount, highest, neutralised, directiveCount, inMotion,
  overdueCount, completion, onNewThreat, onNewDirective, showAllLinks, onShowAllLinks, busy,
}: {
  view: "grid" | "chain";
  onView: (v: "grid" | "chain") => void;
  activeCount: number;
  highest: Priority;
  neutralised: number;
  directiveCount: number;
  inMotion: number;
  overdueCount: number;
  completion: number;
  onNewThreat: () => void;
  onNewDirective: () => void;
  showAllLinks: boolean;
  onShowAllLinks: (v: boolean) => void;
  busy: boolean;
}) {
  const alert = activeCount === 0 ? "hsl(145 45% 45%)" : PRIORITY_COLOR[highest];

  return (
    <div
      className="shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5"
      style={{
        background: "linear-gradient(180deg, hsl(222 24% 6% / 0.92), hsl(222 22% 4% / 0.86))",
        border: "1px solid hsl(var(--accent-h) 20% 15% / 0.7)",
        borderRadius: 4,
      }}
    >
      <div className="flex items-center gap-2.5">
        <Crosshair className="h-4 w-4" style={{ color: alert, filter: `drop-shadow(0 0 6px ${alpha(alert, 0.55)})` }} />
        <span style={{ fontFamily: serif, fontSize: 12, letterSpacing: "0.24em", textTransform: "uppercase", color: "hsl(var(--accent-h) 70% 66%)" }}>
          Command Center
        </span>
      </div>

      {/* The surface switch. Two graphs over one dataset — see the file header. */}
      <div className="flex items-center" style={{ border: "1px solid hsl(var(--accent-h) 22% 18% / 0.8)", borderRadius: 3, overflow: "hidden" }}>
        {([
          { id: "grid"  as const, label: "Threat Grid",     icon: <Radar className="h-3 w-3" /> },
          { id: "chain" as const, label: "Directive Chain", icon: <GitBranch className="h-3 w-3" /> },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => onView(tab.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 transition-colors"
            style={{
              fontFamily: mono, fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase",
              background: view === tab.id ? "hsl(var(--accent-h) 30% 13% / 0.9)" : "transparent",
              color: view === tab.id ? "hsl(var(--accent-h) 80% 68%)" : "hsl(214 12% 40%)",
            }}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Readout. Deliberately terse — this line is glanced at, not read, and
          it changes with the surface: threat counts while the grid is up,
          objective counts on the chain. Overdue only appears when it is not
          zero, because a permanent OVERDUE 00 trains you to stop seeing it. */}
      <div className="flex items-center gap-4" style={{ fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {view === "grid" ? (
          <>
            <Readout label="Active" value={activeCount} color={alert} />
            <Readout label="Neutralised" value={neutralised} color="hsl(214 10% 38%)" />
            <Readout label="Objectives" value={directiveCount} color="hsl(210 55% 58%)" />
          </>
        ) : (
          <>
            <Readout label="Objectives" value={directiveCount} color="hsl(210 55% 58%)" />
            <Readout label="In progress" value={inMotion} color="hsl(var(--accent-h) 78% 60%)" />
            {overdueCount > 0 && <Readout label="Overdue" value={overdueCount} color="hsl(0 70% 58%)" />}
            <span className="flex items-center gap-1.5" style={{ color: "hsl(214 12% 34%)" }}>
              Completion
              <ProgressBar value={completion} width={44} color="hsl(145 55% 50%)" />
              <strong style={{ color: "hsl(145 50% 56%)", fontWeight: 500, fontSize: 10 }}>{completion}%</strong>
            </span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {view === "grid" && (
          <button
            onClick={() => onShowAllLinks(!showAllLinks)}
            title="Draw every marker's links, not just the selected one's"
            className="px-2.5 py-1.5 transition-colors"
            style={{
              fontFamily: mono, fontSize: 7.5, letterSpacing: "0.16em", textTransform: "uppercase",
              borderRadius: 3, border: "1px solid hsl(var(--accent-h) 22% 18% / 0.8)",
              background: showAllLinks ? "hsl(var(--accent-h) 30% 13% / 0.9)" : "transparent",
              color: showAllLinks ? "hsl(var(--accent-h) 80% 68%)" : "hsl(214 12% 40%)",
            }}
          >
            Links: {showAllLinks ? "All" : "Focus"}
          </button>
        )}
        <RailButton onClick={onNewThreat} color="hsl(0 70% 58%)" busy={busy}>Threat</RailButton>
        <RailButton onClick={onNewDirective} color="hsl(var(--accent-h) 82% 62%)" busy={busy}>Objective</RailButton>
      </div>
    </div>
  );
}

function Readout({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="flex items-center gap-1.5" style={{ color: "hsl(214 12% 34%)" }}>
      {label}
      <strong style={{ color, fontWeight: 500, fontSize: 10 }}>{String(value).padStart(2, "0")}</strong>
    </span>
  );
}

/** A completion bar. Used at three sizes; the only thing that changes is width. */
function ProgressBar({ value, width, color, derived = false }: {
  value: number; width: number | string; color: string; derived?: boolean;
}) {
  return (
    <span
      title={derived ? "Averaged from this objective's sub-goals" : undefined}
      style={{
        display: "inline-block", width, height: 3, borderRadius: 2,
        background: "hsl(214 10% 16%)", overflow: "hidden", flexShrink: 0,
      }}
    >
      <span style={{
        display: "block", width: `${Math.max(0, Math.min(100, value))}%`, height: "100%",
        background: color, opacity: derived ? 0.6 : 1,
        transition: "width .25s ease",
      }} />
    </span>
  );
}

function RailButton({ onClick, color, busy, children }: {
  onClick: () => void; color: string; busy: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 px-3 py-1.5 transition-all hover:brightness-125 disabled:opacity-40"
      style={{
        fontFamily: mono, fontSize: 7.5, letterSpacing: "0.18em", textTransform: "uppercase",
        borderRadius: 3, color,
        background: alpha(color, 0.1),
        border: `1px solid ${alpha(color, 0.35)}`,
      }}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      {children}
    </button>
  );
}

/**
 * Shown when `/api/directives` fails, which on a correctly configured install
 * means one thing: the migration has not been run. Naming the file is the
 * whole point — the generic query error says nothing actionable.
 */
function SchemaNotice() {
  return (
    <div
      className="shrink-0 mt-2 px-3 py-2"
      style={{
        fontFamily: mono, fontSize: 8.5, letterSpacing: "0.08em", lineHeight: 1.7,
        color: "hsl(38 60% 66%)", background: "hsl(38 40% 8% / 0.7)",
        border: "1px solid hsl(38 40% 24% / 0.6)", borderRadius: 3,
      }}
    >
      Directives and links are not reachable. Run{" "}
      <code style={{ color: "hsl(38 80% 72%)" }}>script/sql/2026-09-command-center.sql</code>{" "}
      in the Supabase SQL editor — until then the grid shows threats only, and nothing new persists.
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Surface one — the threat grid
// ═══════════════════════════════════════════════════════════════════════════

/** A link drawn orbiting its marker. */
interface Satellite {
  key: string;
  code: string;
  label: string;
  color: string;
  missing: boolean;
  x: number;
  y: number;
  onActivate: () => void;
}

/**
 * Where a marker's satellites sit.
 *
 * They fan into the half of the surface with more room rather than ringing the
 * marker, because a marker near the right edge would otherwise push half its
 * links off the board. The vertical squash keeps a long fan from colliding with
 * the markers directly above and below.
 */
function fan(count: number, cx: number, cy: number, width: number, height: number) {
  const radius = 118;
  const spread = Math.min(Math.PI * 1.15, 0.55 + count * 0.4);
  const base = cx < width / 2 ? 0 : Math.PI;
  return Array.from({ length: count }, (_, i) => {
    const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
    const angle = base + offset;
    return {
      x: Math.max(70, Math.min(width - 70, cx + Math.cos(angle) * radius)),
      y: Math.max(24, Math.min(height - 24, cy + Math.sin(angle) * radius * 0.72)),
    };
  });
}

function ThreatGrid({
  threats, selected, onSelect, onMove, onCreateAt,
  designationOf, linksOf, resolveTarget, onOpenTarget, showAllLinks,
}: {
  threats: Threat[];
  selected: Selection;
  onSelect: (s: Selection) => void;
  onMove: (id: number, x: number, y: number) => void;
  onCreateAt: (x: number, y: number) => void;
  designationOf: (id: number) => string;
  linksOf: (kind: "threat" | "directive", id: number) => CommandLink[];
  resolveTarget: (link: CommandLink) => { title: string; missing: boolean };
  onOpenTarget: (link: CommandLink) => void;
  showAllLinks: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // An unplaced threat is scattered rather than written — see the file header.
  const placed = useMemo(() => {
    const map = new Map<number, { x: number; y: number }>();
    threats.forEach((threat, index) => {
      map.set(threat.id, {
        x: threat.pos_x ?? scatter(index).x,
        y: threat.pos_y ?? scatter(index).y,
      });
    });
    return map;
  }, [threats]);

  const positionOf = useCallback((id: number) => {
    if (drag?.id === id) return { x: drag.x, y: drag.y };
    return placed.get(id) ?? { x: 50, y: 50 };
  }, [drag, placed]);

  const pctFromEvent = useCallback((clientX: number, clientY: number) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return {
      x: clampPct(((clientX - rect.left) / rect.width) * 100),
      y: clampPct(((clientY - rect.top) / rect.height) * 100),
    };
  }, []);

  const startDrag = useCallback((threat: Threat, event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("[data-nodrag]")) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    let last = positionOf(threat.id);
    let moved = false;

    const move = (e: PointerEvent) => {
      const next = pctFromEvent(e.clientX, e.clientY);
      if (!next) return;
      moved = true;
      last = next;
      setDrag({ id: threat.id, ...next });
    };
    const up = () => {
      element.releasePointerCapture(event.pointerId);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      setDrag(null);
      // A click that never moved is a selection, not a zero-length drag: writing
      // the unchanged position back would mark every unplaced marker as placed
      // just for being clicked on.
      if (moved) onMove(threat.id, Math.round(last.x * 100) / 100, Math.round(last.y * 100) / 100);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
  }, [onMove, pctFromEvent, positionOf]);

  // Which markers draw their satellites. Focus mode is the default because a
  // board with thirty edges drawn at once is a hairball, not a map.
  const expanded = useMemo(() => {
    if (showAllLinks) return new Set(threats.map(t => t.id));
    return new Set(selected?.kind === "threat" ? [selected.id] : []);
  }, [showAllLinks, selected, threats]);

  const satellites = useMemo(() => {
    if (size.w === 0) return new Map<number, Satellite[]>();
    const result = new Map<number, Satellite[]>();
    for (const threat of threats) {
      if (!expanded.has(threat.id)) continue;
      const links = linksOf("threat", threat.id);
      if (links.length === 0) continue;
      const centre = positionOf(threat.id);
      const cx = (centre.x / 100) * size.w;
      const cy = (centre.y / 100) * size.h;
      const spots = fan(links.length, cx, cy, size.w, size.h);
      result.set(threat.id, links.map((link, i) => {
        const meta = TARGETS[link.target_kind];
        const resolved = resolveTarget(link);
        return {
          key: `l${link.id}`,
          code: meta?.code ?? "REF",
          label: resolved.title,
          color: meta?.color ?? "hsl(214 20% 55%)",
          missing: resolved.missing,
          x: spots[i].x, y: spots[i].y,
          onActivate: () => onOpenTarget(link),
        };
      }));
    }
    return result;
  }, [size, threats, expanded, linksOf, positionOf, resolveTarget, onOpenTarget]);

  return (
    <div
      ref={surface}
      className="relative h-full w-full overflow-hidden select-none"
      style={{
        background:
          "radial-gradient(ellipse at 50% 46%, hsl(196 26% 9% / 0.55), hsl(222 22% 4%) 72%)",
        border: "1px solid hsl(var(--accent-h) 18% 13% / 0.7)",
        borderTop: "none", borderRadius: "0 0 4px 4px",
        cursor: "crosshair",
      }}
      onPointerDown={e => { if (e.target === e.currentTarget) onSelect(null); }}
      onDoubleClick={e => {
        if (e.target !== e.currentTarget) return;
        const spot = pctFromEvent(e.clientX, e.clientY);
        if (spot) { playCue("nodeSelect"); onCreateAt(spot.x, spot.y); }
      }}
    >
      <GridBackdrop />

      {/* Edges, under the markers and never in the way of a pointer. */}
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
        {threats.map(threat => {
          const orbit = satellites.get(threat.id);
          if (!orbit) return null;
          const centre = positionOf(threat.id);
          const cx = (centre.x / 100) * size.w;
          const cy = (centre.y / 100) * size.h;
          return orbit.map(sat => (
            <g key={`${threat.id}-${sat.key}`}>
              <line
                x1={cx} y1={cy} x2={sat.x} y2={sat.y}
                stroke={alpha(sat.color, sat.missing ? 0.2 : 0.42)}
                strokeWidth={1}
                strokeDasharray={sat.missing ? "3 4" : undefined}
              />
              <circle cx={sat.x} cy={sat.y} r={2} fill={alpha(sat.color, 0.7)} />
            </g>
          ));
        })}
      </svg>

      {threats.map(threat => {
        const position = positionOf(threat.id);
        return (
          <ThreatMarker
            key={threat.id}
            threat={threat}
            designation={designationOf(threat.id)}
            linkCount={linksOf("threat", threat.id).length}
            selected={selected?.kind === "threat" && selected.id === threat.id}
            dragging={drag?.id === threat.id}
            x={position.x} y={position.y}
            onPointerDown={e => startDrag(threat, e)}
            onSelect={() => { playCue("nodeSelect"); onSelect({ kind: "threat", id: threat.id }); }}
          />
        );
      })}

      {Array.from(satellites.values()).flat().map(sat => (
        <button
          key={sat.key}
          onClick={e => { e.stopPropagation(); sat.onActivate(); }}
          className="absolute flex items-center gap-1.5 px-2 py-1 transition-all hover:brightness-125"
          style={{
            left: sat.x, top: sat.y, transform: "translate(-50%, -50%)",
            maxWidth: 170, borderRadius: 2,
            background: "hsl(222 24% 6% / 0.94)",
            border: `1px solid ${alpha(sat.color, sat.missing ? 0.25 : 0.5)}`,
            color: sat.missing ? "hsl(214 10% 42%)" : "hsl(214 14% 72%)",
            fontFamily: mono, fontSize: 8, letterSpacing: "0.04em",
            cursor: "pointer", zIndex: 3,
          }}
          title={sat.missing ? `${sat.label} — target no longer exists` : sat.label}
        >
          <span style={{ color: sat.color, fontSize: 6.5, letterSpacing: "0.16em" }}>{sat.code}</span>
          <span className="truncate">{sat.label}</span>
          {sat.missing && <span style={{ fontSize: 6.5, letterSpacing: "0.14em", color: "hsl(0 40% 50%)" }}>MISSING</span>}
        </button>
      ))}

      {threats.length === 0 && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none"
          style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(214 12% 26%)" }}
        >
          <Crosshair className="h-6 w-6" style={{ opacity: 0.35 }} />
          Grid clear
          <span style={{ fontSize: 8, letterSpacing: "0.1em", textTransform: "none", fontStyle: "italic" }}>
            Double-click anywhere to place a threat
          </span>
        </div>
      )}
    </div>
  );
}

/** Grid lines, range rings, crosshair, sweep. Purely decorative, never hit. */
function GridBackdrop() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--accent-h) 30% 40% / 0.05) 1px, transparent 1px)," +
            "linear-gradient(90deg, hsl(var(--accent-h) 30% 40% / 0.05) 1px, transparent 1px)," +
            "linear-gradient(hsl(var(--accent-h) 30% 40% / 0.025) 1px, transparent 1px)," +
            "linear-gradient(90deg, hsl(var(--accent-h) 30% 40% / 0.025) 1px, transparent 1px)",
          backgroundSize: "96px 96px, 96px 96px, 16px 16px, 16px 16px",
        }}
      />
      <svg className="absolute inset-0" width="100%" height="100%" preserveAspectRatio="none">
        <g stroke="hsl(var(--accent-h) 40% 45% / 0.12)" fill="none" strokeDasharray="2 6">
          <ellipse cx="50%" cy="50%" rx="14%" ry="19%" />
          <ellipse cx="50%" cy="50%" rx="28%" ry="37%" />
          <ellipse cx="50%" cy="50%" rx="42%" ry="55%" />
        </g>
        <g stroke="hsl(var(--accent-h) 45% 50% / 0.16)">
          <line x1="50%" y1="46%" x2="50%" y2="54%" />
          <line x1="47%" y1="50%" x2="53%" y2="50%" />
        </g>
      </svg>
      <div className="cc-sweep absolute" style={{
        left: "50%", top: "50%", width: "150%", height: "150%",
        transform: "translate(-50%, -50%)",
        background: "conic-gradient(from 0deg, transparent 0deg, transparent 320deg, hsl(var(--accent-h) 60% 50% / 0.05) 352deg, hsl(var(--accent-h) 70% 55% / 0.11) 360deg)",
      }} />
    </div>
  );
}

function ThreatMarker({
  threat, designation, linkCount, selected, dragging, x, y, onPointerDown, onSelect,
}: {
  threat: Threat;
  designation: string;
  linkCount: number;
  selected: boolean;
  dragging: boolean;
  x: number;
  y: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onSelect: () => void;
}) {
  const color = threat.resolved ? "hsl(214 10% 34%)" : PRIORITY_COLOR[threat.priority];

  return (
    <div
      className="cc-marker absolute"
      style={{
        left: `${x}%`, top: `${y}%`,
        transform: `translate(-50%, -50%) scale(${dragging ? 1.04 : 1})`,
        width: 176, zIndex: selected ? 6 : 4,
        cursor: dragging ? "grabbing" : "grab",
      }}
      onPointerDown={onPointerDown}
      onClick={e => { e.stopPropagation(); onSelect(); }}
    >
      {/* The alarm halo. Only on an unresolved high-priority marker — if every
          marker pulses, none of them reads as urgent. */}
      {!threat.resolved && threat.priority === 3 && (
        <span
          className="cc-pulse absolute rounded-full pointer-events-none"
          style={{ inset: -14, border: `1px solid ${alpha(color, 0.5)}` }}
        />
      )}
      <div
        style={{
          background: threat.resolved ? "hsl(222 14% 6% / 0.82)" : "hsl(222 22% 6% / 0.94)",
          border: `1px solid ${alpha(color, selected ? 0.85 : 0.4)}`,
          borderLeft: `2px solid ${color}`,
          borderRadius: 3,
          boxShadow: selected ? `0 0 0 1px ${alpha(color, 0.3)}, 0 0 22px ${alpha(color, 0.22)}` : "none",
          padding: "5px 7px",
        }}
      >
        <div className="flex items-center gap-1.5" style={{ marginBottom: 3 }}>
          <WarnMark color={color} />
          <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: "0.2em", color: alpha(color, 0.85) }}>
            {designation}
          </span>
          <span style={{ fontFamily: mono, fontSize: 6.5, letterSpacing: "0.14em", color: "hsl(214 10% 34%)" }}>
            {threat.resolved ? "NEUTRALISED" : PRIORITY_LABEL[threat.priority]}
          </span>
          {linkCount > 0 && (
            <span className="ml-auto flex items-center gap-0.5" style={{ fontFamily: mono, fontSize: 6.5, color: "hsl(214 12% 42%)" }}>
              <Link2 className="h-2 w-2" />{linkCount}
            </span>
          )}
        </div>
        <div
          className="truncate"
          style={{
            fontFamily: mono, fontSize: 9.5, letterSpacing: "0.03em",
            color: threat.resolved ? "hsl(214 8% 40%)" : "hsl(214 14% 80%)",
            textDecoration: threat.resolved ? "line-through" : "none",
          }}
        >
          {threat.title}
        </div>
      </div>
    </div>
  );
}

function WarnMark({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M8 2 L14.5 13.5 L1.5 13.5 Z" stroke={color} strokeWidth="1.4" strokeLinejoin="round" fill={alpha(color, 0.12)} />
      <line x1="8" y1="6.5" x2="8" y2="10" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="12" r="0.9" fill={color} />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Surface two — the objective tree
// ═══════════════════════════════════════════════════════════════════════════

const NODE_W = 200;
const NODE_H = 96;
const NODE_GAP = 30;
const ROW_H = 136;

interface ChainNode {
  id: number;
  children: number[];
  x: number;
  y: number;
}

/**
 * The tidy tree walk: leaves take the next slot left to right, a parent centres
 * over its children, depth sets the row.
 *
 * Positions are computed on every render rather than stored, because the shape
 * is already in the data and a second copy of it would only be a thing to keep
 * in step. This is the whole reason the two surfaces are different: a threat
 * has no shape and so is placed by hand, and a goal has one and so is not.
 */
function layoutChain(directives: Directive[]) {
  const byId = new Map(directives.map(d => [d.id, d]));
  const nodes = new Map<number, ChainNode>();
  for (const directive of directives) nodes.set(directive.id, { id: directive.id, children: [], x: 0, y: 0 });

  const roots: number[] = [];
  for (const directive of [...directives].sort((a, b) => a.created_at - b.created_at)) {
    // A parent that no longer exists reads as a root rather than vanishing — a
    // row written by an older build must not be able to hide an objective.
    const parent = directive.parent_id !== null ? byId.get(directive.parent_id) : undefined;
    if (parent && parent.id !== directive.id) nodes.get(parent.id)!.children.push(directive.id);
    else roots.push(directive.id);
  }

  // The API refuses a cycle, but a row written before that guard existed should
  // degrade to a stray node rather than hang the renderer.
  let slot = 0;
  const seen = new Set<number>();
  const place = (id: number, depth: number): number => {
    const node = nodes.get(id)!;
    if (seen.has(id)) return node.x;
    seen.add(id);
    node.y = depth * ROW_H;
    if (node.children.length === 0) {
      node.x = slot * (NODE_W + NODE_GAP);
      slot += 1;
    } else {
      const spans = node.children.map(child => place(child, depth + 1));
      node.x = (Math.min(...spans) + Math.max(...spans)) / 2;
    }
    return node.x;
  };
  for (const root of roots) place(root, 0);

  const list = Array.from(nodes.values()).filter(node => seen.has(node.id));
  const parentOf = new Map<number, number>();
  for (const node of list) for (const child of node.children) parentOf.set(child, node.id);

  const width = list.reduce((max, node) => Math.max(max, node.x + NODE_W), NODE_W) + 40;
  const height = list.reduce((max, node) => Math.max(max, node.y + NODE_H), ROW_H) + 40;
  return { list, parentOf, width, height };
}

function DirectiveChain({
  directives, selected, onSelect, designationOf, linkCountOf, progressOf,
}: {
  directives: Directive[];
  selected: Selection;
  onSelect: (s: Selection) => void;
  designationOf: (id: number) => string;
  linkCountOf: (id: number) => number;
  progressOf: (id: number) => Progress;
}) {
  const [zoom, setZoom] = useState(1);
  const { list, parentOf, width, height } = useMemo(() => layoutChain(directives), [directives]);
  const byKey = useMemo(() => new Map(list.map(node => [node.id, node])), [list]);
  const byId = useMemo(() => new Map(directives.map(d => [d.id, d])), [directives]);

  return (
    <div
      className="relative h-full w-full overflow-auto"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, hsl(var(--accent-h) 18% 8% / 0.5), hsl(222 22% 4%) 70%)",
        border: "1px solid hsl(var(--accent-h) 18% 13% / 0.7)",
        borderTop: "none", borderRadius: "0 0 4px 4px",
      }}
      onPointerDown={e => { if (e.target === e.currentTarget) onSelect(null); }}
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        {/* Buttons rather than wheel zoom, for the reason the Idea Workshop's
            graph gave up wheel zoom: this sits in a scrolling page, and a wheel
            that sometimes zoomed and sometimes scrolled was the worst of both. */}
        {([["−", -0.15], ["+", 0.15]] as const).map(([glyph, delta]) => (
          <button
            key={glyph}
            onClick={() => setZoom(z => Math.max(0.5, Math.min(1.6, Math.round((z + delta) * 100) / 100)))}
            className="flex h-6 w-6 items-center justify-center transition-colors hover:brightness-125"
            style={{
              fontFamily: mono, fontSize: 11, borderRadius: 3,
              background: "hsl(222 24% 7% / 0.9)",
              border: "1px solid hsl(var(--accent-h) 22% 18% / 0.8)",
              color: "hsl(var(--accent-h) 60% 58%)",
            }}
          >{glyph}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <div
          className="flex h-full flex-col items-center justify-center gap-2"
          style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(214 12% 26%)" }}
        >
          <GitBranch className="h-6 w-6" style={{ opacity: 0.35 }} />
          No objectives set
          <span style={{ fontSize: 8, letterSpacing: "0.1em", textTransform: "none", fontStyle: "italic" }}>
            Add one, then break it down — a selected objective becomes the next one&apos;s parent
          </span>
        </div>
      ) : (
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width, height, position: "relative" }}>
          <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
            {list.map(node => {
              const parentId = parentOf.get(node.id);
              const parent = parentId === undefined ? null : byKey.get(parentId);
              if (!parent) return null;
              const x1 = parent.x + NODE_W / 2;
              const y1 = parent.y + NODE_H;
              const x2 = node.x + NODE_W / 2;
              const y2 = node.y;
              const mid = (y1 + y2) / 2;
              return (
                <path
                  key={`edge-${node.id}`}
                  d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                  fill="none"
                  stroke="hsl(var(--accent-h) 50% 50% / 0.35)"
                  strokeWidth={1.2}
                />
              );
            })}
          </svg>

          {list.map(node => (
            <ObjectiveNode
              key={node.id}
              directive={byId.get(node.id)!}
              designation={designationOf(node.id)}
              progress={progressOf(node.id)}
              subCount={node.children.length}
              linkCount={linkCountOf(node.id)}
              selected={selected?.kind === "directive" && selected.id === node.id}
              x={node.x} y={node.y}
              onSelect={() => { playCue("nodeSelect"); onSelect({ kind: "directive", id: node.id }); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectiveNode({
  directive, designation, progress, subCount, linkCount, selected, x, y, onSelect,
}: {
  directive: Directive;
  designation: string;
  progress: Progress;
  subCount: number;
  linkCount: number;
  selected: boolean;
  x: number;
  y: number;
  onSelect: () => void;
}) {
  const status = STATUS_META[directive.status] ?? STATUS_META.planned;
  const late = overdue(directive);

  return (
    <button
      onClick={onSelect}
      className="absolute flex flex-col text-left transition-all hover:brightness-115"
      style={{
        left: x, top: y, width: NODE_W, height: NODE_H, padding: "7px 9px", borderRadius: 3,
        background: "hsl(222 22% 6% / 0.94)",
        border: `1px solid ${alpha(late ? "hsl(0 70% 55%)" : status.color, selected ? 0.85 : 0.3)}`,
        borderLeft: `2px solid ${status.color}`,
        boxShadow: selected ? `0 0 20px ${alpha(status.color, 0.2)}` : "none",
        opacity: directive.status === "shelved" ? 0.55 : 1,
      }}
    >
      <div className="flex w-full items-center gap-1.5">
        <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: "0.2em", color: alpha(status.color, 0.9) }}>{designation}</span>
        <span style={{ fontFamily: mono, fontSize: 6.5, letterSpacing: "0.14em", color: "hsl(214 10% 36%)" }}>
          {status.label.toUpperCase()}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {linkCount > 0 && (
            <span className="flex items-center gap-0.5" style={{ fontFamily: mono, fontSize: 6.5, color: "hsl(214 12% 42%)" }}>
              <Link2 className="h-2 w-2" />{linkCount}
            </span>
          )}
          <PriorityPips value={directive.priority} />
        </span>
      </div>

      <div
        className="mt-1.5 w-full truncate"
        style={{
          fontFamily: mono, fontSize: 9.5, color: "hsl(214 14% 80%)",
          textDecoration: directive.status === "achieved" ? "line-through" : "none",
        }}
      >
        {directive.title}
      </div>

      <div className="mt-auto flex w-full items-center gap-2">
        <ProgressBar
          value={progress.value}
          width="100%"
          derived={progress.derived}
          color={directive.status === "achieved" ? "hsl(145 55% 50%)" : status.color}
        />
        <span style={{ fontFamily: mono, fontSize: 6.5, color: "hsl(214 12% 44%)", flexShrink: 0 }}>
          {progress.value}%
        </span>
      </div>

      <div className="flex w-full items-center gap-2" style={{ marginTop: 3, fontFamily: mono, fontSize: 6.5, letterSpacing: "0.12em" }}>
        {subCount > 0 && <span style={{ color: "hsl(214 10% 36%)" }}>{subCount} SUB</span>}
        {directive.target_date && (
          <span className="ml-auto" style={{ color: late ? "hsl(0 60% 58%)" : "hsl(214 10% 36%)" }}>
            {late ? "OVERDUE " : ""}{directive.target_date}
          </span>
        )}
      </div>
    </button>
  );
}

function PriorityPips({ value }: { value: Priority }) {
  return (
    <span className="flex items-center gap-0.5">
      {([1, 2, 3] as const).map(p => (
        <span
          key={p}
          style={{
            width: 3, height: 7, borderRadius: 1,
            background: value >= p ? PRIORITY_COLOR[p] : "hsl(214 10% 18%)",
          }}
        />
      ))}
    </span>
  );
}

/**
 * Ten cells rather than a range input: a native slider cannot be styled to sit
 * with the rest of this panel without fighting three vendor pseudo-elements,
 * and 10% steps are as fine a reading as a hand-set number deserves.
 *
 * Clicking the cell that is already the value steps back by one, which is the
 * only way to reach zero.
 */
function ProgressPicker({ value, onChange }: { value: Progress; onChange: (v: number) => void }) {
  const locked = value.derived;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-0.5">
        {Array.from({ length: 10 }, (_, i) => {
          const step = (i + 1) * 10;
          const filled = value.value >= step;
          return (
            <button
              key={step}
              disabled={locked}
              onClick={() => onChange(value.value === step ? step - 10 : step)}
              title={locked ? "Averaged from this objective's sub-goals" : `${step}%`}
              style={{
                flex: 1, height: 14, borderRadius: 1,
                background: filled ? alpha("hsl(145 55% 50%)", locked ? 0.45 : 0.85) : "hsl(214 10% 13%)",
                border: "none", cursor: locked ? "default" : "pointer",
                transition: "background .12s",
              }}
            />
          );
        })}
      </div>
      <span style={{ fontFamily: mono, fontSize: 8.5, color: locked ? "hsl(214 10% 38%)" : "hsl(145 45% 58%)", width: 30, textAlign: "right" }}>
        {value.value}%
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The dossier — one panel, both record types
// ═══════════════════════════════════════════════════════════════════════════

function Dossier(props: {
  threat: Threat | null;
  directive: Directive | null;
  designation: string;
  directives: Directive[];
  directiveDesignationOf: (id: number) => string;
  progressOf: (id: number) => Progress;
  links: CommandLink[];
  resolveTarget: (link: CommandLink) => { title: string; missing: boolean };
  onOpenTarget: (link: CommandLink) => void;
  onDetach: (id: number) => void;
  onAttach: () => void;
  onPatchThreat: (patch: Partial<Threat>) => void;
  onPatchDirective: (patch: Partial<Directive>) => void;
  onDelete: () => void;
  onSelect: (s: Selection) => void;
}) {
  const { threat, directive } = props;

  return (
    <aside
      className="shrink-0 overflow-y-auto"
      style={{
        width: 312,
        background: "linear-gradient(180deg, hsl(222 22% 5% / 0.95), hsl(222 20% 4% / 0.95))",
        borderLeft: "1px solid hsl(var(--accent-h) 20% 15% / 0.7)",
      }}
    >
      {!threat && !directive ? (
        <EmptyDossier />
      ) : (
        <EntityForm
          key={threat ? `t${threat.id}` : `d${directive!.id}`}
          {...props}
        />
      )}
    </aside>
  );
}

function EmptyDossier() {
  return (
    <div className="flex h-full flex-col justify-center gap-4 px-5" style={{ color: "hsl(214 12% 32%)" }}>
      <div style={{ fontFamily: serif, fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: "hsl(var(--accent-h) 40% 44%)" }}>
        No marker selected
      </div>
      <div style={{ fontFamily: mono, fontSize: 8.5, lineHeight: 1.9, letterSpacing: "0.04em" }}>
        Select a marker to open its dossier — its body text, its priority, and every
        project, caseboard, research board, calendar item or plan it is attached to.
      </div>
      <div className="flex flex-col gap-1.5" style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        <Legend color="hsl(0 75% 55%)" text="Threat — what could go wrong, placed by hand" />
        <Legend color="hsl(var(--accent-h) 88% 60%)" text="Objective — what you are aiming at" />
        <Legend color="hsl(192 100% 62%)" text="Link — either one, attached to real work" />
      </div>
    </div>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-2">
      <span style={{ width: 12, height: 2, background: color, borderRadius: 1, flexShrink: 0 }} />
      {text}
    </span>
  );
}

function EntityForm({
  threat, directive, designation, directives, directiveDesignationOf, progressOf,
  links, resolveTarget, onOpenTarget, onDetach, onAttach,
  onPatchThreat, onPatchDirective, onDelete, onSelect,
}: {
  threat: Threat | null;
  directive: Directive | null;
  designation: string;
  directives: Directive[];
  directiveDesignationOf: (id: number) => string;
  progressOf: (id: number) => Progress;
  links: CommandLink[];
  resolveTarget: (link: CommandLink) => { title: string; missing: boolean };
  onOpenTarget: (link: CommandLink) => void;
  onDetach: (id: number) => void;
  onAttach: () => void;
  onPatchThreat: (patch: Partial<Threat>) => void;
  onPatchDirective: (patch: Partial<Directive>) => void;
  onDelete: () => void;
  onSelect: (s: Selection) => void;
}) {
  const isThreat = Boolean(threat);
  const record = (threat ?? directive)!;
  const commit = isThreat ? onPatchThreat : onPatchDirective;

  const [title, setTitle]   = useState(record.title);
  const [detail, setDetail] = useState(record.detail ?? "");
  const [confirming, setConfirming] = useState(false);

  const accent = threat
    ? (threat.resolved ? "hsl(214 10% 40%)" : PRIORITY_COLOR[threat.priority])
    : STATUS_META[directive!.status].color;

  // Descendants cannot be offered as a parent: the API refuses the cycle
  // anyway, and a select that silently does nothing is worse than one that
  // never showed the option.
  const forbiddenParents = useMemo(() => {
    if (!directive) return new Set<number>();
    const blocked = new Set<number>([directive.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const other of directives) {
        if (other.parent_id !== null && blocked.has(other.parent_id) && !blocked.has(other.id)) {
          blocked.add(other.id);
          grew = true;
        }
      }
    }
    return blocked;
  }, [directive, directives]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <span style={{ ...pill(accent), fontSize: 7.5 }}>{isThreat ? "Threat" : "Objective"}</span>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.2em", color: alpha(accent, 0.9) }}>{designation}</span>
        <button
          onClick={() => onSelect(null)}
          className="ml-auto opacity-40 transition-opacity hover:opacity-90"
          title="Close (Esc)"
        >
          <X className="h-3.5 w-3.5" style={{ color: "hsl(214 14% 55%)" }} />
        </button>
      </div>

      <Labelled label="Title">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title !== record.title) commit({ title: title.trim() }); }}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          style={fieldStyle}
        />
      </Labelled>

      <Labelled label={isThreat ? "Assessment" : "What done looks like"}>
        <textarea
          value={detail}
          onChange={e => setDetail(e.target.value)}
          onBlur={() => { if (detail !== (record.detail ?? "")) commit({ detail }); }}
          rows={5}
          placeholder={isThreat ? "What it is, why it matters, what it would cost." : "The outcome, and how you will know you have reached it."}
          style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.7 }}
        />
      </Labelled>

      <Labelled label="Priority">
        <div className="flex items-center gap-2">
          {([1, 2, 3] as const).map(p => (
            <button
              key={p}
              onClick={() => commit({ priority: p })}
              className="flex items-center gap-1 px-2 py-1 transition-all"
              style={{
                fontFamily: mono, fontSize: 7, letterSpacing: "0.16em", borderRadius: 2,
                background: record.priority === p ? alpha(PRIORITY_COLOR[p], 0.14) : "transparent",
                border: `1px solid ${record.priority === p ? alpha(PRIORITY_COLOR[p], 0.5) : "hsl(214 10% 16%)"}`,
                color: record.priority === p ? PRIORITY_COLOR[p] : "hsl(214 10% 38%)",
              }}
            >
              <WarnMark color={record.priority === p ? PRIORITY_COLOR[p] : "hsl(214 10% 30%)"} size={9} />
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      </Labelled>

      {threat && (
        <>
          <Labelled label="State">
            <button
              onClick={() => onPatchThreat({ resolved: !threat.resolved })}
              className="flex w-full items-center justify-between px-2.5 py-1.5 transition-all"
              style={{
                fontFamily: mono, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", borderRadius: 2,
                background: threat.resolved ? "hsl(145 30% 8% / 0.7)" : "hsl(0 25% 8% / 0.7)",
                border: `1px solid ${threat.resolved ? "hsl(145 35% 25%)" : "hsl(0 35% 24%)"}`,
                color: threat.resolved ? "hsl(145 50% 58%)" : "hsl(0 60% 62%)",
              }}
            >
              {threat.resolved ? "Neutralised" : "Active"}
              <span style={{ fontSize: 7, opacity: 0.7 }}>{threat.resolved ? "Reactivate" : "Mark neutralised"}</span>
            </button>
          </Labelled>

        </>
      )}

      {directive && (
        <>
          <Labelled label="Status">
            <div className="grid grid-cols-2 gap-1.5">
              {STATUS_ORDER.map(status => (
                <button
                  key={status}
                  // Marking a leaf achieved sets it to 100 in the same write.
                  // A goal that is done and 60% complete is a contradiction, and
                  // leaving the user to fix it by hand every time is worse than
                  // moving one field they were always going to move. A parent's
                  // number is derived, so there is nothing there to set.
                  onClick={() => onPatchDirective(
                    status === "achieved" && !progressOf(directive.id).derived
                      ? { status, progress: 100 }
                      : { status })}
                  className="px-2 py-1.5 transition-all"
                  style={{
                    fontFamily: mono, fontSize: 7.5, letterSpacing: "0.16em", textTransform: "uppercase", borderRadius: 2,
                    background: directive.status === status ? alpha(STATUS_META[status].color, 0.14) : "transparent",
                    border: `1px solid ${directive.status === status ? alpha(STATUS_META[status].color, 0.5) : "hsl(214 10% 16%)"}`,
                    color: directive.status === status ? STATUS_META[status].color : "hsl(214 10% 38%)",
                  }}
                >{STATUS_META[status].label}</button>
              ))}
            </div>
          </Labelled>

          <Labelled label="Target date">
            <input
              type="date"
              value={directive.target_date ?? ""}
              onChange={e => onPatchDirective({ target_date: e.target.value })}
              style={{ ...fieldStyle, colorScheme: "dark" }}
            />
          </Labelled>

          <Labelled label={progressOf(directive.id).derived ? "Progress · from sub-objectives" : "Progress"}>
            <ProgressPicker
              value={progressOf(directive.id)}
              onChange={value => onPatchDirective({ progress: value })}
            />
          </Labelled>

          <Labelled label="Part of">
            <select
              value={directive.parent_id ?? ""}
              onChange={e => onPatchDirective({ parent_id: e.target.value === "" ? null : Number(e.target.value) })}
              style={fieldStyle}
            >
              <option value="">— top-level objective —</option>
              {directives.filter(d => !forbiddenParents.has(d.id)).map(d => (
                <option key={d.id} value={d.id}>{directiveDesignationOf(d.id)} · {d.title}</option>
              ))}
            </select>
          </Labelled>
        </>
      )}

      <Labelled label={`Linked assets · ${links.length}`}>
        <div className="flex flex-col gap-1">
          {links.length === 0 && (
            <span style={{ fontFamily: mono, fontSize: 8, fontStyle: "italic", color: "hsl(214 10% 30%)" }}>
              Nothing attached yet.
            </span>
          )}
          {links.map(link => {
            const meta = TARGETS[link.target_kind];
            const resolved = resolveTarget(link);
            return (
              <div
                key={link.id}
                className="flex items-center gap-2 px-2 py-1.5"
                style={{
                  borderRadius: 2, background: "hsl(222 20% 7% / 0.8)",
                  border: `1px solid ${alpha(meta?.color ?? "hsl(214 20% 55%)", resolved.missing ? 0.18 : 0.28)}`,
                }}
              >
                <span style={{ fontFamily: mono, fontSize: 6.5, letterSpacing: "0.16em", color: meta?.color ?? "hsl(214 20% 55%)" }}>
                  {meta?.code ?? "REF"}
                </span>
                <span
                  className="truncate"
                  style={{ fontFamily: mono, fontSize: 8.5, color: resolved.missing ? "hsl(214 10% 38%)" : "hsl(214 14% 72%)" }}
                  title={resolved.title}
                >
                  {resolved.title}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {resolved.missing ? (
                    <span style={{ fontFamily: mono, fontSize: 6.5, letterSpacing: "0.14em", color: "hsl(0 40% 48%)" }}>MISSING</span>
                  ) : (
                    <button onClick={() => onOpenTarget(link)} title={`Open in ${meta?.group}`} className="opacity-50 transition-opacity hover:opacity-100">
                      <ExternalLink className="h-3 w-3" style={{ color: meta?.color }} />
                    </button>
                  )}
                  <button onClick={() => onDetach(link.id)} title="Detach" className="opacity-40 transition-opacity hover:opacity-100">
                    <X className="h-3 w-3" style={{ color: "hsl(0 50% 55%)" }} />
                  </button>
                </span>
              </div>
            );
          })}
          <button
            onClick={onAttach}
            className="mt-1 flex items-center justify-center gap-1.5 px-2 py-1.5 transition-all hover:brightness-125"
            style={{
              fontFamily: mono, fontSize: 7.5, letterSpacing: "0.16em", textTransform: "uppercase", borderRadius: 2,
              background: "hsl(var(--accent-h) 25% 10% / 0.7)",
              border: "1px solid hsl(var(--accent-h) 30% 24% / 0.7)",
              color: "hsl(var(--accent-h) 70% 62%)",
            }}
          >
            <Link2 className="h-3 w-3" />Attach
          </button>
        </div>
      </Labelled>

      <div className="mt-2 border-t pt-3" style={{ borderColor: "hsl(214 10% 12%)" }}>
        <button
          onClick={() => { if (confirming) onDelete(); else setConfirming(true); }}
          onBlur={() => setConfirming(false)}
          className="flex w-full items-center justify-center gap-1.5 px-2 py-1.5 transition-all"
          style={{
            fontFamily: mono, fontSize: 7.5, letterSpacing: "0.16em", textTransform: "uppercase", borderRadius: 2,
            background: confirming ? "hsl(0 40% 14% / 0.85)" : "transparent",
            border: `1px solid ${confirming ? "hsl(0 50% 34%)" : "hsl(0 20% 16%)"}`,
            color: confirming ? "hsl(0 70% 66%)" : "hsl(0 25% 42%)",
          }}
        >
          <Trash2 className="h-3 w-3" />
          {confirming ? "Confirm removal" : `Remove ${isThreat ? "threat" : "objective"}`}
        </button>
        {confirming && !isThreat && (
          <p style={{ marginTop: 6, fontFamily: mono, fontSize: 7, lineHeight: 1.7, color: "hsl(214 10% 34%)" }}>
            Sub-objectives are promoted to this one&apos;s parent, not removed with it.
          </p>
        )}
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "hsl(222 20% 7% / 0.9)",
  border: "1px solid hsl(214 12% 15%)",
  borderRadius: 2, outline: "none",
  padding: "5px 7px",
  fontFamily: mono, fontSize: 9, letterSpacing: "0.03em",
  color: "hsl(214 14% 78%)",
};

/**
 * A caption over a control. Deliberately a div and not a `<label>`: several of
 * these wrap a *group* of buttons, and a label forwards its click to the first
 * labelable descendant — which would fire the wrong priority button on some
 * browsers every time the caption was clicked.
 */
function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: "0.2em", textTransform: "uppercase", color: "hsl(var(--accent-h) 25% 40%)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The asset picker
// ═══════════════════════════════════════════════════════════════════════════

interface Candidate { kind: TargetKind; ref: string; label: string }

/**
 * Everything a marker can be attached to, in one list.
 *
 * Boards arrive with the page — one query already covers projects, caseboards
 * and both Research Lab kinds, because they are all rows in `boards`. Kronos is
 * fetched only when this opens: it costs one request per calendar per item
 * kind, which is not a price worth paying on a page that may never attach
 * anything. Garden plans are read out of localStorage, where the Garden keeps
 * them.
 */
function AssetPicker({
  boards, gardenPlans, existing, onClose, onPick,
}: {
  boards: BoardRow[];
  gardenPlans: { letter: string; name: string }[];
  existing: CommandLink[];
  onClose: () => void;
  onPick: (kind: TargetKind, ref: string, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data: kronos = [], isLoading } = useQuery<Candidate[]>({
    queryKey: ["command-center", "kronos-targets"],
    queryFn: async () => {
      const calendars: { id: number }[] = await apiRequest("GET", "/api/kronos/calendars").then(r => r.json());
      const segments = [
        ["routines", "kronos_routine"],
        ["assignments", "kronos_assignment"],
        ["events", "kronos_event"],
        ["generals", "kronos_general"],
      ] as const;
      const out: Candidate[] = [];
      for (const calendar of calendars) {
        const rows = await Promise.all(segments.map(([segment]) =>
          apiRequest("GET", `/api/kronos/calendars/${calendar.id}/${segment}`)
            .then(r => r.json())
            .catch(() => [])));
        rows.forEach((items: { id: number; title: string }[], index) => {
          for (const item of items) {
            out.push({ kind: segments[index][1], ref: String(item.id), label: item.title });
          }
        });
      }
      return out;
    },
    staleTime: 60_000,
    retry: false,
  });

  const attached = useMemo(
    () => new Set(existing.map(link => `${link.target_kind}|${link.target_ref}`)),
    [existing]);

  const candidates = useMemo(() => {
    const out: Candidate[] = [];
    for (const board of boards) {
      if (board.type in TARGETS) out.push({ kind: board.type as TargetKind, ref: String(board.id), label: board.title });
    }
    out.push(...kronos);
    for (const plan of gardenPlans) {
      out.push({ kind: "garden_plan", ref: plan.letter, label: `Plan ${plan.letter} — ${plan.name}` });
    }
    const needle = query.trim().toLowerCase();
    return needle
      ? out.filter(c => c.label.toLowerCase().includes(needle) || TARGETS[c.kind].group.toLowerCase().includes(needle))
      : out;
  }, [boards, kronos, gardenPlans, query]);

  const grouped = useMemo(
    () => TARGET_GROUPS
      .map(group => ({ group, items: candidates.filter(c => TARGETS[c.kind].group === group) }))
      .filter(section => section.items.length > 0),
    [candidates]);

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "hsl(222 30% 2% / 0.72)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[76vh] w-full max-w-lg flex-col overflow-hidden"
        style={{
          background: "linear-gradient(180deg, hsl(222 24% 7%), hsl(222 22% 5%))",
          border: "1px solid hsl(var(--accent-h) 25% 20% / 0.8)",
          borderRadius: 5,
          boxShadow: "0 24px 70px hsl(222 40% 1% / 0.7)",
        }}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid hsl(214 10% 12%)" }}>
          <Link2 className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent-h) 70% 60%)" }} />
          <span style={{ fontFamily: serif, fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "hsl(var(--accent-h) 70% 66%)" }}>
            Attach asset
          </span>
          <button onClick={onClose} className="ml-auto opacity-40 transition-opacity hover:opacity-90">
            <X className="h-3.5 w-3.5" style={{ color: "hsl(214 14% 55%)" }} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid hsl(214 10% 10%)" }}>
          <Search className="h-3 w-3 shrink-0" style={{ color: "hsl(214 10% 32%)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter by name or area…"
            style={{ ...fieldStyle, background: "transparent", border: "none", padding: 0 }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading && (
            <div className="flex items-center gap-2 py-2" style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.16em", color: "hsl(214 10% 34%)" }}>
              <Loader2 className="h-3 w-3 animate-spin" />READING KRONOS…
            </div>
          )}
          {grouped.length === 0 && !isLoading && (
            <div style={{ fontFamily: mono, fontSize: 8.5, fontStyle: "italic", color: "hsl(214 10% 32%)", padding: "12px 0" }}>
              Nothing matches. Boards, calendar items and Garden plans appear here once they exist.
            </div>
          )}
          {grouped.map(section => (
            <div key={section.group} className="mb-4">
              <div style={{ fontFamily: mono, fontSize: 7, letterSpacing: "0.22em", textTransform: "uppercase", color: "hsl(var(--accent-h) 25% 40%)", marginBottom: 6 }}>
                {section.group}
              </div>
              <div className="flex flex-col gap-1">
                {section.items.map(item => {
                  const meta = TARGETS[item.kind];
                  const already = attached.has(`${item.kind}|${item.ref}`);
                  return (
                    <button
                      key={`${item.kind}|${item.ref}`}
                      disabled={already}
                      onClick={() => { onPick(item.kind, item.ref, item.label); onClose(); }}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-left transition-all hover:brightness-125 disabled:cursor-default"
                      style={{
                        borderRadius: 2,
                        background: already ? "hsl(222 18% 6% / 0.5)" : "hsl(222 20% 7% / 0.85)",
                        border: `1px solid ${alpha(meta.color, already ? 0.14 : 0.26)}`,
                        opacity: already ? 0.5 : 1,
                      }}
                    >
                      <span style={{ fontFamily: mono, fontSize: 6.5, letterSpacing: "0.16em", color: meta.color }}>{meta.code}</span>
                      <span className="truncate" style={{ fontFamily: mono, fontSize: 9, color: "hsl(214 14% 74%)" }}>{item.label}</span>
                      {already && <Check className="ml-auto h-3 w-3 shrink-0" style={{ color: "hsl(145 45% 48%)" }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
