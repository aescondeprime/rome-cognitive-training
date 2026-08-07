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
    const result = await sb.from("boards").insert({ user_id: ownerId, type, title, created_at: now, updated_at: now }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/boards/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const id = Number(req.params.id);
    const patch = { ...pick(req.body, ["title"]), updated_at: Date.now() };
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
      pos_x: body.pos_x ?? 100, pos_y: body.pos_y ?? 100, width: body.width ?? 220,
      height: body.height ?? 0, tags: body.tags ?? "", energy: body.energy ?? 3,
      created_at: now, updated_at: now,
    }).select().single();
    ensureNoError(result);
    res.json(result.data);
  }));

  app.patch("/api/ideas/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const patch = { ...pick(req.body, ["content", "color", "pos_x", "pos_y", "width", "height", "tags", "energy"]), updated_at: Date.now() };
    const result = await sb.from("idea_cards").update(patch).eq("id", Number(req.params.id)).eq("user_id", ownerId);
    ensureNoError(result);
    res.json({ ok: true });
  }));

  app.delete("/api/ideas/:id", route(async (req, res) => {
    const ownerId = await userId(req);
    const result = await sb.from("idea_cards").delete().eq("id", Number(req.params.id)).eq("user_id", ownerId);
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
  app.get("/api/kronos/today", route(async (req, res) => {
    const ownerId = await userId(req);
    const dateStr = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
    const weekday = new Date(`${dateStr}T12:00:00`).getDay();
    const calendars = await sb.from("kronos_calendars").select("id").eq("user_id", ownerId);
    ensureNoError(calendars);
    const calendarIds = (calendars.data ?? []).map((calendar: { id: number }) => calendar.id);
    if (calendarIds.length === 0) { res.json([]); return; }
    const [routines, assignments, events] = await Promise.all([
      sb.from("kronos_routines").select("*").in("calendar_id", calendarIds).eq("user_id", ownerId),
      sb.from("kronos_assignments").select("*").in("calendar_id", calendarIds).eq("user_id", ownerId).eq("due_date", dateStr),
      sb.from("kronos_events").select("*").in("calendar_id", calendarIds).eq("user_id", ownerId).eq("event_date", dateStr),
    ]);
    [routines, assignments, events].forEach(ensureNoError);
    const items: Array<Record<string, unknown>> = [];
    for (const item of routines.data ?? []) {
      const fits = item.recurrence === "daily" || (item.recurrence === "weekly" && Array.isArray(item.days_of_week) && item.days_of_week.includes(weekday));
      if (fits) items.push({ type: "routine", id: item.id, title: item.title, color: item.color, start_time: item.start_time, duration_minutes: item.duration_minutes });
    }
    for (const item of assignments.data ?? []) items.push({ type: "assignment", id: item.id, title: item.title, color: item.color, start_time: item.start_time, duration_minutes: item.duration_minutes });
    for (const item of events.data ?? []) items.push({ type: "event", id: item.id, title: item.title, color: item.color, start_time: item.start_time, duration_minutes: item.duration_minutes });
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

  const kronosChildren = [
    { kind: "routines", table: "kronos_routines", defaults: { color: "hsl(43 88% 60%)", start_time: "09:00", duration_minutes: 60, recurrence: "daily", days_of_week: null, notes: "", saved: false }, fields: ["title", "color", "start_time", "duration_minutes", "recurrence", "days_of_week", "notes", "saved"] },
    { kind: "assignments", table: "kronos_assignments", defaults: { color: "hsl(210 65% 62%)", start_time: "09:00", duration_minutes: 60, due_date: "", instructions: "", saved: false }, fields: ["title", "color", "start_time", "duration_minutes", "due_date", "instructions", "saved"] },
    { kind: "events", table: "kronos_events", defaults: { color: "hsl(270 60% 72%)", start_time: "09:00", duration_minutes: 60, event_date: "", preparations: "", saved: false }, fields: ["title", "color", "start_time", "duration_minutes", "event_date", "preparations", "saved"] },
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
  }
}
