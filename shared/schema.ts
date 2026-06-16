import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User profile / cognitive baseline
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default("Trainee"),
  baselineCompleted: integer("baseline_completed", { mode: "boolean" }).default(false),
  currentMode: text("current_mode").default("standard"), // standard | nursing | leadership | creative
  totalSessionsCompleted: integer("total_sessions_completed").default(0),
  totalMinutesTrained: integer("total_minutes_trained").default(0),
  createdAt: integer("created_at").default(Date.now()),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Domain scores tracking each cognitive domain
export const domainScores = sqliteTable("domain_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  domain: text("domain").notNull(), // recall | working_memory | focus | flexibility | problem_solving | creativity | intuition | metacognition
  score: real("score").notNull().default(50),
  totalTrials: integer("total_trials").default(0),
  avgAccuracy: real("avg_accuracy").default(0),
  avgResponseTime: real("avg_response_time").default(0),
  avgConfidence: real("avg_confidence").default(0),
  updatedAt: integer("updated_at").default(Date.now()),
});

export const insertDomainScoreSchema = createInsertSchema(domainScores).omit({ id: true });
export type InsertDomainScore = z.infer<typeof insertDomainScoreSchema>;
export type DomainScore = typeof domainScores.$inferSelect;

// Individual trial results
export const trials = sqliteTable("trials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  domain: text("domain").notNull(),
  activityId: text("activity_id").notNull(),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  responseTimeMs: integer("response_time_ms").default(0),
  confidence: integer("confidence").default(50), // 0-100
  difficulty: integer("difficulty").default(1), // 1-5
  errorType: text("error_type"), // rushing | overthinking | forgetting | distraction | poor_encoding | poor_retrieval
  notes: text("notes"),
  createdAt: integer("created_at").default(Date.now()),
});

export const insertTrialSchema = createInsertSchema(trials).omit({ id: true, createdAt: true });
export type InsertTrial = z.infer<typeof insertTrialSchema>;
export type Trial = typeof trials.$inferSelect;

// Sessions
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  sessionType: text("session_type").notNull().default("standard"), // quick | standard | deep | study | leadership | nursing | creative
  durationMinutes: integer("duration_minutes").default(0),
  trialsCompleted: integer("trials_completed").default(0),
  avgAccuracy: real("avg_accuracy").default(0),
  avgConfidence: real("avg_confidence").default(0),
  metacogReflection: text("metacog_reflection"), // user's written reflection
  completedAt: integer("completed_at").default(Date.now()),
});

export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true, completedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

// Spaced recall items (Memory Vault)
export const recallItems = sqliteTable("recall_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  front: text("front").notNull(),
  back: text("back").notNull(),
  tags: text("tags").default("[]"), // JSON array
  category: text("category").default("general"),
  nextReviewAt: integer("next_review_at").default(Date.now()),
  intervalDays: real("interval_days").default(1),
  easeFactor: real("ease_factor").default(2.5),
  repetitions: integer("repetitions").default(0),
  lastReviewedAt: integer("last_reviewed_at"),
  createdAt: integer("created_at").default(Date.now()),
});

export const insertRecallItemSchema = createInsertSchema(recallItems).omit({ id: true, createdAt: true });
export type InsertRecallItem = z.infer<typeof insertRecallItemSchema>;
export type RecallItem = typeof recallItems.$inferSelect;

// Calibration history (confidence vs accuracy)
export const calibrationHistory = sqliteTable("calibration_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  domain: text("domain").notNull(),
  confidenceBucket: integer("confidence_bucket").notNull(), // 10, 20, 30... 100
  correctCount: integer("correct_count").default(0),
  totalCount: integer("total_count").default(0),
  updatedAt: integer("updated_at").default(Date.now()),
});

export const insertCalibrationSchema = createInsertSchema(calibrationHistory).omit({ id: true, updatedAt: true });
export type InsertCalibration = z.infer<typeof insertCalibrationSchema>;
export type CalibrationHistory = typeof calibrationHistory.$inferSelect;

// Philosophy Chambers — notes
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  title: text("title").notNull().default("Untitled"),
  content: text("content").notNull().default(""),
  tags: text("tags").default("[]"), // JSON array of strings
  pinned: integer("pinned", { mode: "boolean" }).default(false),
  createdAt: integer("created_at").default(Date.now()),
  updatedAt: integer("updated_at").default(Date.now()),
});

export const insertNoteSchema = createInsertSchema(notes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notes.$inferSelect;

// App config — key/value store (e.g. active_profile_id)
export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const insertAppConfigSchema = createInsertSchema(appConfig).omit({ id: true });
export type InsertAppConfig = z.infer<typeof insertAppConfigSchema>;
export type AppConfig = typeof appConfig.$inferSelect;

// Memory items — local profile-specific cognitive memory
export const memoryItems = sqliteTable("memory_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  type: text("type").notNull().default("reflection"), // reflection|pattern|strength|weakness|goal|insight|preference
  content: text("content").notNull(),
  source: text("source").default("manual"), // manual|auto|import
  confidence: integer("confidence").default(50), // 0-100
  importance: integer("importance").default(50), // 0-100
  createdAt: integer("created_at").default(Date.now()),
  updatedAt: integer("updated_at").default(Date.now()),
});

export const insertMemoryItemSchema = createInsertSchema(memoryItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMemoryItem = z.infer<typeof insertMemoryItemSchema>;
export type MemoryItem = typeof memoryItems.$inferSelect;
