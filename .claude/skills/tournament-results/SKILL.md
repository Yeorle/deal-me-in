---
name: tournament-results
description: Use when working on tournament results, history, player profiles, the finalize/standings flow, or any per-player reporting stat (place, playtime, prize, earnings). Covers where the canonical data lives, how standings are computed, and the cross-cutting rules (soft-deleted players, currency snapshots, earnings are derived) that are easy to get wrong.
---

# Tournament results & reporting

When a tournament is finalized, one row per player is written to the **`TournamentResults`** table (`tournament_id`, `player_id`, `place`, `playtime_sec`, `prize`, `entry_fee`). This table is the **single source of truth** for the History pages and Player profiles. Do **not** re-derive results from the tournament `state` JSON in reporting code.

## The pipeline, end to end

1. **During play** (`electron/tournament.ts`)
   - `bustPlayer()` appends to `bustedPlayers[]` and records `this.elapsedTime` into `bustElapsed[playerId]`. `unbustPlayer()` reverses both.
   - `bustedPlayers[]` order = finishing order (first out = last place). `bustElapsed[id]` = that player's playtime.
   - Both `entryFee` and `bustElapsed` live in the persisted `state` JSON (`getStateForSave` / `applySavedRow`) so finalize survives a restart.

2. **Finalize** (`FinalizeStandingsModal` → `tournament:finalize`)
   - `getStandings()` returns provisional `StandingRow[]`: survivors (still seated/unassigned) pre-ordered by seating at places `1..n`, busted players at fixed places `n+1..total`.
   - The operator reorders survivors; `finalize(orderedSurvivorIds)` recomputes places, looks up `prizeForPlace`, and calls `saveTournamentResults`.
   - Survivor playtime = full `elapsedTime`; busted playtime = `bustElapsed[id]`.
   - The alternative is `reset()` (`tournament:stop`) — archives with **no** results.

3. **Reporting** (`electron/db.ts`)
   - `getArchivedTournaments()` — History list (entrants, prize pool, winner via subqueries).
   - `getTournamentResults(id)` — one tournament's meta + ranked result rows (joined to `Players`).
   - `getPlayerProfile(id)` — a player's aggregate stats + per-tournament history.
   - Renderer: `TournamentHistory`, `TournamentResultsView`, `PlayerProfile`.

## Rules that bite if you forget them

- **Earnings are derived, never stored.** Always compute `prize − entry_fee` in the renderer. Don't add an `earnings` column.
- **Soft-deleted players.** A deleted player's row stays (FK intact) with `name = ''` and `is_deleted = 1`. Any reporting join must tolerate a blank/`NULL` name and render the `common.deletedPlayer` placeholder (`???`). Never make a results query inner-filter on `is_deleted`.
- **Currency is per-tournament.** `Tournaments.currency` is snapshotted at creation. Format historical money with `formatCurrencyWith(amount, tournament.currency, language)`, not the live `formatCurrency` from settings. (Player-profile aggregates are the documented exception — they sum across tournaments using the current setting.)
- **Place is 1-based**, 1 = winner. Use `placeLabel(place, t)` (`src/utils/place.ts`) for ordinals and `formatDuration(seconds)` for playtime.

## Adding a new stat or column

- A new **per-result field** → add the column in the `CREATE TABLE` *and* in `migrateSchema()` (existing DBs), populate it in `finalize()` / `saveTournamentResults`, and surface it in the relevant `db.ts` query + renderer page. Mirror any new shape in both `electron/tournament.ts` and `src/types.d.ts` (type-duplication rule).
- A new **aggregate stat** (no schema change) → extend the `SELECT` in `getPlayerProfile()` and the `PlayerProfileData.stats` type, then render it.
- New IPC for any of this → follow `/add-ipc-channel`.

## Verify

```bash
npm run lint
npx tsc --noEmit
npm run dev
```

Smoke-test the loop: create a tournament with an entry fee → bust some players → **Terminate** → reorder survivors → **Save Results & Archive** → check the History list, the results detail (places/playtime/earnings), and a player's profile (stats + history). Then delete a player and confirm they show as `???` in that tournament's results.
