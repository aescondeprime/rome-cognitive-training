import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, lte, desc, sql } from "drizzle-orm";
import {
  users, domainScores, trials, sessions, recallItems, calibrationHistory,
  type User, type InsertUser,
  type DomainScore, type InsertDomainScore,
  type Trial, type InsertTrial,
  type Session, type InsertSession,
  type RecallItem, type InsertRecallItem,
  type CalibrationHistory, type InsertCalibration,
  notes, type Note, type InsertNote,
  appConfig, memoryItems,
  type MemoryItem, type InsertMemoryItem,
} from "@shared/schema";

// ── DB path: use ROME_DB_PATH env var (set by Electron for desktop mode)
// Falls back to data.db in the project root for web/dev mode.
const DB_PATH = process.env.ROME_DB_PATH || "data.db";
const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

// Initialize tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Trainee',
    baseline_completed INTEGER DEFAULT 0,
    current_mode TEXT DEFAULT 'standard',
    total_sessions_completed INTEGER DEFAULT 0,
    total_minutes_trained INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS domain_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 50,
    total_trials INTEGER DEFAULT 0,
    avg_accuracy REAL DEFAULT 0,
    avg_response_time REAL DEFAULT 0,
    avg_confidence REAL DEFAULT 0,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS trials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    correct INTEGER NOT NULL,
    response_time_ms INTEGER DEFAULT 0,
    confidence INTEGER DEFAULT 50,
    difficulty INTEGER DEFAULT 1,
    error_type TEXT,
    notes TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_type TEXT NOT NULL DEFAULT 'standard',
    duration_minutes INTEGER DEFAULT 0,
    trials_completed INTEGER DEFAULT 0,
    avg_accuracy REAL DEFAULT 0,
    avg_confidence REAL DEFAULT 0,
    metacog_reflection TEXT,
    completed_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS recall_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    category TEXT DEFAULT 'general',
    next_review_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    interval_days REAL DEFAULT 1,
    ease_factor REAL DEFAULT 2.5,
    repetitions INTEGER DEFAULT 0,
    last_reviewed_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS calibration_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    confidence_bucket INTEGER NOT NULL,
    correct_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content TEXT NOT NULL DEFAULT '',
    tags TEXT DEFAULT '[]',
    pinned INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS app_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'reflection',
    content TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    confidence INTEGER DEFAULT 50,
    importance INTEGER DEFAULT 50,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
`);

export interface IStorage {
  // Users
  getUser(id: number): User | undefined;
  getDefaultUser(): User;
  createUser(data: InsertUser): User;
  updateUser(id: number, data: Partial<InsertUser>): User | undefined;

  // Domain scores
  getDomainScores(userId: number): DomainScore[];
  getDomainScore(userId: number, domain: string): DomainScore | undefined;
  upsertDomainScore(data: InsertDomainScore): DomainScore;

  // Trials
  createTrial(data: InsertTrial): Trial;
  getRecentTrials(userId: number, limit?: number): Trial[];
  getTrialsByDomain(userId: number, domain: string, limit?: number): Trial[];

  // Sessions
  createSession(data: InsertSession): Session;
  getRecentSessions(userId: number, limit?: number): Session[];

  // Recall items
  createRecallItem(data: InsertRecallItem): RecallItem;
  getRecallItems(userId: number): RecallItem[];
  getDueRecallItems(userId: number): RecallItem[];
  updateRecallItem(id: number, data: Partial<InsertRecallItem>): RecallItem | undefined;
  deleteRecallItem(id: number): void;

  // Calibration
  getCalibrationData(userId: number): CalibrationHistory[];
  upsertCalibration(data: InsertCalibration): CalibrationHistory;

  // Notes (Philosophy Chambers)
  getNotes(userId: number): Note[];
  getNote(id: number): Note | undefined;
  createNote(data: InsertNote): Note;
  updateNote(id: number, data: Partial<InsertNote>): Note | undefined;
  deleteNote(id: number): void;

  // App config (active profile)
  getConfig(key: string): string | undefined;
  setConfig(key: string, value: string): void;
  getActiveProfileId(): number;
  setActiveProfileId(id: number): void;

  // Profile management (users table is the profiles table)
  getAllProfiles(): User[];
  createProfile(name: string): User;
  deleteProfile(id: number): void;
  getProfileStats(id: number): { sessionsCompleted: number; minutesTrained: number };

  // Memory items
  getMemoryItems(userId: number): MemoryItem[];
  createMemoryItem(data: InsertMemoryItem): MemoryItem;
  updateMemoryItem(id: number, data: Partial<InsertMemoryItem>): MemoryItem | undefined;
  deleteMemoryItem(id: number): void;
}

class SQLiteStorage implements IStorage {
  getUser(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  getDefaultUser(): User {
    let user = db.select().from(users).get();
    if (!user) {
      user = db.insert(users).values({ name: "Trainee" }).returning().get();
      // Initialize domain scores
      const domains = ["recall", "working_memory", "focus", "flexibility", "problem_solving", "creativity", "intuition", "metacognition"];
      for (const domain of domains) {
        db.insert(domainScores).values({ userId: user.id, domain, score: 50 }).run();
      }
    }
    return user;
  }

  createUser(data: InsertUser): User {
    return db.insert(users).values(data).returning().get();
  }

  updateUser(id: number, data: Partial<InsertUser>): User | undefined {
    return db.update(users).set(data).where(eq(users.id, id)).returning().get();
  }

  getDomainScores(userId: number): DomainScore[] {
    return db.select().from(domainScores).where(eq(domainScores.userId, userId)).all();
  }

  getDomainScore(userId: number, domain: string): DomainScore | undefined {
    return db.select().from(domainScores)
      .where(and(eq(domainScores.userId, userId), eq(domainScores.domain, domain)))
      .get();
  }

  upsertDomainScore(data: InsertDomainScore): DomainScore {
    const existing = this.getDomainScore(data.userId, data.domain);
    if (existing) {
      return db.update(domainScores)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(domainScores.id, existing.id))
        .returning().get();
    }
    return db.insert(domainScores).values(data).returning().get();
  }

  createTrial(data: InsertTrial): Trial {
    return db.insert(trials).values(data).returning().get();
  }

  getRecentTrials(userId: number, limit = 50): Trial[] {
    return db.select().from(trials)
      .where(eq(trials.userId, userId))
      .orderBy(desc(trials.createdAt))
      .limit(limit)
      .all();
  }

  getTrialsByDomain(userId: number, domain: string, limit = 20): Trial[] {
    return db.select().from(trials)
      .where(and(eq(trials.userId, userId), eq(trials.domain, domain)))
      .orderBy(desc(trials.createdAt))
      .limit(limit)
      .all();
  }

  createSession(data: InsertSession): Session {
    return db.insert(sessions).values(data).returning().get();
  }

  getRecentSessions(userId: number, limit = 10): Session[] {
    return db.select().from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.completedAt))
      .limit(limit)
      .all();
  }

  createRecallItem(data: InsertRecallItem): RecallItem {
    return db.insert(recallItems).values(data).returning().get();
  }

  getRecallItems(userId: number): RecallItem[] {
    return db.select().from(recallItems)
      .where(eq(recallItems.userId, userId))
      .orderBy(desc(recallItems.createdAt))
      .all();
  }

  getDueRecallItems(userId: number): RecallItem[] {
    const now = Date.now();
    return db.select().from(recallItems)
      .where(and(eq(recallItems.userId, userId), lte(recallItems.nextReviewAt, now)))
      .all();
  }

  updateRecallItem(id: number, data: Partial<InsertRecallItem>): RecallItem | undefined {
    return db.update(recallItems).set(data).where(eq(recallItems.id, id)).returning().get();
  }

  deleteRecallItem(id: number): void {
    db.delete(recallItems).where(eq(recallItems.id, id)).run();
  }

  getCalibrationData(userId: number): CalibrationHistory[] {
    return db.select().from(calibrationHistory)
      .where(eq(calibrationHistory.userId, userId))
      .all();
  }

  upsertCalibration(data: InsertCalibration): CalibrationHistory {
    const existing = db.select().from(calibrationHistory)
      .where(and(
        eq(calibrationHistory.userId, data.userId),
        eq(calibrationHistory.domain, data.domain),
        eq(calibrationHistory.confidenceBucket, data.confidenceBucket)
      )).get();
    if (existing) {
      return db.update(calibrationHistory)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(calibrationHistory.id, existing.id))
        .returning().get();
    }
    return db.insert(calibrationHistory).values(data).returning().get();
  }

  // ── Notes ──────────────────────────────────────────────────────────
  getNotes(userId: number): Note[] {
    return db.select().from(notes)
      .where(eq(notes.userId, userId))
      .orderBy(desc(notes.updatedAt))
      .all();
  }

  getNote(id: number): Note | undefined {
    return db.select().from(notes).where(eq(notes.id, id)).get();
  }

  createNote(data: InsertNote): Note {
    const now = Date.now();
    return db.insert(notes).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
  }

  updateNote(id: number, data: Partial<InsertNote>): Note | undefined {
    return db.update(notes)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(notes.id, id))
      .returning().get();
  }

  deleteNote(id: number): void {
    db.delete(notes).where(eq(notes.id, id)).run();
  }

  // ── App Config ─────────────────────────────────────────────────────
  getConfig(key: string): string | undefined {
    const row = db.select().from(appConfig).where(eq(appConfig.key, key)).get();
    return row?.value;
  }

  setConfig(key: string, value: string): void {
    const existing = db.select().from(appConfig).where(eq(appConfig.key, key)).get();
    if (existing) {
      db.update(appConfig).set({ value }).where(eq(appConfig.key, key)).run();
    } else {
      db.insert(appConfig).values({ key, value }).run();
    }
  }

  getActiveProfileId(): number {
    const val = this.getConfig("active_profile_id");
    if (val) {
      const id = parseInt(val, 10);
      if (!isNaN(id)) return id;
    }
    // Fall back to default user
    const user = this.getDefaultUser();
    this.setConfig("active_profile_id", String(user.id));
    return user.id;
  }

  setActiveProfileId(id: number): void {
    this.setConfig("active_profile_id", String(id));
  }

  // ── Profile Management ─────────────────────────────────────────────
  getAllProfiles(): User[] {
    return db.select().from(users).orderBy(users.createdAt).all();
  }

  createProfile(name: string): User {
    const user = db.insert(users).values({ name }).returning().get();
    // Initialize domain scores for new profile
    const domains = ["recall", "working_memory", "focus", "flexibility", "problem_solving", "creativity", "intuition", "metacognition"];
    for (const domain of domains) {
      db.insert(domainScores).values({ userId: user.id, domain, score: 50 }).run();
    }
    return user;
  }

  deleteProfile(id: number): void {
    // Cascade delete in order: memory_items → notes → calibration_history → recall_items → sessions → trials → domain_scores → users
    db.delete(memoryItems).where(eq(memoryItems.userId, id)).run();
    db.delete(notes).where(eq(notes.userId, id)).run();
    db.delete(calibrationHistory).where(eq(calibrationHistory.userId, id)).run();
    db.delete(recallItems).where(eq(recallItems.userId, id)).run();
    db.delete(sessions).where(eq(sessions.userId, id)).run();
    db.delete(trials).where(eq(trials.userId, id)).run();
    db.delete(domainScores).where(eq(domainScores.userId, id)).run();
    db.delete(users).where(eq(users.id, id)).run();
  }

  getProfileStats(id: number): { sessionsCompleted: number; minutesTrained: number } {
    const result = db.select({
      sessionsCompleted: sql<number>`COUNT(*)`,
      minutesTrained: sql<number>`COALESCE(SUM(duration_minutes), 0)`,
    })
      .from(sessions)
      .where(eq(sessions.userId, id))
      .get();
    return {
      sessionsCompleted: result?.sessionsCompleted ?? 0,
      minutesTrained: result?.minutesTrained ?? 0,
    };
  }

  // ── Memory Items ───────────────────────────────────────────────────
  getMemoryItems(userId: number): MemoryItem[] {
    return db.select().from(memoryItems)
      .where(eq(memoryItems.userId, userId))
      .orderBy(desc(memoryItems.createdAt))
      .all();
  }

  createMemoryItem(data: InsertMemoryItem): MemoryItem {
    const now = Date.now();
    return db.insert(memoryItems).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
  }

  updateMemoryItem(id: number, data: Partial<InsertMemoryItem>): MemoryItem | undefined {
    return db.update(memoryItems)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(memoryItems.id, id))
      .returning().get();
  }

  deleteMemoryItem(id: number): void {
    db.delete(memoryItems).where(eq(memoryItems.id, id)).run();
  }
}

export const storage = new SQLiteStorage();
