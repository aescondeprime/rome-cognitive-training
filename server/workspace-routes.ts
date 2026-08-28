import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Express, NextFunction, Request, Response } from "express";

type ActiveUser = { id: number };
type ResolveActiveUser = (req: Request) => Promise<ActiveUser>;

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function route(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

function requireSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY/ANON_KEY are required");
  return createClient(url, key, { auth: { persistSession: false } });
}

function ensureNoError(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}

function pick(body: Record<string, unknown>, keys: readonly string[]) {
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  return patch;
}

/**
 * Desktop/local-server counterparts to the richer workspace routes in api/index.ts.
 * The Vercel build already serves these routes from api/index.ts; Electron launches
 * server/routes.ts instead, so they must also exist here.
 */
export function registerWorkspaceRoutes(app: Express, getActiveUser: ResolveActiveUser): void {
  const sb = requireSupabase();

  const userId = async (req: Request) => (await getActiveUser(req)).id;
  const ownsBoard = async (boardId: number, ownerId: number) => {
    const result = await sb.from("boards").select("id").eq("id", boardId).eq("user_id", ownerId).maybeSingle();
    ensureNoError(result);
    return Boolean(result.data);
  };
  const requireBoard = async (res: Response, boardId: number, ownerId: number) => {
    if (await ownsBoard(boardId, ownerId)) return true;
    res.status(404).json({ error: "Board not found" });
    return false;
  };
  const ownedBoardIdForChild = async (table: string, id: number, ownerId: number) => {
    const result = await sb.from(table).select("board_id").eq("id", id).maybeSingle();
    ensureNoError(result);
    const boardId = Number(result.data?.board_id);
    return Number.isFinite(boardId) && await ownsBoard(boardId, ownerId) ? boardId : null;
  };

  // Multi-board shell shared by Taskboard, Idea Workshop, Component Board and Research Lab.
  app.get("/api/boards", route(async (req, res) => {
    const ownerId = await userId(req);
    const type = typeof req.query.type === "string" ? req.query.type : null;
    let query = sb.from("boards").select("*").eq("user_id", ownerId).order("updated_at", { ascending: false });
    if (type) query = query.eq("type", type);
    const result = await query;
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards", route(async (req, res) => {
    const ownerId = await userId(req);
    const now = Date.now();
    const type = typeof req.body.type === "string" ? req.body.type : "taskboard";
    const title = typeof req.body.title === "string" ? req.body.title : "Untitled";
    const folderId = req.body.folder_id === undefined || req.body.folder_id === null ? null : Number(req.body.folder_id);
    const result = await sb.from("boards").insert({ user_id: ownerId, type, title, folder_id: folderId, created_at: now, updated_at: now }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/boards/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const id = Number(req.params.id);
    const patch = { ...pick(req.body, ["title", "folder_id"]), updated_at: Date.now() };
    const result = await sb.from("boards").update(patch).eq("id", id).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/boards/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("boards").delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // Cores — the renamable files boards are organised into. Shared by every
  // board type that draws the graph sidebar, which is why type is part of both
  // the query and the row rather than implied by the route.
  app.get("/api/board-folders", route(async (req, res) => {
    const ownerId = await userId(req);
    const type = typeof req.query.type === "string" ? req.query.type : null;
    let query = sb.from("board_folders").select("*").eq("user_id", ownerId).order("created_at", { ascending: true });
    if (type) query = query.eq("type", type);
    const result = await query;
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/board-folders", route(async (req, res) => {
    const ownerId = await userId(req);
    const now = Date.now();
    const body = req.body ?? {};
    const result = await sb.from("board_folders").insert({
      user_id: ownerId,
      type: typeof body.type === "string" ? body.type : "idea_workshop",
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "New Core",
      color: typeof body.color === "string" ? body.color : "cyan",
      created_at: now, updated_at: now,
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/board-folders/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body, ["name", "color"]), updated_at: Date.now() };
    const result = await sb.from("board_folders").update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // Deleting a core never deletes work: its boards are unfiled first, and the
  // sidebar shows unfiled boards under their own core, so nothing disappears.
  app.delete("/api/board-folders/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const id = Number(req.params.id);
    const owned = await sb.from("board_folders").select("id").eq("id", id).eq("user_id", ownerId).maybeSingle();
    ensureNoError(owned);
    if (!owned.data) { res.status(404).json({ error: "Core not found" }); return; }
    const unfile = await sb.from("boards").update({ folder_id: null }).eq("folder_id", id).eq("user_id", ownerId);
    ensureNoError(unfile);
    const result = await sb.from("board_folders").delete().eq("id", id).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // Strategic — Taskboard cards.
  app.get("/api/boards/:id/tasks", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("taskboard_cards").select("*").eq("board_id", boardId).order("created_at", { ascending: false });
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards/:id/tasks", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const now = Date.now();
    const body = req.body ?? {};
    const result = await sb.from("taskboard_cards").insert({
      board_id: boardId, user_id: ownerId, content: body.content ?? "", color: body.color ?? "gold",
      pos_x: body.pos_x ?? 100, pos_y: body.pos_y ?? 100, pinned: body.pinned ?? 0,
      width: body.width ?? 210, height: body.height ?? 0, on_board: body.on_board ?? 0,
      created_at: now, updated_at: now,
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/tasks/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body, ["content", "color", "pos_x", "pos_y", "pinned", "width", "height", "on_board"]), updated_at: Date.now() };
    const result = await sb.from("taskboard_cards").update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/tasks/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("taskboard_cards").delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // Creative — Idea Workshop cards and connections.
  app.get("/api/boards/:id/ideas", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("idea_cards").select("*").eq("board_id", boardId).order("created_at", { ascending: true });
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards/:id/ideas", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const now = Date.now();
    const body = req.body ?? {};
    const result = await sb.from("idea_cards").insert({
      board_id: boardId, user_id: ownerId, content: body.content ?? "", color: body.color ?? "violet",
      pos_x: body.pos_x ?? 100, pos_y: body.pos_y ?? 100, width: body.width ?? 0,
      height: body.height ?? 0, tags: body.tags ?? "", energy: body.energy ?? 3,
      kind: body.kind === "image" ? "image" : "text",
      parent_id: body.parent_id ?? null, src: body.src ?? null,
      created_at: now, updated_at: now,
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/ideas/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body, ["content", "color", "pos_x", "pos_y", "width", "height", "tags", "energy", "kind", "parent_id", "src"]), updated_at: Date.now() };
    const result = await sb.from("idea_cards").update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // A sub-idea only means anything next to its parent — its position is an
  // offset from one — so an orphan would render on top of the canvas origin
  // and could not be found again. Children go first.
  app.delete("/api/ideas/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const id = Number(req.params.id);
    const children = await sb.from("idea_cards").delete().eq("parent_id", id).eq("user_id", ownerId);
    ensureNoError(children);
    const result = await sb.from("idea_cards").delete().eq("id", id).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.get("/api/boards/:id/idea-connections", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("idea_connections").select("*").eq("board_id", boardId);
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards/:id/idea-connections", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("idea_connections").insert({
      board_id: boardId, from_id: req.body.from_id, to_id: req.body.to_id,
      label: req.body.label ?? "", created_at: Date.now(),
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/idea-connections/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const id = Number(req.params.id);
    if (!await ownedBoardIdForChild("idea_connections", id, ownerId)) { res.status(404).json({ error: "Connection not found" }); return; }
    const result = await sb.from("idea_connections").update(pick(req.body, ["label"])).eq("id", id);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/idea-connections/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const id = Number(req.params.id);
    if (!await ownedBoardIdForChild("idea_connections", id, ownerId)) { res.status(404).json({ error: "Connection not found" }); return; }
    const result = await sb.from("idea_connections").delete().eq("id", id);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // Investigative — Component Board pins and threads.
  app.get("/api/boards/:id/pins", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("component_pins").select("*").eq("board_id", boardId).order("created_at", { ascending: true });
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards/:id/pins", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const now = Date.now();
    const body = req.body ?? {};
    const result = await sb.from("component_pins").insert({
      board_id: boardId, user_id: ownerId, content: body.content ?? "", pin_type: body.pin_type ?? "evidence",
      pos_x: body.pos_x ?? 100, pos_y: body.pos_y ?? 100, width: body.width ?? 200,
      height: body.height ?? 0, color: body.color ?? "amber", created_at: now, updated_at: now,
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/pins/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body, ["content", "pin_type", "pos_x", "pos_y", "width", "height", "color"]), updated_at: Date.now() };
    const result = await sb.from("component_pins").update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/pins/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("component_pins").delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.get("/api/boards/:id/threads", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("component_threads").select("*").eq("board_id", boardId);
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards/:id/threads", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("component_threads").insert({
      board_id: boardId, from_id: req.body.from_id, to_id: req.body.to_id,
      label: req.body.label ?? "", color: req.body.color ?? "amber", created_at: Date.now(),
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/threads/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const id = Number(req.params.id);
    if (!await ownedBoardIdForChild("component_threads", id, ownerId)) { res.status(404).json({ error: "Thread not found" }); return; }
    const result = await sb.from("component_threads").update(pick(req.body, ["label", "color"])).eq("id", id);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/threads/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const id = Number(req.params.id);
    if (!await ownedBoardIdForChild("component_threads", id, ownerId)) { res.status(404).json({ error: "Thread not found" }); return; }
    const result = await sb.from("component_threads").delete().eq("id", id);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // Investigative — Research Lab articles, conclusions, and experiment sections.
  app.get("/api/boards/:id/articles", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("science_articles").select("*").eq("board_id", boardId).order("created_at", { ascending: false });
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards/:id/articles", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const now = Date.now();
    const body = req.body ?? {};
    const result = await sb.from("science_articles").insert({
      board_id: boardId, user_id: ownerId, title: body.title ?? "", authors: body.authors ?? "",
      year: body.year ?? "", url: body.url ?? "", abstract: body.abstract ?? "", tags: body.tags ?? "",
      created_at: now, updated_at: now,
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/articles/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body, ["title", "authors", "year", "url", "abstract", "tags"]), updated_at: Date.now() };
    const result = await sb.from("science_articles").update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/articles/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("science_articles").delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.get("/api/boards/:id/conclusions", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("article_conclusions").select("*").eq("board_id", boardId).order("created_at", { ascending: true });
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards/:id/conclusions", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const now = Date.now();
    const result = await sb.from("article_conclusions").insert({
      article_id: req.body.article_id, board_id: boardId, user_id: ownerId,
      content: req.body.content ?? "", strength: req.body.strength ?? "moderate",
      created_at: now, updated_at: now,
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/conclusions/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body, ["content", "strength"]), updated_at: Date.now() };
    const result = await sb.from("article_conclusions").update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/conclusions/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("article_conclusions").delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.get("/api/boards/:id/experiment-sections", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const result = await sb.from("experiment_sections").select("*").eq("board_id", boardId);
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/boards/:id/experiment-sections", route(async (req, res) => {
    const ownerId = await userId(req);
    const boardId = Number(req.params.id);
    if (!await requireBoard(res, boardId, ownerId)) return;
    const now = Date.now();
    const body = req.body ?? {};
    const result = await sb.from("experiment_sections").insert({
      board_id: boardId, user_id: ownerId, section_key: body.section_key,
      content: body.content ?? "", pos_x: body.pos_x ?? 0, pos_y: body.pos_y ?? 0,
      width: body.width ?? 260, height: body.height ?? 0, created_at: now, updated_at: now,
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/experiment-sections/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body, ["content", "pos_x", "pos_y", "width", "height"]), updated_at: Date.now() };
    const result = await sb.from("experiment_sections").update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/experiment-sections/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("experiment_sections").delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // Strategic — Kronos Keep.
  // ── Threats ────────────────────────────────────────────────────────────
  // These existed only in api/index.ts (the Vercel handler), so the Threats
  // widget and any capability calling /api/threats got a 404 in the desktop
  // build. Ported here to match, with the ownership filter that the serverless
  // version omits on PATCH and DELETE.

  app.get("/api/threats", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("threats").select("*").eq("user_id", ownerId).order("created_at", { ascending: false });
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/threats", route(async (req, res) => {
    const ownerId = await userId(req);
    const title = String(req.body?.title ?? "").trim();
    if (!title) { res.status(400).json({ error: "A title is required." }); return; }
    const priorityValue = Number(req.body?.priority);
    const priority = [1, 2, 3].includes(priorityValue) ? priorityValue : 1;
    const now = Date.now();
    const result = await sb.from("threats")
      .insert({ user_id: ownerId, title, priority, resolved: false, created_at: now, updated_at: now })
      .select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/threats/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body ?? {}, ["title", "priority", "resolved"]), updated_at: Date.now() };
    const result = await sb.from("threats")
      .update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/threats/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("threats")
      .delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.get("/api/kronos/today", route(async (req, res) => {
    const ownerId = await userId(req);
    const dateStr = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
    const weekday = new Date(`${dateStr}T12:00:00`).getDay();
    const calendars = await sb.from("kronos_calendars").select("id").eq("user_id", ownerId);
    ensureNoError(calendars);
    const calendarIds = (calendars.data ?? []).map((calendar: { id: number }) => calendar.id);
    if (calendarIds.length === 0) { res.json([]); return; }
    const [routines, assignments, events, generals] = await Promise.all([
      sb.from("kronos_routines").select("*").in("calendar_id", calendarIds).eq("user_id", ownerId),
      sb.from("kronos_assignments").select("*").in("calendar_id", calendarIds).eq("user_id", ownerId).eq("due_date", dateStr),
      sb.from("kronos_events").select("*").in("calendar_id", calendarIds).eq("user_id", ownerId).eq("event_date", dateStr),
      sb.from("kronos_generals").select("*").in("calendar_id", calendarIds).eq("user_id", ownerId).eq("item_date", dateStr),
    ]);
    [routines, assignments, events, generals].forEach(ensureNoError);
    const items: Array<Record<string, unknown>> = [];
    // A template (`saved`) is a library entry, not something on the calendar.
    // A routine additionally has to fall inside its date window; an empty
    // bound means unbounded, which is how pre-window rows keep behaving.
    const placed = (item: { saved?: boolean }) => !item.saved;
    const inWindow = (item: { start_date?: string | null; end_date?: string | null }) =>
      (!item.start_date || dateStr >= item.start_date) && (!item.end_date || dateStr <= item.end_date);

    for (const item of routines.data ?? []) {
      if (!placed(item) || !inWindow(item)) continue;
      const fits = item.recurrence === "daily" || (item.recurrence === "weekly" && Array.isArray(item.days_of_week) && item.days_of_week.includes(weekday));
      if (fits) items.push({ type: "routine", id: item.id, title: item.title, color: item.color, start_time: item.start_time, duration_minutes: item.duration_minutes });
    }
    for (const item of assignments.data ?? []) if (placed(item)) items.push({ type: "assignment", id: item.id, title: item.title, color: item.color, start_time: item.start_time, duration_minutes: item.duration_minutes });
    for (const item of events.data ?? []) if (placed(item)) items.push({ type: "event", id: item.id, title: item.title, color: item.color, start_time: item.start_time, duration_minutes: item.duration_minutes });
    for (const item of generals.data ?? []) if (placed(item)) items.push({ type: "general", id: item.id, title: item.title, color: item.color, start_time: item.start_time, duration_minutes: item.duration_minutes });
    items.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    res.json(items);
  }));

  app.get("/api/kronos/calendars", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("kronos_calendars").select("*").eq("user_id", ownerId).order("created_at", { ascending: true });
    ensureNoError(result);
    res.json(result.data ?? []);
  }));

  app.post("/api/kronos/calendars", route(async (req, res) => {
    const ownerId = await userId(req);
    const now = Date.now();
    const result = await sb.from("kronos_calendars").insert({ user_id: ownerId, name: req.body.name ?? "My Calendar", created_at: now, updated_at: now }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/kronos/calendars/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("kronos_calendars").update({ name: req.body.name, updated_at: Date.now() }).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/kronos/calendars/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("kronos_calendars").delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  // Columns every kind carries for the iCloud CalDAV link. Listed once: a kind
  // whose `fields` array is missing one of these silently drops that value on
  // every PATCH, and the sync engine then re-pushes the row forever.
  const KRONOS_SYNC_FIELDS = ["ical_uid", "ical_href", "ical_etag", "ical_raw", "synced_at", "sync_state"] as const;

  const kronosChildren = [
    { kind: "routines", table: "kronos_routines", defaults: { color: "hsl(43 88% 60%)", start_time: "09:00", duration_minutes: 60, recurrence: "daily", days_of_week: null, notes: "", saved: false, start_date: "", end_date: "" }, fields: ["title", "color", "start_time", "duration_minutes", "recurrence", "days_of_week", "notes", "saved", "start_date", "end_date", ...KRONOS_SYNC_FIELDS] },
    { kind: "assignments", table: "kronos_assignments", defaults: { color: "hsl(210 65% 62%)", start_time: "09:00", duration_minutes: 60, due_date: "", instructions: "", saved: false }, fields: ["title", "color", "start_time", "duration_minutes", "due_date", "instructions", "saved", ...KRONOS_SYNC_FIELDS] },
    { kind: "events", table: "kronos_events", defaults: { color: "hsl(270 60% 72%)", start_time: "09:00", duration_minutes: 60, event_date: "", preparations: "", saved: false }, fields: ["title", "color", "start_time", "duration_minutes", "event_date", "preparations", "saved", ...KRONOS_SYNC_FIELDS] },
    { kind: "generals", table: "kronos_generals", defaults: { color: "hsl(145 55% 50%)", start_time: "09:00", duration_minutes: 60, item_date: "", notes: "", saved: false }, fields: ["title", "color", "start_time", "duration_minutes", "item_date", "notes", "saved", ...KRONOS_SYNC_FIELDS] },
  ] as const;

  for (const config of kronosChildren) {
    app.get(`/api/kronos/calendars/:id/${config.kind}`, route(async (req, res) => {
      const ownerId = await userId(req);
      const calendarId = Number(req.params.id);
      const result = await sb.from(config.table).select("*").eq("calendar_id", calendarId).eq("user_id", ownerId);
      ensureNoError(result);
      res.json(result.data ?? []);
    }));

    app.post(`/api/kronos/calendars/:id/${config.kind}`, route(async (req, res) => {
      const ownerId = await userId(req);
      const calendarId = Number(req.params.id);
      const calendar = await sb.from("kronos_calendars").select("id").eq("id", calendarId).eq("user_id", ownerId).maybeSingle();
      ensureNoError(calendar);
      if (!calendar.data) { res.status(404).json({ error: "Calendar not found" }); return; }
      const now = Date.now();
      const body = { ...config.defaults, ...pick(req.body, config.fields) };
      const result = await sb.from(config.table).insert({ ...body, user_id: ownerId, calendar_id: calendarId, created_at: now, updated_at: now }).select().single();
      ensureNoError(result);
      res.json(result.data);
    }));

    app.patch(`/api/kronos/${config.kind}/:id`, route(async (req, res) => {
      const ownerId = await userId(req);
      const patch = { ...pick(req.body, config.fields), updated_at: Date.now() };
      const result = await sb.from(config.table).update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
      ensureNoError(result);
      res.json({ ok: true });
    }));

    app.delete(`/api/kronos/${config.kind}/:id`, route(async (req, res) => {
      const ownerId = await userId(req);
      const result = await sb.from(config.table).delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
      ensureNoError(result);
      res.json({ ok: true });
    }));

    /**
     * The sync writeback. Its own route rather than a PATCH for one reason:
     * **it must not touch `updated_at`.**
     *
     * "Locally dirty" is `updated_at > synced_at`. Every other write path here
     * stamps `updated_at = Date.now()`, so recording a successful push through
     * one of them would mark the row as edited by the user at the same instant
     * it was marked as synced, and the engine would push it again forever.
     *
     * The caller supplies `synced_at` — the `updated_at` it read before the
     * push, not the clock. If the user edited the row mid-cycle its
     * `updated_at` is now higher than that, the row stays dirty, and the newer
     * version goes next time. The race resolves in the safe direction.
     */
    app.post(`/api/kronos/sync/${config.kind}/:id`, route(async (req, res) => {
      const ownerId = await userId(req);
      const patch = pick(req.body, KRONOS_SYNC_FIELDS as unknown as string[]);
      const result = await sb.from(config.table).update(patch)
        .eq("id", Number(req.params.id)).eq("user_id", ownerId);
      ensureNoError(result);
      res.json({ ok: true });
    }));
  }
}
