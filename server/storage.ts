import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Types (mirrors SQLite schema exactly) ─────────────────────────────────
export interface User {
  id: number;
  name: string;
  baselineCompleted: number;
  currentMode: string;
  totalSessionsCompleted: number;
  totalMinutesTrained: number;
  createdAt: number;
}
export type InsertUser = Partial<Omit<User, "id" | "createdAt">>;

export interface DomainScore {
  id: number;
  userId: number;
  domain: string;
  score: number;
  totalTrials: number;
  avgAccuracy: number;
  avgResponseTime: number;
  avgConfidence: number;
  updatedAt: number;
}
export type InsertDomainScore = Omit<DomainScore, "id" | "updatedAt">;

export interface Trial {
  id: number;
  userId: number;
  domain: string;
  activityId: string;
  correct: number;
  responseTimeMs: number;
  confidence: number;
  difficulty: number;
  errorType: string | null;
  notes: string | null;
  createdAt: number;
}
export type InsertTrial = Omit<Trial, "id" | "createdAt">;

export interface Session {
  id: number;
  userId: number;
  sessionType: string;
  durationMinutes: number;
  trialsCompleted: number;
  avgAccuracy: number;
  avgConfidence: number;
  metacogReflection: string | null;
  completedAt: number;
}
export type InsertSession = Omit<Session, "id" | "completedAt">;

export interface RecallItem {
  id: number;
  userId: number;
  front: string;
  back: string;
  tags: string;
  category: string;
  nextReviewAt: number;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lastReviewedAt: number | null;
  createdAt: number;
}
export type InsertRecallItem = Omit<RecallItem, "id" | "createdAt">;

export interface CalibrationHistory {
  id: number;
  userId: number;
  domain: string;
  confidenceBucket: number;
  correctCount: number;
  totalCount: number;
  updatedAt: number;
}
export type InsertCalibration = Omit<CalibrationHistory, "id" | "updatedAt">;

export interface Note {
  id: number;
  userId: number;
  title: string;
  content: string;
  tags: string;
  pinned: number;
  createdAt: number;
  updatedAt: number;
}
export type InsertNote = Omit<Note, "id" | "createdAt" | "updatedAt">;

export interface MemoryItem {
  id: number;
  userId: number;
  type: string;
  content: string;
  source: string;
  confidence: number;
  importance: number;
  createdAt: number;
  updatedAt: number;
}
export type InsertMemoryItem = Omit<MemoryItem, "id" | "createdAt" | "updatedAt">;

export interface TaskboardCard {
  id: number;
  userId: number;
  content: string;
  color: string;
  posX: number;
  posY: number;
  pinned: number;
  width: number;
  createdAt: number;
  updatedAt: number;
}
export type InsertTaskboardCard = Omit<TaskboardCard, "id" | "createdAt" | "updatedAt">;

// ── IStorage interface (unchanged) ────────────────────────────────────────
export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getDefaultUser(): Promise<User>;
  createUser(data: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined>;

  getDomainScores(userId: number): Promise<DomainScore[]>;
  getDomainScore(userId: number, domain: string): Promise<DomainScore | undefined>;
  upsertDomainScore(data: InsertDomainScore): Promise<DomainScore>;

  createTrial(data: InsertTrial): Promise<Trial>;
  getRecentTrials(userId: number, limit?: number): Promise<Trial[]>;
  getTrialsByDomain(userId: number, domain: string, limit?: number): Promise<Trial[]>;

  createSession(data: InsertSession): Promise<Session>;
  getRecentSessions(userId: number, limit?: number): Promise<Session[]>;

  createRecallItem(data: InsertRecallItem): Promise<RecallItem>;
  getRecallItems(userId: number): Promise<RecallItem[]>;
  getDueRecallItems(userId: number): Promise<RecallItem[]>;
  updateRecallItem(id: number, data: Partial<InsertRecallItem>): Promise<RecallItem | undefined>;
  deleteRecallItem(id: number): Promise<void>;

  getCalibrationData(userId: number): Promise<CalibrationHistory[]>;
  upsertCalibration(data: InsertCalibration): Promise<CalibrationHistory>;

  getNotes(userId: number): Promise<Note[]>;
  getNote(id: number): Promise<Note | undefined>;
  createNote(data: InsertNote): Promise<Note>;
  updateNote(id: number, data: Partial<InsertNote>): Promise<Note | undefined>;
  deleteNote(id: number): Promise<void>;

  getConfig(key: string): Promise<string | undefined>;
  setConfig(key: string, value: string): Promise<void>;
  getActiveProfileId(): Promise<number>;
  setActiveProfileId(id: number): Promise<void>;

  getAllProfiles(): Promise<User[]>;
  createProfile(name: string): Promise<User>;
  deleteProfile(id: number): Promise<void>;
  getProfileStats(id: number): Promise<{ sessionsCompleted: number; minutesTrained: number }>;

  getMemoryItems(userId: number): Promise<MemoryItem[]>;
  createMemoryItem(data: InsertMemoryItem): Promise<MemoryItem>;
  updateMemoryItem(id: number, data: Partial<InsertMemoryItem>): Promise<MemoryItem | undefined>;
  deleteMemoryItem(id: number): Promise<void>;

  getTaskboardCards(userId: number): Promise<TaskboardCard[]>;
  createTaskboardCard(data: InsertTaskboardCard): Promise<TaskboardCard>;
  updateTaskboardCard(id: number, data: Partial<InsertTaskboardCard>): Promise<TaskboardCard | undefined>;
  deleteTaskboardCard(id: number): Promise<void>;
}

// ── Column name mapping (snake_case DB → camelCase app) ───────────────────
function mapUser(r: any): User {
  return {
    id: r.id, name: r.name,
    baselineCompleted: r.baseline_completed ?? 0,
    currentMode: r.current_mode ?? "standard",
    totalSessionsCompleted: r.total_sessions_completed ?? 0,
    totalMinutesTrained: r.total_minutes_trained ?? 0,
    createdAt: r.created_at ?? Date.now(),
  };
}
function mapDomainScore(r: any): DomainScore {
  return {
    id: r.id, userId: r.user_id, domain: r.domain, score: r.score,
    totalTrials: r.total_trials ?? 0,
    avgAccuracy: r.avg_accuracy ?? 0,
    avgResponseTime: r.avg_response_time ?? 0,
    avgConfidence: r.avg_confidence ?? 0,
    updatedAt: r.updated_at ?? Date.now(),
  };
}
function mapTrial(r: any): Trial {
  return {
    id: r.id, userId: r.user_id, domain: r.domain, activityId: r.activity_id,
    correct: r.correct, responseTimeMs: r.response_time_ms ?? 0,
    confidence: r.confidence ?? 50, difficulty: r.difficulty ?? 1,
    errorType: r.error_type ?? null, notes: r.notes ?? null,
    createdAt: r.created_at ?? Date.now(),
  };
}
function mapSession(r: any): Session {
  return {
    id: r.id, userId: r.user_id, sessionType: r.session_type ?? "standard",
    durationMinutes: r.duration_minutes ?? 0,
    trialsCompleted: r.trials_completed ?? 0,
    avgAccuracy: r.avg_accuracy ?? 0,
    avgConfidence: r.avg_confidence ?? 0,
    metacogReflection: r.metacog_reflection ?? null,
    completedAt: r.completed_at ?? Date.now(),
  };
}
function mapRecallItem(r: any): RecallItem {
  return {
    id: r.id, userId: r.user_id, front: r.front, back: r.back,
    tags: r.tags ?? "[]", category: r.category ?? "general",
    nextReviewAt: r.next_review_at ?? Date.now(),
    intervalDays: r.interval_days ?? 1,
    easeFactor: r.ease_factor ?? 2.5,
    repetitions: r.repetitions ?? 0,
    lastReviewedAt: r.last_reviewed_at ?? null,
    createdAt: r.created_at ?? Date.now(),
  };
}
function mapCalibration(r: any): CalibrationHistory {
  return {
    id: r.id, userId: r.user_id, domain: r.domain,
    confidenceBucket: r.confidence_bucket,
    correctCount: r.correct_count ?? 0,
    totalCount: r.total_count ?? 0,
    updatedAt: r.updated_at ?? Date.now(),
  };
}
function mapNote(r: any): Note {
  return {
    id: r.id, userId: r.user_id, title: r.title ?? "Untitled",
    content: r.content ?? "", tags: r.tags ?? "[]",
    pinned: r.pinned ?? 0,
    createdAt: r.created_at ?? Date.now(),
    updatedAt: r.updated_at ?? Date.now(),
  };
}
function mapMemoryItem(r: any): MemoryItem {
  return {
    id: r.id, userId: r.user_id, type: r.type ?? "reflection",
    content: r.content, source: r.source ?? "manual",
    confidence: r.confidence ?? 50, importance: r.importance ?? 50,
    createdAt: r.created_at ?? Date.now(),
    updatedAt: r.updated_at ?? Date.now(),
  };
}
function mapTaskboardCard(r: any): TaskboardCard {
  return {
    id: r.id, userId: r.user_id, content: r.content ?? "",
    color: r.color ?? "gold", posX: r.pos_x ?? 100, posY: r.pos_y ?? 100,
    pinned: r.pinned ?? 0, width: r.width ?? 200,
    createdAt: r.created_at ?? Date.now(),
    updatedAt: r.updated_at ?? Date.now(),
  };
}

// ── SupabaseStorage ───────────────────────────────────────────────────────
class SupabaseStorage implements IStorage {
  private sb: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY!;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY/ANON_KEY are required");
    this.sb = createClient(url, key, { auth: { persistSession: false } });
  }

  // ── Users ───────────────────────────────────────────────────────────
  async getUser(id: number): Promise<User | undefined> {
    const { data } = await this.sb.from("users").select("*").eq("id", id).single();
    return data ? mapUser(data) : undefined;
  }

  async getDefaultUser(): Promise<User> {
    const { data } = await this.sb.from("users").select("*").order("id").limit(1).single();
    if (data) return mapUser(data);
    // Create default
    const { data: created } = await this.sb.from("users")
      .insert({ name: "Trainee", created_at: Date.now() }).select().single();
    const user = mapUser(created);
    const domains = ["recall","working_memory","focus","flexibility","problem_solving","creativity","intuition","metacognition"];
    await this.sb.from("domain_scores").insert(
      domains.map(d => ({ user_id: user.id, domain: d, score: 50, updated_at: Date.now() }))
    );
    return user;
  }

  async createUser(data: InsertUser): Promise<User> {
    const { data: r } = await this.sb.from("users").insert({
      name: data.name ?? "Trainee",
      baseline_completed: data.baselineCompleted ?? 0,
      current_mode: data.currentMode ?? "standard",
      total_sessions_completed: data.totalSessionsCompleted ?? 0,
      total_minutes_trained: data.totalMinutesTrained ?? 0,
      created_at: Date.now(),
    }).select().single();
    return mapUser(r);
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined> {
    const patch: any = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.baselineCompleted !== undefined) patch.baseline_completed = data.baselineCompleted;
    if (data.currentMode !== undefined) patch.current_mode = data.currentMode;
    if (data.totalSessionsCompleted !== undefined) patch.total_sessions_completed = data.totalSessionsCompleted;
    if (data.totalMinutesTrained !== undefined) patch.total_minutes_trained = data.totalMinutesTrained;
    const { data: r } = await this.sb.from("users").update(patch).eq("id", id).select().single();
    return r ? mapUser(r) : undefined;
  }

  // ── Domain Scores ───────────────────────────────────────────────────
  async getDomainScores(userId: number): Promise<DomainScore[]> {
    const { data } = await this.sb.from("domain_scores").select("*").eq("user_id", userId);
    return (data ?? []).map(mapDomainScore);
  }

  async getDomainScore(userId: number, domain: string): Promise<DomainScore | undefined> {
    const { data } = await this.sb.from("domain_scores").select("*")
      .eq("user_id", userId).eq("domain", domain).single();
    return data ? mapDomainScore(data) : undefined;
  }

  async upsertDomainScore(data: InsertDomainScore): Promise<DomainScore> {
    const existing = await this.getDomainScore(data.userId, data.domain);
    if (existing) {
      const { data: r } = await this.sb.from("domain_scores").update({
        score: data.score, total_trials: data.totalTrials,
        avg_accuracy: data.avgAccuracy, avg_response_time: data.avgResponseTime,
        avg_confidence: data.avgConfidence, updated_at: Date.now(),
      }).eq("id", existing.id).select().single();
      return mapDomainScore(r);
    }
    const { data: r } = await this.sb.from("domain_scores").insert({
      user_id: data.userId, domain: data.domain, score: data.score,
      total_trials: data.totalTrials ?? 0, avg_accuracy: data.avgAccuracy ?? 0,
      avg_response_time: data.avgResponseTime ?? 0, avg_confidence: data.avgConfidence ?? 0,
      updated_at: Date.now(),
    }).select().single();
    return mapDomainScore(r);
  }

  // ── Trials ──────────────────────────────────────────────────────────
  async createTrial(data: InsertTrial): Promise<Trial> {
    const { data: r } = await this.sb.from("trials").insert({
      user_id: data.userId, domain: data.domain, activity_id: data.activityId,
      correct: data.correct, response_time_ms: data.responseTimeMs ?? 0,
      confidence: data.confidence ?? 50, difficulty: data.difficulty ?? 1,
      error_type: data.errorType ?? null, notes: data.notes ?? null,
      created_at: Date.now(),
    }).select().single();
    return mapTrial(r);
  }

  async getRecentTrials(userId: number, limit = 50): Promise<Trial[]> {
    const { data } = await this.sb.from("trials").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
    return (data ?? []).map(mapTrial);
  }

  async getTrialsByDomain(userId: number, domain: string, limit = 20): Promise<Trial[]> {
    const { data } = await this.sb.from("trials").select("*")
      .eq("user_id", userId).eq("domain", domain)
      .order("created_at", { ascending: false }).limit(limit);
    return (data ?? []).map(mapTrial);
  }

  // ── Sessions ────────────────────────────────────────────────────────
  async createSession(data: InsertSession): Promise<Session> {
    const { data: r } = await this.sb.from("sessions").insert({
      user_id: data.userId, session_type: data.sessionType ?? "standard",
      duration_minutes: data.durationMinutes ?? 0,
      trials_completed: data.trialsCompleted ?? 0,
      avg_accuracy: data.avgAccuracy ?? 0, avg_confidence: data.avgConfidence ?? 0,
      metacog_reflection: data.metacogReflection ?? null,
      completed_at: Date.now(),
    }).select().single();
    return mapSession(r);
  }

  async getRecentSessions(userId: number, limit = 10): Promise<Session[]> {
    const { data } = await this.sb.from("sessions").select("*")
      .eq("user_id", userId).order("completed_at", { ascending: false }).limit(limit);
    return (data ?? []).map(mapSession);
  }

  // ── Recall Items ────────────────────────────────────────────────────
  async createRecallItem(data: InsertRecallItem): Promise<RecallItem> {
    const { data: r } = await this.sb.from("recall_items").insert({
      user_id: data.userId, front: data.front, back: data.back,
      tags: data.tags ?? "[]", category: data.category ?? "general",
      next_review_at: data.nextReviewAt ?? Date.now(),
      interval_days: data.intervalDays ?? 1, ease_factor: data.easeFactor ?? 2.5,
      repetitions: data.repetitions ?? 0,
      last_reviewed_at: data.lastReviewedAt ?? null,
      created_at: Date.now(),
    }).select().single();
    return mapRecallItem(r);
  }

  async getRecallItems(userId: number): Promise<RecallItem[]> {
    const { data } = await this.sb.from("recall_items").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    return (data ?? []).map(mapRecallItem);
  }

  async getDueRecallItems(userId: number): Promise<RecallItem[]> {
    const { data } = await this.sb.from("recall_items").select("*")
      .eq("user_id", userId).lte("next_review_at", Date.now());
    return (data ?? []).map(mapRecallItem);
  }

  async updateRecallItem(id: number, data: Partial<InsertRecallItem>): Promise<RecallItem | undefined> {
    const patch: any = {};
    if (data.front !== undefined) patch.front = data.front;
    if (data.back !== undefined) patch.back = data.back;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.category !== undefined) patch.category = data.category;
    if (data.nextReviewAt !== undefined) patch.next_review_at = data.nextReviewAt;
    if (data.intervalDays !== undefined) patch.interval_days = data.intervalDays;
    if (data.easeFactor !== undefined) patch.ease_factor = data.easeFactor;
    if (data.repetitions !== undefined) patch.repetitions = data.repetitions;
    if (data.lastReviewedAt !== undefined) patch.last_reviewed_at = data.lastReviewedAt;
    const { data: r } = await this.sb.from("recall_items").update(patch).eq("id", id).select().single();
    return r ? mapRecallItem(r) : undefined;
  }

  async deleteRecallItem(id: number): Promise<void> {
    await this.sb.from("recall_items").delete().eq("id", id);
  }

  // ── Calibration ─────────────────────────────────────────────────────
  async getCalibrationData(userId: number): Promise<CalibrationHistory[]> {
    const { data } = await this.sb.from("calibration_history").select("*").eq("user_id", userId);
    return (data ?? []).map(mapCalibration);
  }

  async upsertCalibration(data: InsertCalibration): Promise<CalibrationHistory> {
    const { data: existing } = await this.sb.from("calibration_history").select("*")
      .eq("user_id", data.userId).eq("domain", data.domain)
      .eq("confidence_bucket", data.confidenceBucket).single();
    if (existing) {
      const { data: r } = await this.sb.from("calibration_history").update({
        correct_count: data.correctCount, total_count: data.totalCount, updated_at: Date.now(),
      }).eq("id", existing.id).select().single();
      return mapCalibration(r);
    }
    const { data: r } = await this.sb.from("calibration_history").insert({
      user_id: data.userId, domain: data.domain,
      confidence_bucket: data.confidenceBucket,
      correct_count: data.correctCount ?? 0, total_count: data.totalCount ?? 0,
      updated_at: Date.now(),
    }).select().single();
    return mapCalibration(r);
  }

  // ── Notes ───────────────────────────────────────────────────────────
  async getNotes(userId: number): Promise<Note[]> {
    const { data } = await this.sb.from("notes").select("*")
      .eq("user_id", userId).order("updated_at", { ascending: false });
    return (data ?? []).map(mapNote);
  }

  async getNote(id: number): Promise<Note | undefined> {
    const { data } = await this.sb.from("notes").select("*").eq("id", id).single();
    return data ? mapNote(data) : undefined;
  }

  async createNote(data: InsertNote): Promise<Note> {
    const now = Date.now();
    const { data: r } = await this.sb.from("notes").insert({
      user_id: data.userId, title: data.title ?? "Untitled",
      content: data.content ?? "", tags: data.tags ?? "[]",
      pinned: data.pinned ?? 0, created_at: now, updated_at: now,
    }).select().single();
    return mapNote(r);
  }

  async updateNote(id: number, data: Partial<InsertNote>): Promise<Note | undefined> {
    const patch: any = { updated_at: Date.now() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.content !== undefined) patch.content = data.content;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    const { data: r } = await this.sb.from("notes").update(patch).eq("id", id).select().single();
    return r ? mapNote(r) : undefined;
  }

  async deleteNote(id: number): Promise<void> {
    await this.sb.from("notes").delete().eq("id", id);
  }

  // ── App Config ──────────────────────────────────────────────────────
  async getConfig(key: string): Promise<string | undefined> {
    const { data } = await this.sb.from("app_config").select("value").eq("key", key).single();
    return data?.value;
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.sb.from("app_config").upsert({ key, value }, { onConflict: "key" });
  }

  async getActiveProfileId(): Promise<number> {
    const val = await this.getConfig("active_profile_id");
    if (val) {
      const id = parseInt(val, 10);
      if (!isNaN(id)) return id;
    }
    const user = await this.getDefaultUser();
    await this.setConfig("active_profile_id", String(user.id));
    return user.id;
  }

  async setActiveProfileId(id: number): Promise<void> {
    await this.setConfig("active_profile_id", String(id));
  }

  // ── Profiles ────────────────────────────────────────────────────────
  async getAllProfiles(): Promise<User[]> {
    const { data } = await this.sb.from("users").select("*").order("id");
    return (data ?? []).map(mapUser);
  }

  async createProfile(name: string): Promise<User> {
    const { data: r } = await this.sb.from("users")
      .insert({ name, created_at: Date.now() }).select().single();
    const user = mapUser(r);
    const domains = ["recall","working_memory","focus","flexibility","problem_solving","creativity","intuition","metacognition"];
    await this.sb.from("domain_scores").insert(
      domains.map(d => ({ user_id: user.id, domain: d, score: 50, updated_at: Date.now() }))
    );
    return user;
  }

  async deleteProfile(id: number): Promise<void> {
    // Cascade is handled by FK ON DELETE CASCADE in the schema
    await this.sb.from("users").delete().eq("id", id);
  }

  async getProfileStats(id: number): Promise<{ sessionsCompleted: number; minutesTrained: number }> {
    const { data } = await this.sb.from("sessions").select("duration_minutes").eq("user_id", id);
    const sessionsCompleted = data?.length ?? 0;
    const minutesTrained = data?.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0) ?? 0;
    return { sessionsCompleted, minutesTrained };
  }

  // ── Memory Items ────────────────────────────────────────────────────
  async getMemoryItems(userId: number): Promise<MemoryItem[]> {
    const { data } = await this.sb.from("memory_items").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    return (data ?? []).map(mapMemoryItem);
  }

  async createMemoryItem(data: InsertMemoryItem): Promise<MemoryItem> {
    const now = Date.now();
    const { data: r } = await this.sb.from("memory_items").insert({
      user_id: data.userId, type: data.type ?? "reflection",
      content: data.content, source: data.source ?? "manual",
      confidence: data.confidence ?? 50, importance: data.importance ?? 50,
      created_at: now, updated_at: now,
    }).select().single();
    return mapMemoryItem(r);
  }

  async updateMemoryItem(id: number, data: Partial<InsertMemoryItem>): Promise<MemoryItem | undefined> {
    const patch: any = { updated_at: Date.now() };
    if (data.type !== undefined) patch.type = data.type;
    if (data.content !== undefined) patch.content = data.content;
    if (data.source !== undefined) patch.source = data.source;
    if (data.confidence !== undefined) patch.confidence = data.confidence;
    if (data.importance !== undefined) patch.importance = data.importance;
    const { data: r } = await this.sb.from("memory_items").update(patch).eq("id", id).select().single();
    return r ? mapMemoryItem(r) : undefined;
  }

  async deleteMemoryItem(id: number): Promise<void> {
    await this.sb.from("memory_items").delete().eq("id", id);
  }

  // ── Taskboard Cards ─────────────────────────────────────────────────
  async getTaskboardCards(userId: number): Promise<TaskboardCard[]> {
    const { data } = await this.sb.from("taskboard_cards").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    return (data ?? []).map(mapTaskboardCard);
  }

  async createTaskboardCard(data: InsertTaskboardCard): Promise<TaskboardCard> {
    const now = Date.now();
    const { data: r } = await this.sb.from("taskboard_cards").insert({
      user_id: data.userId, content: data.content ?? "",
      color: data.color ?? "gold", pos_x: data.posX ?? 100,
      pos_y: data.posY ?? 100, pinned: data.pinned ?? 0,
      width: data.width ?? 200, created_at: now, updated_at: now,
    }).select().single();
    return mapTaskboardCard(r);
  }

  async updateTaskboardCard(id: number, data: Partial<InsertTaskboardCard>): Promise<TaskboardCard | undefined> {
    const patch: any = { updated_at: Date.now() };
    if (data.content !== undefined) patch.content = data.content;
    if (data.color !== undefined) patch.color = data.color;
    if (data.posX !== undefined) patch.pos_x = data.posX;
    if (data.posY !== undefined) patch.pos_y = data.posY;
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    if (data.width !== undefined) patch.width = data.width;
    const { data: r } = await this.sb.from("taskboard_cards").update(patch).eq("id", id).select().single();
    return r ? mapTaskboardCard(r) : undefined;
  }

  async deleteTaskboardCard(id: number): Promise<void> {
    await this.sb.from("taskboard_cards").delete().eq("id", id);
  }
}

export const storage = new SupabaseStorage();
