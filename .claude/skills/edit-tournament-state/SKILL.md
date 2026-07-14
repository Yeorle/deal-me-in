---
name: edit-tournament-state
description: Use when adding, removing, or changing a field on TournamentState (the shape broadcast to all windows via `timer-update`). Forces you to update both the main-process and renderer type declarations and to handle the persistence/restore round-trip — easy to forget one and ship a partial change.
---

# Editing the tournament state shape

`TournamentState` is the canonical snapshot the renderer sees. It flows: `TournamentManager.getState()` → `broadcastState()` → `timer-update` event → every registered `BrowserWindow`. It's also persisted to SQLite on every mutation and rehydrated on startup.

## Files that must move together

1. **`electron/tournament.ts`**
   - Update the `TournamentState` interface at the top.
   - If the field is part of long-lived state (not derived), add a private property on `TournamentManager` and initialize it in `initialize()`.
   - Update `getState()` to include the new field.
   - Update `save()` so the field is written to the SQLite `state` JSON.
   - Update `load()` to read the field back, with a sensible default for tournaments saved before the field existed (`state.foo ?? defaultValue`).
   - Update `reset()` if the field needs clearing on `tournament:stop`.

2. **`src/types.d.ts`**
   - Mirror the change on the renderer-side `TournamentState` (currently inlined inside `Window['api']` and the per-component `TimerState` shapes — there is no shared `TournamentState` interface in the renderer yet).
   - If you're adding a new domain shape (like `SeatMove` was), declare it here AND in `electron/tournament.ts`. They can't share a file across the process boundary.

3. **Consumers in `src/components/`**
   - `ControlPanel.tsx`, `ProjectorView.tsx`, and `ManagePlayersModal.tsx` are the main consumers of `timer-update`. Each maps the broadcast payload into a local component-state shape (`TimerState`). Update those mappings.
   - If the field affects what the user sees, also reflect it in `TournamentCreator` (creation form) and the `tournament:create` IPC handler in `main.ts`, which calls `tournamentManager.initialize(...)`.

## The persistence round-trip is the easy thing to miss

`broadcastState()` calls `save()`, so any field you stop writing in `save()` will be lost on restart. And `load()` runs on app startup against tournaments saved with the *old* shape — always default-coalesce missing fields rather than trusting they're present.

## If the field changes existing semantics

`load()` runs against rows persisted under the previous shape. Either:
- Default-coalesce on read (`state.foo ?? oldEquivalent`), or
- Migrate explicitly during `load()` and re-save.

There are no SQL migrations — the schema is `state JSON` and you handle versioning in code.

## Verify

```bash
npm run lint
npm run dev
```

Smoke-test:
1. Create a fresh tournament — does the new field appear correctly in `ControlPanel` / `ProjectorView`?
2. Quit the Electron app and reopen — does `load()` restore correctly? (The DB lives at `~/Library/Application Support/<app>/poker_manager.db` on macOS — `app.getPath('userData')`.)
3. Open the projector window after creating a tournament — does it receive the field through the `addWindow()` immediate broadcast?
