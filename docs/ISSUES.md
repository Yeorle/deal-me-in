# Deal me in — Code Audit

Full review of the codebase as of 2026-07-13 (commit `3e059f9`). Every source file in
`electron/` and `src/` was read; `npm run lint` and `tsc --noEmit` both pass clean, so
everything below is a logic, design, or hygiene finding rather than a compile error.

## Fix status (2026-07-14)

Nearly everything below was fixed in the follow-up pass. Line references in the issue
bodies describe the code **as audited** and may no longer match current sources.

| Issue | Status |
| --- | --- |
| C1 unbust deadlock | ✅ Fixed — `checkTableHealth` counts unassigned players, `unbustPlayer` opens a table via `ensureSeatCapacity()` when the room is full, `collapseToFinalTable` seats unassigned players, `bustPlayer` works on unassigned players (with a bust button in the UI). Covered by tests. |
| H1 prize renumbering | ✅ Fixed — places are assigned before filtering; gaps are preserved end-to-end (`prizeForPlace` already handled them). Covered by tests. |
| H2 PII on delete | ✅ Fixed — photo file unlinked on delete and on photo replace; `state` snapshots scrubbed for the deleted player; `getStateForSave()` no longer persists `email` at all. |
| H3 balance vs clock | ✅ Fixed — `balanceTables()` pauses the timer like merge/final-table. Covered by tests. |
| H4 `file://` URLs | ✅ Fixed — both secondary windows use `loadFile(..., { hash })`. |
| M1 biased shuffle | ✅ Fixed — shared Fisher–Yates `shuffle()` used by all three seat draws. |
| M2 per-second SQLite query | ✅ Fixed — running-tournament list refreshes on mount and when the active tournament id changes. |
| M3 verbose SQL logging | ✅ Fixed — gated behind `!app.isPackaged`. |
| M4 structure double-save | ✅ Fixed — first insert's `lastInsertRowid` captured into `editId`. |
| M5 renderer hardening | ✅ Fixed — `window.ipcRenderer` is channel-whitelisted, `media://` only serves `userData/photos` + `userData/projector` (no more `bypassCSP`), CSP meta injected into the packaged `index.html` at build time. |
| M6 structure polling | ✅ Fixed — `structures-updated` broadcast replaces the 2 s interval. |
| M7 seat-move overwrite | ✅ Fixed — popup queues batches until dismissed; `console.log` removed. |
| M8 projector break | ✅ Fixed — break banner replaces "Level N", blinds hidden during breaks. |
| M9 deleted-player profile | ✅ Fixed — `getPlayerProfile` filters `is_deleted`; `updatePlayer` refuses deleted rows. |
| M10 swallowed errors | ◑ Partially — `tournament:create` now throws instead of silently returning, the creator and structure editor show inline error/success notices (no more `alert()`), skip/stop is awaited and logged. No global toast system yet. |
| M11 structure validation | ◑ Mostly — name/levels/blinds/duration validated on save with inline messages. No unsaved-changes warning on window close yet. |
| M12 CLAUDE.md drift | ✅ Fixed — multi-tournament, balance pause, addWindow exception, stop-is-invoke, new test command all documented; ARCHITECTURE.md updated to match. |
| M13 no tests | ✅ Fixed — Vitest configured (`npm run test`, standalone `vitest.config.ts`); 12 tests over seating, bust/unbust, merge (incl. the C1 scenario), balance, final table, standings, prize gaps, finalize. CI added 2026-07-14 (`.github/workflows/ci.yml`: lint + tsc + vitest). |
| L1 dead code | ✅ Fixed — `nextLevel()`, `total_winnings` (schema + types; legacy DBs keep the column), `electron-store`, `main-process-message`, `handleSave(close)` all removed. |
| L2 duplication | ◑ Mostly — `placeLabel` (and the duplicate `creator.place*` key set), photo-import block, `defaultAvatar`, currency-symbol map, and `formatTime`/`formatBreakCountdown` are deduplicated. Left as-is: `Stat`/`BackLink` mini-components, the two inline delete modals, and the cross-process type duplication (documented as deliberate). |
| L3 branding | ✅ Fixed — all windows + favicon use `logo.png`; sidebar version comes from `package.json` via a Vite define. |
| L4 robustness nits | ✅ Fixed — parse-before-assign in `applySavedRow`, awaited `tournament:stop` (invoke), `mkdirSync` recursive, `getStructures` ordered, `powerSaveBlocker` only while the clock runs, stable drag keys in the structure editor, slider sends once on release. |

Severity levels:

| Level | Meaning |
| --- | --- |
| 🔴 **Critical** | Can break a live tournament with no in-app recovery, or corrupts money/results data. Fix before the next real event. |
| 🟠 **High** | Wrong results/money in realistic scenarios, incomplete privacy guarantees, or a broken feature on a shipped platform. |
| 🟡 **Medium** | Robustness, performance, security hardening, UX gaps, doc drift. |
| ⚪ **Low** | Code duplication, dead code, template leftovers, polish. |

---

## 🔴 Critical

### C1. Un-busting after an auto-merge can deadlock the tournament

**Where:** [tournament.ts:559-575](electron/tournament.ts#L559-L575) (`unbustPlayer`), [tournament.ts:598-606](electron/tournament.ts#L598-L606) (merge capacity check), [ControlPanel.tsx:118-121](src/components/ControlPanel.tsx#L118-L121) (`playDisabled`)

**Scenario:** 2 tables × 9 seats, 10 players (5/5). A player busts → 9 active players fit
in one table → auto-merge collapses to a single full 9/9 table. The operator then
un-busts that player (mis-click, disputed hand, …). The player goes to
`unassignedPlayers` — but now **every seat in the tournament is occupied**:

- `randomizeSeating()` with existing tables only fills *empty* seats ([tournament.ts:411-444](electron/tournament.ts#L411-L444)); with none available the player just stays unassigned.
- `seatPlayer()` requires an empty seat ([tournament.ts:450-470](electron/tournament.ts#L450-L470)).
- There is no "add table" operation anywhere in the engine or UI.
- The full-reseat path (`doSeatPlayers`) only runs when `tables.length === 0`.
- The play button is disabled while anyone is unassigned (`playDisabled` in ControlPanel), and the merge already paused the clock — so **the timer can never be restarted**.
- An unassigned player cannot be busted either (`bustPlayer` only searches seats, and the UI offers no bust button for unassigned players), so the state can't be undone.

The only escape is finalizing the tournament early. That is a ruined live event.

**Root cause:** `checkTableHealth()` computes capacity from *seated* players only —
`unassignedPlayers` is invisible to the merge check, the balance check, and the
final-table-shuffle trigger ([tournament.ts:577-618](electron/tournament.ts#L577-L618)). The same blindness means a
final-table collapse (`collapseToFinalTable` builds exactly `playersPerTable` seats)
can also strand unassigned players.

**Suggested fix (any one of these closes the deadlock; the first is the most correct):**
1. Include `unassignedPlayers.length` in `totalActive` for all three `checkTableHealth` capacity decisions, so a merge never removes seats that pending players need.
2. In `unbustPlayer` / `randomizeSeating`, if no empty seat exists, create a new table (or re-run a full reseat).
3. At minimum: let the operator bust an unassigned player again so the mistake is reversible.

---

## 🟠 High

### H1. Prize amounts silently shift to different places when a middle prize is 0

**Where:** [TournamentCreator.tsx:48-50](src/components/TournamentCreator.tsx#L48-L50)

```ts
const cleanedPrizes = prizes
    .filter(p => p.amount > 0)
    .map((p, i) => ({ place: i + 1, amount: p.amount }));
```

Zero-amount rows are filtered *and then all places are renumbered sequentially*. If the
operator enters 1st = 500, 2nd = 0 (left blank), 3rd = 200, the tournament is created
with 1st = 500, **2nd = 200** — 3rd's payout moved to 2nd place with no warning. This
flows straight into `prizeForPlace()` in the engine and ultimately into
`TournamentResults.prize`, i.e. real recorded money.

**Fix:** keep the original `place` when filtering (`.filter(...)` only, no renumbering
`.map`), or validate/warn when a gap exists.

### H2. "Delete player" does not actually remove all personal data

**Where:** [db.ts:204-215](electron/db.ts#L204-L215) (`deletePlayer`), [tournament.ts:165-186](electron/tournament.ts#L165-L186) (`getStateForSave`), [main.ts:119-133](electron/main.ts#L119-L133) (photo copy)

`deletePlayer()` is explicitly documented as a PII-strip ("strip all personal info"),
but two copies of the data survive:

1. **The photo file on disk.** `photo_path` is set to NULL, but the copied file in `userData/photos/` is never deleted. (The same is true when a photo is *replaced* via `db:update-player` — the old file is orphaned forever.)
2. **Tournament `state` JSON snapshots.** Every tournament row (running *and* archived) embeds full `Player` objects — name, nickname, email, photo path — inside `tables`, `unassignedPlayers` and `bustedPlayers`. Soft-deleting the player never touches these snapshots, so the "deleted" player's PII remains readable in the DB indefinitely.

**Fix:** delete the photo file in `deletePlayer` (and the previous file in
`updatePlayer`); either scrub player details from archived `state` JSON on delete, or —
simpler — stop persisting `email`/`nickname` in the state snapshot at all (the engine
only needs `id`, `name`, `photo_path`).

### H3. Auto-balance moves players while the clock keeps running

**Where:** [tournament.ts:706-752](electron/tournament.ts#L706-L752) (`balanceTables`), compare [tournament.ts:620-622](electron/tournament.ts#L620-L622) (`mergeTables`) and [tournament.ts:673-675](electron/tournament.ts#L673-L675) (`collapseToFinalTable`)

`mergeTables()` and `collapseToFinalTable()` both call `pauseTimer()` before moving
players; `balanceTables()` does not. Players get relocated mid-level with the blinds
clock running. CLAUDE.md even documents the intended behavior — *"it pauses the timer
and rebalances"* — so this is a code/spec divergence, not a design choice.

**Fix:** add `this.pauseTimer()` at the top of `balanceTables()` (or make all three
consistent and update the docs).

### H4. Secondary windows load `file://` + `path.join` URLs — fragile on Windows

**Where:** [main.ts:220](electron/main.ts#L220) (projector), [main.ts:326](electron/main.ts#L326) (structure editor)

```ts
projectorWin.loadURL(`file://${path.join(RENDERER_DIST, 'index.html')}#/projector`)
```

On Windows, `path.join` produces backslashes and a drive letter
(`file://C:\Users\...`), which is not a valid file URL — Chromium's lenient parsing
usually rescues it, but it breaks with `#` fragments plus special characters in the
install path, and it is the documented-wrong way to do this. The main window correctly
uses `loadFile()`.

**Fix:** `win.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: '/projector' })`
(the `hash` option exists precisely for this).

---

## 🟡 Medium

### M1. Biased shuffle used for all seating draws

**Where:** [tournament.ts:407](electron/tournament.ts#L407), [tournament.ts:474](electron/tournament.ts#L474), [tournament.ts:689](electron/tournament.ts#L689)

All three seat draws use `[...players].sort(() => Math.random() - 0.5)`. That is a
well-known *non-uniform* shuffle — some orderings come up measurably more often than
others. For a poker tool whose seat draw is supposed to be fair, use Fisher–Yates
(one shared `shuffle()` helper also removes the triplication).

### M2. ControlPanel hits SQLite once per second while the clock runs

**Where:** [ControlPanel.tsx:56-88](src/components/ControlPanel.tsx#L56-L88)

`handleStateUpdate` calls `loadRunningTournaments()` on **every** `timer-update`
broadcast (~1/sec while running). Each call is an IPC round-trip + SQLite query +
`setState` → re-render, to refresh a list that only changes on create/switch/finalize.
Load it on mount and after those events instead (or only when `state.id` changes).

### M3. Production database logs every SQL statement

**Where:** [db.ts:10](electron/db.ts#L10)

`new Database(dbPath, { verbose: console.log })` — combined with the 1 Hz state save,
the main process logs a full `UPDATE Tournaments SET state = <multi-KB JSON>` line
every second, forever. Gate it: `verbose: process.env.NODE_ENV === 'development' ? console.log : undefined`.

### M4. Saving a *new* structure twice creates duplicates

**Where:** [StructureEditor.tsx:117-154](src/components/StructureEditor.tsx#L117-L154)

For a new structure, `handleSave` calls `saveStructure` but never captures the new row
id into `editId`. Pressing "Save" and then "Save & Close" (or "Save" twice) inserts two
rows. Fix: `saveStructure` already returns `lastInsertRowid` from better-sqlite3 —
plumb it back and `setEditId(...)` after the first insert.

### M5. Renderer hardening is thin (generic IPC bridge, unrestricted `media://`, no CSP)

**Where:** [preload.ts:4-27](electron/preload.ts#L4-L27), [main.ts:34-36](electron/main.ts#L34-L36) and [main.ts:92-96](electron/main.ts#L92-L96), [index.html](index.html)

Three compounding choices, each individually defensible for a local desktop app:

- `window.ipcRenderer` exposes raw `invoke`/`send`/`on` for *any* channel, which defeats the point of a channel-whitelisting preload (Electron's own security checklist warns against this).
- The `media://` protocol serves **any absolute file path** the renderer asks for (`media://local/<encoded path>`), registered with `bypassCSP: true` — effectively an arbitrary-file-read primitive for renderer code.
- `index.html` sets no Content-Security-Policy.

None of this is exploitable without first compromising the renderer, but the layers
that would contain such a compromise are absent. Cheap wins: restrict `media://` to
the `userData/photos` + `userData/projector` directories (plus the DB-known paths),
drop the generic `invoke`/`send` from the bridge (everything already goes through
`window.api` except two timer channels), and add a CSP meta tag.

### M6. StructureList polls the DB every 2 seconds forever

**Where:** [StructureList.tsx:22-26](src/components/StructureList.tsx#L22-L26)

`setInterval(fetchStructures, 2000)` runs as long as the page is mounted, to pick up
edits made in the separate editor window. Event-driven would be cleaner: have
`db:save-structure`/`db:update-structure` broadcast a `structures-updated` message
(the `settings-update` broadcast at [main.ts:171-178](electron/main.ts#L171-L178) is the existing pattern to copy),
or at least refresh on window focus.

### M7. A second seat-move batch overwrites the first while the popup is open

**Where:** [SeatMovePopup.tsx:19-29](src/components/SeatMovePopup.tsx#L19-L29), [tournament.ts:664-667](electron/tournament.ts#L664-L667)

`mergeTables()` recursively calls `checkTableHealth()`, so a merge can immediately be
followed by a balance — two `seat-moves-notification` broadcasts back-to-back. The
popup does `setMoves(newMoves)`, so the first batch is replaced before the operator
reads it, and those moves are announced nowhere else. Append batches (or queue them)
instead of replacing. There's also a leftover `console.log` on line 21.

### M8. Projector shows "Level N — 0 / 0" during breaks

**Where:** [ProjectorView.tsx:8-24](src/components/ProjectorView.tsx#L8-L24) and [ProjectorView.tsx:46-64](src/components/ProjectorView.tsx#L46-L64)

`ProjectorView`'s local `TimerState` never captures `currentLevel.isBreak`, so during a
break the room display shows a level number with small/big blinds of 0 instead of a
"BREAK" panel. (The only break hint is the small "next break: on break" text in the
left column.) The ControlPanel's structure tab *does* render breaks specially, so the
data is available — the projector just ignores it.

### M9. Soft-deleted players are still reachable and editable via their profile URL

**Where:** [db.ts:365-389](electron/db.ts#L365-L389) (`getPlayerProfile` — no `is_deleted` filter), [db.ts:190-202](electron/db.ts#L190-L202) (`updatePlayer` — no guard), [PlayerProfile.tsx](src/components/PlayerProfile.tsx)

Navigating to `/players/<id>` of a deleted player loads a blank-named but fully
editable profile; saving writes name/email back onto the row while `is_deleted = 1`
stays set — a half-resurrected record that stays hidden from lists but keeps PII again.
Either filter deleted players out of `getPlayerProfile` (render "not found"), or make
saving clear `is_deleted` deliberately ("restore player").

### M10. Errors are swallowed; the operator never sees failures

**Where:** everywhere — e.g. [PlayerManagement.tsx:50-52](src/components/PlayerManagement.tsx#L50-L52), [FinalizeStandingsModal.tsx:60-62](src/components/FinalizeStandingsModal.tsx#L60-L62), [main.ts:253-254](electron/main.ts#L253-L254)

Every renderer IPC call catches errors with `console.error` only (or not at all);
main-process handlers have no try/catch, so exceptions surface as rejected promises
that nothing displays. Two concrete instances: `tournament:create` silently returns
`undefined` when the sender window can't be resolved (renderer believes the create
succeeded), and `StructureEditor` is the sole place with user feedback — via bare
`alert()` ([StructureEditor.tsx:135-142](src/components/StructureEditor.tsx#L135-L142)). Introduce one small toast/error-banner
component and use it consistently.

### M11. Structure editor accepts invalid structures

**Where:** [StructureEditor.tsx](src/components/StructureEditor.tsx)

No validation on save: big blind can be smaller than the small blind, blinds/durations
can be 0 or negative, and a structure with zero levels can be saved (creating a
tournament from it yields `timeLeftInLevel` stuck at 0 with no current level). There's
also no unsaved-changes warning on window close.

### M12. CLAUDE.md has drifted from the code

**Where:** [CLAUDE.md](CLAUDE.md)

- *"There is at most one running tournament at a time"* — false since the multi-tournament feature: `getRunningTournaments`/`switchTournament` exist and the README advertises running several tournaments concurrently.
- *"[auto-balance] pauses the timer and rebalances"* — the pause is not implemented (see H3).
- *"Multiple BrowserWindows … Each must be registered via addWindow"* — the structure-editor window is deliberately not registered ([main.ts:309-328](electron/main.ts#L309-L328)); the doc should note the exception.

### M13. No tests at all

The money/results core — `getStandings()`, `finalize()`, `checkTableHealth()`,
`bustPlayer`/`unbustPlayer`, the tick/rollover logic — is pure, deterministic
main-process TypeScript that would be trivial to unit-test with Vitest, and it's
exactly the code where a regression costs a real event (see C1, H1). There is no test
runner configured and no CI running `lint`/`tsc`.

---

## ⚪ Low

### L1. Dead code and unused artifacts

| Item | Where |
| --- | --- |
| `TournamentManager.nextLevel()` — superseded by `goToNextLevel()`; no caller (the `tournament:next-level` handler calls `goToNextLevel`) | [tournament.ts:343-353](electron/tournament.ts#L343-L353) |
| `Players.total_winnings` column — created, seeded, never written or read | [db.ts:20](electron/db.ts#L20), [types.d.ts:6](src/types.d.ts#L6), [tournament.ts:16](electron/tournament.ts#L16) |
| `electron-store` dependency — never imported | [package.json:16](package.json#L16) |
| `main-process-message` demo plumbing from the template | [main.ts:47-50](electron/main.ts#L47-L50), [main.tsx:12-15](src/main.tsx#L12-L15) |
| `handleSave(close: boolean)` — `close` is always `true` | [TournamentCreator.tsx:44](src/components/TournamentCreator.tsx#L44) |

### L2. Code duplication

| What | Copies |
| --- | --- |
| `placeLabel()` ordinal helper — a canonical version exists in [place.ts](src/utils/place.ts) but three components re-implement it against a *second, duplicate set of translation keys* (`creator.place*` vs `place.*`, both maintained in [translations.ts](src/i18n/translations.ts)) | [TournamentCreator.tsx:90-95](src/components/TournamentCreator.tsx#L90-L95), [ControlPanel.tsx:411-416](src/components/ControlPanel.tsx#L411-L416), [ProjectorView.tsx:107-112](src/components/ProjectorView.tsx#L107-L112) |
| Photo/image import (mkdir + timestamp-rand filename + `copyFileSync`) — three identical blocks | [main.ts:103-117](electron/main.ts#L103-L117), [main.ts:119-133](electron/main.ts#L119-L133), [main.ts:180-191](electron/main.ts#L180-L191) |
| `defaultAvatar` constant | [PlayerManagement.tsx:21](src/components/PlayerManagement.tsx#L21), [PlayerProfile.tsx:9](src/components/PlayerProfile.tsx#L9), [TournamentResultsView.tsx:9](src/components/TournamentResultsView.tsx#L9), [FinalizeStandingsModal.tsx:15](src/components/FinalizeStandingsModal.tsx#L15) |
| `Stat` and `BackLink` mini-components | [ControlPanel.tsx:343](src/components/ControlPanel.tsx#L343), [PlayerProfile.tsx:188-199](src/components/PlayerProfile.tsx#L188-L199), [TournamentResultsView.tsx:112-123](src/components/TournamentResultsView.tsx#L112-L123) |
| Inline delete-confirmation modals re-implementing the existing `ConfirmationModal` | [PlayerManagement.tsx:193-233](src/components/PlayerManagement.tsx#L193-L233), [StructureList.tsx:106-146](src/components/StructureList.tsx#L106-L146) |
| Currency-symbol map duplicating what `Intl`/`formatCurrency` already knows | [TournamentCreator.tsx:97-100](src/components/TournamentCreator.tsx#L97-L100) |
| `formatTime` / `formatBreakCountdown` overlap with [format.ts](src/utils/format.ts) | [ControlPanel.tsx:90-94](src/components/ControlPanel.tsx#L90-L94), [ProjectorView.tsx:92-98](src/components/ProjectorView.tsx#L92-L98) |
| `Player`/`Seat`/`Table`/`SeatMove`/`TournamentState` declared twice across the process boundary — documented as unavoidable in CLAUDE.md, but a shared `types/` directory included by both tsconfig projects would remove the risk of drift | [tournament.ts:3-81](electron/tournament.ts#L3-L81), [types.d.ts](src/types.d.ts) |

### L3. Template leftovers / branding

- App icon for every window is the electron-vite template SVG ([main.ts:40](electron/main.ts#L40), [main.ts:209](electron/main.ts#L209), [main.ts:314](electron/main.ts#L314)); the HTML favicon is `vite.svg` ([index.html:5](index.html#L5)). The app has a real logo in `src/assets/logo.png`.
- Sidebar version string `v0.1.0` is hardcoded ([App.tsx:61](src/App.tsx#L61)) instead of read from `package.json` (will silently lie after the next version bump).

### L4. Minor robustness nits

- `applySavedRow` mutates `tournamentId`/`name` before `JSON.parse` — a corrupt `state` column leaves the singleton half-hydrated ([tournament.ts:211-238](electron/tournament.ts#L211-L238)). Parse first, assign after.
- `finalize`'s "skip" path fires `stopTournament()` (fire-and-forget `send`) and immediately calls `onFinalized()`, which re-queries running tournaments — a small race where the archived tournament can still appear ([FinalizeStandingsModal.tsx:67-75](src/components/FinalizeStandingsModal.tsx#L67-L75)).
- `fs.mkdirSync(dir)` without `recursive: true` in the three photo-import blocks — fails if `userData` itself doesn't exist yet.
- `getStructures()` has no `ORDER BY` — list order is technically undefined ([db.ts:180-183](electron/db.ts#L180-L183)).
- `powerSaveBlocker.start('prevent-display-sleep')` runs unconditionally for the app's whole lifetime ([main.ts:89](electron/main.ts#L89)) — it only needs to be active while a tournament clock is running (and arguably should be `prevent-app-suspension` + fullscreen-projector-only display blocking).
- `bustPlayer` on an unassigned player is a silent no-op ([tournament.ts:528-555](electron/tournament.ts#L528-L555)); the UI never offers it, but the asymmetry matters for C1's fix.
- `StructureEditor` rows are keyed by array index while being drag-reorderable — controlled inputs keep values correct, but focus/DOM state can jump on reorder ([StructureEditor.tsx:206-209](src/components/StructureEditor.tsx#L206-L209)).
- Slider drag in ControlPanel sends a `tournament:set-time-left` IPC (each one triggering a full save + broadcast) for **every** pointer-move tick ([ControlPanel.tsx:225-229](src/components/ControlPanel.tsx#L225-L229)); debouncing or send-on-release would do.

---

## Suggested fix order

1. **C1** — make `checkTableHealth` count unassigned players and/or add a table when un-busting into a full room. This is the one that can strand a real event.
2. **H1** — stop renumbering prize places (one-line fix, money correctness).
3. **H3** — pause the timer in `balanceTables` (one-line fix).
4. **H2** — delete photo files and scrub state snapshots on player delete.
5. **H4, M3, M4** — small, mechanical fixes (loadFile hash option, verbose gate, capture insert id).
6. **M13** — stand up Vitest and cover `getStandings`/`finalize`/`checkTableHealth` before touching them for C1.
7. Everything else opportunistically, Medium before Low.
