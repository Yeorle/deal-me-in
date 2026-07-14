---
name: add-ipc-channel
description: Use when adding a new IPC method that the renderer should call on the main process (DB query, tournament action, window action). Walks through every file that has to be touched, in the order that minimizes broken intermediate states.
---

# Adding a new IPC channel

The renderer can only reach the main process through the bridge in `electron/preload.ts`. Adding a new method touches **five** layers. Do them in this order:

## 1. Implement the work in the main process

Pick the right home:

- Database CRUD → new function in `electron/db.ts`, exported.
- Tournament state mutation → new method on `TournamentManager` in `electron/tournament.ts`. If it changes state, end with `this.broadcastState()` (which also persists). If it generates seat movements, also call `this.broadcastMoves(moves)`.
- New `BrowserWindow` → put creation logic directly in the IPC handler in `main.ts`, and call `tournamentManager.addWindow(win)` if the window needs `timer-update` broadcasts.

## 2. Register the IPC handler in `electron/main.ts`

Naming convention used in this codebase:

- `db:<verb>-<noun>` — DB CRUD (e.g., `db:get-players`, `db:delete-tournament`)
- `tournament:<verb>` — tournament mutations (e.g., `tournament:bust-player`, `tournament:create`)
- `window:open-<thing>` — opening a new window
- raw `start-timer` / `pause-timer` / `next-level` — fire-and-forget timer controls (these use `ipcMain.on`, not `handle`)

Choose `ipcMain.handle` for request/response (renderer awaits a value) and `ipcMain.on` for fire-and-forget. Match what the rest of the file does for similar channels.

## 3. Expose it in `electron/preload.ts`

Add the method to the `window.api` object (`contextBridge.exposeInMainWorld('api', {...})`). Wrap the corresponding `ipcRenderer.invoke(...)` or `ipcRenderer.send(...)` call.

## 4. Type it in `src/types.d.ts`

Add the method signature to the `Window['api']` interface. Avoid `any` for arguments — define a small inline type or reuse an existing one. If the new method introduces new domain shapes, declare them next to `Player` / `Seat` / `Table`. **Remember the type-duplication rule**: if the shape is also used in the main process, declare it in `electron/tournament.ts` too — they cannot share a file.

## 5. Call it from the renderer

Use `window.api.<method>(...)` directly — it's typed. Do **not** introduce new `(window as any).api` casts; that pattern is legacy and being phased out (see `PlayerManagement.tsx` for the typed form).

If your method depends on tournament state changes, the existing `timer-update` broadcast and the `getTournamentState()` initial-fetch pattern (see `ControlPanel.tsx`, `ProjectorView.tsx`) is almost always the right way to consume updates — don't add a parallel channel unless you have a real need.

## Verify

```bash
npm run lint   # must pass with --max-warnings 0
npm run dev    # exercise the new path end-to-end
```

There is no test runner. UI verification in the running Electron app is the only correctness check.
