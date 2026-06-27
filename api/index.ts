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
  return { id: r.id, userId: r.user_id, title: r.title ?? "Untitled", content: r.content ?? "", tags: r.tags ?? "[]", pinned: r.pinned ?? 0, createdAt: r.created_at ?? Date.now(), updatedAt: r.updated_at ?? Date.now() };
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
  return { id: r.id, userId: r.user_id, content: r.content ?? "", color: r.color ?? "gold", posX: r.pos_x ?? 100, posY: r.pos_y ?? 100, pinned: r.pinned ?? 0, width: r.width ?? 200, createdAt: r.created_at ?? Date.now(), updatedAt: r.updated_at ?? Date.now() };
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
      const { content = "", color = "gold", posX = 100, posY = 100, width = 200 } = body;
      const { data: card } = await sb.from("taskboard_cards").insert({ user_id: user.id, content, color, pos_x: posX, pos_y: posY, pinned: 0, width, created_at: now, updated_at: now }).select().single();
      return json(res, 200, card ? mapTaskboardCard(card) : {});
    }

    {
      const m = route.match(/^\/taskboard\/(\d+)$/);
      if (m) {
        const id = parseInt(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const patch: any = { updated_at: Date.now() };
          if (body.content !== undefined) patch.content = body.content;
          if (body.color !== undefined) patch.color = body.color;
          if (body.posX !== undefined) patch.pos_x = body.posX;
          if (body.posY !== undefined) patch.pos_y = body.posY;
          if (body.pinned !== undefined) patch.pinned = body.pinned;
          if (body.width !== undefined) patch.width = body.width;
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

    return json(res, 404, { error: `Not found: ${route}` });

  } catch (err: any) {
    console.error("[api] error:", err?.message ?? err);
    return json(res, 500, { error: err?.message ?? "Internal server error" });
  }
}
