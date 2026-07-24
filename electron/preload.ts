import { ipcRenderer, contextBridge, IpcRendererEvent, webUtils } from 'electron'

// --------- Expose some API to the Renderer process ---------

// The raw bridge is channel-whitelisted: exposing generic invoke/send/on would
// let any compromised renderer code drive arbitrary IPC (see Electron's
// security checklist). Everything else goes through `window.api` below.
const ALLOWED_ON_CHANNELS = ['timer-update', 'structures-updated']
const ALLOWED_SEND_CHANNELS = ['start-timer', 'pause-timer']

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (...args: unknown[]) => void) {
    if (!ALLOWED_ON_CHANNELS.includes(channel)) {
      throw new Error(`ipcRenderer.on: channel "${channel}" is not allowed`)
    }
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, subscription)
    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
  send(channel: string, ...args: unknown[]) {
    if (!ALLOWED_SEND_CHANNELS.includes(channel)) {
      throw new Error(`ipcRenderer.send: channel "${channel}" is not allowed`)
    }
    ipcRenderer.send(channel, ...args)
  },
})

contextBridge.exposeInMainWorld('api', {
  getPlayers: () => ipcRenderer.invoke('db:get-players'),
  addPlayer: (player: unknown) => ipcRenderer.invoke('db:add-player', player),
  updatePlayer: (player: unknown) => ipcRenderer.invoke('db:update-player', player),
  deletePlayer: (id: number) => ipcRenderer.invoke('db:delete-player', id),
  saveStructure: (structure: unknown) => ipcRenderer.invoke('db:save-structure', structure),
  getStructure: (id: number) => ipcRenderer.invoke('db:get-structure', id),
  updateStructure: (structure: unknown) => ipcRenderer.invoke('db:update-structure', structure),
  deleteStructure: (id: number) => ipcRenderer.invoke('db:delete-structure', id),
  randomizeSeating: (playersPerTable?: number) => ipcRenderer.invoke('tournament:randomize-seating', playersPerTable),
  bustPlayer: (playerId: number) => ipcRenderer.invoke('tournament:bust-player', playerId),
  unbustPlayer: (playerId: number) => ipcRenderer.invoke('tournament:unbust-player', playerId),
  seatPlayer: (playerId: number, tableNumber: number, seatNumber: number) => ipcRenderer.invoke('tournament:seat-player', { playerId, tableNumber, seatNumber }),
  openProjector: () => ipcRenderer.invoke('window:open-projector'),
  getStructures: () => ipcRenderer.invoke('db:get-structures'),
  openStructureEditor: (id?: number) => ipcRenderer.invoke('window:open-structure-editor', id),
  createTournament: (config: { structureId: number; playerIds: number[]; maxPlayersPerTable: number; name: string; autoBalance: boolean; autoMerge: boolean; shuffleFinalTable: boolean; prizes: { place: number; amount: number }[]; entryFee: number }) => ipcRenderer.invoke('tournament:create', config),
  getTournamentState: () => ipcRenderer.invoke('tournament:get-state'),
  getStandings: () => ipcRenderer.invoke('tournament:get-standings'),
  finalizeTournament: (orderedSurvivorIds: number[]) => ipcRenderer.invoke('tournament:finalize', orderedSurvivorIds),
  getTournamentResults: (id: number) => ipcRenderer.invoke('db:get-tournament-results', id),
  getPlayerProfile: (id: number) => ipcRenderer.invoke('db:get-player-profile', id),
  getRunningTournaments: () => ipcRenderer.invoke('tournament:get-running-tournaments'),
  switchTournament: (id: number) => ipcRenderer.invoke('tournament:switch', id),
  stopTournament: () => ipcRenderer.invoke('tournament:stop'),
  setTimeLeft: (seconds: number) => ipcRenderer.send('tournament:set-time-left', seconds),
  nextLevel: () => ipcRenderer.send('tournament:next-level'),
  previousLevel: () => ipcRenderer.send('tournament:previous-level'),
  getArchivedTournaments: () => ipcRenderer.invoke('db:get-archived-tournaments'),
  deleteTournament: (id: number) => ipcRenderer.invoke('db:delete-tournament', id),
  onSeatMoves: (callback: (moves: unknown[]) => void) => {
    const subscription = (_event: IpcRendererEvent, moves: unknown[]) => callback(moves);
    ipcRenderer.on('seat-moves-notification', subscription);
    return () => ipcRenderer.removeListener('seat-moves-notification', subscription);
  },
  getSettings: () => ipcRenderer.invoke('db:get-settings'),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('db:set-setting', { key, value }),
  importProjectorImage: (sourcePath: string) => ipcRenderer.invoke('projector:import-image', { sourcePath }),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  // Resolve the absolute filesystem path of a File from an <input type="file">.
  // Replaces the deprecated File.path, which is empty under the renderer sandbox.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onSettingsUpdate: (callback: (settings: Record<string, string>) => void) => {
    const subscription = (_event: IpcRendererEvent, settings: Record<string, string>) => callback(settings);
    ipcRenderer.on('settings-update', subscription);
    return () => ipcRenderer.removeListener('settings-update', subscription);
  },
  onSoundCue: (callback: (cue: string) => void) => {
    const subscription = (_event: IpcRendererEvent, cue: string) => callback(cue);
    ipcRenderer.on('sound-cue', subscription);
    return () => ipcRenderer.removeListener('sound-cue', subscription);
  }
})
