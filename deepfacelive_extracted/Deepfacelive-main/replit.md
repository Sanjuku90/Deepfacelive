# DeepFaceLive

Real-time face-swap web app where users appear as a different digital avatar during live streaming, powered by MediaPipe face tracking and Three.js avatar rendering.

## Run & Operate

- `pnpm --filter @workspace/virtual-human run dev` — run the frontend (port from `PORT` env)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind v4, shadcn/ui components, Wouter routing
- 3D: Three.js, @react-three/fiber, @react-three/drei
- Face tracking: @mediapipe/face_mesh, @mediapipe/camera_utils
- Audio: Web Audio API (lip sync via AnalyserNode)
- API: Express 5 (port 8080, path `/api`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle for API server)

## Where things live

- `artifacts/virtual-human/` — React+Vite frontend
- `artifacts/api-server/` — Express API server
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/api-zod/src/generated/` — generated Zod schemas (do not edit)
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/db/src/schema.ts` — Drizzle DB schema (avatars, avatar_config tables)
- `backend/main.py` — Python FastAPI backend (optional GPU face-swap features)

## Architecture decisions

- Contract-first API: OpenAPI spec drives both server validation (Zod) and client hooks (React Query) via Orval codegen
- Date serialization: All Drizzle query results go through `JSON.parse(JSON.stringify(...))` before Zod parsing to convert `Date` objects to ISO strings
- Dark mode: `class="dark"` set directly on `<html>` in `index.html` (no flash), Tailwind `@custom-variant dark (&:is(.dark *))` for utility classes
- SVG `bg-image` in `@apply` causes Tailwind parse errors — use plain `background-image:` CSS instead
- MediaPipe face mesh runs client-side; head pose estimation drives Three.js avatar rotation in real time

## Product

- **Studio**: live camera feed with MediaPipe face mesh overlay, Three.js geometric avatar that mirrors head pose, Web Audio lip sync, streaming controls
- **Avatars**: browse and activate preset avatars (Aria Nova, Marcus Veil, Zhen Liang) from DB
- **Settings**: configure render quality, lip sync, voice modulation, pose tracking, background blur
- **OBS Guide**: step-by-step instructions for streaming via OBS virtual camera

## User preferences

_Populate as you build._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- Do not use `bg-[url(...)]` inside `@apply` in Tailwind v4 — Tailwind misparses SVG data URLs as class names
- Drizzle returns `Date` objects; wrap with `JSON.parse(JSON.stringify(...))` before Zod `.parse()`
- `pnpm run dev` at workspace root has no script — use workflow restart or per-package filter commands

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- `backend/README.md` — Python FastAPI GPU backend setup
