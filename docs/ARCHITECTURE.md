# Deal me in — Architecture

Deal me in is an Electron desktop app for running live poker tournaments: a blind-level
timer, table seating with automatic balancing/merging, player and structure management,
prize pools, per-player results history, and a full-screen projector display.

This document describes how the system is put together. For the current list of known
defects and debt, see [ISSUES.md](./ISSUES.md). For contributor conventions and
gotchas, see [CLAUDE.md](../CLAUDE.md).

## Contents

1. [Tech stack](#tech-stack)
2. [Repository layout](#repository-layout)
3. [Process model](#process-model)
4. [Main process](#main-process)
   - [The tournament engine (`tournament.ts`)](#the-tournament-engine-tournamentts)
   - [The database layer (`db.ts`)](#the-database-layer-dbts)
   - [The IPC surface (`main.ts` + `preload.ts`)](#the-ipc-surface-maints--preloadts)
5. [Renderer](#renderer)
6. [Data model](#data-model)
7. [Tournament lifecycle](#tournament-lifecycle)
8. [Settings and i18n](#settings-and-i18n)
9. [Media and assets](#media-and-assets)
10. [Build and packaging](#build-and-packaging)

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Desktop shell | Electron 30 |
| UI | React 18 + React Router 7 (`HashRouter`) |
| Language | TypeScript (two projects: `electron/` and `src/`) |
| Build / dev | Vite 5 + `vite-plugin-electron` (`npm run dev` is the only dev command) |
| Persistence | SQLite via `better-sqlite3` (synchronous, WAL mode) |
| Styling | Tailwind CSS 3 (semantic tokens: `surface`, `ink`, `accent`, `line`, …) |
| Packaging | electron-builder → DMG / NSIS / AppImage |

Unit tests run with **Vitest** (`npm run test`): `tests/tournament.test.ts` covers the
tournament engine (seating, bust/unbust, merge/balance/final-table, standings,
finalize) with `electron` and `electron/db` mocked. `vitest.config.ts` is deliberately
standalone so the electron Vite plugins are not loaded during tests. There is no CI
configured.

## Repository layout

```
electron/            Main process (Node context)
  main.ts            App entry: windows, IPC handlers, media:// protocol
  preload.ts         contextBridge: window.api + window.ipcRenderer
  tournament.ts      TournamentManager singleton — all live tournament logic
  db.ts              SQLite open/schema/migrations + every query
  backup.ts          Full-data backup export/import (.dmibak zip, path rewriting)
src/                 Renderer (React SPA, no Node access)
  App.tsx            HashRouter routes + sidebar shell
  components/        One file per page/panel/modal (see inventory below)
  i18n/              SettingsContext, translations (en/fr), accent palettes
  utils/             format.ts, place.ts, media.ts, SoundCuePlayer.tsx
  types.d.ts         Renderer-side types + window.api typings (duplicates
                     the shapes in electron/tournament.ts — keep in sync!)
public/              Static assets served at / (default avatar, icons)
docs/                This documentation
.claude/skills/      Repo-local checklists (add-ipc-channel, edit-tournament-state, …)
```

## Process model

Electron splits the app into a privileged **main process** and sandboxed **renderer
processes**. The design principle here is strict: *the main process owns all state;
renderers are disposable views*.

```
┌────────────────────────── Main process ──────────────────────────┐
│                                                                   │
│   SQLite (better-sqlite3, WAL)      TournamentManager singleton   │
│   userData/poker_manager.db   ◄──── levels · tables · seats       │
│   userData/photos/*                 busted · timer · prizes       │
│   userData/projector/*                     │                      │
│                                            │ broadcastState()     │
│              ipcMain.handle/on             ▼ after every mutation │
└───────────────┬───────────────────── webContents.send ───────────┘
                │ invoke/send                │ 'timer-update' (full state)
                │                            │ 'seat-moves-notification'
                │                            │ 'settings-update', 'sound-cue'
┌───────────────┴────────────────────────────▼─────────────────────┐
│  Renderer windows (same bundle, routed by URL hash)               │
│   #/            Main control window (also plays sound cues)       │
│   #/projector   Fullscreen room display                           │
│   #/structure-editor[?id=N]   Standalone structure editor         │
└───────────────────────────────────────────────────────────────────┘
```

Key consequences:

- **Renderers never mirror tournament state.** They fetch it once on mount (`window.api.getTournamentState()`) and then re-render from each `timer-update` broadcast, which carries the *entire* `TournamentState` snapshot.
- **Every mutation broadcasts and persists.** `broadcastState()` calls `save()` (write the state JSON to SQLite) and then pushes the snapshot to every registered window. A newly registered window immediately receives one snapshot from `addWindow()`, so it renders correctly without an explicit fetch.
- **Windows must be registered.** `tournamentManager.addWindow(win)` subscribes a window to broadcasts and auto-unsubscribes on `closed`. The main and projector windows are registered; the structure editor is intentionally not (it only edits DB rows and never shows live state).
- **`HashRouter` is mandatory** because production loads the bundle via `file://`, where path-based routing cannot work.

## Main process

### The tournament engine (`tournament.ts`)

`TournamentManager` is instantiated once at the bottom of the file
([tournament.ts:940](../electron/tournament.ts#L940)) and holds the entire live
tournament in private fields: `levels`, `tables` (each a list of `Seat`s with
`player: Player | null`), `unassignedPlayers`, `bustedPlayers`, `prizes`, timer
bookkeeping, and the `bustElapsed` map.

**Player location model.** A player is in exactly one of three places:

1. seated — referenced by some `seat.player`;
2. `unassignedPlayers[]` — in the tournament but not seated (freshly created tournament, or just un-busted);
3. `bustedPlayers[]` — eliminated. Seats have no "busted" flag; an empty seat is just empty, and "is this player out?" means "are they in `bustedPlayers`?". The *append order* of `bustedPlayers` is the finishing order (first out = last place).

**Timer engine.** The clock is wall-clock anchored, not tick-counted
([tournament.ts:263-341](../electron/tournament.ts#L263-L341)):

- `startTimer()` records `segmentStartMs = Date.now()` plus the `timeLeftInLevel`/`elapsedTime` at that instant, then runs a 250 ms `setInterval`.
- Each `tick()` recomputes both values from `Date.now() − segmentStartMs`, so a laggy or suspended interval never loses time.
- Broadcasts (and therefore SQLite writes) are gated on the whole-second value changing, keeping writes at ~1/sec.
- Level rollover is a `while (newTimeLeft <= 0)` loop so one lagged tick can cross multiple level boundaries; the anchor is re-set at each boundary. The final level finishing pauses the timer.
- Sound cues are emitted at level/break start, at the ≤5 s warning crossing, and on elimination — to a single designated `primaryWindow` (the main control window) so multiple open windows never double-play audio.

Manual playhead controls (`setTimeLeftInLevel`, `goToNextLevel`, `goToPreviousLevel`)
re-anchor the timer if it is running. `goToPreviousLevel` has "media-player" semantics:
more than 10 s into a level restarts the level; otherwise it jumps to the previous one.

**Seating and table health.** `checkTableHealth()` runs after every bust/un-bust and
applies, in priority order ([tournament.ts:577-618](../electron/tournament.ts#L577-L618)):

1. **Final-table shuffle** (if `shuffleFinalTable` and >1 table and all remaining players fit one table): gather all seated *and unassigned* players, shuffle, reseat everyone on table 1.
2. **Auto-merge** (if `autoMerge`): if the field fits into N−1 tables, remove the last table and distribute its players into empty seats elsewhere, then recursively re-check.
3. **Auto-balance** (if `autoBalance`): while `max − min ≥ 2` players across tables, move one player at a time from the fullest to the emptiest table.

All capacity checks count `unassignedPlayers` as active, so a merge or collapse never
removes seats a pending player still needs; `unbustPlayer()` additionally calls
`ensureSeatCapacity()`, opening a new table when the room is full (un-busting after a
merge must never strand a player), and `bustPlayer()` also works on unassigned players
so an accidental un-bust is reversible. Seat draws use the exported Fisher–Yates
`shuffle()` helper.

Every algorithm emits a `SeatMove[]` describing who moved where and why
(`'random' | 'manual' | 'merge' | 'balance' | 'final-table'`), broadcast on
`seat-moves-notification` and rendered by `SeatMovePopup` in the control window (which
queues batches, since a merge can immediately trigger a balance). All three
algorithms pause the clock before moving players.

**Standings and finalize.** See [Tournament lifecycle](#tournament-lifecycle).

### The database layer (`db.ts`)

`initDB()` opens `userData/poker_manager.db` with WAL mode and `foreign_keys = ON`,
creates all tables idempotently, runs `migrateSchema()`, and seeds 10 demo players and
2 demo structures on first run.

**Migrations** are additive-only: `migrateSchema()` checks `PRAGMA table_info` for each
known column and `ALTER TABLE … ADD COLUMN` if missing. SQLite cannot alter existing
column constraints, so the `CREATE TABLE` bodies only describe *fresh* databases — any
column added after first release must also appear in `migrateSchema()`. Changes to the
`state` JSON *content* are not migrated here; they are handled by defaulting in
`applySavedRow()` (the `/edit-tournament-state` skill walks through this).

All query functions are thin, synchronous prepared statements. Multi-statement writes
(`saveTournamentResults`) run inside `db.transaction()`.

### The IPC surface (`main.ts` + `preload.ts`)

`preload.ts` exposes two globals via `contextBridge`:

- **`window.api`** — the domain API. One method per channel: player/structure/settings CRUD (`db:*`), tournament actions (`tournament:*`), window opening (`window:*`), media import, and the subscription helpers `onSeatMoves` / `onSettingsUpdate` / `onSoundCue` (each returns an unsubscribe function).
- **`window.ipcRenderer`** — a **channel-whitelisted** raw bridge: `on` accepts `timer-update` / `structures-updated`, `send` accepts `start-timer` / `pause-timer`. Anything else throws; new raw channels must be added to the whitelist in `preload.ts`.

All handlers live in one `app.whenReady()` block in `main.ts`. The complete
channel-by-channel table is maintained in [CLAUDE.md](../CLAUDE.md#ipc-channel-quick-reference);
the `/add-ipc-channel` skill documents the five files a new channel must touch
(`db.ts`/`tournament.ts` → `main.ts` → `preload.ts` → `types.d.ts` → caller).

Broadcast channels (main → all windows):

| Channel | Payload | Emitted when |
| --- | --- | --- |
| `timer-update` | full `TournamentState` | after every engine mutation and every timer second |
| `seat-moves-notification` | `SeatMove[]` | after any seating change |
| `settings-update` | `Record<string, string>` | after `db:set-setting` (keeps all windows' theme/language in sync) |
| `structures-updated` | none | after any structure save/update/delete (the list page refreshes on it instead of polling) |
| `sound-cue` | cue name | level/break start, 5 s warning, elimination — primary window only |

## Renderer

`src/App.tsx` mounts `SettingsProvider` → `SoundCuePlayer` → `HashRouter`. The sidebar
is hidden for the projector and structure-editor routes so those windows render
standalone.

| Route | Component | Purpose |
| --- | --- | --- |
| `/` | `ControlPanel` | The operator hub: timer controls + time slider, level/prize/player tabs, other-running-tournaments switcher, opens creator & finalize modals |
| `/players` | `PlayerManagement` | Roster CRUD (add form + table), soft delete with confirmation |
| `/players/:id` | `PlayerProfile` | Edit info/photo; aggregate stats and per-tournament history from `TournamentResults` |
| `/history` | `TournamentHistory` | Archived tournaments list (winner, prize pool, entrants) |
| `/history/:id` | `TournamentResultsView` | Full rankings of one archived tournament |
| `/structure` | `StructureList` | Structure cards; opens the editor window |
| `/structure-editor` | `StructureEditor` | Separate window; drag-to-reorder blind level editor |
| `/projector` | `ProjectorView` | Separate fullscreen window; room display themed by the projector settings |
| `/settings` | `Settings` | Language / accent color / currency |
| `/projector-designer` | `ProjectorDesigner` | Theme editor for the projector (background, text color, logo, shadow/outline) with live preview |

Non-route components: `TournamentCreator` (modal: structure, players, tables,
auto-balance/merge/final-table toggles, entry fee, prize distribution),
`ManagePlayersPanel` (seating grid with drag-and-drop of unassigned players onto
seats, bust/un-bust), `FinalizeStandingsModal` (survivor ordering + results
confirmation), `SeatMovePopup`, `ConfirmationModal`.

State pattern used by live views (`ControlPanel`, `ProjectorView`): fetch the snapshot
once on mount, subscribe to `timer-update`, project the snapshot into a local
view-model, and unsubscribe on unmount. DB-backed pages (`PlayerManagement`,
`TournamentHistory`, …) fetch on mount and re-fetch after their own mutations.

Shared utilities: `format.ts` (European date/time, `formatDuration`,
`formatCurrencyWith` for *snapshotted* currencies), `place.ts` (localized ordinals),
`media.ts` (`mediaUrl()` → `media://` URLs), `SoundCuePlayer` (maps `sound-cue`
payloads to cached `Audio` elements).

## Data model

Five tables (see [db.ts:14-70](../electron/db.ts#L14-L70)):

```
Players            id · name · nickname · email · photo_path · is_deleted
                   (legacy DBs may also carry an unused total_winnings column)
Structures         id · name · starting_chips · data(JSON: Level[])
Tournaments        id · name · start_date · end_date · status('running'|'archived') ·
                   state(JSON) · entry_fee · currency · structure_id · structure_name
TournamentResults  id · tournament_id(FK, CASCADE) · player_id(FK, no cascade) ·
                   place · playtime_sec · prize · entry_fee ·
                   UNIQUE(tournament_id, player_id)
Settings           key · value        (language, accentColor, currency, projectorTheme)
```

Design rules that everything else depends on:

- **Snapshots over joins for money/labels.** `Tournaments` copies `entry_fee`, `currency`, and `structure_name` at creation time, and `TournamentResults` copies `entry_fee` per row — so history stays correct when settings or structures change or get deleted later.
- **`TournamentResults` is the canonical reporting source.** History and profile pages query it (via `getTournamentResults` / `getPlayerProfile` with their aggregate SQL); nothing re-derives results from the `state` JSON.
- **Earnings are never stored.** `earnings = prize − entry_fee` is always computed at render time.
- **Soft delete.** `deletePlayer()` sets `is_deleted = 1`, blanks `name` (legacy `NOT NULL`), nulls the PII columns, deletes the photo file, and scrubs the player from every tournament's `state` JSON snapshot. `getPlayers()` filters deleted rows and `getPlayerProfile()` returns `null` for them; result joins keep them, rendered as `???` (`common.deletedPlayer`).
- **State snapshots are PII-sanitized.** `getStateForSave()` persists only `id`/`name`/`nickname`/`photo_path` per player — never `email`.
- **Units gotcha.** `Structures.data` stores level `duration` in **minutes**; the `tournament:create` handler multiplies by 60 once, and everything downstream (engine, timer, state JSON) is in **seconds**.
- **`state` JSON round-trip.** `getStateForSave()` / `applySavedRow()` define exactly which engine fields persist (including `entryFee` and `bustElapsed`, so finalize survives an app restart). `applySavedRow` applies `??`-defaults for fields added after old rows were written.

## Tournament lifecycle

```
TournamentCreator ──tournament:create──►  initialize()
   structure levels (min→sec), selected players, options, prize list,
   entry-fee/currency/structure-name snapshot
        │   players start UNASSIGNED; status='running' row inserted
        ▼
 randomizeSeating / drag-to-seat        (clock can't start while anyone
        │                                is unassigned)
        ▼
 running: start/pause · level moves · bustPlayer ⇄ unbustPlayer
        │                │
        │                └── every bust/unbust → checkTableHealth()
        │                    (final-table shuffle ▸ merge ▸ balance)
        ▼
   ┌────────────────────────────┐
   │  FinalizeStandingsModal    │  getStandings(): busted players have fixed
   │  operator orders survivors │  places from elimination order; survivors are
   └──────┬──────────┬──────────┘  pre-ordered by seating for the operator
          │          │
   finalize(ids)   "skip" → tournament:stop → reset()
          │          │
          ▼          ▼
  TournamentResults  (no results)
  rows written       │
          └────┬─────┘
               ▼
        archiveTournament()  →  status='archived', end_date set
        clearInMemory()      →  singleton empty, broadcastState()
```

Details worth knowing:

- **Places and playtime.** `bustPlayer()` records the tournament `elapsedTime` into `bustElapsed[playerId]`; `unbustPlayer()` reverses it. Busted player *N-from-the-end* gets place `numSurvivors + (bustedCount − index)`. Survivors take places `1..numSurvivors` in the operator's chosen order and get the full `elapsedTime` as playtime.
- **`finalize(orderedSurvivorIds)`** is defensive: unknown ids are ignored and unmentioned survivors are appended in seating order, so nobody is dropped from the results.
- **`reset()` vs `finalize()`** both archive and both call the shared `clearInMemory()`; archiving is the caller's responsibility (never double-archive).
- **Multiple running tournaments.** Creating a tournament while another runs first saves the old one; both stay `status='running'`. The ControlPanel lists "other running tournaments" and `switchTournament(id)` re-hydrates the singleton from any running row (always paused after a switch). On app startup, `load()` resumes the *most recent* running tournament, paused.

## Settings and i18n

Settings live in the SQLite `Settings` key/value table, not in localStorage — so all
windows share them. `SettingsProvider` fetches on mount, subscribes to the
`settings-update` broadcast (emitted by `db:set-setting` to every window), validates
raw values against allow-lists, and exposes `{ language, accentColor, currency,
projector, t(), formatCurrency(), set* }` via `useSettings()`.

- **i18n**: `translations.ts` holds flat `en`/`fr` dictionaries; `TranslationKey` is derived from the `en` object so `t()` is fully typed. `{placeholders}` are interpolated by `translate()`.
- **Accent theming**: `applyAccent()` writes an accent palette onto CSS custom properties consumed by the Tailwind semantic tokens.
- **Currency**: the *app* currency setting formats live views via `formatCurrency`; archived pages must use `formatCurrencyWith(amount, tournament.currency, language)` with the snapshot instead.
- **Projector theme**: stored as a JSON blob under the `projectorTheme` key, hardened by `parseProjectorTheme` (hex-color and range validation) so a corrupt value can never break the projector window.

## Media and assets

Player photos and projector images are **not** stored in SQLite. The main process
copies the source file into `userData/photos/` or `userData/projector/` with a
`<timestamp>-<rand><ext>` name and stores the absolute path. Renderers load them via
the custom **`media://` protocol** (`media://local/<encodeURIComponent(path)>` →
`net.fetch(file-url)`), because in dev the renderer origin is `http://` and Chromium
blocks `file://` images from non-file origins. The handler refuses paths outside
`userData/photos` and `userData/projector` (403), so the renderer has no
arbitrary-file-read primitive. The protocol must be registered as
privileged *before* `app.ready`. File paths from `<input type="file">` are resolved
with `webUtils.getPathForFile` in the preload (the old `File.path` is empty under the
sandbox).

Sound cues are bundled mp3s in `src/assets/sounds/`, played only in the primary window
(see the timer engine section).

## Build and packaging

- `npm run dev` — Vite dev server + Electron with HMR for both processes.
- `npm run build` — `tsc` (typecheck only) → `vite build` (renderer to `dist/`, main/preload to `dist-electron/` via `vite-plugin-electron`) → `electron-builder` (config in `electron-builder.json5`; artifacts under `release/<version>/`, git-ignored).
- `npm run lint` — ESLint over the repo with `--max-warnings 0`.
- **`better-sqlite3` is a native module**: it is declared `external` in the main-process Rollup options ([vite.config.ts:17](../vite.config.ts#L17)) and rebuilt against Electron's ABI by `@electron/rebuild`. Do not try to bundle it.
- The two TypeScript "projects" (`tsconfig.json` for `src/`, referenced `tsconfig.node.json` for `electron/` + config files) are why type declarations are duplicated across the process boundary — when changing a shared shape, update **both** `electron/tournament.ts` and `src/types.d.ts` (the `/edit-tournament-state` skill enforces this).
