# PRD — Full Data Export / Import (Backup & Transfer)

**Status:** Implemented (v1, replace-only import)
**Date:** 2026-07-24

## 1. Problem & goal

All app data lives on one machine, inside Electron's `userData` directory: the SQLite
database (`poker_manager.db`), player photos (`userData/photos/`), and projector images
(`userData/projector/`). There is no supported way to move an installation to another
computer, or to make a backup before an event.

**Goal:** a single-file export of *everything* (players, structures, tournaments —
running and archived — results, settings, photos, projector images) that can be imported
on another machine (or the same one) and fully restores the application state.

**Non-goals (v1):**
- Merging two databases (import is a full replace, not a merge).
- Selective export (only some tournaments / only players).
- Cloud sync / automatic scheduled backups.
- Cross-app interchange formats (CSV, TournamentDirector, …).

These are all natural v2 extensions of the format chosen below, and the format is
designed not to preclude them.

## 2. File format

A **ZIP archive** with the extension **`.dmibak`** (registered in the save dialog as
"Deal Me In backup"; it's a plain zip under the hood, so users can inspect it).

```
mybackup.dmibak (zip)
├── manifest.json          # format version, app version, export date, row counts
├── data.json              # JSON dump of all five tables, IDs preserved
├── photos/                # verbatim copies of userData/photos/*
│   └── 1719246000-ab12.jpg
└── projector/             # verbatim copies of userData/projector/*
    └── 1719250000-cd34.png
```

### Why a JSON dump instead of zipping the raw `.db` file

The database stores **absolute paths** in three places, and they are wrong on the
destination machine (`userData` differs per OS/user):

1. `Players.photo_path`
2. `Tournaments.state` JSON — every embedded `Player` object carries `photo_path`
3. `Settings.projectorTheme` JSON — `backgroundImage` and `logoPath`

A raw DB copy would need SQL + JSON surgery after restore anyway; a JSON dump lets us
relativize paths on export and rewrite them on import in one obvious place. It is also
version-tolerant (unknown/missing columns are handled explicitly rather than by whatever
schema the source machine happened to have), human-inspectable, and it keeps the door
open for v2 merge/selective import. WAL checkpointing concerns disappear because we
read through the live `better-sqlite3` handle instead of copying the file.

### `manifest.json`

```json
{
  "format": "dealmein-backup",
  "formatVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-07-24T14:03:00.000Z",
  "counts": { "players": 42, "structures": 5, "tournaments": 17, "results": 180, "settings": 4 }
}
```

Import rejects archives where `format` doesn't match or `formatVersion` is greater than
the version the running app supports. Older `formatVersion`s must always import (same
philosophy as `migrateSchema()`).

### `data.json`

One key per table, rows as plain objects, **primary keys preserved** (required: `TournamentResults`
references `player_id`/`tournament_id`, `Tournaments.structure_id` references structures):

```json
{
  "players": [ { "id": 1, "name": "…", "nickname": "…", "email": "…", "photo_path": "photos/1719246000-ab12.jpg", "is_deleted": 0 } ],
  "structures": [ { "id": 1, "name": "…", "starting_chips": 10000, "data": "[…levels…]" } ],
  "tournaments": [ { "id": 1, "name": "…", "start_date": "…", "end_date": null, "status": "running", "state": "…JSON…", "entry_fee": 20, "currency": "EUR", "structure_id": 1, "structure_name": "…" } ],
  "tournamentResults": [ { "id": 1, "tournament_id": 1, "player_id": 3, "place": 1, "playtime_sec": 7200, "prize": 500, "entry_fee": 20 } ],
  "settings": [ { "key": "currency", "value": "EUR" } ]
}
```

**Path convention inside the archive:** every media reference is stored
*archive-relative* (`photos/<file>`, `projector/<file>`). Export converts absolute →
relative; import converts relative → absolute under the destination `userData`. This
applies to `Players.photo_path`, every `photo_path` inside `Tournaments.state`, and
`backgroundImage`/`logoPath` inside the `projectorTheme` setting value.

## 3. User experience

### Location

A new **"Backup"** (or "Data") section at the bottom of the existing **Settings** page
(`src/components/Settings.tsx`) with two actions:

- **Export all data** — opens a native save dialog (default name
  `deal-me-in-backup-YYYY-MM-DD.dmibak`), writes the archive, shows a success toast/line
  with the file path (or an error message).
- **Import backup…** — opens a native open dialog filtered to `.dmibak`/`.zip`, then
  shows a **destructive-action confirmation modal** (reuse `ConfirmationModal.tsx`)
  stating clearly: *"This replaces ALL current data — players, tournaments, structures,
  results and settings. A safety copy of the current data is saved automatically. The
  app will reload."* Confirm → import runs → singleton rehydrates → all windows reload.

### Behavioral rules

- **Export is always allowed**, including while a tournament is running. The live
  singleton persists on every mutation (`broadcastState()` → `save()`), and export
  additionally calls `tournamentManager`'s save first so the running tournament's row is
  current at the moment of export.
- **Import replaces everything.** Before touching anything, the current data is
  automatically exported to a timestamped safety file
  (`userData/backups/pre-import-<timestamp>.dmibak`) so a bad import is recoverable.
  Mention this path in the confirmation modal and in the success message.
- **Import ends with an in-place reload** (not `app.relaunch()` — that strands dev
  against a dead vite server, since vite-plugin-electron exits with the electron
  process, and is a no-op from an AppImage's unmounted squashfs). The handler calls
  `tournamentManager.reloadFromDb()` — which nulls the tournament id *first* so no
  save() can hit a freshly imported row, clears the singleton without archiving, and
  rehydrates via the same `load()` path used at startup — then reloads every
  `BrowserWindow` so the renderer (settings context, player lists, projector) refetches
  everything from the imported data.
- Import failure (bad zip, wrong format, newer `formatVersion`, JSON parse error) must
  leave the existing data **untouched** — validate the whole archive before the first
  write (see §5).

### PII note

The archive contains player emails and photos in the clear (it's a backup, not an
anonymized export). The confirmation/success copy should not claim any encryption.
Soft-deleted players export exactly as stored (blank name, nulled PII, `is_deleted = 1`)
so history keeps working after import — the scrub done by `deletePlayer()` survives the
round-trip by construction.

## 4. Technical design

### New dependency

`adm-zip` (pure JS, sync API, reads + writes). Node has no built-in zip container
support and `better-sqlite3` precedent shows native modules are a packaging headache —
avoid them; `adm-zip` bundles fine through vite-plugin-electron with no
`external` entry needed.

### New module: `electron/backup.ts`

Keep export/import logic out of `main.ts` (which is already the IPC switchboard) and out
of `db.ts` (pure DB accessors). Suggested surface:

```ts
export function exportAllData(targetFilePath: string): void
export function importAllData(sourceFilePath: string): void   // throws on invalid archive
```

**Export algorithm:**
1. Ask `tournamentManager` to persist the live tournament (if any) so its row is fresh.
2. `SELECT *` from all five tables (new `db.ts` helpers `getAllRowsForExport()` — note
   these must NOT filter `is_deleted`, unlike `getPlayers()`).
3. Build the path map: for each referenced file under `userData/photos` /
   `userData/projector`, record `absolute → photos|projector/<basename>` and add the
   file to the zip (skip silently if missing on disk — a dangling path must not abort
   the backup).
4. Rewrite paths in the three locations listed in §2 (parse/re-serialize the
   `state` and `projectorTheme` JSON strings).
5. Add `manifest.json` + `data.json`, write the zip to `targetFilePath`.

**Import algorithm:**
1. Open zip, parse + validate `manifest.json` (format id, `formatVersion <= SUPPORTED`)
   and `data.json` (all five keys present and arrays). Throw before any write if invalid.
2. Write the automatic safety backup (call `exportAllData()` to
   `userData/backups/pre-import-<ts>.dmibak`).
3. Extract `photos/` and `projector/` entries into the destination `userData`
   subdirectories. Keep the archive basenames (they're already unique-by-construction
   from `importFileToUserData()`); on a name collision with an existing file, overwrite —
   step 4 wipes the old rows referencing them anyway. **Sanitize entry names** (reject
   entries containing `..` or absolute paths — zip-slip).
4. In **one transaction**: `DELETE FROM` all five tables (children first:
   `TournamentResults`, then `Tournaments`, `Players`, `Structures`, `Settings`), then
   insert every row **with its original `id`**, rewriting archive-relative paths to
   absolute destination paths (same three locations). Tolerate rows from older exports
   by applying the same defaults `migrateSchema()` would (e.g. missing `is_deleted` → 0,
   missing `currency` → `'EUR'`).
5. Old orphaned media files (from the pre-import data) are left on disk in v1 — the
   safety backup references them. Optional cleanup is a v2 item.
6. Caller (`main.ts` handler) rehydrates the tournament singleton
   (`tournamentManager.reloadFromDb()`) and reloads every window on success.

**Do not seed on empty:** note that `initDB()` seeds 10 demo players / 2 structures when
tables are empty. Import inserts inside a transaction after the deletes, so `initDB()`'s
seeding never observes the empty state (it only runs at app startup, which the in-place
reload never re-triggers). No change needed — just don't restructure import into
"wipe, restart, then fill".

### IPC plumbing (follow `/add-ipc-channel`)

Two new invoke channels, both fully main-process-side (the renderer never sees file
contents, only triggers):

| `window.api` method | Channel | Handler behavior |
| --- | --- | --- |
| `exportData()` | `data:export` | `dialog.showSaveDialog` (filter `.dmibak`, default dated name) → `exportAllData(path)` → return `{ ok: true, path }` or `{ ok: false, error }`; `{ ok: true, canceled: true }` on cancel |
| `importData()` | `data:import` | `dialog.showOpenDialog` → return the picked path *and* run nothing yet? **No** — keep it one round-trip: handler picks file, validates, backs up, imports, returns `{ ok: true }`, then relaunches after a short delay so the renderer can render the success state. The renderer shows its own confirmation modal *before* calling `importData()`. |

Files to touch, in order: `electron/backup.ts` (new) + `electron/db.ts` (export/import
row helpers) → `electron/main.ts` (two `ipcMain.handle` + dialogs) → `electron/preload.ts`
(`window.api.exportData/importData`) → `src/types.d.ts` (typings) →
`src/components/Settings.tsx` (UI). Dialogs need the parent `BrowserWindow`
(`BrowserWindow.fromWebContents(event.sender)`) so they're modal to the settings window.

Error results cross IPC as structured `{ ok, error }` values rather than thrown errors
(thrown errors get wrapped/mangled by Electron's IPC serialization).

### i18n

New strings in `src/i18n/translations.ts` for **both `en` and `fr`**: section title +
description, both button labels, confirmation modal title/body/confirm, success/error
messages (export path shown, import "reloading…" notice).

## 5. Edge cases & failure modes

| Case | Behavior |
| --- | --- |
| Tournament running during export | Allowed; live state saved to its row immediately before the dump. Importing that archive restores the tournament as `running`, paused — exactly the existing resume-on-startup path. |
| Tournament running during import | Allowed; the confirmation modal is the guard. The handler pauses the timer before the swap and `reloadFromDb()` tears down the singleton without writing through the old id (current data was safety-backed-up). |
| Archive from a newer app version | Rejected with an explicit "created by a newer version" error (via `formatVersion`). |
| Archive from an older app version | Must import; missing columns filled with current-schema defaults. |
| Corrupt zip / missing `data.json` / bad JSON | Rejected before any write; DB untouched; clear error surfaced in Settings. |
| Photo file referenced but missing from archive | Import the row anyway with the rewritten path; renderer already tolerates broken photo paths (avatar fallback). Never fail the whole import on a media file. |
| Zip-slip (`../` in entry names) | Entries outside `photos/`, `projector/`, `manifest.json`, `data.json` are ignored; entry names are sanitized before extraction. |
| Export to a read-only location / disk full | `{ ok: false, error }`, no partial file left behind if avoidable (write to temp name, rename on success). |
| Importing on the same machine (restore) | Works identically — full replace semantics make same-machine restore and cross-machine transfer the same code path. |

## 6. Testing

- **Unit (vitest, `tests/`)**: the serialize/deserialize core should be testable under
  the existing setup where `electron` and `electron/db` are mocked. Structure
  `backup.ts` so path-rewriting and row-mapping are pure functions
  (e.g. `relativizePaths(rows, userDataDir)` / `absolutizePaths(rows, userDataDir)`,
  `buildDataDump(rows)` / `validateDump(json)`), and test:
  - round-trip: dump → restore yields identical rows including IDs;
  - path rewriting in all three locations (player row, `state` JSON, `projectorTheme`);
  - rejection of bad manifests / future `formatVersion` / malformed `data.json`;
  - older-version dump with missing columns gets defaults;
  - zip entry-name sanitization.
- **Manual (`/verify`)**: export on machine A with a running tournament + photos +
  custom projector background; import on a fresh profile; confirm players (incl. one
  soft-deleted shown as `???` in history), history/results, structures, settings,
  photos, projector background, and the running tournament (paused) all restore.

## 7. Acceptance criteria

1. Settings page offers Export and Import; both use native dialogs.
2. Exported `.dmibak` contains manifest, full data dump, and all referenced media.
3. Importing on a second machine reproduces the full app state, including photos and
   projector images displayed correctly (paths rewritten) and a resumable running
   tournament.
4. Import is atomic with respect to the database: any validation or write failure leaves
   the previous data intact.
5. Every import first writes an automatic safety backup under `userData/backups/`.
6. After a successful import the app reloads itself automatically (singleton rehydrated,
   all windows reloaded) — no manual restart needed.
7. `npm run lint`, `npm run test`, and `npm run build` pass; new engine-adjacent logic
   has unit coverage per §6.

## 8. Future extensions (out of scope, but enabled by this design)

- Merge import (dedupe players by name/email, remap IDs).
- Selective export (single tournament with its players/results).
- Scheduled/automatic local backups reusing `exportAllData()`.
- Optional passphrase encryption of the archive (PII).
