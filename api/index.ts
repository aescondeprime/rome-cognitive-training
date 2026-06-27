/**
 * ROME Cognitive Training — Vercel Serverless API
 *
 * Self-contained: no imports from ../server/* or path aliases.
 * Uses only @supabase/supabase-js + Node built-ins (crypto, util).
 * This is the single handler for all /api/* routes on Vercel.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { promisify } from "util";
import type { IncomingMessage, ServerResponse } from "http";

// ── Supabase client ────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Password hashing (Node built-in crypto.scrypt) ─────────────────────────
const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return crypto.timingSafeEqual(Buffer.from(hashed, "hex"), buf);
}

// ── Session TTL ────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── Body parser ────────────────────────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

// ── CORS headers ───────────────────────────────────────────────────────────
function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-session-token, Authorization"
  );
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ── Auth helpers ───────────────────────────────────────────────────────────
async function getSessionUser(
  req: IncomingMessage,
  sb: ReturnType<typeof getSupabase>
): Promise<number | null> {
  const token = req.headers["x-session-token"] as string | undefined;
  if (!token) return null;
  const { data } = await sb
    .from("auth_sessions")
    .select("user_id, expires_at")
    .eq("id", token)
    .single();
  if (!data) return null;
  if (data.expires_at < Date.now()) {
    await sb.from("auth_sessions").delete().eq("id", token);
    return null;
  }
  return data.user_id as number;
}

// ── Column mapper ──────────────────────────────────────────────────────────
function mapUser(r: any) {
  return {
    id: r.id,
    name: r.name,
    baselineCompleted: r.baseline_completed ?? 0,
    currentMode: r.current_mode ?? "standard",
    totalSessionsCompleted: r.total_sessions_completed ?? 0,
    totalMinutesTrained: r.total_minutes_trained ?? 0,
    createdAt: r.created_at ?? Date.now(),
  };
}

// ── Route handlers ─────────────────────────────────────────────────────────

async function handleRegister(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>
) {
  const body = await readBody(req);
  const { name, password } = body as { name?: string; password?: string };

  if (!name || !password) {
    return json(res, 400, { error: "Name and password are required" });
  }
  if (password.length < 4) {
    return json(res, 400, { error: "Password must be at least 4 characters" });
  }

  // Check if name already taken
  const { data: existing } = await sb
    .from("users")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .single();
  if (existing) {
    return json(res, 409, { error: "That name is already taken" });
  }

  // Create user
  const { data: newUser, error: createErr } = await sb
    .from("users")
    .insert({ name, created_at: Date.now() })
    .select()
    .single();
  if (createErr || !newUser) {
    return json(res, 500, { error: "Failed to create user: " + (createErr?.message ?? "unknown") });
  }

  // Seed domain scores
  const domains = [
    "recall", "working_memory", "focus", "flexibility",
    "problem_solving", "creativity", "intuition", "metacognition",
  ];
  await sb.from("domain_scores").insert(
    domains.map((d) => ({ user_id: newUser.id, domain: d, score: 50, updated_at: Date.now() }))
  );

  // Hash password
  const hash = await hashPassword(password);
  await sb.from("users").update({ password_hash: hash }).eq("id", newUser.id);

  // Create session
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await sb.from("auth_sessions").insert({
    id: sessionId,
    user_id: newUser.id,
    created_at: Date.now(),
    expires_at: expiresAt,
  });

  return json(res, 201, {
    token: sessionId,
    user: mapUser(newUser),
  });
}

async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>
) {
  const body = await readBody(req);
  const { name, password } = body as { name?: string; password?: string };

  if (!name || !password) {
    return json(res, 400, { error: "Name and password are required" });
  }

  const { data: user } = await sb
    .from("users")
    .select("*")
    .ilike("name", name)
    .limit(1)
    .single();

  if (!user) {
    return json(res, 401, { error: "Invalid name or password" });
  }

  const storedHash = user.password_hash as string | null;
  if (!storedHash) {
    return json(res, 401, { error: "This profile has no password set" });
  }

  const ok = await verifyPassword(password, storedHash);
  if (!ok) {
    return json(res, 401, { error: "Invalid name or password" });
  }

  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await sb.from("auth_sessions").insert({
    id: sessionId,
    user_id: user.id,
    created_at: Date.now(),
    expires_at: expiresAt,
  });

  return json(res, 200, {
    token: sessionId,
    user: mapUser(user),
  });
}

async function handleLogout(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>
) {
  const token = req.headers["x-session-token"] as string | undefined;
  if (token) {
    await sb.from("auth_sessions").delete().eq("id", token);
  }
  return json(res, 200, { ok: true });
}

async function handleMe(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>
) {
  const userId = await getSessionUser(req, sb);
  if (!userId) return json(res, 401, { error: "Not authenticated" });

  const { data: user } = await sb.from("users").select("*").eq("id", userId).single();
  if (!user) return json(res, 404, { error: "User not found" });

  return json(res, 200, { user: mapUser(user) });
}

async function handleUsers(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>
) {
  const { data } = await sb.from("users").select("*").order("id");
  return json(res, 200, (data ?? []).map(mapUser));
}

async function handleGetConfig(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>,
  key: string
) {
  const { data } = await sb.from("app_config").select("value").eq("key", key).single();
  return json(res, 200, { key, value: data?.value ?? null });
}

async function handleSetConfig(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>,
  key: string
) {
  const body = await readBody(req);
  const value = body?.value ?? body;
  await sb.from("app_config").upsert({ key, value: String(value) }, { onConflict: "key" });
  return json(res, 200, { ok: true });
}

async function handleProfiles(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>
) {
  if (req.method === "GET") {
    const { data } = await sb.from("users").select("*").order("id");
    return json(res, 200, (data ?? []).map(mapUser));
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    const name: string = body?.name ?? "New Profile";
    const { data: newUser } = await sb
      .from("users")
      .insert({ name, created_at: Date.now() })
      .select()
      .single();
    if (!newUser) return json(res, 500, { error: "Failed to create profile" });
    const domains = [
      "recall", "working_memory", "focus", "flexibility",
      "problem_solving", "creativity", "intuition", "metacognition",
    ];
    await sb.from("domain_scores").insert(
      domains.map((d) => ({ user_id: newUser.id, domain: d, score: 50, updated_at: Date.now() }))
    );
    return json(res, 201, mapUser(newUser));
  }
  return json(res, 405, { error: "Method not allowed" });
}

async function handleProfileDelete(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>,
  id: number
) {
  await sb.from("users").delete().eq("id", id);
  return json(res, 200, { ok: true });
}

async function handleDomainScores(
  req: IncomingMessage,
  res: ServerResponse,
  sb: ReturnType<typeof getSupabase>,
  userId: number
) {
  const { data } = await sb.from("domain_scores").select("*").eq("user_id", userId);
  return json(res, 200, data ?? []);
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setCors(res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  // Strip /api prefix if present
  const route = path.replace(/^\/api/, "");

  let sb: ReturnType<typeof getSupabase>;
  try {
    sb = getSupabase();
  } catch (err: any) {
    return json(res, 500, { error: err.message });
  }

  try {
    // ── Auth routes ────────────────────────────────────────────────────
    if (route === "/auth/register" && req.method === "POST") {
      return await handleRegister(req, res, sb);
    }
    if (route === "/auth/login" && req.method === "POST") {
      return await handleLogin(req, res, sb);
    }
    if (route === "/auth/logout" && req.method === "POST") {
      return await handleLogout(req, res, sb);
    }
    if (route === "/auth/me" && req.method === "GET") {
      return await handleMe(req, res, sb);
    }

    // ── Users ──────────────────────────────────────────────────────────
    if (route === "/users" && req.method === "GET") {
      return await handleUsers(req, res, sb);
    }

    // ── Profiles ───────────────────────────────────────────────────────
    if (route === "/profiles") {
      return await handleProfiles(req, res, sb);
    }
    {
      const m = route.match(/^\/profiles\/(\d+)$/);
      if (m && req.method === "DELETE") {
        return await handleProfileDelete(req, res, sb, parseInt(m[1]));
      }
    }

    // ── Config ─────────────────────────────────────────────────────────
    {
      const m = route.match(/^\/config\/(.+)$/);
      if (m) {
        if (req.method === "GET") return await handleGetConfig(req, res, sb, m[1]);
        if (req.method === "POST" || req.method === "PATCH") return await handleSetConfig(req, res, sb, m[1]);
      }
    }

    // ── Domain scores ──────────────────────────────────────────────────
    {
      const m = route.match(/^\/users\/(\d+)\/domain-scores$/);
      if (m && req.method === "GET") {
        return await handleDomainScores(req, res, sb, parseInt(m[1]));
      }
    }

    // ── Health check ───────────────────────────────────────────────────
    if (route === "/health") {
      return json(res, 200, { ok: true, ts: Date.now() });
    }

    return json(res, 404, { error: `Not found: ${route}` });
  } catch (err: any) {
    console.error("[api] unhandled error:", err);
    return json(res, 500, { error: err?.message ?? "Internal server error" });
  }
}
