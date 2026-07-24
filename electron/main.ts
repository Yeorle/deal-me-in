import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { initDB, getPlayers, addPlayer, saveStructure, getStructures, updatePlayer, deletePlayer, getStructure, updateStructure, deleteStructure, getArchivedTournaments, deleteTournament, getRunningTournaments, getSettings, setSetting, getTournamentResults, getPlayerProfile } from './db'
import { tournamentManager, Player } from './tournament'
import { exportAllData, importAllData } from './backup'

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
  const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`
  const newPath = path.join(dir, filename)
  fs.copyFileSync(sourcePath, newPath)
  return newPath
}

function broadcastToAllWindows(channel: string, payload?: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    autoHideMenuBar: true,
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // Register the window so it receives `timer-update` / `seat-moves-notification`
  // broadcasts. This must happen for every window we create — including ones
  // re-created via the macOS `activate` event below — or it would render the
  // initial state but never update on subsequent ticks.
  tournamentManager.addWindow(win)
  // The main control window is the one that plays tournament sound cues.
  tournamentManager.setPrimaryWindow(win)
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

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
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
    const filePath = path.resolve(decodeURIComponent(encoded))
    const permitted = allowedMediaRoots.some(root => filePath.startsWith(root + path.sep))
    if (!permitted) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  ipcMain.handle('db:get-players', () => {
    return getPlayers()
  })


  ipcMain.handle('db:add-player', (_event, player) => {
    if (player.photoPath) {
      player.photo_path = importFileToUserData(player.photoPath, 'photos');
    }
    return addPlayer(player)
  })

  ipcMain.handle('db:update-player', (_event, player) => {
    if (player.photoPath) {
      player.photo_path = importFileToUserData(player.photoPath, 'photos');
    }
    return updatePlayer(player)
  })

  ipcMain.handle('db:delete-player', (_event, id) => {
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
    const date = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(senderWin, {
      defaultPath: `deal-me-in-backup-${date}.dmibak`,
      filters: [{ name: 'Deal Me In backup', extensions: ['dmibak'] }],
    })
    if (result.canceled || !result.filePath) return { ok: true, canceled: true }
    try {
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
    const result = await dialog.showOpenDialog(senderWin, {
      filters: [{ name: 'Deal Me In backup', extensions: ['dmibak', 'zip'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true }
    try {
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
      setTimeout(() => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.reload()
        }
      }, 1500)
      return { ok: true, backupPath: safetyBackupPath }
    } catch (e) {
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
    const projectorWin = new BrowserWindow({
      width: 800,
      height: 600,
      icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.mjs'),
      },
      fullscreen: true,
      autoHideMenuBar: true,
    })

    if (VITE_DEV_SERVER_URL) {
      projectorWin.loadURL(`${VITE_DEV_SERVER_URL}#/projector`)
    } else {
      // loadFile handles path→URL conversion (Windows backslashes, drive
      // letters, special characters); hand-built file:// strings do not.
      projectorWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: '/projector' })
    }

    tournamentManager.addWindow(projectorWin)
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
    const structure = getStructure(structureId) as { name: string; data: string; starting_chips: number } | undefined;
    if (!structure) throw new Error('Structure not found');

    // Parse levels from structure data
    const rawLevels = JSON.parse(structure.data) as { smallBlind: number; bigBlind: number; ante?: number; duration: number }[];
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
    const editorWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Structure Editor',
      icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.mjs'),
      },
      autoHideMenuBar: true,
    })

    const hash = id ? `/structure-editor?id=${id}` : '/structure-editor';

    if (VITE_DEV_SERVER_URL) {
      editorWin.loadURL(`${VITE_DEV_SERVER_URL}#${hash}`)
    } else {
      editorWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash })
    }
  })

  createWindow()

  // Try to restore active tournament
  tournamentManager.load();
})
