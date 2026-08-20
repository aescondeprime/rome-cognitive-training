# ROME — working notes for Claude

ROME is a cognitive training lab, mental calculator, and project HUB, with a
voice assistant (Akira) built in. React frontend, Express API, Electron desktop
shell, Supabase Postgres behind it.

Read this before changing anything. Most of it is the stuff that is not
guessable from the file tree, and the first two sections are where the real
traps are.

---

## The API exists twice — and the copies drift

There are **two independent implementations of the same HTTP API**:

| File | Runs where | Notes |
|---|---|---|
| `server/routes.ts` + `server/workspace-routes.ts` | Express, desktop + `npm run dev` | `workspace-routes.ts` is registered from `routes.ts:119` |
| `api/index.ts` | Vercel serverless (web deploy) | ~1,600 lines, deliberately self-contained — no imports from `server/*`, no path aliases |

**Adding an endpoint to one does not add it to the other.** This has already
caused a real bug: `/api/threats` existed only in `api/index.ts`, so the feature
worked on the web and silently did not exist in the desktop app.

When you touch routes, state explicitly which target you changed and whether
the other needs the same change. Do not "refactor to share code" between them
without asking — `api/index.ts` is standalone on purpose, because Vercel's
bundler and the path aliases do not get along.

### The two Express route files disagree on casing

- `server/routes.ts` speaks **camelCase** (`userId`, `createdAt`)
- `server/workspace-routes.ts` speaks **snake_case** (`user_id`, `created_at`)
  and its `PATCH`/`DELETE` handlers return only `{ ok: true }` — not the
  updated row

Match the file you are in. Do not normalise one to the other; clients on both
sides depend on the current shapes.

## Data lives in Supabase, not SQLite

`server/storage.ts` is a Supabase client. Requires `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` (or `SUPABASE_ANON_KEY`) or the server refuses to start.

Two things in the repo say otherwise and are **stale**:

- `VAULT.md` describes a local `rome.db` SQLite file. Historical.
- `shared/schema.ts` is a drizzle SQLite schema, and `drizzle.config.ts` /
  `npm run db:push` go with it. Vestigial — the type shapes in `storage.ts`
  mirror it by hand, which is why the comment there says "mirrors SQLite schema
  exactly". Changing the drizzle schema changes nothing at runtime.

`better-sqlite3` is still a dependency and still gets rebuilt against Electron
on every desktop build. It is not the app's database.

## Environment

`.env` at the repo root, gitignored. Electron's `loadEnvFile()` looks in the
app data dir, then `resourcesPath`, then `process.cwd()` — so in dev mode the
copy at the repo root is the one that matters. A missing `.env` surfaces as
`ROME server stopped before startup completed`, which does not name the cause.

Never commit `.env`, and never put the ElevenLabs API key anywhere but ROME's
own settings (encrypted via Electron `safeStorage`).

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Express + **Vite dev middleware with HMR** on port 5000. Browser only, no Electron. |
| `npm run desktop:dev` | Full production build, then launches Electron. **Not a watch mode** — see below. |
| `npm run desktop:build` | Same build, no launch |
| `npm run test:akira` | Node's test runner over `electron/akira/__tests__/*.test.ts` |
| `npx tsc --noEmit` | Renderer + server typecheck |
| `npx tsc -p electron/tsconfig.json --noEmit` | Electron main typecheck (separate config, `strict: false`) |
| `npm run dist:mac` | Signed DMG via electron-builder |

**`desktop:dev` is a full rebuild every time**: Vite build, server bundle, three
esbuild passes, and a native rebuild of `better-sqlite3`. There is no hot
reload in the Electron path today. For renderer-only work, `npm run dev` in a
browser is far faster and has real HMR.

### Typecheck baseline

`main` carries **10 pre-existing errors**, all unrelated to current work:
`LightRay.tsx`, `NodeBranchMenu.tsx`, `ComponentBoard.tsx`, `Dashboard.tsx`,
`Home.tsx`, `games/CorsiBlocks.tsx`, `server/routes.ts`.

Count before you start and count after. "Typecheck passes" is not the bar;
"the number did not go up" is.

---

## Layout

```
client/src/        React 18, wouter routing, TanStack Query, Tailwind 3, Radix
  pages/           One file per node (Taskboard, IdeaWorkshop, AthenaTrials, …)
  pages/games/     The six Athena Trials drills
  akira/           Mic, wake word, playback, ambience, console
  lib/             constellationLayout, trainingRecorder, shared client state
server/            Express 5 — see the casing warning above
api/index.ts       Vercel serverless twin
electron/          Main process, preload, browser views
  akira/           Controller, ElevenLabs socket, capability registry, policy
shared/            Cross-process contracts (akira.ts) + vestigial schema.ts
script/            Build scripts; build-electron.ts is the desktop pipeline
```

Aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`. The Express server
listens on **5000** and Electron loads `http://127.0.0.1:5000`.

## Akira

The voice assistant has its own docs, and they are current — read them rather
than inferring from the code:

- `AKIRA_ARCHITECTURE.md` — how it works and **why each choice was made**
- `AKIRA_SETUP.md` — ElevenLabs agent config, the `rome_execute` tool, wake word
- `AKIRA_PERFORMANCE.md` — latency budget and the on-device QA list

The short version: one ElevenLabs realtime WebSocket owned by the Electron main
process; capabilities execute through `electron/akira/capability-registry.ts`;
the agent has exactly one client tool (`rome_execute`) and the catalogue of what
it can do rides in a per-conversation system prompt override.

Adding a capability means editing `capability-registry.ts` only — no ElevenLabs
dashboard change. Removing the prompt override, or disabling it in the
dashboard, breaks every capability at once.

Hermes (`runtime-manager.ts`, `hermes-gateway.ts`, `mcp-server.ts`) is **not**
in the live path anymore. It remains for a future background-delegation
feature. Nothing in a normal conversation touches it.

---

## Conventions

- **Comments explain why, not what.** The existing code is written that way;
  match it. A comment restating the line below it is noise.
- **No emoji** anywhere in code, comments, or commit messages.
- Commit messages: imperative subject, then a paragraph on *why*, and on what
  the failure looked like if it was a fix.
- Tests live in `electron/akira/__tests__/`. They are deterministic and use
  fakes, not network. Anything needing real hardware — microphone, wake word
  accuracy, notarised-app entitlements — belongs on the QA list in
  `AKIRA_PERFORMANCE.md`, not in a unit test.
- Prefer editing the file the feature already lives in over adding a new one.

## Verify before claiming

This project has burned real time on changes that typechecked and did not work.
Before saying something is done: run the typecheck for the side you touched,
run `npm run test:akira` if Akira changed, and launch the app if the change is
user-visible. If you could not verify something, say so plainly rather than
implying it was checked.
