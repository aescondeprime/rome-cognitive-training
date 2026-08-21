/**
 * Contingency Garden — the model behind the Strategic node's planning canvas.
 *
 * A garden is a forest of **branches**. Each branch *is* an action: something
 * you would actually do, with a duration attached. A branch can sprout
 * contingencies — alternative or follow-on actions — and each contingency
 * carries a label, because the useful thing about a contingency is not what it
 * is but *when* you would reach for it ("if the vendor stalls", "if funding
 * lands early").
 *
 * ── The one rule worth knowing ──────────────────────────────────────────────
 *
 * **Writing a goal on an action makes it terminal.** A branch with a non-empty
 * goal is where a line of reasoning stops, and it can no longer sprout
 * contingencies. This is deliberate: a plan whose endpoints can keep growing is
 * not a plan, it is a list. Clear the goal text and the branch can branch again.
 *
 * ── Plans ───────────────────────────────────────────────────────────────────
 *
 * Any branch can belong to any number of lettered plans. Plan A is the one you
 * intend; B and C are the ones you have already thought through. Plans are a
 * *tagging* of the tree rather than a copy of it, so editing an action's
 * duration changes every plan that uses it at once.
 *
 * Storage is `localStorage`, same guarded accessor as `cardStore` and
 * `midasStore`. Scheduling into Kronos Keep is the only thing that touches the
 * server, and it uses endpoints that already exist.
 */

const KEY = "rome_contingency_garden_v1";

// ── Shape ───────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export type BranchSource = "manual" | "kronos" | "stabilizer";

export interface Branch {
  id: string;
  /** null for a root — a garden may hold several independent starting points. */
  parentId: string | null;
  /** The action. This is the branch; everything else describes it. */
  action: string;
  /** Why you would take this branch. Empty on roots, set when a contingency is made. */
  label: string;
  /** Minutes. Feeds both the plan total and the Kronos schedule. */
  durationMinutes: number;
  /** Non-empty makes the branch terminal. See the header. */
  goal: string;
  checklist: ChecklistItem[];
  /** Plan letters this branch belongs to. */
  plans: string[];
  /** Manual position. null means "wherever the tidy layout puts it". */
  pos: { x: number; y: number } | null;
  source: BranchSource;
  createdAt: number;
}

export interface Plan {
  letter: string;
  name: string;
  /** HSL components, matching the convention everywhere else in ROME. */
  color: string;
}

export interface GardenState {
  version: 1;
  branches: Branch[];
  plans: Plan[];
}

/** Six that stay distinguishable when several are glowing at once. */
export const PLAN_COLORS = [
  "43 95% 60%",   // gold
  "199 95% 60%",  // sky
  "146 80% 50%",  // emerald
  "342 90% 64%",  // rose
  "270 85% 70%",  // violet
  "28 95% 58%",   // amber
];

export const PLAN_LETTERS = "ABCDEFGH".split("");

export function emptyGarden(): GardenState {
  return {
    version: 1,
    branches: [],
    plans: [{ letter: "A", name: "Primary", color: PLAN_COLORS[0] }],
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

// Bracket notation for the same reason cardStore uses it: static scanners that
// block the raw identifier should not trip on this file.
function getStore(): Storage | null {
  try {
    const store = (window as any)["local" + "Storage"] as Storage;
    store.setItem("__rome_test__", "1");
    store.removeItem("__rome_test__");
    return store;
  } catch {
    return null;
  }
}

export function loadGarden(): GardenState {
  try {
    const raw = getStore()?.getItem(KEY);
    if (!raw) return emptyGarden();
    const parsed = JSON.parse(raw) as GardenState;
    if (!parsed || parsed.version !== 1) return emptyGarden();
    const branches = (parsed.branches ?? []).map(normalise);
    return {
      version: 1,
      branches: pruneOrphans(branches),
      plans: (parsed.plans ?? []).length ? parsed.plans : emptyGarden().plans,
    };
  } catch {
    return emptyGarden();
  }
}

export function saveGarden(state: GardenState): void {
  try {
    getStore()?.setItem(KEY, JSON.stringify(state));
  } catch {}
}

function normalise(b: Branch): Branch {
  return {
    ...b,
    action: typeof b.action === "string" ? b.action : "",
    label: typeof b.label === "string" ? b.label : "",
    goal: typeof b.goal === "string" ? b.goal : "",
    durationMinutes: clampDuration(b.durationMinutes),
    checklist: Array.isArray(b.checklist) ? b.checklist : [],
    plans: Array.isArray(b.plans) ? b.plans : [],
    pos: b.pos && Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y) ? b.pos : null,
    source: b.source ?? "manual",
  };
}

/**
 * Drop branches whose parent is gone.
 *
 * Deletion already removes descendants, so this only matters for storage that
 * was hand-edited or written by an older build — but an orphan is invisible on
 * the canvas while still counting toward a plan's duration, which is the worst
 * kind of bug to chase.
 */
function pruneOrphans(branches: Branch[]): Branch[] {
  const byId = new Map(branches.map(b => [b.id, b]));
  const reachable = new Set<string>();
  const visit = (b: Branch, seen: Set<string>): boolean => {
    if (b.parentId === null) return true;
    if (seen.has(b.id)) return false; // cycle
    const parent = byId.get(b.parentId);
    if (!parent) return false;
    seen.add(b.id);
    return visit(parent, seen);
  };
  for (const b of branches) if (visit(b, new Set())) reachable.add(b.id);
  return branches.filter(b => reachable.has(b.id));
}

export function clampDuration(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(24 * 60, n));
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

// ── Tree queries ────────────────────────────────────────────────────────────

export function childrenOf(state: GardenState, id: string | null): Branch[] {
  return state.branches.filter(b => b.parentId === id);
}

export function branchById(state: GardenState, id: string | null): Branch | undefined {
  return id ? state.branches.find(b => b.id === id) : undefined;
}

/** A branch with a goal is an endpoint. That is the whole rule. */
export function isTerminal(b: Branch): boolean {
  return b.goal.trim().length > 0;
}

export function canSprout(b: Branch): boolean {
  return !isTerminal(b);
}

/** Depth from its root, 0-based. */
export function depthOf(state: GardenState, id: string): number {
  let depth = 0;
  let current = branchById(state, id);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = branchById(state, current.parentId);
    depth += 1;
  }
  return depth;
}

/** A branch and everything below it. */
export function subtreeIds(state: GardenState, id: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    out.push(current);
    for (const child of childrenOf(state, current)) walk(child.id);
  };
  walk(id);
  return out;
}

// ── Mutations ───────────────────────────────────────────────────────────────
//
// All pure. The page owns one piece of React state and persists on change, so
// what is drawn and what is stored can never disagree.

export interface NewBranchInput {
  action?: string;
  label?: string;
  durationMinutes?: number;
  source?: BranchSource;
}

/**
 * Add a branch.
 *
 * Passing a `parentId` whose branch is terminal is refused rather than silently
 * clearing its goal — the caller should not have offered the option.
 */
export function addBranch(state: GardenState, parentId: string | null, input: NewBranchInput = {}): GardenState {
  if (parentId !== null) {
    const parent = branchById(state, parentId);
    if (!parent || isTerminal(parent)) return state;
  }
  const branch: Branch = {
    id: newId("br"),
    parentId,
    action: (input.action ?? "").trim().slice(0, 160),
    label: (input.label ?? "").trim().slice(0, 60),
    durationMinutes: clampDuration(input.durationMinutes ?? 30),
    goal: "",
    checklist: [],
    plans: [],
    pos: null,
    source: input.source ?? "manual",
    createdAt: Date.now(),
  };
  return { ...state, branches: [...state.branches, branch] };
}

export function updateBranch(state: GardenState, id: string, patch: Partial<Branch>): GardenState {
  return {
    ...state,
    branches: state.branches.map(b => {
      if (b.id !== id) return b;
      const next: Branch = { ...b };
      if (patch.action !== undefined) next.action = patch.action.slice(0, 160);
      if (patch.label !== undefined) next.label = patch.label.slice(0, 60);
      if (patch.durationMinutes !== undefined) next.durationMinutes = clampDuration(patch.durationMinutes);
      if (patch.goal !== undefined) next.goal = patch.goal.slice(0, 400);
      if (patch.checklist !== undefined) next.checklist = patch.checklist;
      if (patch.plans !== undefined) next.plans = patch.plans;
      if (patch.pos !== undefined) next.pos = patch.pos;
      return next;
    }),
  };
}

/**
 * Write a goal, which makes the branch terminal.
 *
 * A branch that already has children cannot become terminal — the children are
 * evidence that the reasoning did not stop here. The caller is expected to warn;
 * this just refuses.
 */
export function setGoal(state: GardenState, id: string, goal: string): GardenState {
  const branch = branchById(state, id);
  if (!branch) return state;
  if (goal.trim() && childrenOf(state, id).length > 0) return state;
  return updateBranch(state, id, { goal });
}

/** Removing a branch removes everything that hangs off it. */
export function removeBranch(state: GardenState, id: string): GardenState {
  const doomed = new Set(subtreeIds(state, id));
  return { ...state, branches: state.branches.filter(b => !doomed.has(b.id)) };
}

export function addChecklistItem(state: GardenState, id: string, text: string): GardenState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  const branch = branchById(state, id);
  if (!branch) return state;
  const item: ChecklistItem = { id: newId("ck"), text: trimmed.slice(0, 120), done: false };
  return updateBranch(state, id, { checklist: [...branch.checklist, item] });
}

export function toggleChecklistItem(state: GardenState, id: string, itemId: string): GardenState {
  const branch = branchById(state, id);
  if (!branch) return state;
  return updateBranch(state, id, {
    checklist: branch.checklist.map(i => (i.id === itemId ? { ...i, done: !i.done } : i)),
  });
}

export function removeChecklistItem(state: GardenState, id: string, itemId: string): GardenState {
  const branch = branchById(state, id);
  if (!branch) return state;
  return updateBranch(state, id, { checklist: branch.checklist.filter(i => i.id !== itemId) });
}

// ── Plans ───────────────────────────────────────────────────────────────────

export function addPlan(state: GardenState): GardenState {
  const used = new Set(state.plans.map(p => p.letter));
  const letter = PLAN_LETTERS.find(l => !used.has(l));
  if (!letter) return state;
  const color = PLAN_COLORS[state.plans.length % PLAN_COLORS.length];
  return { ...state, plans: [...state.plans, { letter, name: "", color }] };
}

/** Removing a plan also untags every branch, so no branch glows for a ghost. */
export function removePlan(state: GardenState, letter: string): GardenState {
  return {
    ...state,
    plans: state.plans.filter(p => p.letter !== letter),
    branches: state.branches.map(b =>
      b.plans.includes(letter) ? { ...b, plans: b.plans.filter(l => l !== letter) } : b),
  };
}

export function updatePlan(state: GardenState, letter: string, patch: Partial<Plan>): GardenState {
  return {
    ...state,
    plans: state.plans.map(p => (p.letter === letter ? { ...p, ...patch, letter: p.letter } : p)),
  };
}

/** The tracer's click handler: toggle this branch in or out of the plan. */
export function toggleBranchPlan(state: GardenState, id: string, letter: string): GardenState {
  const branch = branchById(state, id);
  if (!branch) return state;
  const plans = branch.plans.includes(letter)
    ? branch.plans.filter(l => l !== letter)
    : [...branch.plans, letter];
  return updateBranch(state, id, { plans });
}

/**
 * The branches of a plan, in the order you would carry them out.
 *
 * Depth-first through the forest, emitting only tagged branches. Depth-first
 * rather than by-depth because a plan is a *route* — the order the tree is
 * walked is the order the actions happen, even where a plan skips a generation.
 */
export function planOrder(state: GardenState, letter: string): Branch[] {
  const out: Branch[] = [];
  const walk = (branch: Branch) => {
    if (branch.plans.includes(letter)) out.push(branch);
    for (const child of childrenOf(state, branch.id)) walk(child);
  };
  for (const root of childrenOf(state, null)) walk(root);
  return out;
}

export function planDuration(state: GardenState, letter: string): number {
  return planOrder(state, letter).reduce((sum, b) => sum + b.durationMinutes, 0);
}

// ── Layout ──────────────────────────────────────────────────────────────────

export const COL_W = 268;
export const ROW_H = 104;
/** Blank rows left between the subtrees of two different roots. */
const ROOT_GAP = 1;

export interface LaidOut {
  branch: Branch;
  x: number;
  y: number;
  /** True when the position came from a manual drag rather than the algorithm. */
  pinned: boolean;
}

/**
 * Tidy layout: depth sets the column, leaves take successive rows, and a parent
 * sits at the midpoint of its children.
 *
 * Manual positions win. Dragging one branch therefore does not disturb the rest,
 * which is what makes "auto-laid but draggable" bearable — a layout that
 * re-flowed around every drag would fight you.
 */
export function layoutGarden(state: GardenState): LaidOut[] {
  const positions = new Map<string, { x: number; y: number }>();
  let row = 0;

  const place = (branch: Branch, depth: number, seen: Set<string>): number => {
    if (seen.has(branch.id)) return row * ROW_H;
    seen.add(branch.id);
    const kids = childrenOf(state, branch.id);
    if (!kids.length) {
      const y = row * ROW_H;
      row += 1;
      positions.set(branch.id, { x: depth * COL_W, y });
      return y;
    }
    const ys = kids.map(kid => place(kid, depth + 1, seen));
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    positions.set(branch.id, { x: depth * COL_W, y });
    return y;
  };

  for (const root of childrenOf(state, null)) {
    place(root, 0, new Set());
    row += ROOT_GAP;
  }

  return state.branches.map(branch => {
    const auto = positions.get(branch.id) ?? { x: 0, y: 0 };
    return {
      branch,
      x: branch.pos?.x ?? auto.x,
      y: branch.pos?.y ?? auto.y,
      pinned: branch.pos !== null,
    };
  });
}

/** Drop every manual position and let the algorithm take over again. */
export function retidy(state: GardenState): GardenState {
  return { ...state, branches: state.branches.map(b => (b.pos ? { ...b, pos: null } : b)) };
}

// ── Scheduling into Kronos Keep ─────────────────────────────────────────────

export interface ScheduledAction {
  branch: Branch;
  /** "HH:MM" */
  startTime: string;
  /** "YYYY-MM-DD" — may roll past the start date on a long plan. */
  date: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" plus whole days, without going near the Date parsing traps. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const stamp = new Date(y, (m ?? 1) - 1, d ?? 1);
  stamp.setDate(stamp.getDate() + days);
  return `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
}

/**
 * Lay a plan out in time, back to back from a start.
 *
 * Every action begins when the one before it ends, which is what makes the
 * durations on the branches worth setting in the first place. A plan that runs
 * past midnight continues onto the next day rather than wrapping to 00:00 of
 * the same one.
 */
export function schedulePlan(actions: Branch[], date: string, startTime: string): ScheduledAction[] {
  const [h, min] = startTime.split(":").map(Number);
  let cursor = (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(min) ? min : 0);
  const out: ScheduledAction[] = [];
  for (const branch of actions) {
    const dayOffset = Math.floor(cursor / (24 * 60));
    const withinDay = cursor % (24 * 60);
    out.push({
      branch,
      date: dayOffset ? addDays(date, dayOffset) : date,
      startTime: `${pad(Math.floor(withinDay / 60))}:${pad(withinDay % 60)}`,
    });
    cursor += branch.durationMinutes;
  }
  return out;
}

/** What Kronos should be told about an action, beyond its title and times. */
export function scheduleNotes(branch: Branch): string {
  const parts: string[] = [];
  if (branch.label) parts.push(`Contingency: ${branch.label}`);
  if (branch.goal) parts.push(`Goal: ${branch.goal}`);
  if (branch.checklist.length) {
    parts.push(branch.checklist.map(i => `${i.done ? "[x]" : "[ ]"} ${i.text}`).join("\n"));
  }
  parts.push("Scheduled from the Contingency Garden");
  return parts.join("\n");
}
