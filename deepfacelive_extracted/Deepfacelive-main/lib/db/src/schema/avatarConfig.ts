import { pgTable, serial, boolean, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const avatarConfigTable = pgTable("avatar_config", {
  id: serial("id").primaryKey(),
  renderQuality: text("render_quality").notNull().default("high"),
  enableLipSync: boolean("enable_lip_sync").notNull().default(true),
  enableVoiceModulation: boolean("enable_voice_modulation").notNull().default(false),
  voicePitchShift: real("voice_pitch_shift").notNull().default(0),
  enablePoseTracking: boolean("enable_pose_tracking").notNull().default(true),
  smoothingFactor: real("smoothing_factor").notNull().default(0.5),
  backgroundBlur: boolean("background_blur").notNull().default(false),
  backgroundReplacement: text("background_replacement"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAvatarConfigSchema = createInsertSchema(avatarConfigTable).omit({ id: true, updatedAt: true });
export type InsertAvatarConfig = z.infer<typeof insertAvatarConfigSchema>;
export type AvatarConfig = typeof avatarConfigTable.$inferSelect;
