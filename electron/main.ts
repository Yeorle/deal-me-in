import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { initDB, closeDB, getPlayers, addPlayer, saveStructure, getStructures, updatePlayer, deletePlayer, getStructure, updateStructure, deleteStructure, getArchivedTournaments, deleteTournament, getRunningTournaments, getSettings, setSetting, getTournamentResults, getPlayerProfile } from './db'
import { tournamentManager, Player, MAX_PLAYERS_PER_TABLE } from './tournament'
import { exportAllData, importAllData, MediaExtractionError } from './backup'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
// Single-instance refs for the secondary windows. Without these, repeated
// clicks stack multiple fullscreen projectors (all receiving every broadcast).
let projectorWin: BrowserWindow | null = null
let structureEditorWin: BrowserWindow | null = null

// A custom protocol to serve local files (player photos, projector images) to
// the renderer. Required because in dev the renderer is served over http://, and
// Chromium refuses to load file:// resources from a non-file origin. Must be
// registered before the app `ready` event.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// Copy a user-picked file into a subdirectory of userData with a unique name
// and return the new absolute path (player photos, projector images).
function importFileToUserData(sourcePath: string, subdir: string): string {
  const dir = path.join(app.getPath('userData'), subdir)
  fs.mkdirSync(dir, { recursive: true })
  const ext = path.extname(sourcePath)
  // The random suffix can be shorter than expected (or empty), so loop until
  // the name is genuinely unused rather than overwrite an existing file.
  let newPath: string
  do {
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`
    newPath = path.join(dir, filename)
  } while (fs.existsSync(newPath))
  fs.copyFileSync(sourcePath, newPath)
  return newPath
}

// Renderer hardening: a compromised renderer must not be able to open new
// windows or navigate the app window away from the local bundle.
function hardenWindow(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
}

function broadcastToAllWindows(channel: string, payload?: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

// After a backup import the old renderers stay alive until their reload lands
// (1.5 s, so the success notice is visible). During that window a stray
// Bust/Stop/Finalize click would mutate the freshly imported tournament and
// be persisted by the next broadcast — freeze input until the reload swaps
// in a fresh renderer.
function freezeAndReloadAllWindows() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.setEnabled(false)
  }
  setTimeout(() => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.setEnabled(true)
        w.webContents.reload()
      }
    }
  }, 1500)
}

function createWindow() {
  const created = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    autoHideMenuBar: true,
  })
  win = created
  hardenWindow(created)

  // Track destruction so the macOS `activate` handler knows whether the main
  // control window still exists when a projector/editor window is open.
  created.on('closed', () => {
    if (win === created) win = null
  })

  if (VITE_DEV_SERVER_URL) {
    created.loadURL(VITE_DEV_SERVER_URL)
  } else {
    created.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // Register the window so it receives `timer-update` / `seat-moves-notification`
  // broadcasts. This must happen for every window we create — including ones
  // re-created via the macOS `activate` event below — or it would render the
  // initial state but never update on subsequent ticks.
  tournamentManager.addWindow(created)
  // The main control window is the one that plays tournament sound cues.
  tournamentManager.setPrimaryWindow(created)
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('will-quit', () => {
  // Checkpoint/truncate the WAL file on a clean exit.
  closeDB()
})

app.on('activate', () => {
  // On macOS re-create the main control window when the dock icon is clicked
  // and it isn't open — even if a projector/editor window is still around,
  // otherwise the operator is stranded with no way back to the controls (the
  // clock would keep running invisibly behind the projector).
  if (!win || win.isDestroyed()) {
    createWindow()
  } else {
    win.focus()
  }
})

app.whenReady().then(() => {
  initDB()

  // Serve local files via `media://local/<encodeURIComponent(absolutePath)>`.
  // Only files inside the app-managed media directories are served — the
  // renderer must not get an arbitrary-file-read primitive.
  const allowedMediaRoots = [
    path.join(app.getPath('userData'), 'photos'),
    path.join(app.getPath('userData'), 'projector'),
  ]
  protocol.handle('media', (request) => {
    const encoded = new URL(request.url).pathname.replace(/^\//, '')
    let filePath: string
    try {
      filePath = path.resolve(decodeURIComponent(encoded))
      // Resolve symlinks before the allow-list check: a symlink under an
      // allowed media dir could otherwise point at any file on disk.
      filePath = fs.realpathSync(filePath)
    } catch {
      // Malformed percent-encoding or a missing file must not throw out of the
      // handler (and a realpath failure means there is nothing to serve).
      return new Response('Forbidden', { status: 403 })
    }
    const permitted = allowedMediaRoots.some(root => filePath.startsWith(root + path.sep))
    if (!permitted) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  ipcMain.handle('db:get-players', () => {
    return getPlayers()
  })


  ipcMain.handle('db:add-player', (_event, player) => {
    let importedPhotoPath: string | null = null
    if (player.photoPath) {
      player.photo_path = importFileToUserData(player.photoPath, 'photos');
      importedPhotoPath = player.photo_path
    }
    try {
      return addPlayer(player)
    } catch (e) {
      // The insert never landed — don't orphan the just-imported file
      // (db:update-player below does the same cleanup).
      if (importedPhotoPath) {
        try {
          fs.unlinkSync(importedPhotoPath)
        } catch {
          // best-effort cleanup
        }
      }
      throw e
    }
  })

  ipcMain.handle('db:update-player', (_event, player) => {
    let importedPhotoPath: string | null = null
    if (player.photoPath) {
      player.photo_path = importFileToUserData(player.photoPath, 'photos');
      importedPhotoPath = player.photo_path
    }
    let result
    try {
      result = updatePlayer(player)
    } catch (e) {
      // The write never landed — don't orphan the just-imported file.
      if (importedPhotoPath) {
        try {
          fs.unlinkSync(importedPhotoPath)
        } catch {
          // best-effort cleanup
        }
      }
      throw e
    }
    // If the write didn't land (e.g. the player was soft-deleted elsewhere),
    // the just-imported file would otherwise be orphaned.
    if (importedPhotoPath && result.changes === 0) {
      try {
        fs.unlinkSync(importedPhotoPath)
      } catch {
        // best-effort cleanup
      }
      return result
    }
    // The live tournament holds its own copies of player data; without this
    // the broadcasts would keep re-saving the old name/photo path (a replaced
    // photo file is unlinked by updatePlayer, so the old path now dangles).
    if (result.changes > 0) {
      tournamentManager.updatePlayerInfo(player.id, {
        name: player.name,
        nickname: player.nickname ?? null,
        photo_path: player.photo_path ?? null,
      })
    }
    return result
  })

  ipcMain.handle('db:delete-player', (_event, id) => {
    // If the player is in the live tournament, drop them first: otherwise the
    // next broadcast would re-save their PII/photo path over the scrub below.
    tournamentManager.removePlayerFromTournament(id)
    return deletePlayer(id)
  })

  // Structure mutations notify every window so open lists refresh without
  // polling (the editor lives in a separate BrowserWindow).
  ipcMain.handle('db:save-structure', (_event, structure) => {
    const result = saveStructure(structure)
    broadcastToAllWindows('structures-updated')
    return result
  })

  ipcMain.handle('db:get-structures', () => {
    return getStructures()
  })

  ipcMain.handle('db:get-structure', (_event, id) => {
    return getStructure(id)
  })

  ipcMain.handle('db:update-structure', (_event, structure) => {
    const result = updateStructure(structure)
    broadcastToAllWindows('structures-updated')
    return result
  })

  ipcMain.handle('db:delete-structure', (_event, id) => {
    const result = deleteStructure(id)
    broadcastToAllWindows('structures-updated')
    return result
  })

  ipcMain.handle('db:get-archived-tournaments', () => {
    return getArchivedTournaments()
  })

  ipcMain.handle('db:delete-tournament', (_event, id) => {
    return deleteTournament(id)
  })

  ipcMain.handle('db:get-settings', () => {
    return getSettings()
  })

  ipcMain.handle('db:set-setting', (_event, { key, value }: { key: string; value: string }) => {
    setSetting(key, value)
    const updated = getSettings()
    broadcastToAllWindows('settings-update', updated)
    return updated
  })

  ipcMain.handle('projector:import-image', (_event, { sourcePath }: { sourcePath: string }) => {
    return importFileToUserData(sourcePath, 'projector');
  })

  // Full-data backup export/import (electron/backup.ts). Errors cross IPC as
  // structured { ok, error } values — thrown errors get wrapped/mangled by
  // Electron's IPC serialization.
  ipcMain.handle('data:export', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    if (!senderWin) return { ok: false, error: 'No window' }
    try {
      const date = new Date().toISOString().slice(0, 10)
      const result = await dialog.showSaveDialog(senderWin, {
        defaultPath: `deal-me-in-backup-${date}.dmibak`,
        filters: [{ name: 'Deal Me In backup', extensions: ['dmibak'] }],
      })
      if (result.canceled || !result.filePath) return { ok: true, canceled: true }
      // Flush the live tournament (if any) so the archive captures it as of now.
      tournamentManager.persist()
      exportAllData(result.filePath)
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('data:import', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    if (!senderWin) return { ok: false, error: 'No window' }
    let wasRunning = false
    try {
      const result = await dialog.showOpenDialog(senderWin, {
        filters: [{ name: 'Deal Me In backup', extensions: ['dmibak', 'zip'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true }
      wasRunning = !tournamentManager.getState().isPaused
      // Stop the live tournament's timer first: a tick between the DB swap and
      // the reload would save() stale state on top of the imported rows.
      tournamentManager.pauseTimer()
      const { safetyBackupPath } = importAllData(result.filePaths[0])
      // No app.relaunch() here: it strands dev against a dead vite server
      // (vite-plugin-electron exits with the electron process) and is a no-op
      // from an AppImage's unmounted squashfs. Instead, rehydrate the
      // singleton from the imported rows right away, then reload every window
      // after a short delay so the renderer can show its success notice.
      tournamentManager.reloadFromDb()
      freezeAndReloadAllWindows()
      return { ok: true, backupPath: safetyBackupPath }
    } catch (e) {
      if (e instanceof MediaExtractionError) {
        // The DB swap committed but some media files could not be extracted.
        // The in-memory singleton is stale now: resuming it would let the next
        // tick's save() overwrite the freshly imported rows. Rehydrate from the
        // imported DB instead, keep the clock paused, and reload the windows.
        tournamentManager.reloadFromDb()
        freezeAndReloadAllWindows()
        return { ok: false, error: e.message }
      }
      // Nothing was written (validation runs before any DB/media write), so
      // restoring the clock we paused for the attempt is safe.
      if (wasRunning) tournamentManager.startTimer()
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('tournament:bust-player', (_event, playerId) => {
    tournamentManager.bustPlayer(playerId);
  })

  ipcMain.handle('tournament:unbust-player', (_event, playerId) => {
    tournamentManager.unbustPlayer(playerId);
  })

  ipcMain.handle('tournament:seat-player', (_event, { playerId, tableNumber, seatNumber }) => {
    tournamentManager.seatPlayer(playerId, tableNumber, seatNumber);
  })

  ipcMain.handle('window:open-projector', () => {
    // Reuse an existing projector rather than stacking fullscreen windows that
    // all receive every broadcast.
    if (projectorWin && !projectorWin.isDestroyed()) {
      if (projectorWin.isMinimized()) projectorWin.restore()
      projectorWin.focus()
      return
    }
    const created = new BrowserWindow({
      width: 800,
      height: 600,
      icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.mjs'),
      },
      fullscreen: true,
      autoHideMenuBar: true,
    })
    projectorWin = created
    created.on('closed', () => {
      if (projectorWin === created) projectorWin = null
    })
    hardenWindow(created)

    if (VITE_DEV_SERVER_URL) {
      created.loadURL(`${VITE_DEV_SERVER_URL}#/projector`)
    } else {
      // loadFile handles path→URL conversion (Windows backslashes, drive
      // letters, special characters); hand-built file:// strings do not.
      created.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: '/projector' })
    }

    tournamentManager.addWindow(created)
  })

  ipcMain.on('start-timer', () => {
    tournamentManager.startTimer();
  })

  ipcMain.on('pause-timer', () => {
    tournamentManager.pauseTimer();
  })

  ipcMain.on('tournament:set-time-left', (_e, seconds: number) => tournamentManager.setTimeLeftInLevel(seconds));
  ipcMain.on('tournament:next-level', () => tournamentManager.goToNextLevel());
  ipcMain.on('tournament:previous-level', () => tournamentManager.goToPreviousLevel());

  ipcMain.handle('tournament:create', (_event, { structureId, playerIds, maxPlayersPerTable, name, autoBalance, autoMerge, shuffleFinalTable, prizes, entryFee }) => {
    // IPC input is not trusted: a non-positive table size makes the seating
    // math degenerate (Math.ceil(n/0) = Infinity loops forever in doSeatPlayers),
    // and an absurdly large one would allocate that many Seat objects.
    if (!Number.isInteger(maxPlayersPerTable) || maxPlayersPerTable < 1 || maxPlayersPerTable > MAX_PLAYERS_PER_TABLE) {
      throw new Error('Invalid table size');
    }
    const structure = getStructure(structureId) as { name: string; data: string; starting_chips: number } | undefined;
    if (!structure) throw new Error('Structure not found');

    // Parse levels from structure data
    let rawLevels: { smallBlind: number; bigBlind: number; ante?: number; duration: number }[];
    try {
      rawLevels = JSON.parse(structure.data);
    } catch {
      throw new Error('The selected structure\u2019s level data is corrupt — re-save the structure and try again');
    }
    if (!Array.isArray(rawLevels) || rawLevels.length === 0) {
      throw new Error('The selected structure has no levels');
    }
    const parsedData = rawLevels.map(level => ({
      ...level,
      duration: level.duration * 60
    }));

    // Get all players and filter
    const allPlayers = getPlayers() as Player[];
    const selectedPlayers = allPlayers.filter(p => p.id != null && playerIds.includes(p.id));

    const senderWin = BrowserWindow.fromWebContents(_event.sender);
    // Throw rather than silently return undefined — the renderer must not
    // believe the create succeeded.
    if (!senderWin) throw new Error('Could not resolve the window that requested the tournament');

    // Snapshot the entry fee and the currency in effect now, plus the structure
    // name (so history survives structure rename/deletion).
    const settings = getSettings();
    const meta = {
      entryFee: Number(entryFee) || 0,
      currency: settings.currency || 'EUR',
      structureId,
      structureName: structure.name,
    };

    // Initialize tournament (players start as unassigned)
    // We pass maxPlayersPerTable as the preference
    tournamentManager.initialize(senderWin, parsedData, selectedPlayers, maxPlayersPerTable, name, autoBalance, autoMerge, !!shuffleFinalTable, structure.starting_chips ?? 0, prizes ?? [], meta);

    return { success: true };
  })

  ipcMain.handle('tournament:randomize-seating', (_event, playersPerTable) => {
    tournamentManager.randomizeSeating(playersPerTable);
  })

  ipcMain.handle('tournament:get-state', () => {
    return tournamentManager.getState();
  })

  ipcMain.handle('tournament:get-running-tournaments', () => {
    return getRunningTournaments();
  })

  ipcMain.handle('tournament:switch', (_event, id: number) => {
    tournamentManager.switchTournament(id);
  })

  // invoke (not send) so the renderer can await the archive before re-querying
  // the running-tournament list.
  ipcMain.handle('tournament:stop', () => {
    tournamentManager.reset();
  })

  ipcMain.handle('tournament:get-standings', () => {
    return tournamentManager.getStandings();
  })

  ipcMain.handle('tournament:finalize', (_event, orderedSurvivorIds: number[]) => {
    return tournamentManager.finalize(orderedSurvivorIds ?? []);
  })

  ipcMain.handle('db:get-tournament-results', (_event, id: number) => {
    return getTournamentResults(id);
  })

  ipcMain.handle('db:get-player-profile', (_event, id: number) => {
    return getPlayerProfile(id);
  })

  ipcMain.handle('window:open-structure-editor', (_event, id?) => {
    // `window=1` tells the renderer this route lives in its own BrowserWindow, so
    // its close buttons may call window.close() (vs navigate back when the same
    // route is rendered inside the main window).
    const hash = id ? `/structure-editor?id=${id}&window=1` : '/structure-editor?window=1';

    // Reuse the existing editor instead of opening duplicates. If a specific
    // structure was requested, navigate the open window to it.
    if (structureEditorWin && !structureEditorWin.isDestroyed()) {
      if (id) {
        if (VITE_DEV_SERVER_URL) {
          structureEditorWin.loadURL(`${VITE_DEV_SERVER_URL}#${hash}`)
        } else {
          structureEditorWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash })
        }
      }
      if (structureEditorWin.isMinimized()) structureEditorWin.restore()
      structureEditorWin.focus()
      return
    }

    const created = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Structure Editor',
      icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.mjs'),
      },
      autoHideMenuBar: true,
    })
    structureEditorWin = created
    created.on('closed', () => {
      if (structureEditorWin === created) structureEditorWin = null
    })
    hardenWindow(created)

    if (VITE_DEV_SERVER_URL) {
      created.loadURL(`${VITE_DEV_SERVER_URL}#${hash}`)
    } else {
      created.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash })
    }
  })

  createWindow()

  // Try to restore active tournament
  tournamentManager.load();
}).catch((e) => {
  // A failure before ready (corrupt/locked DB, protocol registration, …)
  // would otherwise be a silent unhandled rejection with no usable window.
  console.error('Startup failed:', e)
  dialog.showErrorBox(
    'Deal Me In failed to start',
    e instanceof Error ? e.message : String(e)
  )
  app.quit()
})
