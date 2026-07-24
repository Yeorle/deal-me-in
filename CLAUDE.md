# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server + Electron with HMR (the only command for local development).
- `npm run build` — `tsc` typecheck → `vite build` → `electron-builder` packaging (DMG/NSIS/AppImage configured in `electron-builder.json5`).
- `npm run lint` — ESLint over `src/` and `electron/` with `--max-warnings 0`.
- `npm run test` — Vitest unit tests for the tournament engine (`tests/`, configured by `vitest.config.ts` — deliberately standalone so the electron Vite plugins don't load). `electron` and `electron/db` are mocked; the engine logic runs under plain Node.

## Architecture

This is an Electron app split into two TypeScript projects compiled by Vite:

- **Main process** (`electron/`) owns all stateful logic: SQLite access, tournament state, and window creation.
- **Renderer process** (`src/`) is a React 18 + React Router (HashRouter) SPA — `HashRouter` is required because production loads via `file://`.

The processes communicate only through the IPC bridge in `electron/preload.ts`, which exposes two globals on `window`: `window.api` (high-level domain methods) and `window.ipcRenderer` (a **channel-whitelisted** raw bridge: `on` accepts only `timer-update` / `structures-updated`, `send` only `start-timer` / `pause-timer` — extend the whitelist in `preload.ts` if you add a raw channel). Renderer-side typings live in `src/types.d.ts`. The packaged `index.html` also gets a CSP meta tag injected at build time (see `injectCsp` in `vite.config.ts`); dev runs without it because HMR needs inline scripts.

### Tournament state is a main-process singleton

`tournamentManager` (instantiated at the bottom of `electron/tournament.ts`) holds the entire live tournament — levels, tables, seats, busted players, timer interval. The renderer is a thin view: it calls IPC methods to mutate state and re-renders from `timer-update` broadcasts. **Do not mirror tournament state in the renderer**; always read it from `window.api.getTournamentState()` (initial fetch) or the `timer-update` broadcast payload.

Multiple `BrowserWindow`s (main control panel, projector, structure editor) can be open simultaneously. Windows that display tournament state must be registered via `tournamentManager.addWindow(win)` so they receive broadcasts (the structure-editor window is deliberately *not* registered — it doesn't render tournament state). `broadcastState()` is called after every mutation and also persists state to SQLite via `save()`. `addWindow()` also sends an immediate `timer-update` so newly opened windows render correctly without an explicit fetch.

### Tournament persistence and resume

Tournaments are rows in the `Tournaments` table with `status = 'running' | 'archived'`. **Several tournaments can be `running` at once**, but only one is live in the singleton; `getRunningTournaments()` lists them and `switchTournament(id)` saves the current one and rehydrates another. On app startup `main.ts` calls `tournamentManager.load()`, which reads the most recent running tournament and rehydrates the singleton (always paused on resume/switch).

Two ways a tournament ends, both of which archive it:
- `reset()` (wired to `tournament:stop`) archives the current tournament and clears the singleton — the "archive without results" path.
- `finalize(orderedSurvivorIds)` (wired to `tournament:finalize`) writes per-player results **then** archives and clears. See the results model below.

`reset()` and `finalize()` share `clearInMemory()` for the singleton teardown; archiving is the caller's responsibility (don't double-archive).

### Per-player results, standings, and finalize

When a tournament is finalized, one row per player is written to `TournamentResults` (place, `playtime_sec`, `prize`, `entry_fee`). This is the **canonical reporting source** for the History and Player-profile pages — query it, don't re-derive from the `state` JSON.

How the engine knows each player's place and playtime:
- **Elimination order + time** — `bustPlayer()` records `elapsedTime` into the `bustElapsed` map (keyed by player id) and appends to `bustedPlayers[]`; `unbustPlayer()` reverses both. The append order of `bustedPlayers[]` is the finishing order (first out = last place); `bustElapsed[id]` is that player's playtime.
- **Survivors** — players still seated (or unassigned) at finalize time take the top places. The engine can't know their relative order, so `getStandings()` returns them pre-ordered by seating and the operator reorders them in `FinalizeStandingsModal`; `finalize(orderedSurvivorIds)` applies that order. Survivors' playtime is the full `elapsedTime`.
- **Earnings are never stored** — `earnings = prize − entry_fee` is always computed in the renderer.

`entryFee` and `bustElapsed` are part of the persisted `state` JSON (round-tripped through `getStateForSave()` / `applySavedRow()`), so a finalize works correctly even after an app restart.

### Auto-balance / auto-merge / final table

`checkTableHealth()` runs after every bust/unbust. Priority: final-table shuffle (everyone fits one table and `shuffleFinalTable` is on) → auto-merge (`autoMerge` on and active players fit into N-1 tables: removes the last table and redistributes) → auto-balance (`autoBalance` on and `max - min >= 2` players across tables: rebalances one player at a time). All three pause the timer before moving players, and all three emit `SeatMove[]` arrays via `broadcastMoves()` — the renderer's `SeatMovePopup` listens for `seat-moves-notification` and queues batches (a merge can immediately trigger a balance).

**Capacity counts unassigned players.** `checkTableHealth()`'s `totalActive` includes `unassignedPlayers`, so a merge/collapse never removes seats a pending player needs, and `collapseToFinalTable()` draws unassigned players into the final table. `unbustPlayer()` calls `ensureSeatCapacity()`, which opens a new table if the room is full — otherwise un-busting into a full room would deadlock the tournament (play is blocked while anyone is unassigned). `bustPlayer()` also works on unassigned players so an accidental un-bust is always reversible. Seat draws use the exported Fisher–Yates `shuffle()` helper — don't reintroduce `sort(() => Math.random() - 0.5)`.

### Database

`electron/db.ts` opens `better-sqlite3` at `app.getPath('userData')/poker_manager.db` in WAL mode (with `foreign_keys = ON`) and creates: `Players`, `Structures`, `Tournaments`, `TournamentResults`, `Settings`. On first run it seeds 10 default players and 2 default structures. **`better-sqlite3` is a native module and is marked `external` in `vite.config.ts`** — do not try to bundle it.

`migrateSchema()` runs on every startup and is the only migration mechanism for *table columns* — it adds missing columns (`Players.is_deleted`, `Tournaments.entry_fee/currency/structure_id/structure_name`) idempotently via `PRAGMA table_info`. Add new columns there too; SQLite can't change a column's constraints in place, so don't rely on the `CREATE TABLE` body for existing DBs. (The `state` JSON column is *not* migrated this way — see `/edit-tournament-state`.)

- **`Tournaments`** snapshots `entry_fee`, `currency`, and `structure_name` at creation so historical money/labels stay correct if settings or structures change later.
- **`TournamentResults`** is the per-player result table (FK to `Tournaments` cascades on delete; FK to `Players` does **not**). See "Per-player results" above.
- **Soft delete:** `deletePlayer()` does *not* remove the row — it sets `is_deleted = 1`, blanks `name` (to `''`, satisfying the legacy `NOT NULL`) and nulls the other PII, deletes the photo file from disk, and scrubs the player's fields out of every tournament's `state` JSON snapshot (`scrubPlayerFromTournamentStates`). `getPlayers()` filters `is_deleted = 0`, `getPlayerProfile()` returns `null` for deleted players, and `updatePlayer()` refuses to write onto a deleted row; result joins keep the row, so a deleted player shows as `???` (the `common.deletedPlayer` string) in history.

Player photos are not stored in SQLite; `db:add-player` / `db:update-player` copy the source file into `userData/photos/<timestamp-rand><ext>` (via `importFileToUserData` in `main.ts`) and store the absolute path in `photo_path`; replacing a photo unlinks the old file. Photos are then loaded in the renderer via the `media://` protocol (`mediaUrl(...)`), not `file://` — the protocol handler only serves files under `userData/photos` and `userData/projector`.

**State snapshots are PII-sanitized:** `getStateForSave()` persists only `id`/`name`/`nickname`/`photo_path` per player (never `email`). If you add fields to `Player`, decide explicitly whether they belong in `sanitizePlayer()`.

### Backup export/import

`electron/backup.ts` implements the Settings-page backup feature: a `.dmibak` zip containing `manifest.json` (format id + version), `data.json` (dump of all five tables, primary keys preserved) and the `photos/` / `projector/` media files. The DB stores absolute media paths in three places (`Players.photo_path`, embedded players inside `Tournaments.state`, `backgroundImage`/`logoPath` in the `projectorTheme` setting); export rewrites them archive-relative, import rewrites them back under the destination `userData`. Export reads via `getAllRowsForExport()`, which deliberately does **not** filter `is_deleted` — soft-deleted rows must round-trip or result joins break. Import is full-replace: validate the whole archive before any write, save a safety backup to `userData/backups/pre-import-<ts>.dmibak`, extract media (entry names sanitized against zip-slip), swap all rows in one transaction (`replaceAllData()`), then `main.ts` pauses the timer, rehydrates the singleton via `tournamentManager.reloadFromDb()` (which nulls the tournament id *first* so no save() can hit a freshly imported row) and reloads every window. **Do not switch this to `app.relaunch()`** — it strands dev against a dead vite server (vite-plugin-electron exits with the electron process) and is a no-op from an AppImage's unmounted squashfs. If you add a media-path field or a new table, update `relativizeDump`/`absolutizeDump`/`validateDump` and bump/handle `BACKUP_FORMAT_VERSION` accordingly (older versions must always import; newer ones are rejected). The path/dump logic is pure and covered by `tests/backup.test.ts`. Full design: `docs/PRD-data-import-export.md`.

### Structure data shape (watch the units)

Structures store their levels as JSON in the `data` column — a bare array of level objects (no wrapper). The level objects use `duration` in **minutes**. When a tournament is created (`tournament:create` handler in `main.ts`), the levels are parsed and `duration` is multiplied by 60 — every other piece of code (`TournamentManager`, the timer tick) treats `duration` as **seconds**. If you read or write structure JSON directly, keep the unit in mind.

### Windows and routing

Three window types, all loading the same renderer bundle but routing via the URL hash:

- Main window — `/` (`ControlPanel`), `/players` (`PlayerManagement`), `/players/:id` (`PlayerProfile`), `/history` (`TournamentHistory`), `/history/:id` (`TournamentResultsView`), `/structure` (`StructureList`), `/settings` (`Settings`), `/projector-designer` (`ProjectorDesigner`)
- Projector window — `#/projector` (`ProjectorView`), opened by `window:open-projector`, fullscreen, no sidebar
- Structure editor window — `#/structure-editor` or `#/structure-editor?id=<id>` (`StructureEditor`), opened by `window:open-structure-editor`

`AppContent` in `src/App.tsx` hides the sidebar when the route is the projector or structure editor so those windows render standalone.

### IPC channel quick reference

Domain methods (use `window.api.*`, defined in `electron/preload.ts`):

| `window.api` method                         | IPC channel                          | Handler in `main.ts` |
| ------------------------------------------- | ------------------------------------ | -------------------- |
| `getPlayers / addPlayer / updatePlayer / deletePlayer` | `db:get-players` etc.       | `db:*` handlers      |
| `getStructures / getStructure / saveStructure / updateStructure / deleteStructure` | `db:*` | `db:*` handlers |
| `getArchivedTournaments / deleteTournament` | `db:get-archived-tournaments` etc.   | `db:*` handlers      |
| `getTournamentResults`                      | `db:get-tournament-results`          | results + meta for one archived tournament |
| `getPlayerProfile`                          | `db:get-player-profile`              | player + aggregate stats + history |
| `createTournament`                          | `tournament:create`                  | calls `tournamentManager.initialize` (snapshots entry fee / currency / structure) |
| `getTournamentState`                        | `tournament:get-state`               | returns `tournamentManager.getState()` |
| `getStandings`                              | `tournament:get-standings`           | provisional finalize standings |
| `finalizeTournament`                        | `tournament:finalize`                | writes `TournamentResults` + archives |
| `randomizeSeating`                          | `tournament:randomize-seating`       |                      |
| `bustPlayer / unbustPlayer`                 | `tournament:bust-player` / `unbust-player` | triggers `checkTableHealth`; records/clears `bustElapsed`; both handle unassigned players |
| `stopTournament`                            | `tournament:stop`                    | archives + resets (no results); invoke so the renderer can await the archive |
| `openProjector / openStructureEditor`       | `window:open-projector` / `open-structure-editor` | creates a new `BrowserWindow` |
| `exportData / importData`                   | `data:export` / `data:import`        | full-data backup (see "Backup export/import" below); returns structured `{ ok, error }`, never throws across IPC |
| `onSeatMoves(callback)`                     | listens on `seat-moves-notification` |                      |

Raw `window.ipcRenderer.send` channels (no `window.api` wrapper):
- `start-timer`, `pause-timer` — fire-and-forget timer controls.

Renderer subscribes to `timer-update` (full `TournamentState` snapshot) and `structures-updated` (no payload; broadcast after every structure save/update/delete so lists refresh without polling) via `window.ipcRenderer.on(...)`; `seat-moves-notification` (`SeatMove[]`), `settings-update`, and `sound-cue` have `window.api.on*` wrappers. All raw channels must be in the preload whitelist.

## Conventions and gotchas

### Type duplication caveat

`Player`, `Seat`, `Table`, `SeatMove`, and the tournament state shape are declared in **both** `electron/tournament.ts` and `src/types.d.ts` (they cannot share a file across the process boundary in this Vite setup). When changing a shape, update both sides.

### Prize places may have gaps

`prizes` is a sparse list of `{ place, amount }` — a blank middle prize in the creator is dropped *without renumbering* (1st=500, 3rd=200 stays exactly that). `prizeForPlace()` looks up by `place` and returns 0 for gaps. Never renumber prize places after filtering.

### Busted players live in `bustedPlayers[]`

When a player busts, their seat is cleared (`seat.player = null`) and the `Player` object is appended to `bustedPlayers[]`. There is no per-seat busted flag — an empty seat is just "no player here", and "is this player out?" means "are they in `bustedPlayers[]`?".

### `numTables` is a local UI input

`TournamentCreator` keeps `numTables` as local state alongside `maxPlayersPerTable` purely to drive the capacity-check warning ("you've selected more players than seats"). It is **not** sent over IPC — the seating algorithm in `doSeatPlayers` derives the actual table count from `Math.ceil(players.length / maxPlayersPerTable)`.

## Project-specific skills

When the relevant scenario comes up, invoke these skills with `/<skill-name>`:

- `/add-ipc-channel` — checklist for plumbing a new IPC method through `db.ts` / `tournament.ts` → `main.ts` → `preload.ts` → `types.d.ts` → renderer.
- `/edit-tournament-state` — checklist for adding or changing a field on `TournamentState`, including persistence (`save`/`load`) and the dual type declarations.
- `/tournament-results` — the results/history/profile reporting model: where `TournamentResults` data comes from, the finalize/standings flow, and the soft-delete / currency-snapshot / derived-earnings rules.
