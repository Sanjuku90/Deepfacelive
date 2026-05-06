import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const avatarsTable = pgTable("avatars", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  thumbnailUrl: text("thumbnail_url"),
  isActive: boolean("is_active").notNull().default(false),
  skinTone: text("skin_tone").notNull().default("medium"),
  hairColor: text("hair_color").notNull().default("black"),
  eyeColor: text("eye_color").notNull().default("brown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAvatarSchema = createInsertSchema(avatarsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAvatar = z.infer<typeof insertAvatarSchema>;
export type Avatar = typeof avatarsTable.$inferSelect;
