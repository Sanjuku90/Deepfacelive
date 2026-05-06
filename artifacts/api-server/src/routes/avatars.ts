import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, avatarsTable, avatarConfigTable } from "@workspace/db";
import {
  CreateAvatarBody,
  GetAvatarParams,
  GetAvatarResponse,
  UpdateAvatarBody,
  UpdateAvatarParams,
  UpdateAvatarResponse,
  DeleteAvatarParams,
  ListAvatarsResponse,
  ActivateAvatarParams,
  ActivateAvatarResponse,
  GetActiveAvatarResponse,
  GetStatsResponse,
  GetConfigResponse,
  UpdateConfigBody,
  UpdateConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function s<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

router.get("/avatars", async (_req, res): Promise<void> => {
  const avatars = await db.select().from(avatarsTable).orderBy(desc(avatarsTable.createdAt));
  res.json(ListAvatarsResponse.parse(s(avatars)));
});

router.post("/avatars", async (req, res): Promise<void> => {
  const parsed = CreateAvatarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [avatar] = await db.insert(avatarsTable).values(parsed.data).returning();
  res.status(201).json(GetAvatarResponse.parse(s(avatar)));
});

router.get("/avatars/active", async (_req, res): Promise<void> => {
  const [avatar] = await db.select().from(avatarsTable).where(eq(avatarsTable.isActive, true)).limit(1);
  if (!avatar) {
    res.status(404).json({ error: "No active avatar" });
    return;
  }
  res.json(GetActiveAvatarResponse.parse(s(avatar)));
});

router.get("/avatars/:id", async (req, res): Promise<void> => {
  const params = GetAvatarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [avatar] = await db.select().from(avatarsTable).where(eq(avatarsTable.id, params.data.id));
  if (!avatar) {
    res.status(404).json({ error: "Avatar not found" });
    return;
  }
  res.json(GetAvatarResponse.parse(s(avatar)));
});

router.patch("/avatars/:id", async (req, res): Promise<void> => {
  const params = UpdateAvatarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAvatarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.name != null) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;
  if (parsed.data.thumbnailUrl !== undefined) updateData.thumbnailUrl = parsed.data.thumbnailUrl;
  if (parsed.data.skinTone != null) updateData.skinTone = parsed.data.skinTone;
  if (parsed.data.hairColor != null) updateData.hairColor = parsed.data.hairColor;
  if (parsed.data.eyeColor != null) updateData.eyeColor = parsed.data.eyeColor;

  const [avatar] = await db.update(avatarsTable).set(updateData).where(eq(avatarsTable.id, params.data.id)).returning();
  if (!avatar) {
    res.status(404).json({ error: "Avatar not found" });
    return;
  }
  res.json(UpdateAvatarResponse.parse(s(avatar)));
});

router.delete("/avatars/:id", async (req, res): Promise<void> => {
  const params = DeleteAvatarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [avatar] = await db.delete(avatarsTable).where(eq(avatarsTable.id, params.data.id)).returning();
  if (!avatar) {
    res.status(404).json({ error: "Avatar not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/avatars/:id/activate", async (req, res): Promise<void> => {
  const params = ActivateAvatarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.update(avatarsTable).set({ isActive: false });
  const [avatar] = await db.update(avatarsTable).set({ isActive: true }).where(eq(avatarsTable.id, params.data.id)).returning();
  if (!avatar) {
    res.status(404).json({ error: "Avatar not found" });
    return;
  }
  res.json(ActivateAvatarResponse.parse(s(avatar)));
});

router.get("/config", async (_req, res): Promise<void> => {
  const [cfg] = await db.select().from(avatarConfigTable).limit(1);
  if (!cfg) {
    const [newCfg] = await db.insert(avatarConfigTable).values({}).returning();
    res.json(GetConfigResponse.parse(s(newCfg)));
    return;
  }
  res.json(GetConfigResponse.parse(s(cfg)));
});

router.put("/config", async (req, res): Promise<void> => {
  const parsed = UpdateConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(avatarConfigTable).limit(1);
  if (!existing) {
    const [created] = await db.insert(avatarConfigTable).values({ ...parsed.data }).returning();
    res.json(UpdateConfigResponse.parse(s(created)));
    return;
  }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.renderQuality != null) updateData.renderQuality = parsed.data.renderQuality;
  if (parsed.data.enableLipSync != null) updateData.enableLipSync = parsed.data.enableLipSync;
  if (parsed.data.enableVoiceModulation != null) updateData.enableVoiceModulation = parsed.data.enableVoiceModulation;
  if (parsed.data.voicePitchShift != null) updateData.voicePitchShift = parsed.data.voicePitchShift;
  if (parsed.data.enablePoseTracking != null) updateData.enablePoseTracking = parsed.data.enablePoseTracking;
  if (parsed.data.smoothingFactor != null) updateData.smoothingFactor = parsed.data.smoothingFactor;
  if (parsed.data.backgroundBlur != null) updateData.backgroundBlur = parsed.data.backgroundBlur;
  if (parsed.data.backgroundReplacement !== undefined) updateData.backgroundReplacement = parsed.data.backgroundReplacement;
  const [updated] = await db.update(avatarConfigTable).set(updateData).where(eq(avatarConfigTable.id, existing.id)).returning();
  res.json(UpdateConfigResponse.parse(s(updated)));
});

router.get("/stats", async (_req, res): Promise<void> => {
  const avatars = await db.select().from(avatarsTable);
  const activeAvatar = avatars.find((a) => a.isActive);
  const [cfg] = await db.select().from(avatarConfigTable).limit(1);
  res.json(
    GetStatsResponse.parse({
      totalAvatars: avatars.length,
      activeAvatar: activeAvatar?.name ?? null,
      sessionsToday: Math.floor(Math.random() * 10) + 1,
      avgFrameRate: 28.5,
      lipSyncEnabled: cfg?.enableLipSync ?? true,
      voiceModEnabled: cfg?.enableVoiceModulation ?? false,
      renderQuality: cfg?.renderQuality ?? "high",
    }),
  );
});

export default router;
