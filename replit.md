# DeepFaceLive

Real-time face-swap web app where users appear as a different digital avatar during live streaming, powered by MediaPipe face tracking and Three.js avatar rendering.

## Run & Operate

- `PORT=26185 BASE_PATH=/ pnpm --filter @workspace/virtual-human run dev` — run the frontend (port 26185)
- `PORT=8080 pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
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
- `lib/db/src/schema/` — Drizzle DB schema (avatars, avatar_config tables)
- `backend/main.py` — Python FastAPI backend (optional GPU face-swap features)

## Architecture decisions

- Contract-first API: OpenAPI spec drives both server validation (Zod) and client hooks (React Query) via Orval codegen
- Date serialization: All Drizzle query results go through `JSON.parse(JSON.stringify(...))` before Zod parsing to handle Date → string conversion
- Workflows require explicit PORT env vars: `PORT=26185 BASE_PATH=/` for frontend, `PORT=8080` for API
- Dark mode enforced at app level via `document.documentElement.classList.add('dark')`
- MediaPipe runs in the browser for real-time face tracking — no GPU server needed for basic operation

## Product

- **Studio**: Real-time webcam + 3D holographic avatar overlay using MediaPipe face tracking
- **Avatars**: Manage avatar profiles (name, skin tone, hair color, eye color); activate/deactivate
- **Settings**: Configure render quality, lip sync, voice modulation, smoothing, background effects
- **OBS Guide**: Instructions for streaming integration

## User preferences

- Project imported from ZIP archive (Deepfacelive-main)

## Gotchas

- MediaPipe packages must be installed in `artifacts/virtual-human` (not root)
- Both PORT and BASE_PATH env vars required for frontend dev server
- API server requires PORT env var to start
- `pnpm --filter @workspace/db run push` must be run after schema changes

## Pointers

- OpenAPI spec: `lib/api-spec/openapi.yaml`
- DB schema: `lib/db/src/schema/`
- Routes: `artifacts/api-server/src/routes/`
