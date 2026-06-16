import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertTrialSchema, insertSessionSchema, insertRecallItemSchema,
  insertMemoryItemSchema,
} from "@shared/schema";
import { z } from "zod";

// SM-2 spaced repetition algorithm
function sm2(item: { easeFactor: number; intervalDays: number; repetitions: number }, quality: number) {
  // quality: 0-5 (0=blackout, 5=perfect)
  const ef = Math.max(1.3, item.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  let interval: number;
  let reps: number;

  if (quality < 3) {
    interval = 1;
    reps = 0;
  } else {
    if (item.repetitions === 0) interval = 1;
    else if (item.repetitions === 1) interval = 6;
    else interval = Math.round(item.intervalDays * ef);
    reps = item.repetitions + 1;
  }

  return { easeFactor: ef, intervalDays: interval, repetitions: reps };
}

// Helper: get the currently active user (falls back to default if not found)
function getActiveUser() {
  const id = storage.getActiveProfileId();
  return storage.getUser(id) ?? storage.getDefaultUser();
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // ── Active Profile ─────────────────────────────────────────────────
  app.get("/api/active-profile", (req, res) => {
    const user = getActiveUser();
    res.json(user);
  });

  // ── Profiles ───────────────────────────────────────────────────────
  app.get("/api/profiles", (req, res) => {
    const profiles = storage.getAllProfiles();
    const activeId = storage.getActiveProfileId();
    const result = profiles.map(p => {
      const stats = storage.getProfileStats(p.id);
      return {
        ...p,
        isActive: p.id === activeId,
        sessionsCompleted: stats.sessionsCompleted,
        minutesTrained: stats.minutesTrained,
      };
    });
    res.json(result);
  });

  app.post("/api/profiles", (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    const profile = storage.createProfile(name.trim());
    res.json(profile);
  });

  app.patch("/api/profiles/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    const updated = storage.updateUser(id, { name: name.trim() });
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    res.json(updated);
  });

  app.delete("/api/profiles/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const profiles = storage.getAllProfiles();
    if (profiles.length <= 1) {
      return res.status(400).json({ error: "Cannot delete the only profile" });
    }
    // If deleting active profile, switch to another
    const activeId = storage.getActiveProfileId();
    if (activeId === id) {
      const other = profiles.find(p => p.id !== id);
      if (other) storage.setActiveProfileId(other.id);
    }
    storage.deleteProfile(id);
    res.json({ success: true });
  });

  app.post("/api/profiles/:id/activate", (req, res) => {
    const id = parseInt(req.params.id);
    const profile = storage.getUser(id);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    storage.setActiveProfileId(id);
    res.json(profile);
  });

  // ── Get or init user ───────────────────────────────────────────────
  app.get("/api/user", (req, res) => {
    const user = getActiveUser();
    res.json(user);
  });

  app.patch("/api/user", (req, res) => {
    const user = getActiveUser();
    const updated = storage.updateUser(user.id, req.body);
    res.json(updated);
  });

  // Domain scores
  app.get("/api/domain-scores", (req, res) => {
    const user = getActiveUser();
    const scores = storage.getDomainScores(user.id);
    res.json(scores);
  });

  // Record a trial
  app.post("/api/trials", (req, res) => {
    const user = getActiveUser();
    const parsed = insertTrialSchema.safeParse({ ...req.body, userId: user.id });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const trial = storage.createTrial(parsed.data);

    // Update domain score
    const existing = storage.getDomainScore(user.id, trial.domain);
    const totalTrials = (existing?.totalTrials || 0) + 1;
    const prevAccuracy = existing?.avgAccuracy || 0;
    const prevRT = existing?.avgResponseTime || 0;
    const prevConf = existing?.avgConfidence || 0;

    const newAccuracy = (prevAccuracy * (totalTrials - 1) + (trial.correct ? 100 : 0)) / totalTrials;
    const newRT = (prevRT * (totalTrials - 1) + (trial.responseTimeMs || 0)) / totalTrials;
    const newConf = (prevConf * (totalTrials - 1) + (trial.confidence || 50)) / totalTrials;

    // ELO-like score update
    const baseScore = existing?.score || 50;
    const expected = baseScore / 100;
    const actual = trial.correct ? 1 : 0;
    const k = 8;
    const difficultyBonus = (trial.difficulty || 1) * 0.5;
    const newScore = Math.min(100, Math.max(0, baseScore + k * (actual - expected) + (trial.correct ? difficultyBonus : -difficultyBonus)));

    storage.upsertDomainScore({
      userId: user.id,
      domain: trial.domain,
      score: newScore,
      totalTrials,
      avgAccuracy: newAccuracy,
      avgResponseTime: newRT,
      avgConfidence: newConf,
    });

    // Update calibration
    if (trial.confidence !== null && trial.confidence !== undefined) {
      const bucket = Math.ceil(trial.confidence / 10) * 10;
      const cal = storage.getCalibrationData(user.id).find(
        c => c.domain === trial.domain && c.confidenceBucket === bucket
      );
      storage.upsertCalibration({
        userId: user.id,
        domain: trial.domain,
        confidenceBucket: bucket,
        correctCount: (cal?.correctCount || 0) + (trial.correct ? 1 : 0),
        totalCount: (cal?.totalCount || 0) + 1,
      });
    }

    res.json(trial);
  });

  app.get("/api/trials/recent", (req, res) => {
    const user = getActiveUser();
    const trialList = storage.getRecentTrials(user.id, 100);
    res.json(trialList);
  });

  // Sessions
  app.post("/api/sessions", (req, res) => {
    const user = getActiveUser();
    const parsed = insertSessionSchema.safeParse({ ...req.body, userId: user.id });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const session = storage.createSession(parsed.data);

    // Update user totals
    storage.updateUser(user.id, {
      totalSessionsCompleted: (user.totalSessionsCompleted || 0) + 1,
      totalMinutesTrained: (user.totalMinutesTrained || 0) + (parsed.data.durationMinutes || 0),
    });

    res.json(session);
  });

  app.get("/api/sessions", (req, res) => {
    const user = getActiveUser();
    const recentSessions = storage.getRecentSessions(user.id, 20);
    res.json(recentSessions);
  });

  // Memory Vault (recall items)
  app.get("/api/recall-items", (req, res) => {
    const user = getActiveUser();
    const items = storage.getRecallItems(user.id);
    res.json(items);
  });

  app.get("/api/recall-items/due", (req, res) => {
    const user = getActiveUser();
    const items = storage.getDueRecallItems(user.id);
    res.json(items);
  });

  app.post("/api/recall-items", (req, res) => {
    const user = getActiveUser();
    const parsed = insertRecallItemSchema.safeParse({ ...req.body, userId: user.id });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const item = storage.createRecallItem(parsed.data);
    res.json(item);
  });

  app.patch("/api/recall-items/:id/review", (req, res) => {
    const id = parseInt(req.params.id);
    const { quality } = req.body; // 0-5
    const user = getActiveUser();
    const items = storage.getRecallItems(user.id);
    const item = items.find(i => i.id === id);
    if (!item) return res.status(404).json({ error: "Not found" });

    const updated = sm2(
      { easeFactor: item.easeFactor || 2.5, intervalDays: item.intervalDays || 1, repetitions: item.repetitions || 0 },
      quality
    );

    const nextReview = Date.now() + updated.intervalDays * 24 * 60 * 60 * 1000;
    const result = storage.updateRecallItem(id, {
      ...updated,
      nextReviewAt: nextReview,
      lastReviewedAt: Date.now(),
    });
    res.json(result);
  });

  app.delete("/api/recall-items/:id", (req, res) => {
    const id = parseInt(req.params.id);
    storage.deleteRecallItem(id);
    res.json({ success: true });
  });

  // Calibration data
  app.get("/api/calibration", (req, res) => {
    const user = getActiveUser();
    const data = storage.getCalibrationData(user.id);
    res.json(data);
  });

  // Stats / analytics
  app.get("/api/stats", (req, res) => {
    const user = getActiveUser();
    const scores = storage.getDomainScores(user.id);
    const recentTrials = storage.getRecentTrials(user.id, 50);
    const recentSessions = storage.getRecentSessions(user.id, 7);

    const avgScore = scores.length > 0
      ? scores.reduce((s, d) => s + d.score, 0) / scores.length
      : 50;

    const weakest = [...scores].sort((a, b) => a.score - b.score).slice(0, 2);
    const strongest = [...scores].sort((a, b) => b.score - a.score).slice(0, 2);

    const correctLast = recentTrials.filter(t => t.correct).length;
    const recentAccuracy = recentTrials.length > 0 ? (correctLast / recentTrials.length) * 100 : 0;

    res.json({
      user,
      avgScore,
      weakestDomains: weakest,
      strongestDomains: strongest,
      recentAccuracy,
      totalTrials: recentTrials.length,
      recentSessions: recentSessions.length,
    });
  });

  // ── Philosophy Chambers: Notes API ───────────────────────────────
  app.get("/api/notes", (req, res) => {
    const user = getActiveUser();
    const allNotes = storage.getNotes(user.id);
    res.json(allNotes);
  });

  app.post("/api/notes", (req, res) => {
    const user = getActiveUser();
    const { title, content, tags } = req.body;
    const note = storage.createNote({
      userId: user.id,
      title: title || "Untitled",
      content: content || "",
      tags: tags ? JSON.stringify(tags) : "[]",
      pinned: false,
    });
    res.json(note);
  });

  app.patch("/api/notes/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const { title, content, tags, pinned } = req.body;
    const patch: any = {};
    if (title !== undefined) patch.title = title;
    if (content !== undefined) patch.content = content;
    if (tags !== undefined) patch.tags = JSON.stringify(tags);
    if (pinned !== undefined) patch.pinned = pinned;
    const updated = storage.updateNote(id, patch);
    if (!updated) return res.status(404).json({ message: "Note not found" });
    res.json(updated);
  });

  app.delete("/api/notes/:id", (req, res) => {
    const id = parseInt(req.params.id);
    storage.deleteNote(id);
    res.json({ ok: true });
  });

  // ── Memory Items ───────────────────────────────────────────────────
  app.get("/api/memory", (req, res) => {
    const user = getActiveUser();
    const items = storage.getMemoryItems(user.id);
    res.json(items);
  });

  app.post("/api/memory", (req, res) => {
    const user = getActiveUser();
    const parsed = insertMemoryItemSchema.safeParse({ ...req.body, userId: user.id });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const item = storage.createMemoryItem(parsed.data);
    res.json(item);
  });

  app.patch("/api/memory/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const updated = storage.updateMemoryItem(id, req.body);
    if (!updated) return res.status(404).json({ error: "Memory item not found" });
    res.json(updated);
  });

  app.delete("/api/memory/:id", (req, res) => {
    const id = parseInt(req.params.id);
    storage.deleteMemoryItem(id);
    res.json({ success: true });
  });

  // ── Export / Import ────────────────────────────────────────────────
  app.get("/api/export", (req, res) => {
    const user = getActiveUser();
    const data = {
      version: "1.0",
      exportedAt: Date.now(),
      profile: user,
      domainScores: storage.getDomainScores(user.id),
      trials: storage.getRecentTrials(user.id, 10000),
      sessions: storage.getRecentSessions(user.id, 10000),
      recallItems: storage.getRecallItems(user.id),
      calibrationHistory: storage.getCalibrationData(user.id),
      notes: storage.getNotes(user.id),
      memoryItems: storage.getMemoryItems(user.id),
    };
    res.json(data);
  });

  app.post("/api/import", (req, res) => {
    const body = req.body;
    if (!body || !body.profile || !body.version) {
      return res.status(400).json({ error: "Invalid import format — missing version or profile" });
    }

    const profileName = body.profile?.name || "Imported Profile";
    const overwrite = body.overwrite === true;

    let targetUser: any;

    if (overwrite) {
      // Find profile with same name and overwrite
      const existing = storage.getAllProfiles().find(p => p.name === profileName);
      if (existing) {
        storage.deleteProfile(existing.id);
      }
    }

    // Create new profile
    targetUser = storage.createProfile(profileName);
    const newId = targetUser.id;

    // Re-insert all related data under new profile id
    if (Array.isArray(body.domainScores)) {
      for (const ds of body.domainScores) {
        storage.upsertDomainScore({ ...ds, id: undefined, userId: newId });
      }
    }
    if (Array.isArray(body.trials)) {
      for (const t of body.trials) {
        storage.createTrial({ ...t, id: undefined, userId: newId, createdAt: undefined });
      }
    }
    if (Array.isArray(body.sessions)) {
      for (const s of body.sessions) {
        storage.createSession({ ...s, id: undefined, userId: newId, completedAt: undefined });
      }
    }
    if (Array.isArray(body.recallItems)) {
      for (const ri of body.recallItems) {
        storage.createRecallItem({ ...ri, id: undefined, userId: newId, createdAt: undefined });
      }
    }
    if (Array.isArray(body.calibrationHistory)) {
      for (const c of body.calibrationHistory) {
        storage.upsertCalibration({ ...c, id: undefined, userId: newId, updatedAt: undefined });
      }
    }
    if (Array.isArray(body.notes)) {
      for (const n of body.notes) {
        storage.createNote({ ...n, id: undefined, userId: newId });
      }
    }
    if (Array.isArray(body.memoryItems)) {
      for (const m of body.memoryItems) {
        storage.createMemoryItem({ ...m, id: undefined, userId: newId });
      }
    }

    // Set as active profile
    storage.setActiveProfileId(newId);

    res.json({ success: true, profileId: newId, profileName });
  });

  return httpServer;
}
