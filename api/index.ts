/**
 * ROME Cognitive Training — Vercel Serverless API (complete)
 *
 * Self-contained: no imports from ../server/* or path aliases.
 * Uses only @supabase/supabase-js + Node built-ins (crypto, util).
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { promisify } from "util";
import type { IncomingMessage, ServerResponse } from "http";
import WebSocket from "ws";

// ── Supabase ───────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}
type SB = ReturnType<typeof getSupabase>;

// ── Crypto ─────────────────────────────────────────────────────────────────
const scryptAsync = promisify(crypto.scrypt);
async function hashPassword(p: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const buf = (await scryptAsync(p, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}
async function verifyPassword(p: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) return false;
  const buf = (await scryptAsync(p, salt, 64)) as Buffer;
  return crypto.timingSafeEqual(Buffer.from(hashed, "hex"), buf);
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── Request helpers ────────────────────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-session-token, Authorization");
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

// ── Column mappers ─────────────────────────────────────────────────────────
function mapUser(r: any) {
  return { id: r.id, name: r.name, baselineCompleted: r.baseline_completed ?? 0, currentMode: r.current_mode ?? "standard", totalSessionsCompleted: r.total_sessions_completed ?? 0, totalMinutesTrained: r.total_minutes_trained ?? 0, createdAt: r.created_at ?? Date.now() };
}
function mapNote(r: any) {
  return { id: r.id, userId: r.user_id, title: r.title ?? "Untitled", content: r.content ?? "", tags: r.tags ?? "[]", pinned: Boolean(r.pinned), createdAt: r.created_at ?? Date.now(), updatedAt: r.updated_at ?? Date.now() };
}
function mapDomainScore(r: any) {
  return { id: r.id, userId: r.user_id, domain: r.domain, score: r.score, totalTrials: r.total_trials ?? 0, avgAccuracy: r.avg_accuracy ?? 0, avgResponseTime: r.avg_response_time ?? 0, avgConfidence: r.avg_confidence ?? 0, updatedAt: r.updated_at ?? Date.now() };
}
function mapTrial(r: any) {
  return { id: r.id, userId: r.user_id, domain: r.domain, activityId: r.activity_id, correct: r.correct, responseTimeMs: r.response_time_ms ?? 0, confidence: r.confidence ?? 50, difficulty: r.difficulty ?? 1, errorType: r.error_type ?? null, notes: r.notes ?? null, createdAt: r.created_at ?? Date.now() };
}
function mapSession(r: any) {
  return { id: r.id, userId: r.user_id, sessionType: r.session_type ?? "standard", durationMinutes: r.duration_minutes ?? 0, trialsCompleted: r.trials_completed ?? 0, avgAccuracy: r.avg_accuracy ?? 0, avgConfidence: r.avg_confidence ?? 0, metacogReflection: r.metacog_reflection ?? null, completedAt: r.completed_at ?? Date.now() };
}
function mapRecallItem(r: any) {
  return { id: r.id, userId: r.user_id, front: r.front, back: r.back, tags: r.tags ?? "[]", category: r.category ?? "general", nextReviewAt: r.next_review_at ?? Date.now(), intervalDays: r.interval_days ?? 1, easeFactor: r.ease_factor ?? 2.5, repetitions: r.repetitions ?? 0, lastReviewedAt: r.last_reviewed_at ?? null, createdAt: r.created_at ?? Date.now() };
}
function mapCalibration(r: any) {
  return { id: r.id, userId: r.user_id, domain: r.domain, confidenceBucket: r.confidence_bucket, correctCount: r.correct_count ?? 0, totalCount: r.total_count ?? 0, updatedAt: r.updated_at ?? Date.now() };
}
function mapMemoryItem(r: any) {
  return { id: r.id, userId: r.user_id, type: r.type ?? "reflection", content: r.content, source: r.source ?? "manual", confidence: r.confidence ?? 50, importance: r.importance ?? 50, createdAt: r.created_at ?? Date.now(), updatedAt: r.updated_at ?? Date.now() };
}
function mapTaskboardCard(r: any) {
  return { id: r.id, userId: r.user_id, content: r.content ?? "", color: r.color ?? "gold", pos_x: r.pos_x ?? 100, pos_y: r.pos_y ?? 100, pinned: r.pinned ?? 0, width: r.width ?? 200, height: r.height ?? 0, on_board: r.on_board ?? 0, createdAt: r.created_at ?? Date.now(), updatedAt: r.updated_at ?? Date.now() };
}

// ── Active user resolution ─────────────────────────────────────────────────
async function getActiveUser(req: IncomingMessage, sb: SB) {
  const token = req.headers["x-session-token"] as string | undefined;
  if (token) {
    const { data: sess } = await sb.from("auth_sessions").select("user_id, expires_at").eq("id", token).single();
    if (sess && sess.expires_at >= Date.now()) {
      const { data: u } = await sb.from("users").select("*").eq("id", sess.user_id).single();
      if (u) return mapUser(u);
    }
  }
  // Fall back to active_profile_id config
  const { data: cfg } = await sb.from("app_config").select("value").eq("key", "active_profile_id").single();
  const id = cfg ? parseInt(cfg.value, 10) : NaN;
  if (!isNaN(id)) {
    const { data: u } = await sb.from("users").select("*").eq("id", id).single();
    if (u) return mapUser(u);
  }
  // Default: first user or create one
  const { data: first } = await sb.from("users").select("*").order("id").limit(1).single();
  if (first) return mapUser(first);
  const { data: created } = await sb.from("users").insert({ name: "Trainee", created_at: Date.now() }).select().single();
  return mapUser(created);
}

// ── SM-2 spaced repetition ─────────────────────────────────────────────────
function sm2(item: { easeFactor: number; intervalDays: number; repetitions: number }, quality: number) {
  const ef = Math.max(1.3, item.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  let interval: number, reps: number;
  if (quality < 3) { interval = 1; reps = 0; }
  else { interval = item.repetitions === 0 ? 1 : item.repetitions === 1 ? 6 : Math.round(item.intervalDays * ef); reps = item.repetitions + 1; }
  return { easeFactor: ef, intervalDays: interval, repetitions: reps };
}

// ── DOMAINS default seed ───────────────────────────────────────────────────
const DOMAINS = ["recall","working_memory","focus","flexibility","problem_solving","creativity","intuition","metacognition"];

async function seedDomains(sb: SB, userId: number) {
  await sb.from("domain_scores").insert(DOMAINS.map(d => ({ user_id: userId, domain: d, score: 50, updated_at: Date.now() })));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setCors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url ?? "/", "http://localhost");
  const route = url.pathname.replace(/^\/api/, "");
  const method = req.method ?? "GET";

  let sb: SB;
  try { sb = getSupabase(); } catch (e: any) { return json(res, 500, { error: e.message }); }

  try {

    // ── Health ───────────────────────────────────────────────────────────
    if (route === "/health") return json(res, 200, { ok: true, ts: Date.now() });

    // ════════════════════════════════════════════════════════════════════
    // AUTH
    // ════════════════════════════════════════════════════════════════════
    if (route === "/auth/register" && method === "POST") {
        return json(res, 403, { error: "Registration is disabled." });
      const { name, password } = await readBody(req);
      if (!name?.trim() || !password) return json(res, 400, { error: "Name and password are required" });
      if (password.length < 4) return json(res, 400, { error: "Password must be at least 4 characters" });
      const { data: ex } = await sb.from("users").select("id").ilike("name", name.trim()).limit(1).single();
      if (ex) return json(res, 409, { error: "A profile with that name already exists" });
      const { data: newUser, error: ce } = await sb.from("users").insert({ name: name.trim(), created_at: Date.now() }).select().single();
      if (ce || !newUser) return json(res, 500, { error: "Failed to create user" });
      await seedDomains(sb, newUser.id);
      await sb.from("users").update({ password_hash: await hashPassword(password) }).eq("id", newUser.id);
      const sessionId = crypto.randomBytes(32).toString("hex");
      await sb.from("auth_sessions").insert({ id: sessionId, user_id: newUser.id, created_at: Date.now(), expires_at: Date.now() + SESSION_TTL_MS });
      return json(res, 201, { token: sessionId, user: mapUser(newUser) });
    }

    if (route === "/auth/login" && method === "POST") {
      const { name, password } = await readBody(req);
      if (!name?.trim() || !password) return json(res, 400, { error: "Name and password are required" });
      const { data: user } = await sb.from("users").select("*").ilike("name", name.trim()).limit(1).single();
      if (!user) return json(res, 401, { error: "No profile found with that name" });
      if (!user.password_hash) return json(res, 401, { error: "This profile has no password set" });
      if (!await verifyPassword(password, user.password_hash)) return json(res, 401, { error: "Incorrect password" });
      const sessionId = crypto.randomBytes(32).toString("hex");
      await sb.from("auth_sessions").insert({ id: sessionId, user_id: user.id, created_at: Date.now(), expires_at: Date.now() + SESSION_TTL_MS });
      return json(res, 200, { token: sessionId, user: mapUser(user) });
    }

    if (route === "/auth/logout" && method === "POST") {
      const token = req.headers["x-session-token"] as string | undefined;
      if (token) await sb.from("auth_sessions").delete().eq("id", token);
      return json(res, 200, { ok: true });
    }

    if (route === "/auth/me" && method === "GET") {
      const token = req.headers["x-session-token"] as string | undefined;
      if (!token) return json(res, 401, { error: "Not authenticated" });
      const { data: sess } = await sb.from("auth_sessions").select("user_id, expires_at").eq("id", token).single();
      if (!sess || sess.expires_at < Date.now()) return json(res, 401, { error: "Session expired" });
      const { data: user } = await sb.from("users").select("*").eq("id", sess.user_id).single();
      if (!user) return json(res, 404, { error: "User not found" });
      return json(res, 200, { user: mapUser(user) });
    }

    // ════════════════════════════════════════════════════════════════════
    // ACTIVE PROFILE / USER
    // ════════════════════════════════════════════════════════════════════
    if ((route === "/active-profile" || route === "/user") && method === "GET") {
      return json(res, 200, await getActiveUser(req, sb));
    }

    if (route === "/user" && method === "PATCH") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const patch: any = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.baselineCompleted !== undefined) patch.baseline_completed = body.baselineCompleted;
      if (body.currentMode !== undefined) patch.current_mode = body.currentMode;
      if (body.totalSessionsCompleted !== undefined) patch.total_sessions_completed = body.totalSessionsCompleted;
      if (body.totalMinutesTrained !== undefined) patch.total_minutes_trained = body.totalMinutesTrained;
      const { data: updated } = await sb.from("users").update(patch).eq("id", user.id).select().single();
      return json(res, 200, updated ? mapUser(updated) : user);
    }

    // ════════════════════════════════════════════════════════════════════
    // PROFILES
    // ════════════════════════════════════════════════════════════════════
    if (route === "/profiles" && method === "GET") {
      const { data: profiles } = await sb.from("users").select("*").order("id");
      const { data: cfg } = await sb.from("app_config").select("value").eq("key", "active_profile_id").single();
      const activeId = cfg ? parseInt(cfg.value, 10) : -1;
      const result = await Promise.all((profiles ?? []).map(async (p: any) => {
        const { data: sessions } = await sb.from("sessions").select("duration_minutes").eq("user_id", p.id);
        return { ...mapUser(p), isActive: p.id === activeId, sessionsCompleted: sessions?.length ?? 0, minutesTrained: sessions?.reduce((s: number, x: any) => s + (x.duration_minutes ?? 0), 0) ?? 0 };
      }));
      return json(res, 200, result);
    }

    if (route === "/profiles" && method === "POST") {
      const { name } = await readBody(req);
      if (!name?.trim()) return json(res, 400, { error: "Name is required" });
      const { data: newUser } = await sb.from("users").insert({ name: name.trim(), created_at: Date.now() }).select().single();
      if (!newUser) return json(res, 500, { error: "Failed to create profile" });
      await seedDomains(sb, newUser.id);
      return json(res, 201, mapUser(newUser));
    }

    {
      const m = route.match(/^\/profiles\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const { name } = await readBody(req);
          if (!name?.trim()) return json(res, 400, { error: "Name is required" });
          const { data: updated } = await sb.from("users").update({ name: name.trim() }).eq("id", id).select().single();
          return json(res, 200, updated ? mapUser(updated) : { error: "Not found" });
        }
        if (method === "DELETE") {
          const { data: all } = await sb.from("users").select("id").order("id");
          if ((all?.length ?? 0) <= 1) return json(res, 400, { error: "Cannot delete the only profile" });
          const { data: cfg } = await sb.from("app_config").select("value").eq("key", "active_profile_id").single();
          const activeId = cfg ? parseInt(cfg.value, 10) : -1;
          if (activeId === id) {
            const other = (all ?? []).find((p: any) => p.id !== id);
            if (other) await sb.from("app_config").upsert({ key: "active_profile_id", value: String(other.id) }, { onConflict: "key" });
          }
          await sb.from("users").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    {
      const m = route.match(/^\/profiles\/(\d+)\/activate$/);
      if (m && method === "POST") {
        const id = parseInt(m[1]);
        const { data: user } = await sb.from("users").select("*").eq("id", id).single();
        if (!user) return json(res, 404, { error: "Profile not found" });
        await sb.from("app_config").upsert({ key: "active_profile_id", value: String(id) }, { onConflict: "key" });
        return json(res, 200, mapUser(user));
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // DOMAIN SCORES
    // ════════════════════════════════════════════════════════════════════
    if (route === "/domain-scores" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("domain_scores").select("*").eq("user_id", user.id);
      return json(res, 200, (data ?? []).map(mapDomainScore));
    }

    // ════════════════════════════════════════════════════════════════════
    // TRIALS
    // ════════════════════════════════════════════════════════════════════
    if (route === "/trials/recent" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("trials").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
      return json(res, 200, (data ?? []).map(mapTrial));
    }

    if (route === "/trials" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const { domain, activityId, correct, responseTimeMs = 0, confidence = 50, difficulty = 1, errorType = null, notes: nt = null } = body;
      const { data: trial } = await sb.from("trials").insert({ user_id: user.id, domain, activity_id: activityId, correct, response_time_ms: responseTimeMs, confidence, difficulty, error_type: errorType, notes: nt, created_at: Date.now() }).select().single();
      // Update domain score
      const { data: ex } = await sb.from("domain_scores").select("*").eq("user_id", user.id).eq("domain", domain).single();
      const totalTrials = (ex?.total_trials ?? 0) + 1;
      const newAcc = ((ex?.avg_accuracy ?? 0) * (totalTrials - 1) + (correct ? 100 : 0)) / totalTrials;
      const newRT = ((ex?.avg_response_time ?? 0) * (totalTrials - 1) + responseTimeMs) / totalTrials;
      const newConf = ((ex?.avg_confidence ?? 0) * (totalTrials - 1) + confidence) / totalTrials;
      const baseScore = ex?.score ?? 50;
      const newScore = Math.min(100, Math.max(0, baseScore + 8 * ((correct ? 1 : 0) - baseScore / 100) + (correct ? difficulty * 0.5 : -difficulty * 0.5)));
      if (ex) { await sb.from("domain_scores").update({ score: newScore, total_trials: totalTrials, avg_accuracy: newAcc, avg_response_time: newRT, avg_confidence: newConf, updated_at: Date.now() }).eq("id", ex.id); }
      else { await sb.from("domain_scores").insert({ user_id: user.id, domain, score: newScore, total_trials: totalTrials, avg_accuracy: newAcc, avg_response_time: newRT, avg_confidence: newConf, updated_at: Date.now() }); }
      // Calibration
      if (confidence != null) {
        const bucket = Math.ceil(confidence / 10) * 10;
        const { data: cal } = await sb.from("calibration_history").select("*").eq("user_id", user.id).eq("domain", domain).eq("confidence_bucket", bucket).single();
        if (cal) { await sb.from("calibration_history").update({ correct_count: (cal.correct_count ?? 0) + (correct ? 1 : 0), total_count: (cal.total_count ?? 0) + 1, updated_at: Date.now() }).eq("id", cal.id); }
        else { await sb.from("calibration_history").insert({ user_id: user.id, domain, confidence_bucket: bucket, correct_count: correct ? 1 : 0, total_count: 1, updated_at: Date.now() }); }
      }
      return json(res, 200, trial ? mapTrial(trial) : {});
    }

    // ════════════════════════════════════════════════════════════════════
    // SESSIONS
    // ════════════════════════════════════════════════════════════════════
    if (route === "/sessions" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("sessions").select("*").eq("user_id", user.id).order("completed_at", { ascending: false }).limit(20);
      return json(res, 200, (data ?? []).map(mapSession));
    }

    if (route === "/sessions" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const { sessionType = "standard", durationMinutes = 0, trialsCompleted = 0, avgAccuracy = 0, avgConfidence = 0, metacogReflection = null } = body;
      const { data: sess } = await sb.from("sessions").insert({ user_id: user.id, session_type: sessionType, duration_minutes: durationMinutes, trials_completed: trialsCompleted, avg_accuracy: avgAccuracy, avg_confidence: avgConfidence, metacog_reflection: metacogReflection, completed_at: Date.now() }).select().single();
      await sb.from("users").update({ total_sessions_completed: (user.totalSessionsCompleted ?? 0) + 1, total_minutes_trained: (user.totalMinutesTrained ?? 0) + durationMinutes }).eq("id", user.id);
      return json(res, 200, sess ? mapSession(sess) : {});
    }

    // ════════════════════════════════════════════════════════════════════
    // RECALL ITEMS
    // ════════════════════════════════════════════════════════════════════
    if (route === "/recall-items/due" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("recall_items").select("*").eq("user_id", user.id).lte("next_review_at", Date.now());
      return json(res, 200, (data ?? []).map(mapRecallItem));
    }

    if (route === "/recall-items" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("recall_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return json(res, 200, (data ?? []).map(mapRecallItem));
    }

    if (route === "/recall-items" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const { front, back, tags = "[]", category = "general", nextReviewAt, intervalDays = 1, easeFactor = 2.5, repetitions = 0, lastReviewedAt = null } = body;
      const { data: item } = await sb.from("recall_items").insert({ user_id: user.id, front, back, tags, category, next_review_at: nextReviewAt ?? Date.now(), interval_days: intervalDays, ease_factor: easeFactor, repetitions, last_reviewed_at: lastReviewedAt, created_at: Date.now() }).select().single();
      return json(res, 200, item ? mapRecallItem(item) : {});
    }

    {
      const m = route.match(/^\/recall-items\/(\d+)\/review$/);
      if (m && method === "PATCH") {
        const id = parseInt(m[1]);
        const { quality } = await readBody(req);
        const { data: item } = await sb.from("recall_items").select("*").eq("id", id).single();
        if (!item) return json(res, 404, { error: "Not found" });
        const updated = sm2({ easeFactor: item.ease_factor ?? 2.5, intervalDays: item.interval_days ?? 1, repetitions: item.repetitions ?? 0 }, quality);
        const { data: r } = await sb.from("recall_items").update({ ease_factor: updated.easeFactor, interval_days: updated.intervalDays, repetitions: updated.repetitions, next_review_at: Date.now() + updated.intervalDays * 86400000, last_reviewed_at: Date.now() }).eq("id", id).select().single();
        return json(res, 200, r ? mapRecallItem(r) : {});
      }
    }

    {
      const m = route.match(/^\/recall-items\/(\d+)$/);
      if (m && method === "DELETE") {
        await sb.from("recall_items").delete().eq("id", parseInt(m[1]));
        return json(res, 200, { ok: true });
      }
      // Content edits only. Reviewing advances the schedule and lives at
      // /review; a rename must never be able to reach those fields.
      if (m && method === "PATCH") {
        const patch: Record<string, unknown> = {};
        if (typeof body?.front === "string" && body.front.trim()) patch.front = body.front.trim();
        if (typeof body?.back === "string" && body.back.trim()) patch.back = body.back.trim();
        if (typeof body?.category === "string") patch.category = body.category.trim() || "general";
        if (typeof body?.tags === "string") patch.tags = body.tags;
        if (!Object.keys(patch).length) return json(res, 400, { error: "Nothing to change" });
        const { data, error } = await sb.from("recall_items").update(patch).eq("id", parseInt(m[1])).select().single();
        if (error) return json(res, 500, { error: error.message });
        return json(res, 200, data);
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // CALIBRATION
    // ════════════════════════════════════════════════════════════════════
    if (route === "/calibration" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("calibration_history").select("*").eq("user_id", user.id);
      return json(res, 200, (data ?? []).map(mapCalibration));
    }

    // ════════════════════════════════════════════════════════════════════
    // STATS
    // ════════════════════════════════════════════════════════════════════
    if (route === "/stats" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const [{ data: scores }, { data: recentTrials }, { data: recentSessions }] = await Promise.all([
        sb.from("domain_scores").select("*").eq("user_id", user.id),
        sb.from("trials").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        sb.from("sessions").select("*").eq("user_id", user.id).order("completed_at", { ascending: false }).limit(7),
      ]);
      const sc = (scores ?? []).map(mapDomainScore);
      const tr = (recentTrials ?? []).map(mapTrial);
      const avgScore = sc.length > 0 ? sc.reduce((s, d) => s + d.score, 0) / sc.length : 50;
      const recentAccuracy = tr.length > 0 ? (tr.filter(t => t.correct).length / tr.length) * 100 : 0;
      return json(res, 200, { user, avgScore, weakestDomains: [...sc].sort((a, b) => a.score - b.score).slice(0, 2), strongestDomains: [...sc].sort((a, b) => b.score - a.score).slice(0, 2), recentAccuracy, totalTrials: tr.length, recentSessions: (recentSessions ?? []).length });
    }

    // ════════════════════════════════════════════════════════════════════
    // NOTES (Philosophy Chambers)
    // ════════════════════════════════════════════════════════════════════
    if (route === "/notes" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("notes").select("*").eq("user_id", user.id).order("updated_at", { ascending: false });
      return json(res, 200, (data ?? []).map(mapNote));
    }

    if (route === "/notes" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const now = Date.now();
      const { data: note } = await sb.from("notes").insert({ user_id: user.id, title: body.title ?? "Untitled", content: body.content ?? "", tags: body.tags ? JSON.stringify(body.tags) : "[]", pinned: 0, created_at: now, updated_at: now }).select().single();
      return json(res, 200, note ? mapNote(note) : {});
    }

    {
      const m = route.match(/^\/notes\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          if (body.title !== undefined) patch.title = body.title;
          if (body.content !== undefined) patch.content = body.content;
          if (body.tags !== undefined) patch.tags = JSON.stringify(body.tags);
          if (body.pinned !== undefined) patch.pinned = body.pinned ? 1 : 0;
          const { data: updated } = await sb.from("notes").update(patch).eq("id", id).select().single();
          if (!updated) return json(res, 404, { error: "Note not found" });
          return json(res, 200, mapNote(updated));
        }
        if (method === "DELETE") {
          await sb.from("notes").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // MEMORY ITEMS
    // ════════════════════════════════════════════════════════════════════
    if (route === "/memory" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("memory_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return json(res, 200, (data ?? []).map(mapMemoryItem));
    }

    if (route === "/memory" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const now = Date.now();
      const { data: item } = await sb.from("memory_items").insert({ user_id: user.id, type: body.type ?? "reflection", content: body.content, source: body.source ?? "manual", confidence: body.confidence ?? 50, importance: body.importance ?? 50, created_at: now, updated_at: now }).select().single();
      return json(res, 200, item ? mapMemoryItem(item) : {});
    }

    {
      const m = route.match(/^\/memory\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          if (body.type !== undefined) patch.type = body.type;
          if (body.content !== undefined) patch.content = body.content;
          if (body.source !== undefined) patch.source = body.source;
          if (body.confidence !== undefined) patch.confidence = body.confidence;
          if (body.importance !== undefined) patch.importance = body.importance;
          const { data: updated } = await sb.from("memory_items").update(patch).eq("id", id).select().single();
          return json(res, 200, updated ? mapMemoryItem(updated) : { error: "Not found" });
        }
        if (method === "DELETE") {
          await sb.from("memory_items").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // TASKBOARD
    // ════════════════════════════════════════════════════════════════════
    if (route === "/taskboard" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("taskboard_cards").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return json(res, 200, (data ?? []).map(mapTaskboardCard));
    }

    if (route === "/taskboard" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const now = Date.now();
      const { content = "", color = "gold", posX = 100, posY = 100, width = 200, onBoard = false, on_board } = body;
      const onBoardVal = on_board !== undefined ? on_board : (onBoard ? 1 : 0);
      const { data: card } = await sb.from("taskboard_cards").insert({ user_id: user.id, content, color, pos_x: posX, pos_y: posY, pinned: 0, width, on_board: onBoardVal, created_at: now, updated_at: now }).select().single();
      return json(res, 200, card ? mapTaskboardCard(card) : {});
    }

    {
      const m = route.match(/^\/taskboard\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          if (body.content  !== undefined) patch.content  = body.content;
          if (body.color    !== undefined) patch.color    = body.color;
          if (body.posX     !== undefined) patch.pos_x    = body.posX;
          if (body.pos_x    !== undefined) patch.pos_x    = body.pos_x;
          if (body.posY     !== undefined) patch.pos_y    = body.posY;
          if (body.pos_y    !== undefined) patch.pos_y    = body.pos_y;
          if (body.pinned   !== undefined) patch.pinned   = body.pinned;
          if (body.width    !== undefined) patch.width    = body.width;
          if (body.height   !== undefined) patch.height   = body.height;
          if (body.onBoard  !== undefined) patch.on_board = body.onBoard ? 1 : 0;
          if (body.on_board !== undefined) patch.on_board = body.on_board;
          const { data: updated } = await sb.from("taskboard_cards").update(patch).eq("id", id).select().single();
          return json(res, 200, updated ? mapTaskboardCard(updated) : { error: "Not found" });
        }
        if (method === "DELETE") {
          await sb.from("taskboard_cards").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }


    // ════════════════════════════════════════════════════════════════════
    // BOARDS (multi-board system for Taskboard / Idea Workshop / Component Board)
    // ════════════════════════════════════════════════════════════════════

    // GET /boards?type=taskboard|idea_workshop|component_board
    if (route === "/boards" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const url  = new URL(req.url!, "http://localhost");
      const type = url.searchParams.get("type");
      let q = sb.from("boards").select("*").eq("user_id", user.id).order("updated_at", { ascending: false });
      if (type) q = q.eq("type", type);
      const { data } = await q;
      return json(res, 200, data ?? []);
    }

    // POST /boards
    if (route === "/boards" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const now  = Date.now();
      const { type = "taskboard", title = "Untitled", folder_id = null } = body;
      const { data: board } = await sb.from("boards").insert({ user_id: user.id, type, title, folder_id, created_at: now, updated_at: now }).select().single();
      return json(res, 200, board ?? {});
    }

    {
      const m = route.match(/^\/boards\/(\d+)$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          if (body.title !== undefined) patch.title = body.title;
          if (body.folder_id !== undefined) patch.folder_id = body.folder_id;
          await sb.from("boards").update(patch).eq("id", boardId);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("boards").delete().eq("id", boardId);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // BOARD FOLDERS — the renamable cores boards are filed into
    // GET/POST /board-folders   ·   PATCH/DELETE /board-folders/:id
    // ════════════════════════════════════════════════════════════════════

    if (route === "/board-folders" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const url  = new URL(req.url!, "http://localhost");
      const type = url.searchParams.get("type");
      let q = sb.from("board_folders").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
      if (type) q = q.eq("type", type);
      const { data } = await q;
      return json(res, 200, data ?? []);
    }

    if (route === "/board-folders" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const now  = Date.now();
      const { type = "idea_workshop", name = "New Core", color = "cyan" } = body;
      const { data: folder } = await sb.from("board_folders")
        .insert({ user_id: user.id, type, name: String(name).trim() || "New Core", color, created_at: now, updated_at: now })
        .select().single();
      return json(res, 200, folder ?? {});
    }

    {
      const m = route.match(/^\/board-folders\/(\d+)$/);
      if (m) {
        const user = await getActiveUser(req, sb);
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          if (body.name  !== undefined) patch.name  = body.name;
          if (body.color !== undefined) patch.color = body.color;
          await sb.from("board_folders").update(patch).eq("id", id).eq("user_id", user.id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          // Unfile before deleting: an unfiled board still shows in the
          // sidebar, a board pointing at a dead core would not.
          await sb.from("boards").update({ folder_id: null }).eq("folder_id", id).eq("user_id", user.id);
          await sb.from("board_folders").delete().eq("id", id).eq("user_id", user.id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // TASKBOARD v2 — board-scoped cards
    // GET  /boards/:id/tasks
    // POST /boards/:id/tasks
    // PATCH/DELETE /tasks/:id
    // ════════════════════════════════════════════════════════════════════

    {
      const m = route.match(/^\/boards\/(\d+)\/tasks$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "GET") {
          const { data } = await sb.from("taskboard_cards").select("*").eq("board_id", boardId).order("created_at", { ascending: false });
          return json(res, 200, (data ?? []).map(mapTaskboardCard));
        }
        if (method === "POST") {
          const user = await getActiveUser(req, sb);
          const body = await readBody(req);
          const now  = Date.now();
          const { content = "", color = "gold", pos_x = 100, pos_y = 100, width = 210, on_board = 0, pinned = 0 } = body;
          const { data: card } = await sb.from("taskboard_cards").insert({ board_id: boardId, user_id: user.id, content, color, pos_x, pos_y, pinned, width, on_board, created_at: now, updated_at: now }).select().single();
          return json(res, 200, card ? mapTaskboardCard(card) : {});
        }
      }
    }

    {
      const m = route.match(/^\/tasks\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          if (body.content  !== undefined) patch.content  = body.content;
          if (body.color    !== undefined) patch.color    = body.color;
          if (body.pos_x    !== undefined) patch.pos_x    = body.pos_x;
          if (body.pos_y    !== undefined) patch.pos_y    = body.pos_y;
          if (body.pinned   !== undefined) patch.pinned   = body.pinned;
          if (body.width    !== undefined) patch.width    = body.width;
          if (body.height   !== undefined) patch.height   = body.height;
          if (body.on_board !== undefined) patch.on_board = body.on_board;
          await sb.from("taskboard_cards").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("taskboard_cards").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // IDEA WORKSHOP — cards + connections
    // GET  /boards/:id/ideas
    // POST /boards/:id/ideas
    // PATCH/DELETE /ideas/:id
    // GET  /boards/:id/idea-connections
    // POST /boards/:id/idea-connections
    // DELETE /idea-connections/:id
    // ════════════════════════════════════════════════════════════════════

    {
      const m = route.match(/^\/boards\/(\d+)\/ideas$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "GET") {
          const { data } = await sb.from("idea_cards").select("*").eq("board_id", boardId).order("created_at", { ascending: true });
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const user = await getActiveUser(req, sb);
          const body = await readBody(req);
          const now  = Date.now();
          const { content = "", color = "violet", pos_x = 100, pos_y = 100, width = 0, height = 0, tags = "", energy = 3, kind = "text", parent_id = null, src = null } = body;
          const { data: card } = await sb.from("idea_cards").insert({ board_id: boardId, user_id: user.id, content, color, pos_x, pos_y, width, height, tags, energy, kind: kind === "image" ? "image" : "text", parent_id, src, created_at: now, updated_at: now }).select().single();
          return json(res, 200, card ?? {});
        }
      }
    }

    {
      const m = route.match(/^\/ideas\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["content","color","pos_x","pos_y","width","height","tags","energy","kind","parent_id","src"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("idea_cards").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          // A sub-idea is positioned as an offset from its parent, so an
          // orphan would land on the canvas origin and be unfindable.
          await sb.from("idea_cards").delete().eq("parent_id", id);
          await sb.from("idea_cards").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    {
      const m = route.match(/^\/boards\/(\d+)\/idea-connections$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "GET") {
          const { data } = await sb.from("idea_connections").select("*").eq("board_id", boardId);
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const { from_id, to_id, label = "" } = body;
          const { data: conn } = await sb.from("idea_connections").insert({ board_id: boardId, from_id, to_id, label, created_at: Date.now() }).select().single();
          return json(res, 200, conn ?? {});
        }
      }
    }

    {
      const m = route.match(/^\/idea-connections\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "DELETE") {
          await sb.from("idea_connections").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "PATCH") {
          const body = await readBody(req);
          if (body.label !== undefined) await sb.from("idea_connections").update({ label: body.label }).eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // COMPONENT BOARD — pins + threads
    // GET  /boards/:id/pins
    // POST /boards/:id/pins
    // PATCH/DELETE /pins/:id
    // GET  /boards/:id/threads
    // POST /boards/:id/threads
    // DELETE /threads/:id
    // ════════════════════════════════════════════════════════════════════

    {
      const m = route.match(/^\/boards\/(\d+)\/pins$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "GET") {
          const { data } = await sb.from("component_pins").select("*").eq("board_id", boardId).order("created_at", { ascending: true });
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const user = await getActiveUser(req, sb);
          const body = await readBody(req);
          const now  = Date.now();
          const { content = "", pin_type = "evidence", pos_x = 100, pos_y = 100, width = 200, color = "amber" } = body;
          const { data: pin } = await sb.from("component_pins").insert({ board_id: boardId, user_id: user.id, content, pin_type, pos_x, pos_y, width, color, created_at: now, updated_at: now }).select().single();
          return json(res, 200, pin ?? {});
        }
      }
    }

    {
      const m = route.match(/^\/pins\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["content","pin_type","pos_x","pos_y","width","height","color"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("component_pins").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("component_pins").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    {
      const m = route.match(/^\/boards\/(\d+)\/threads$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "GET") {
          const { data } = await sb.from("component_threads").select("*").eq("board_id", boardId);
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const { from_id, to_id, label = "", color = "red" } = body;
          const { data: thread } = await sb.from("component_threads").insert({ board_id: boardId, from_id, to_id, label, color, created_at: Date.now() }).select().single();
          return json(res, 200, thread ?? {});
        }
      }
    }

    {
      const m = route.match(/^\/threads\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "DELETE") {
          await sb.from("component_threads").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = {};
          if (body.label !== undefined) patch.label = body.label;
          if (body.color !== undefined) patch.color = body.color;
          if (Object.keys(patch).length) await sb.from("component_threads").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // SCIENCE BOARDS — articles + conclusions
    // ════════════════════════════════════════════════════════════════════

    // GET /boards/:id/articles
    // POST /boards/:id/articles
    {
      const m = route.match(/^\/boards\/(\d+)\/articles$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "GET") {
          const { data } = await sb.from("science_articles").select("*").eq("board_id", boardId).order("created_at", { ascending: false });
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const user = await getActiveUser(req, sb);
          const now = Date.now();
          const { title="", authors="", year="", url="", abstract="", tags="" } = body;
          const { data: row } = await sb.from("science_articles").insert({ board_id: boardId, user_id: user.id, title, authors, year, url, abstract, tags, created_at: now, updated_at: now }).select().single();
          await sb.from("boards").update({ updated_at: now }).eq("id", boardId);
          return json(res, 200, row ?? {});
        }
      }
    }

    // PATCH /articles/:id
    // DELETE /articles/:id
    {
      const m = route.match(/^\/articles\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["title","authors","year","url","abstract","tags"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("science_articles").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("science_articles").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // GET /boards/:id/conclusions
    // POST /boards/:id/conclusions
    {
      const m = route.match(/^\/boards\/(\d+)\/conclusions$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "GET") {
          const { data } = await sb.from("article_conclusions").select("*").eq("board_id", boardId).order("created_at", { ascending: true });
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const user = await getActiveUser(req, sb);
          const now = Date.now();
          const { article_id, content="", strength="moderate" } = body;
          const { data: row } = await sb.from("article_conclusions").insert({ article_id, board_id: boardId, user_id: user.id, content, strength, created_at: now, updated_at: now }).select().single();
          return json(res, 200, row ?? {});
        }
      }
    }

    // PATCH /conclusions/:id
    // DELETE /conclusions/:id
    {
      const m = route.match(/^\/conclusions\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["content","strength"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("article_conclusions").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("article_conclusions").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // EXPERIMENT BOARDS — sections
    // ════════════════════════════════════════════════════════════════════

    // GET /boards/:id/experiment-sections
    // POST /boards/:id/experiment-sections
    {
      const m = route.match(/^\/boards\/(\d+)\/experiment-sections$/);
      if (m) {
        const boardId = parseInt(m[1]);
        if (method === "GET") {
          const { data } = await sb.from("experiment_sections").select("*").eq("board_id", boardId);
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const user = await getActiveUser(req, sb);
          const now = Date.now();
          const { section_key, content="", pos_x=0, pos_y=0, width=260, height=0 } = body;
          const { data: row } = await sb.from("experiment_sections").insert({ board_id: boardId, user_id: user.id, section_key, content, pos_x, pos_y, width, height, created_at: now, updated_at: now }).select().single();
          await sb.from("boards").update({ updated_at: now }).eq("id", boardId);
          return json(res, 200, row ?? {});
        }
      }
    }

    // PATCH /DELETE /experiment-sections/:id
    {
      const m = route.match(/^\/experiment-sections\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const now = Date.now();
          const patch: any = { updated_at: now };
          ["content","pos_x","pos_y","width","height"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("experiment_sections").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("experiment_sections").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // NOOTROPICS
    // ════════════════════════════════════════════════════════════════════

    // GET /api/nootropics  — list all for user
    // POST /api/nootropics — create
    if (route === "/nootropics") {
      const user = await getActiveUser(req, sb);
      if (method === "GET") {
        const { data } = await sb
          .from("nootropics")
          .select("*")
          .eq("user_id", user.id)
          .order("name", { ascending: true });
        return json(res, 200, data ?? []);
      }
      if (method === "POST") {
        const body = await readBody(req);
        const now  = Date.now();
        const { name = "", category = "other", mechanism = "", effects = "", dosage = "", half_life = "", notes = "" } = body;
        const { data: row } = await sb
          .from("nootropics")
          .insert({ user_id: user.id, name, category, mechanism, effects, dosage, half_life, notes, is_preset: 0, created_at: now, updated_at: now })
          .select()
          .single();
        return json(res, 200, row ?? {});
      }
    }

    // PATCH /api/nootropics/:id  — update
    // DELETE /api/nootropics/:id — delete
    {
      const m = route.match(/^\/nootropics\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["name","category","mechanism","effects","dosage","half_life","notes"].forEach(k => {
            if (body[k] !== undefined) patch[k] = body[k];
          });
          await sb.from("nootropics").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("nootropics").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // KRONOS KEEP
    // ════════════════════════════════════════════════════════════════════

    // GET /api/kronos/today — all items for the user's local today across all calendars
    if (route === "/kronos/today" && method === "GET") {
      const user = await getActiveUser(req, sb);
      // Accept ?date=YYYY-MM-DD from client (client knows local date)
      const dateStr = (url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10));
      const weekday = new Date(dateStr + "T12:00:00").getDay(); // local noon avoids DST
      const { data: cals } = await sb.from("kronos_calendars").select("id").eq("user_id", user.id);
      const calIds = (cals ?? []).map((c: { id: number }) => c.id);
      const items: object[] = [];
      if (calIds.length > 0) {
        // A template (`saved`) is a library entry, not something on the
        // calendar. A routine additionally has to fall inside its date
        // window; an empty bound means unbounded, which is how rows written
        // before the window existed keep behaving.
        const placed = (row: any) => !row.saved;
        const inWindow = (row: any) =>
          (!row.start_date || dateStr >= row.start_date) && (!row.end_date || dateStr <= row.end_date);

        const { data: routines } = await sb.from("kronos_routines").select("*").in("calendar_id", calIds).eq("user_id", user.id);
        for (const r of routines ?? []) {
          if (!placed(r) || !inWindow(r)) continue;
          const fits = r.recurrence === "daily" || (r.recurrence === "weekly" && Array.isArray(r.days_of_week) && r.days_of_week.includes(weekday));
          if (fits) items.push({ type: "routine", id: r.id, title: r.title, color: r.color, start_time: r.start_time, duration_minutes: r.duration_minutes });
        }
        const { data: assignments } = await sb.from("kronos_assignments").select("*").in("calendar_id", calIds).eq("user_id", user.id).eq("due_date", dateStr);
        for (const a of assignments ?? []) if (placed(a)) items.push({ type: "assignment", id: a.id, title: a.title, color: a.color, start_time: a.start_time, duration_minutes: a.duration_minutes });
        const { data: events } = await sb.from("kronos_events").select("*").in("calendar_id", calIds).eq("user_id", user.id).eq("event_date", dateStr);
        for (const e of events ?? []) if (placed(e)) items.push({ type: "event", id: e.id, title: e.title, color: e.color, start_time: e.start_time, duration_minutes: e.duration_minutes });
        const { data: generals } = await sb.from("kronos_generals").select("*").in("calendar_id", calIds).eq("user_id", user.id).eq("item_date", dateStr);
        for (const g of generals ?? []) if (placed(g)) items.push({ type: "general", id: g.id, title: g.title, color: g.color, start_time: g.start_time, duration_minutes: g.duration_minutes });
      }
      // Sort by start_time
      items.sort((a: any, b: any) => {
        const toMins = (t: string) => { const [h, m] = String(t ?? "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
        return toMins(a.start_time) - toMins(b.start_time);
      });
      return json(res, 200, items);
    }

    // GET /api/kronos/calendars  POST /api/kronos/calendars
    if (route === "/kronos/calendars") {
      const user = await getActiveUser(req, sb);
      if (method === "GET") {
        const { data } = await sb.from("kronos_calendars").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
        return json(res, 200, data ?? []);
      }
      if (method === "POST") {
        const body = await readBody(req);
        const now = Date.now();
        const { data: row } = await sb.from("kronos_calendars").insert({ user_id: user.id, name: body.name ?? "My Calendar", created_at: now, updated_at: now }).select().single();
        return json(res, 200, row ?? {});
      }
    }

    // PATCH /DELETE /api/kronos/calendars/:id
    {
      const m = route.match(/^\/kronos\/calendars\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        const user = await getActiveUser(req, sb);
        if (method === "PATCH") {
          const body = await readBody(req);
          await sb.from("kronos_calendars").update({ name: body.name, updated_at: Date.now() }).eq("id", id).eq("user_id", user.id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("kronos_calendars").delete().eq("id", id).eq("user_id", user.id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ── Routines ──
    // GET  /api/kronos/calendars/:id/routines
    // POST /api/kronos/calendars/:id/routines
    {
      const m = route.match(/^\/kronos\/calendars\/(\d+)\/routines$/);
      if (m) {
        const calId = parseInt(m[1]);
        const user = await getActiveUser(req, sb);
        if (method === "GET") {
          const { data } = await sb.from("kronos_routines").select("*").eq("calendar_id", calId).eq("user_id", user.id);
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const now = Date.now();
          const { data: row } = await sb.from("kronos_routines").insert({ user_id: user.id, calendar_id: calId, title: body.title, color: body.color ?? "hsl(43 88% 60%)", start_time: body.start_time ?? "09:00", duration_minutes: body.duration_minutes ?? 60, recurrence: body.recurrence ?? "daily", days_of_week: body.days_of_week ?? null, notes: body.notes ?? "", saved: body.saved ?? false, start_date: body.start_date ?? "", end_date: body.end_date ?? "", created_at: now, updated_at: now }).select().single();
          return json(res, 200, row ?? {});
        }
      }
    }
    // PATCH/DELETE /api/kronos/routines/:id
    {
      const m = route.match(/^\/kronos\/routines\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["title","color","start_time","duration_minutes","recurrence","days_of_week","notes","saved","start_date","end_date","ical_uid","ical_href","ical_etag","ical_raw","synced_at","sync_state"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("kronos_routines").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("kronos_routines").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ── Assignments ──
    {
      const m = route.match(/^\/kronos\/calendars\/(\d+)\/assignments$/);
      if (m) {
        const calId = parseInt(m[1]);
        const user = await getActiveUser(req, sb);
        if (method === "GET") {
          const { data } = await sb.from("kronos_assignments").select("*").eq("calendar_id", calId).eq("user_id", user.id);
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const now = Date.now();
          const { data: row } = await sb.from("kronos_assignments").insert({ user_id: user.id, calendar_id: calId, title: body.title, color: body.color ?? "hsl(210 65% 62%)", start_time: body.start_time ?? "09:00", duration_minutes: body.duration_minutes ?? 60, due_date: body.due_date ?? "", instructions: body.instructions ?? "", saved: body.saved ?? false, created_at: now, updated_at: now }).select().single();
          return json(res, 200, row ?? {});
        }
      }
    }
    {
      const m = route.match(/^\/kronos\/assignments\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["title","color","start_time","duration_minutes","due_date","instructions","saved","ical_uid","ical_href","ical_etag","ical_raw","synced_at","sync_state"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("kronos_assignments").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("kronos_assignments").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ── Events ──
    {
      const m = route.match(/^\/kronos\/calendars\/(\d+)\/events$/);
      if (m) {
        const calId = parseInt(m[1]);
        const user = await getActiveUser(req, sb);
        if (method === "GET") {
          const { data } = await sb.from("kronos_events").select("*").eq("calendar_id", calId).eq("user_id", user.id);
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const now = Date.now();
          const { data: row } = await sb.from("kronos_events").insert({ user_id: user.id, calendar_id: calId, title: body.title, color: body.color ?? "hsl(270 60% 72%)", start_time: body.start_time ?? "09:00", duration_minutes: body.duration_minutes ?? 60, event_date: body.event_date ?? "", preparations: body.preparations ?? "", saved: body.saved ?? false, created_at: now, updated_at: now }).select().single();
          return json(res, 200, row ?? {});
        }
      }
    }
    {
      const m = route.match(/^\/kronos\/events\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["title","color","start_time","duration_minutes","event_date","preparations","saved","ical_uid","ical_href","ical_etag","ical_raw","synced_at","sync_state"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("kronos_events").update(patch).eq("id", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("kronos_events").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ── Generals ──
    // The neutral fourth type: a one-shot with a date, a time and notes.
    {
      const m = route.match(/^\/kronos\/calendars\/(\d+)\/generals$/);
      if (m) {
        const calId = parseInt(m[1]);
        const user = await getActiveUser(req, sb);
        if (method === "GET") {
          const { data } = await sb.from("kronos_generals").select("*").eq("calendar_id", calId).eq("user_id", user.id);
          return json(res, 200, data ?? []);
        }
        if (method === "POST") {
          const body = await readBody(req);
          const now = Date.now();
          const { data: row } = await sb.from("kronos_generals").insert({ user_id: user.id, calendar_id: calId, title: body.title, color: body.color ?? "hsl(145 55% 50%)", start_time: body.start_time ?? "09:00", duration_minutes: body.duration_minutes ?? 60, item_date: body.item_date ?? "", notes: body.notes ?? "", saved: body.saved ?? false, created_at: now, updated_at: now }).select().single();
          return json(res, 200, row ?? {});
        }
      }
    }
    // ── Sync writeback ──
    // Deliberately not a PATCH: this must not touch `updated_at`. "Locally
    // dirty" is `updated_at > synced_at`, so stamping the clock here would
    // mark the row as freshly edited at the same moment it is marked synced,
    // and the engine would push it again on every cycle, forever.
    {
      const m = route.match(/^\/kronos\/sync\/(routines|assignments|events|generals)\/(\d+)$/);
      if (m && method === "POST") {
        const table = `kronos_${m[1]}`;
        const id = parseInt(m[2]);
        const user = await getActiveUser(req, sb);
        const body = await readBody(req);
        const patch: any = {};
        ["ical_uid","ical_href","ical_etag","ical_raw","sync_state","synced_at"]
          .forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
        await sb.from(table).update(patch).eq("id", id).eq("user_id", user.id);
        return json(res, 200, { ok: true });
      }
    }

    {
      const m = route.match(/^\/kronos\/generals\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        const user = await getActiveUser(req, sb);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          ["title","color","start_time","duration_minutes","item_date","notes","saved","ical_uid","ical_href","ical_etag","ical_raw","synced_at","sync_state"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
          await sb.from("kronos_generals").update(patch).eq("id", id).eq("user_id", user.id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await sb.from("kronos_generals").delete().eq("id", id).eq("user_id", user.id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // EXPORT / IMPORT
    // ════════════════════════════════════════════════════════════════════
    if (route === "/export" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const [{ data: scores }, { data: trials }, { data: sessions }, { data: recall }, { data: cal }, { data: notes }, { data: memory }] = await Promise.all([
        sb.from("domain_scores").select("*").eq("user_id", user.id),
        sb.from("trials").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10000),
        sb.from("sessions").select("*").eq("user_id", user.id).order("completed_at", { ascending: false }).limit(10000),
        sb.from("recall_items").select("*").eq("user_id", user.id),
        sb.from("calibration_history").select("*").eq("user_id", user.id),
        sb.from("notes").select("*").eq("user_id", user.id),
        sb.from("memory_items").select("*").eq("user_id", user.id),
      ]);
      return json(res, 200, { version: "1.0", exportedAt: Date.now(), profile: user, domainScores: (scores ?? []).map(mapDomainScore), trials: (trials ?? []).map(mapTrial), sessions: (sessions ?? []).map(mapSession), recallItems: (recall ?? []).map(mapRecallItem), calibrationHistory: (cal ?? []).map(mapCalibration), notes: (notes ?? []).map(mapNote), memoryItems: (memory ?? []).map(mapMemoryItem) });
    }

    if (route === "/import" && method === "POST") {
      const body = await readBody(req);
      if (!body?.profile || !body?.version) return json(res, 400, { error: "Invalid import format" });
      const profileName = body.profile?.name || "Imported Profile";
      const { data: newUser } = await sb.from("users").insert({ name: profileName, created_at: Date.now() }).select().single();
      if (!newUser) return json(res, 500, { error: "Failed to create profile" });
      await seedDomains(sb, newUser.id);
      const newId = newUser.id;
      if (Array.isArray(body.domainScores)) for (const ds of body.domainScores) await sb.from("domain_scores").upsert({ user_id: newId, domain: ds.domain, score: ds.score, total_trials: ds.totalTrials ?? 0, avg_accuracy: ds.avgAccuracy ?? 0, avg_response_time: ds.avgResponseTime ?? 0, avg_confidence: ds.avgConfidence ?? 0, updated_at: Date.now() }, { onConflict: "user_id,domain" });
      if (Array.isArray(body.trials)) for (const t of body.trials) await sb.from("trials").insert({ user_id: newId, domain: t.domain, activity_id: t.activityId, correct: t.correct, response_time_ms: t.responseTimeMs ?? 0, confidence: t.confidence ?? 50, difficulty: t.difficulty ?? 1, error_type: t.errorType ?? null, notes: t.notes ?? null, created_at: t.createdAt ?? Date.now() });
      if (Array.isArray(body.notes)) for (const n of body.notes) await sb.from("notes").insert({ user_id: newId, title: n.title ?? "Untitled", content: n.content ?? "", tags: n.tags ?? "[]", pinned: n.pinned ?? 0, created_at: n.createdAt ?? Date.now(), updated_at: n.updatedAt ?? Date.now() });
      await sb.from("app_config").upsert({ key: "active_profile_id", value: String(newId) }, { onConflict: "key" });
      return json(res, 200, { ok: true, profileId: newId, profileName });
    }

    // ── Config (legacy) ──────────────────────────────────────────────────
    {
      const m = route.match(/^\/config\/(.+)$/);
      if (m) {
        const key = m[1];
        if (method === "GET") {
          const { data } = await sb.from("app_config").select("value").eq("key", key).single();
          return json(res, 200, { key, value: data?.value ?? null });
        }
        if (method === "POST" || method === "PATCH") {
          const body = await readBody(req);
          const value = body?.value ?? body;
          await sb.from("app_config").upsert({ key, value: String(value) }, { onConflict: "key" });
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // THREATS
    // ════════════════════════════════════════════════════════════════════

    // GET /api/threats
    if (route === "/threats" && method === "GET") {
      const user = await getActiveUser(req, sb);
      const { data } = await sb.from("threats").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      return json(res, 200, data ?? []);
    }

    // POST /api/threats
    if (route === "/threats" && method === "POST") {
      const user = await getActiveUser(req, sb);
      const body = await readBody(req);
      const now  = Date.now();
      const { title = "", priority = 1 } = body;
      const { data } = await sb.from("threats").insert({ user_id: user.id, title: title.trim(), priority, resolved: false, created_at: now, updated_at: now }).select().single();
      return json(res, 200, data ?? {});
    }

    // PATCH /api/threats/:id  &  DELETE /api/threats/:id
    {
      const m = route.match(/^\/threats\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body  = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          if (body.title    !== undefined) patch.title    = body.title;
          if (body.priority !== undefined) patch.priority = body.priority;
          if (body.resolved !== undefined) patch.resolved = body.resolved;
          const { data } = await sb.from("threats").update(patch).eq("id", id).select().single();
          return json(res, 200, data ?? { error: "Not found" });
        }
        if (method === "DELETE") {
          await sb.from("threats").delete().eq("id", id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // WORLD BROWSER — remote Browserbase sessions
    // ════════════════════════════════════════════════════════════════════
    if (route.startsWith("/browser")) {
      // ── helpers ──────────────────────────────────────────────────────
      const BROWSERBASE_API_KEY  = process.env.BROWSERBASE_API_KEY  ?? "";
      const BROWSERBASE_PROJECT  = process.env.BROWSERBASE_PROJECT_ID ?? "";
      const BB_BASE              = "https://api.browserbase.com/v1";
      const SESSION_INACTIVITY   = 2 * 60 * 60 * 1000; // 2 h

      // Private IP / dangerous URL guard
      function isDangerous(rawUrl: string): boolean {
        try {
          const u = new URL(rawUrl);
          if (u.protocol === "file:" || u.protocol === "ftp:" || u.protocol === "javascript:") return true;
          const h = u.hostname;
          if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
          if (/^169\.254\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
          if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
          if (h === "metadata.google.internal" || h === "100.100.100.200") return true;
          return false;
        } catch { return false; }
      }

      function normaliseUrl(input: string): string {
        const trimmed = input.trim();
        if (!trimmed) return "https://www.google.com";
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+/.test(trimmed) && !trimmed.includes(" ")) {
          return "https://" + trimmed;
        }
        return "https://www.google.com/search?q=" + encodeURIComponent(trimmed);
      }

      // Check Browserbase configured
      function requireBB() {
        if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT) throw new Error("BROWSERBASE_NOT_CONFIGURED");
      }

      // Fetch through Browserbase REST API
      async function bbFetch(path: string, method = "GET", body?: unknown): Promise<any> {
        // Use manual AbortController instead of AbortSignal.timeout() for Node 18 compat
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        try {
          const res2 = await fetch(`${BB_BASE}${path}`, {
            method,
            headers: { "X-BB-API-Key": BROWSERBASE_API_KEY, "Content-Type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: ctrl.signal,
          });
          if (!res2.ok) {
            const txt = await res2.text().catch(() => "");
            throw new Error(`BB ${res2.status}: ${txt.slice(0, 200)}`);
          }
          return res2.json().catch(() => ({}));
        } finally {
          clearTimeout(timer);
        }
      }

      // Resolve + auth-guard a browser_session row
      async function getOwnedSession(user: any, sessionId: string) {
        const now = Date.now();
        const { data } = await sb.from("browser_sessions").select("*").eq("id", sessionId).single();
        if (!data)                              return json(res, 404, { error: "Session not found" });
        if (String(data.user_id) !== String(user.id)) return json(res, 403, { error: "Forbidden" });
        if (data.expires_at < now)              return json(res, 410, { error: "Session expired" });
        return data;
      }

      // Touch last_active + reset expiry
      async function touchSession(sessionId: string) {
        const now = Date.now();
        await sb.from("browser_sessions").update({ last_active: now, expires_at: now + SESSION_INACTIVITY }).eq("id", sessionId);
      }

      // ── POST /api/browser/sessions — create a new isolated session ──
      if (route === "/browser/sessions" && method === "POST") {
        const user = await getActiveUser(req, sb);
        requireBB();
        // Create a Browserbase session
        let bbSess: any;
        try {
          bbSess = await bbFetch("/sessions", "POST", {
            projectId: BROWSERBASE_PROJECT,
            browserSettings: { viewport: { width: 1280, height: 800 } },
          });
        } catch (bbErr: any) {
          return json(res, 502, { error: `Browserbase session create failed: ${bbErr?.message ?? bbErr}` });
        }
        if (!bbSess?.id) return json(res, 502, { error: `Browserbase returned no session id: ${JSON.stringify(bbSess)}` });
        const now = Date.now();
        const tabs = [{ id: 0, url: "https://www.google.com", title: "New Tab", loading: false }];
        const { data: row, error: insertErr } = await sb.from("browser_sessions").insert({
          user_id: String(user.id),
          provider_session_id: bbSess.id,
          status: "connected",
          current_url: "https://www.google.com",
          title: "New Tab",
          active_tab_idx: 0,
          tabs: JSON.stringify(tabs),
          created_at: now, last_active: now, expires_at: now + SESSION_INACTIVITY,
        }).select().single();
        if (insertErr) return json(res, 500, { error: `DB insert failed: ${insertErr.message}` });
        // Fetch the embeddable live-view URL from Browserbase /debug endpoint
        // Use debuggerFullscreenUrl — Browserbase navbar is shown so the user can navigate inside the iframe
        let liveViewUrl = "";
        try {
          const dbg = await bbFetch(`/sessions/${bbSess.id}/debug`);
          const base = dbg.debuggerFullscreenUrl ?? dbg.debuggerUrl ?? "";
          liveViewUrl = base ?? "";
          // Also store the raw CDP wsUrl so the screenshot relay can connect
          const wsUrl: string = dbg.wsUrl ?? dbg.pages?.[0]?.debuggerUrl ?? "";
          if (wsUrl) {
            await sb.from("browser_sessions").update({ ws_url: wsUrl }).eq("id", row!.id);
          }
        } catch (dbgErr: any) {
          console.error("[browser] debug URL fetch failed:", dbgErr?.message);
        }
        return json(res, 200, { sessionId: row!.id, liveViewUrl, tabs, activeTabIdx: 0, status: "connected" });
      }

      // ── GET /api/browser/sessions/:id — poll status ─────────────────
      {
        const m = route.match(/^\/browser\/sessions\/([\w-]+)$/);
        if (m && method === "GET") {
          const user = await getActiveUser(req, sb);
          const sess = await getOwnedSession(user, m[1]);
          // Refresh the live-view URL (Browserbase URLs are short-lived)
          let liveViewUrl = "";
          if (sess.provider_session_id && sess.status === "connected") {
            try {
              const dbg = await bbFetch(`/sessions/${sess.provider_session_id}/debug`);
              const base = dbg.debuggerFullscreenUrl ?? dbg.debuggerUrl ?? "";
              liveViewUrl = base ?? ""; // Browserbase navbar shown so user can navigate
            } catch { /* session may have ended on provider side */ }
          }
          return json(res, 200, { sessionId: sess.id, status: sess.status, currentUrl: sess.current_url, title: sess.title, tabs: sess.tabs ?? [], activeTabIdx: sess.active_tab_idx, expiresAt: sess.expires_at, liveViewUrl });
        }

        // ── DELETE /api/browser/sessions/:id — end session ─────────────
        if (m && method === "DELETE") {
          const user = await getActiveUser(req, sb);
          const sess = await getOwnedSession(user, m[1]);
          if (sess.provider_session_id) {
            await bbFetch(`/sessions/${sess.provider_session_id}`, "PUT", { status: "REQUEST_RELEASE" }).catch(() => {});
          }
          await sb.from("browser_sessions").update({ status: "disconnected" }).eq("id", m[1]);
          return json(res, 200, { ok: true });
        }
      }

      // ── POST /api/browser/sessions/:id/action — metadata-only actions ──
      // Note: Browserbase REST API does not support execute/navigate/CDP commands.
      // All browser interaction happens via the live-view iframe directly.
      // This endpoint only handles metadata updates (tab tracking, URL recording,
      // dangerous-URL validation) that the client needs server-side.
      {
        const m = route.match(/^\/browser\/sessions\/([\w-]+)\/action$/);
        if (m && method === "POST") {
          const user  = await getActiveUser(req, sb);
          const body  = await readBody(req);
          const sess  = await getOwnedSession(user, m[1]);
          if (!sess || typeof (sess as any).id === "undefined") return; // already responded

          const { action, url: rawUrl } = body as { action: string; url?: string };

          // Only action we validate server-side: URL safety check before navigating
          if (action === "navigate") {
            const target = normaliseUrl(rawUrl ?? "");
            if (isDangerous(target)) return json(res, 403, { error: "DANGEROUS_URL", url: target });
            // Record URL in DB for polling / address bar sync
            await touchSession(m[1]);
            await sb.from("browser_sessions").update({ current_url: target }).eq("id", m[1]);
            return json(res, 200, { ok: true, safeUrl: target });
          }

          // All other actions (back/forward/reload/stop/newtab/closetab/switchtab)
          // are handled client-side via the iframe — just touch the session to keep it alive
          await touchSession(m[1]);
          return json(res, 200, { ok: true });
        }
      }

      // ── CDP helper: send one command over a WS and return result ───────────────
      async function cdpCommand(wsUrl: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 8000): Promise<any> {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(wsUrl, {
            headers: { "x-bb-api-key": BROWSERBASE_API_KEY },
          });
          const id = 1;
          let done = false;
          const timer = setTimeout(() => { if (!done) { done = true; ws.terminate(); reject(new Error("CDP timeout")); } }, timeoutMs);
          ws.on("open", () => ws.send(JSON.stringify({ id, method, params })));
          ws.on("message", (data: Buffer) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.id === id) { done = true; clearTimeout(timer); ws.terminate(); resolve(msg.result ?? msg); }
            } catch {}
          });
          ws.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
          ws.on("close", () => { if (!done) { done = true; clearTimeout(timer); reject(new Error("CDP WS closed")); } });
        });
      }

      // ── GET /api/browser/sessions/:id/screenshot — CDP screenshot ────────
      {
        const m = route.match(/^\/browser\/sessions\/([\w-]+)\/screenshot$/);
        if (m && method === "GET") {
          const user = await getActiveUser(req, sb);
          const sess = await getOwnedSession(user, m[1]);
          if (!sess || typeof (sess as any).id === "undefined") return;
          let wsUrl: string = (sess as any).ws_url ?? "";
          if (!wsUrl && sess.provider_session_id) {
            // Fetch fresh wsUrl from Browserbase
            try {
              const dbg = await bbFetch(`/sessions/${sess.provider_session_id}/debug`);
              wsUrl = dbg.wsUrl ?? dbg.pages?.[0]?.debuggerUrl ?? "";
              if (wsUrl) await sb.from("browser_sessions").update({ ws_url: wsUrl }).eq("id", m[1]);
            } catch {}
          }
          if (!wsUrl) return json(res, 503, { error: "No CDP WebSocket URL available" });
          try {
            const result = await cdpCommand(wsUrl, "Page.captureScreenshot", { format: "jpeg", quality: 80 });
            const imgBuf = Buffer.from(result.data ?? "", "base64");
            res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
            res.end(imgBuf);
            return;
          } catch (e: any) {
            return json(res, 502, { error: e.message });
          }
        }
      }

      // ── POST /api/browser/sessions/:id/input — CDP mouse/key input ──────
      {
        const m = route.match(/^\/browser\/sessions\/([\w-]+)\/input$/);
        if (m && method === "POST") {
          const user = await getActiveUser(req, sb);
          const body = await readBody(req) as any;
          const sess = await getOwnedSession(user, m[1]);
          if (!sess || typeof (sess as any).id === "undefined") return;
          let wsUrl: string = (sess as any).ws_url ?? "";
          if (!wsUrl && sess.provider_session_id) {
            try {
              const dbg = await bbFetch(`/sessions/${sess.provider_session_id}/debug`);
              wsUrl = dbg.wsUrl ?? dbg.pages?.[0]?.debuggerUrl ?? "";
              if (wsUrl) await sb.from("browser_sessions").update({ ws_url: wsUrl }).eq("id", m[1]);
            } catch {}
          }
          if (!wsUrl) return json(res, 503, { error: "No CDP WebSocket URL" });
          try {
            const { type, x, y, button, key, text, modifiers, deltaX, deltaY, navigateTo } = body;
            if (navigateTo) {
              // URL navigation via CDP
              const target = normaliseUrl(navigateTo);
              if (isDangerous(target)) return json(res, 403, { error: "DANGEROUS_URL" });
              await cdpCommand(wsUrl, "Page.navigate", { url: target });
              await sb.from("browser_sessions").update({ current_url: target }).eq("id", m[1]);
              await touchSession(m[1]);
              return json(res, 200, { ok: true });
            }
            if (type === "mousedown" || type === "mouseup" || type === "mousemove") {
              const evtType = type === "mousedown" ? "mousePressed" : type === "mouseup" ? "mouseReleased" : "mouseMoved";
              await cdpCommand(wsUrl, "Input.dispatchMouseEvent", { type: evtType, x: x ?? 0, y: y ?? 0, button: button ?? "left", clickCount: type === "mousedown" ? 1 : 0 }, 4000);
            } else if (type === "wheel") {
              await cdpCommand(wsUrl, "Input.dispatchMouseEvent", { type: "mouseWheel", x: x ?? 0, y: y ?? 0, deltaX: deltaX ?? 0, deltaY: deltaY ?? 0 }, 4000);
            } else if (type === "keydown" || type === "keyup") {
              const evtType = type === "keydown" ? "keyDown" : "keyUp";
              await cdpCommand(wsUrl, "Input.dispatchKeyEvent", { type: evtType, key: key ?? "", text: text ?? "", modifiers: modifiers ?? 0 }, 4000);
            } else if (type === "char") {
              await cdpCommand(wsUrl, "Input.dispatchKeyEvent", { type: "char", text: text ?? key ?? "", modifiers: modifiers ?? 0 }, 4000);
            } else if (type === "back") {
              await cdpCommand(wsUrl, "Runtime.evaluate", { expression: "history.back()" }, 4000);
            } else if (type === "forward") {
              await cdpCommand(wsUrl, "Runtime.evaluate", { expression: "history.forward()" }, 4000);
            } else if (type === "reload") {
              await cdpCommand(wsUrl, "Page.reload", {}, 4000);
            } else if (type === "stop") {
              await cdpCommand(wsUrl, "Page.stopLoading", {}, 4000);
            }
            await touchSession(m[1]);
            return json(res, 200, { ok: true });
          } catch (e: any) {
            return json(res, 502, { error: e.message });
          }
        }
      }

      // ── GET /api/browser/sessions/:id/url — get current page URL via CDP ──
      {
        const m = route.match(/^\/browser\/sessions\/([\w-]+)\/url$/);
        if (m && method === "GET") {
          const user = await getActiveUser(req, sb);
          const sess = await getOwnedSession(user, m[1]);
          if (!sess || typeof (sess as any).id === "undefined") return;
          let wsUrl: string = (sess as any).ws_url ?? "";
          if (!wsUrl) return json(res, 503, { error: "No CDP WS" });
          try {
            const result = await cdpCommand(wsUrl, "Runtime.evaluate", { expression: "JSON.stringify({url:location.href,title:document.title})" }, 4000);
            const parsed = JSON.parse(result?.result?.value ?? "{}");
            await sb.from("browser_sessions").update({ current_url: parsed.url ?? "", title: parsed.title ?? "" }).eq("id", m[1]);
            return json(res, 200, { url: parsed.url, title: parsed.title });
          } catch (e: any) {
            return json(res, 502, { error: e.message });
          }
        }
      }

      // ── GET /api/browser/config — tells client if BB is configured ──
      if (route === "/browser/config" && method === "GET") {
        return json(res, 200, { configured: Boolean(BROWSERBASE_API_KEY && BROWSERBASE_PROJECT) });
      }
    }

    // ── GET /api/browser/neko-url — returns configured Neko URL ─────────────
    // The Neko URL is set via NEKO_URL environment variable on Vercel.
    // Returns null if not configured so the UI can show a setup prompt.
    if (route === "/browser/neko-url" && method === "GET") {
      const nekoUrl = process.env.NEKO_URL ?? null;
      return json(res, 200, { nekoUrl });
    }

    
    return json(res, 404, { error: `Not found: ${route}` });

  } catch (err: any) {
    const msg = err?.message ?? String(err) ?? "Internal server error";
    console.error("[api] error:", msg, err?.stack?.slice?.(0, 400));
    // Return real message in non-prod to aid debugging; keep generic in future if needed
    return json(res, 500, { error: msg });
  }
}
