import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// ── Auth middleware ────────────────────────────────────────────────────
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-session-token"] as string | undefined;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  const session = await storage.getAuthSession(token);
  if (!session) return res.status(401).json({ error: "Session expired or invalid" });
  (req as any).userId = session.userId;
  next();
}

// 30-day session TTL
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── Schema validation (inline, no drizzle dependency) ─────────────────────
const insertTrialSchema = z.object({
  userId: z.number(),
  domain: z.string(),
  activityId: z.string(),
  correct: z.number(),
  responseTimeMs: z.number().optional().default(0),
  confidence: z.number().optional().default(50),
  difficulty: z.number().optional().default(1),
  errorType: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const insertSessionSchema = z.object({
  userId: z.number(),
  sessionType: z.string().optional().default("standard"),
  durationMinutes: z.number().optional().default(0),
  trialsCompleted: z.number().optional().default(0),
  avgAccuracy: z.number().optional().default(0),
  avgConfidence: z.number().optional().default(0),
  metacogReflection: z.string().nullable().optional(),
});

const insertRecallItemSchema = z.object({
  userId: z.number(),
  front: z.string(),
  back: z.string(),
  tags: z.string().optional().default("[]"),
  category: z.string().optional().default("general"),
  nextReviewAt: z.number().optional(),
  intervalDays: z.number().optional().default(1),
  easeFactor: z.number().optional().default(2.5),
  repetitions: z.number().optional().default(0),
  lastReviewedAt: z.number().nullable().optional(),
});

const insertMemoryItemSchema = z.object({
  userId: z.number(),
  type: z.string().optional().default("reflection"),
  content: z.string(),
  source: z.string().optional().default("manual"),
  confidence: z.number().optional().default(50),
  importance: z.number().optional().default(50),
});

// ── SM-2 spaced repetition ────────────────────────────────────────────────
function sm2(item: { easeFactor: number; intervalDays: number; repetitions: number }, quality: number) {
  const ef = Math.max(1.3, item.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  let interval: number;
  let reps: number;
  if (quality < 3) {
    interval = 1; reps = 0;
  } else {
    if (item.repetitions === 0) interval = 1;
    else if (item.repetitions === 1) interval = 6;
    else interval = Math.round(item.intervalDays * ef);
    reps = item.repetitions + 1;
  }
  return { easeFactor: ef, intervalDays: interval, repetitions: reps };
}

async function getActiveUser(req?: Request) {
  if (req) {
    const token = req.headers["x-session-token"] as string | undefined;
    if (token) {
      const session = await storage.getAuthSession(token);
      if (session) {
        const user = await storage.getUser(session.userId);
        if (user) return user;
      }
    }
  }
  const id = await storage.getActiveProfileId();
  return (await storage.getUser(id)) ?? (await storage.getDefaultUser());
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Auth routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { name, password } = req.body;
      if (!name?.trim() || !password) return res.status(400).json({ error: "Name and password required" });
      const existing = await storage.getUserByName(name.trim());
      if (existing) return res.status(409).json({ error: "A profile with that name already exists" });
      const user = await storage.createProfile(name.trim());
      const hash = await bcrypt.hash(password, 12);
      await storage.setPasswordHash(user.id, hash);
      const sessionId = crypto.randomBytes(32).toString("hex");
      await storage.createAuthSession(user.id, sessionId, Date.now() + SESSION_TTL_MS);
      res.json({ token: sessionId, user });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { name, password } = req.body;
      if (!name?.trim() || !password) return res.status(400).json({ error: "Name and password required" });
      const user = await storage.getUserByName(name.trim());
      if (!user) return res.status(401).json({ error: "No profile found with that name" });
      const hash = await storage.getPasswordHash(user.id);
      if (!hash) return res.status(401).json({ error: "This profile has no password set" });
      const valid = await bcrypt.compare(password, hash);
      if (!valid) return res.status(401).json({ error: "Incorrect password" });
      const sessionId = crypto.randomBytes(32).toString("hex");
      await storage.createAuthSession(user.id, sessionId, Date.now() + SESSION_TTL_MS);
      res.json({ token: sessionId, user });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const token = req.headers["x-session-token"] as string | undefined;
      if (!token) return res.status(401).json({ error: "Not authenticated" });
      const session = await storage.getAuthSession(token);
      if (!session) return res.status(401).json({ error: "Session expired" });
      const user = await storage.getUser(session.userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json({ user });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const token = req.headers["x-session-token"] as string | undefined;
      if (token) await storage.deleteAuthSession(token);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Active Profile ──────────────────────────────────────────────────
  app.get("/api/active-profile", async (req, res) => {
    try { res.json(await getActiveUser(req)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Profiles ────────────────────────────────────────────────────────
  app.get("/api/profiles", async (req, res) => {
    try {
      const profiles = await storage.getAllProfiles();
      const activeId = await storage.getActiveProfileId();
      const result = await Promise.all(profiles.map(async p => {
        const stats = await storage.getProfileStats(p.id);
        return { ...p, isActive: p.id === activeId, ...stats };
      }));
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/profiles", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim())
        return res.status(400).json({ error: "Name is required" });
      res.json(await storage.createProfile(name.trim()));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/profiles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim())
        return res.status(400).json({ error: "Name is required" });
      const updated = await storage.updateUser(id, { name: name.trim() });
      if (!updated) return res.status(404).json({ error: "Profile not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/profiles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const profiles = await storage.getAllProfiles();
      if (profiles.length <= 1) return res.status(400).json({ error: "Cannot delete the only profile" });
      const activeId = await storage.getActiveProfileId();
      if (activeId === id) {
        const other = profiles.find(p => p.id !== id);
        if (other) await storage.setActiveProfileId(other.id);
      }
      await storage.deleteProfile(id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/profiles/:id/activate", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const profile = await storage.getUser(id);
      if (!profile) return res.status(404).json({ error: "Profile not found" });
      await storage.setActiveProfileId(id);
      res.json(profile);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── User ────────────────────────────────────────────────────────────
  app.get("/api/user", async (req, res) => {
    try { res.json(await getActiveUser(req)); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/user", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      res.json(await storage.updateUser(user.id, req.body));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Domain Scores ───────────────────────────────────────────────────
  app.get("/api/domain-scores", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      res.json(await storage.getDomainScores(user.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Trials ──────────────────────────────────────────────────────────
  app.post("/api/trials", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      const parsed = insertTrialSchema.safeParse({ ...req.body, userId: user.id });
      if (!parsed.success) return res.status(400).json({ error: parsed.error });

      const trial = await storage.createTrial(parsed.data);
      const existing = await storage.getDomainScore(user.id, trial.domain);
      const totalTrials = (existing?.totalTrials || 0) + 1;
      const prevAccuracy = existing?.avgAccuracy || 0;
      const prevRT = existing?.avgResponseTime || 0;
      const prevConf = existing?.avgConfidence || 0;
      const newAccuracy = (prevAccuracy * (totalTrials - 1) + (trial.correct ? 100 : 0)) / totalTrials;
      const newRT = (prevRT * (totalTrials - 1) + (trial.responseTimeMs || 0)) / totalTrials;
      const newConf = (prevConf * (totalTrials - 1) + (trial.confidence || 50)) / totalTrials;
      const baseScore = existing?.score || 50;
      const k = 8;
      const difficultyBonus = (trial.difficulty || 1) * 0.5;
      const newScore = Math.min(100, Math.max(0, baseScore + k * ((trial.correct ? 1 : 0) - baseScore / 100) + (trial.correct ? difficultyBonus : -difficultyBonus)));

      await storage.upsertDomainScore({
        userId: user.id, domain: trial.domain, score: newScore,
        totalTrials, avgAccuracy: newAccuracy, avgResponseTime: newRT, avgConfidence: newConf,
      });

      if (trial.confidence !== null && trial.confidence !== undefined) {
        const bucket = Math.ceil(trial.confidence / 10) * 10;
        const calData = await storage.getCalibrationData(user.id);
        const cal = calData.find(c => c.domain === trial.domain && c.confidenceBucket === bucket);
        await storage.upsertCalibration({
          userId: user.id, domain: trial.domain, confidenceBucket: bucket,
          correctCount: (cal?.correctCount || 0) + (trial.correct ? 1 : 0),
          totalCount: (cal?.totalCount || 0) + 1,
        });
      }
      res.json(trial);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/trials/recent", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      res.json(await storage.getRecentTrials(user.id, 100));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Sessions ────────────────────────────────────────────────────────
  app.post("/api/sessions", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      const parsed = insertSessionSchema.safeParse({ ...req.body, userId: user.id });
      if (!parsed.success) return res.status(400).json({ error: parsed.error });
      const session = await storage.createSession(parsed.data);
      await storage.updateUser(user.id, {
        totalSessionsCompleted: (user.totalSessionsCompleted || 0) + 1,
        totalMinutesTrained: (user.totalMinutesTrained || 0) + (parsed.data.durationMinutes || 0),
      });
      res.json(session);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/sessions", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      res.json(await storage.getRecentSessions(user.id, 20));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Recall Items ────────────────────────────────────────────────────
  app.get("/api/recall-items", async (req, res) => {
    try { res.json(await storage.getRecallItems((await getActiveUser(req)).id)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/recall-items/due", async (req, res) => {
    try { res.json(await storage.getDueRecallItems((await getActiveUser(req)).id)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/recall-items", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      const parsed = insertRecallItemSchema.safeParse({ ...req.body, userId: user.id });
      if (!parsed.success) return res.status(400).json({ error: parsed.error });
      res.json(await storage.createRecallItem(parsed.data));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/recall-items/:id/review", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { quality } = req.body;
      const user = await getActiveUser(req);
      const items = await storage.getRecallItems(user.id);
      const item = items.find(i => i.id === id);
      if (!item) return res.status(404).json({ error: "Not found" });
      const updated = sm2({ easeFactor: item.easeFactor || 2.5, intervalDays: item.intervalDays || 1, repetitions: item.repetitions || 0 }, quality);
      const nextReview = Date.now() + updated.intervalDays * 24 * 60 * 60 * 1000;
      res.json(await storage.updateRecallItem(id, { ...updated, nextReviewAt: nextReview, lastReviewedAt: Date.now() }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/recall-items/:id", async (req, res) => {
    try { await storage.deleteRecallItem(parseInt(req.params.id)); res.json({ success: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Calibration ─────────────────────────────────────────────────────
  app.get("/api/calibration", async (req, res) => {
    try { res.json(await storage.getCalibrationData((await getActiveUser(req)).id)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Stats ───────────────────────────────────────────────────────────
  app.get("/api/stats", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      const [scores, recentTrials, recentSessions] = await Promise.all([
        storage.getDomainScores(user.id),
        storage.getRecentTrials(user.id, 50),
        storage.getRecentSessions(user.id, 7),
      ]);
      const avgScore = scores.length > 0 ? scores.reduce((s, d) => s + d.score, 0) / scores.length : 50;
      const weakest = [...scores].sort((a, b) => a.score - b.score).slice(0, 2);
      const strongest = [...scores].sort((a, b) => b.score - a.score).slice(0, 2);
      const correctLast = recentTrials.filter(t => t.correct).length;
      const recentAccuracy = recentTrials.length > 0 ? (correctLast / recentTrials.length) * 100 : 0;
      res.json({ user, avgScore, weakestDomains: weakest, strongestDomains: strongest, recentAccuracy, totalTrials: recentTrials.length, recentSessions: recentSessions.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Notes ────────────────────────────────────────────────────────────
  app.get("/api/notes", async (req, res) => {
    try { res.json(await storage.getNotes((await getActiveUser(req)).id)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/notes", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      const { title, content, tags } = req.body;
      res.json(await storage.createNote({ userId: user.id, title: title || "Untitled", content: content || "", tags: tags ? JSON.stringify(tags) : "[]", pinned: false as any }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title, content, tags, pinned } = req.body;
      const patch: any = {};
      if (title !== undefined) patch.title = title;
      if (content !== undefined) patch.content = content;
      if (tags !== undefined) patch.tags = JSON.stringify(tags);
      if (pinned !== undefined) patch.pinned = pinned;
      const updated = await storage.updateNote(id, patch);
      if (!updated) return res.status(404).json({ message: "Note not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    try { await storage.deleteNote(parseInt(req.params.id)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Memory Items ─────────────────────────────────────────────────────
  app.get("/api/memory", async (req, res) => {
    try { res.json(await storage.getMemoryItems((await getActiveUser(req)).id)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/memory", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      const parsed = insertMemoryItemSchema.safeParse({ ...req.body, userId: user.id });
      if (!parsed.success) return res.status(400).json({ error: parsed.error });
      res.json(await storage.createMemoryItem(parsed.data));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/memory/:id", async (req, res) => {
    try {
      const updated = await storage.updateMemoryItem(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ error: "Memory item not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/memory/:id", async (req, res) => {
    try { await storage.deleteMemoryItem(parseInt(req.params.id)); res.json({ success: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Export / Import ──────────────────────────────────────────────────
  app.get("/api/export", async (req, res) => {
    try {
      const user = await getActiveUser(req);
      const [domainScores, trials, sessions, recallItems, calibrationHistory, notes, memoryItems] = await Promise.all([
        storage.getDomainScores(user.id),
        storage.getRecentTrials(user.id, 10000),
        storage.getRecentSessions(user.id, 10000),
        storage.getRecallItems(user.id),
        storage.getCalibrationData(user.id),
        storage.getNotes(user.id),
        storage.getMemoryItems(user.id),
      ]);
      res.json({ version: "1.0", exportedAt: Date.now(), profile: user, domainScores, trials, sessions, recallItems, calibrationHistory, notes, memoryItems });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/import", async (req, res) => {
    try {
      const body = req.body;
      if (!body || !body.profile || !body.version)
        return res.status(400).json({ error: "Invalid import format — missing version or profile" });
      const profileName = body.profile?.name || "Imported Profile";
      if (body.overwrite === true) {
        const existing = (await storage.getAllProfiles()).find(p => p.name === profileName);
        if (existing) await storage.deleteProfile(existing.id);
      }
      const targetUser = await storage.createProfile(profileName);
      const newId = targetUser.id;
      if (Array.isArray(body.domainScores)) {
        for (const ds of body.domainScores) await storage.upsertDomainScore({ ...ds, id: undefined, userId: newId });
      }
      if (Array.isArray(body.trials)) {
        for (const t of body.trials) await storage.createTrial({ ...t, id: undefined, userId: newId });
      }
      if (Array.isArray(body.sessions)) {
        for (const s of body.sessions) await storage.createSession({ ...s, id: undefined, userId: newId });
      }
      if (Array.isArray(body.recallItems)) {
        for (const ri of body.recallItems) await storage.createRecallItem({ ...ri, id: undefined, userId: newId });
      }
      if (Array.isArray(body.calibrationHistory)) {
        for (const c of body.calibrationHistory) await storage.upsertCalibration({ ...c, id: undefined, userId: newId });
      }
      if (Array.isArray(body.notes)) {
        for (const n of body.notes) await storage.createNote({ ...n, id: undefined, userId: newId });
      }
      if (Array.isArray(body.memoryItems)) {
        for (const m of body.memoryItems) await storage.createMemoryItem({ ...m, id: undefined, userId: newId });
      }
      await storage.setActiveProfileId(newId);
      res.json({ success: true, profileId: newId, profileName });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Taskboard Cards ──────────────────────────────────────────────────
  app.get("/api/taskboard", async (req, res) => {
    try {
      const userId = await storage.getActiveProfileId();
      res.json(await storage.getTaskboardCards(userId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/taskboard", async (req, res) => {
    try {
      const userId = await storage.getActiveProfileId();
      const { content = "", color = "gold", posX = 100, posY = 100, width = 200 } = req.body;
      res.json(await storage.createTaskboardCard({ userId, content, color, posX, posY, pinned: 0, width }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/taskboard/:id", async (req, res) => {
    try {
      const updated = await storage.updateTaskboardCard(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/taskboard/:id", async (req, res) => {
    try { await storage.deleteTaskboardCard(parseInt(req.params.id)); res.json({ success: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return httpServer;
}
