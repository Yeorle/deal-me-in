import { app, BrowserWindow, powerSaveBlocker } from 'electron';

// Engine logs mention player names, so like the SQL logging in db.ts they are
// dev-only.
function devLog(...args: unknown[]) {
    if (!app?.isPackaged) console.log(...args);
}

interface Level {
    smallBlind: number;
    bigBlind: number;
    ante?: number;
    duration: number; // in seconds
    isBreak?: boolean;
}

export interface Player {
    id?: number;
    name: string;
    nickname?: string;
    email?: string;
    total_winnings?: number;
    photo_path?: string;
}

export type SeatLocation =
    | { kind: 'unassigned' }
    | { kind: 'seat'; tableNumber: number; seatNumber: number };

export type SeatMoveReason = 'random' | 'manual' | 'merge' | 'balance' | 'final-table';

export interface SeatMove {
    playerName: string;
    from: SeatLocation;
    to: SeatLocation;
    reason: SeatMoveReason;
}

export interface Prize {
    place: number;
    amount: number;
}

export interface StandingRow {
    place: number;
    playerId: number;
    name: string;
    photoPath?: string | null;
    playtimeSec: number;
    prize: number;
    isSurvivor: boolean; // true = still seated at finalize time (operator orders these)
}

export interface Seat {
    seatNumber: number;
    player: Player | null; // null if empty seat
}

export interface Table {
    tableNumber: number;
    seats: Seat[];
}

export interface TournamentState {
    id?: number;
    currentLevelIndex: number;
    timeLeftInLevel: number; // in seconds
    isPaused: boolean;
    playersRemaining: number;
    totalEntries: number;
    currentLevel?: Level;
    nextLevel?: Level;
    levels: Level[];
    tables: Table[];
    unassignedPlayers: Player[];
    bustedPlayers: Player[];
    isActive: boolean;
    name?: string;
    autoBalance?: boolean;
    autoMerge?: boolean;
    shuffleFinalTable?: boolean;
    startingChips?: number;
    timeUntilNextBreak?: number | null;
    elapsedTime: number; // total seconds the tournament has been running
    prizes: Prize[];
    entryFee?: number;
}

import { getRunningTournament, getTournamentById, createTournament, updateTournamentState, archiveTournament, saveTournamentResults, TournamentMeta } from './db';

// Unbiased Fisher–Yates shuffle (returns a new array). Used for every seat
// draw — `sort(() => Math.random() - 0.5)` is measurably non-uniform.
export function shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

export class TournamentManager {
    private tournamentId: number | null = null;
    private currentLevelIndex: number = 0;
    private timeLeftInLevel: number = 0;
    private isPaused: boolean = true;
    private playersRemaining: number = 0;
    private totalEntries: number = 0;
    private timerInterval: NodeJS.Timeout | null = null;
    private windows: Set<BrowserWindow> = new Set();
    // Sound cues play in a single window only (set to the main control window)
    // to avoid the same effect firing from every open BrowserWindow at once.
    private primaryWindow: BrowserWindow | null = null;
    private levels: Level[] = [];
    private tables: Table[] = [];
    private unassignedPlayers: Player[] = [];
    private bustedPlayers: Player[] = [];
    private playersPerTable: number = 9;
    private name: string = '';
    private autoBalance: boolean = true;
    private autoMerge: boolean = true;
    private shuffleFinalTable: boolean = false;
    private startingChips: number = 0;
    private elapsedTime: number = 0;
    private prizes: Prize[] = [];
    private entryFee: number = 0;
    // Tournament elapsed time (seconds) at the moment each player busted, keyed
    // by player id. Combined with bustedPlayers[] ordering this gives per-player
    // playtime and finishing place when the tournament is finalized.
    private bustElapsed: Record<number, number> = {};

    // Wall-clock anchor for the currently running segment. Null while paused.
    private segmentStartMs: number | null = null;   // Date.now() when the segment started
    private timeLeftAtSegmentStart: number = 0;      // timeLeftInLevel at that moment
    private elapsedAtSegmentStart: number = 0;       // elapsedTime at that moment

    // Keep the display awake only while a tournament clock is actually running.
    private powerSaveBlockerId: number | null = null;

    constructor() { }

    public initialize(mainWindow: BrowserWindow, levels: Level[], players: Player[], playersPerTable: number, name: string, autoBalance: boolean, autoMerge: boolean, shuffleFinalTable: boolean, startingChips: number, prizes: Prize[], meta: TournamentMeta) {
        // If another tournament is already loaded in the singleton, persist its
        // latest state before we overwrite the in-memory fields. Otherwise any
        // ticks/mutations since the last save would be lost.
        this.pauseTimer();
        this.save();

        this.addWindow(mainWindow);
        this.levels = levels;
        this.name = name;
        this.playersPerTable = playersPerTable;
        this.autoBalance = autoBalance;
        this.autoMerge = autoMerge;
        this.shuffleFinalTable = shuffleFinalTable;
        this.startingChips = startingChips;
        this.prizes = [...prizes].sort((a, b) => a.place - b.place);
        this.entryFee = meta.entryFee;
        this.bustElapsed = {};
        this.unassignedPlayers = [...players]; // Start with all players unassigned
        this.bustedPlayers = [];
        this.playersRemaining = players.length;
        this.totalEntries = players.length;
        this.currentLevelIndex = 0;
        this.tables = [];
        this.elapsedTime = 0;

        if (this.levels.length > 0) {
            this.timeLeftInLevel = this.levels[0].duration;
        }

        this.isPaused = true;

        // Create new tournament in DB. tournamentId is set BEFORE building the
        // state object so save() inside broadcastState() writes to the new row.
        this.tournamentId = null;
        const initialState = this.getStateForSave();
        const result = createTournament(name, initialState, meta);
        this.tournamentId = Number(result.lastInsertRowid);
        devLog(`Initialized tournament "${name}" with ID: ${this.tournamentId}`);

        this.broadcastState();
    }

    // Persist only what's needed to render a player. Email (and any other
    // future PII) must not be copied into tournament state snapshots — those
    // rows outlive the player and would survive a "delete player".
    private sanitizePlayer(p: Player): Player {
        return { id: p.id, name: p.name, nickname: p.nickname, photo_path: p.photo_path };
    }

    private getStateForSave() {
        return {
            currentLevelIndex: this.currentLevelIndex,
            timeLeftInLevel: this.timeLeftInLevel,
            isPaused: this.isPaused,
            playersRemaining: this.playersRemaining,
            totalEntries: this.totalEntries,
            levels: this.levels,
            tables: this.tables.map(t => ({
                tableNumber: t.tableNumber,
                seats: t.seats.map(s => ({
                    seatNumber: s.seatNumber,
                    player: s.player ? this.sanitizePlayer(s.player) : null
                }))
            })),
            unassignedPlayers: this.unassignedPlayers.map(p => this.sanitizePlayer(p)),
            bustedPlayers: this.bustedPlayers.map(p => this.sanitizePlayer(p)),
            autoBalance: this.autoBalance,
            autoMerge: this.autoMerge,
            shuffleFinalTable: this.shuffleFinalTable,
            playersPerTable: this.playersPerTable,
            startingChips: this.startingChips,
            elapsedTime: this.elapsedTime,
            prizes: this.prizes,
            entryFee: this.entryFee,
            bustElapsed: this.bustElapsed
        };
    }

    public load() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const saved = getRunningTournament() as any;
        if (saved) this.applySavedRow(saved);
    }

    public switchTournament(id: number) {
        if (this.tournamentId === id) return;

        this.pauseTimer();
        this.save();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const saved = getTournamentById(id) as any;
        if (!saved || saved.status !== 'running') {
            console.warn(`switchTournament: tournament ${id} is not running`);
            return;
        }
        this.applySavedRow(saved);
        this.broadcastState();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private applySavedRow(saved: any) {
        try {
            // Parse before assigning anything so a corrupt state column can't
            // leave the singleton half-hydrated.
            const state = JSON.parse(saved.state as string);
            this.tournamentId = saved.id;
            devLog('Restoring tournament state for ID:', this.tournamentId);
            this.name = saved.name;
            this.levels = state.levels || [];
            this.currentLevelIndex = state.currentLevelIndex;
            this.timeLeftInLevel = state.timeLeftInLevel;
            this.isPaused = true; // Always pause on restore/switch
            this.playersRemaining = state.playersRemaining;
            this.totalEntries = state.totalEntries;
            this.tables = state.tables || [];
            this.unassignedPlayers = state.unassignedPlayers || [];
            this.bustedPlayers = state.bustedPlayers || [];
            this.autoBalance = state.autoBalance ?? true;
            this.autoMerge = state.autoMerge ?? true;
            this.shuffleFinalTable = state.shuffleFinalTable ?? false;
            this.playersPerTable = state.playersPerTable ?? 9;
            this.startingChips = state.startingChips ?? 0;
            this.elapsedTime = state.elapsedTime ?? 0;
            this.prizes = state.prizes ?? [];
            this.entryFee = state.entryFee ?? 0;
            this.bustElapsed = state.bustElapsed ?? {};
        } catch (e) {
            console.error('Failed to parse saved tournament state', e);
        }
    }

    public addWindow(window: BrowserWindow) {
        this.windows.add(window);
        window.on('closed', () => {
            this.windows.delete(window);
            if (this.primaryWindow === window) this.primaryWindow = null;
        });
        window.webContents.send('timer-update', this.getState());
    }

    // Designate the window that plays sound cues (the main control window).
    public setPrimaryWindow(window: BrowserWindow) {
        this.primaryWindow = window;
    }

    private emitSoundCue(cue: 'level-warning' | 'level-start' | 'break-start' | 'eliminate') {
        // Prefer the designated primary window; fall back to any live window so
        // a cue is never silently dropped if the main window was re-created.
        const target = this.primaryWindow && !this.primaryWindow.isDestroyed()
            ? this.primaryWindow
            : [...this.windows].find(w => !w.isDestroyed()) ?? null;
        target?.webContents.send('sound-cue', cue);
    }

    private anchorTimer() {
        this.segmentStartMs = Date.now();
        this.timeLeftAtSegmentStart = this.timeLeftInLevel;
        this.elapsedAtSegmentStart = this.elapsedTime;
    }

    public startTimer() {
        if (!this.isPaused) return;

        this.isPaused = false;
        this.anchorTimer();
        if (this.powerSaveBlockerId === null) {
            this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
        }
        this.broadcastState();

        // Run at 250ms for a smoother display; tick() gates broadcasts on a
        // whole-second change so SQLite writes stay at ~1/sec.
        this.timerInterval = setInterval(() => {
            this.tick();
        }, 250);
    }

    public pauseTimer() {
        if (this.isPaused) return;

        this.isPaused = true;
        this.segmentStartMs = null;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.powerSaveBlockerId !== null) {
            powerSaveBlocker.stop(this.powerSaveBlockerId);
            this.powerSaveBlockerId = null;
        }
        this.broadcastState();
    }

    public toggleTimer() {
        if (this.isPaused) {
            this.startTimer();
        } else {
            this.pauseTimer();
        }
    }

    private tick() {
        if (this.segmentStartMs === null) return;

        const elapsedSegment = Math.floor((Date.now() - this.segmentStartMs) / 1000);
        const prevTimeLeft = this.timeLeftInLevel;

        this.elapsedTime = this.elapsedAtSegmentStart + elapsedSegment;
        let newTimeLeft = this.timeLeftAtSegmentStart - elapsedSegment;

        // Roll over any levels we've crossed (handles a lagged tick spanning a boundary).
        while (newTimeLeft <= 0) {
            if (this.currentLevelIndex < this.levels.length - 1) {
                const overshoot = -newTimeLeft;                  // seconds past the boundary
                this.currentLevelIndex++;
                const dur = this.levels[this.currentLevelIndex].duration;
                newTimeLeft = dur - overshoot;
                this.emitSoundCue(this.levels[this.currentLevelIndex].isBreak ? 'break-start' : 'level-start');
                // Re-anchor so the next tick measures from this new level start.
                this.segmentStartMs = Date.now() - (overshoot * 1000);
                this.timeLeftAtSegmentStart = dur;
                this.elapsedAtSegmentStart = this.elapsedTime;
            } else {
                newTimeLeft = 0;
                this.timeLeftInLevel = 0;
                this.pauseTimer();   // final level finished
                this.broadcastState();
                return;
            }
        }

        // Warning cue: fire when we CROSS the 5s mark (a lagged tick may skip exactly 5).
        if (prevTimeLeft > 5 && newTimeLeft <= 5) {
            this.emitSoundCue('level-warning');
        }

        const changed = newTimeLeft !== this.timeLeftInLevel;
        this.timeLeftInLevel = newTimeLeft;
        if (changed) this.broadcastState();
    }

    // Move the playhead within the current level. `seconds` = desired timeLeftInLevel.
    public setTimeLeftInLevel(seconds: number) {
        const cur = this.levels[this.currentLevelIndex];
        if (!cur) return;
        this.timeLeftInLevel = Math.max(0, Math.min(seconds, cur.duration));
        if (!this.isPaused) this.anchorTimer();
        this.broadcastState();
    }

    // Skip forward to the next level/break (no-op at the last level).
    public goToNextLevel() {
        if (this.currentLevelIndex >= this.levels.length - 1) return;
        this.currentLevelIndex++;
        this.timeLeftInLevel = this.levels[this.currentLevelIndex].duration;
        this.emitSoundCue(this.levels[this.currentLevelIndex].isBreak ? 'break-start' : 'level-start');
        if (!this.isPaused) this.anchorTimer();
        this.broadcastState();
    }

    // Back: >10s into current level → restart current level; else → previous level start.
    public goToPreviousLevel() {
        const cur = this.levels[this.currentLevelIndex];
        if (!cur) return;
        const elapsedInLevel = cur.duration - this.timeLeftInLevel;
        if (elapsedInLevel > 10 || this.currentLevelIndex === 0) {
            this.timeLeftInLevel = cur.duration;                 // restart current
        } else {
            this.currentLevelIndex--;                            // start of previous
            this.timeLeftInLevel = this.levels[this.currentLevelIndex].duration;
        }
        if (!this.isPaused) this.anchorTimer();
        this.broadcastState();
    }

    public reset() {
        this.pauseTimer();
        if (this.tournamentId) {
            devLog(`Archiving tournament ${this.tournamentId}`);
            archiveTournament(this.tournamentId);
            this.tournamentId = null;
        }

        this.clearInMemory();
        this.broadcastState();
    }

    public randomizeSeating(playersPerTable?: number) {
        if (this.unassignedPlayers.length === 0) return;

        const ppt = playersPerTable || this.playersPerTable;
        devLog(`Randomizing seating for ${this.unassignedPlayers.length} unassigned players with ${ppt} per table...`);

        const playersToSeat = shuffle(this.unassignedPlayers);

        // If tables already exist (e.g. re-seating an unbusted player), fill the
        // emptiest tables first instead of rebuilding the whole seating chart.
        if (this.tables.length > 0) {
            this.ensureSeatCapacity();
            const moves: SeatMove[] = [];
            const remaining: Player[] = [];

            for (const player of playersToSeat) {
                const candidates = this.tables
                    .map(t => ({
                        table: t,
                        count: t.seats.filter(s => s.player).length,
                        emptySeat: t.seats.find(s => s.player === null)
                    }))
                    .filter(c => c.emptySeat)
                    .sort((a, b) => a.count - b.count);

                if (candidates.length === 0) {
                    remaining.push(player);
                    continue;
                }

                const target = candidates[0];
                target.emptySeat!.player = player;
                moves.push({
                    playerName: player.name,
                    from: { kind: 'unassigned' },
                    to: { kind: 'seat', tableNumber: target.table.tableNumber, seatNumber: target.emptySeat!.seatNumber },
                    reason: 'random'
                });
            }

            this.unassignedPlayers = remaining;
            this.broadcastState();
            this.broadcastMoves(moves);
            return;
        }

        this.unassignedPlayers = []; // All will be seated
        this.doSeatPlayers(playersToSeat, ppt);
    }

    public seatPlayer(playerId: number, tableNumber: number, seatNumber: number) {
        const playerIdx = this.unassignedPlayers.findIndex(p => p.id === playerId);
        if (playerIdx === -1) return;

        const table = this.tables.find(t => t.tableNumber === tableNumber);
        if (!table) return;

        const seat = table.seats.find(s => s.seatNumber === seatNumber);
        if (!seat || seat.player !== null) return;

        const [player] = this.unassignedPlayers.splice(playerIdx, 1);
        seat.player = player;

        this.broadcastState();
        this.broadcastMoves([{
            playerName: player.name,
            from: { kind: 'unassigned' },
            to: { kind: 'seat', tableNumber, seatNumber },
            reason: 'manual'
        }]);
    }

    private doSeatPlayers(players: Player[], playersPerTable: number) {
        const shuffledPlayers = shuffle(players);

        const numTables = Math.ceil(shuffledPlayers.length / playersPerTable);
        this.tables = [];

        // Balanced distribution calculation
        const totalPlayers = shuffledPlayers.length;
        const basePlayers = Math.floor(totalPlayers / numTables);
        const extraPlayers = totalPlayers % numTables;

        let currentPlayerIdx = 0;
        const moves: SeatMove[] = [];

        for (let i = 0; i < numTables; i++) {
            const tableSeats: Seat[] = [];
            // Calculate how many players in this table
            // First 'extraPlayers' tables get basePlayers + 1, rest get basePlayers
            const playersInThisTable = i < extraPlayers ? basePlayers + 1 : basePlayers;

            for (let j = 0; j < playersPerTable; j++) {
                if (j < playersInThisTable && currentPlayerIdx < shuffledPlayers.length) {
                    const player = shuffledPlayers[currentPlayerIdx++];
                    tableSeats.push({
                        seatNumber: j + 1,
                        player: player
                    });
                    moves.push({
                        playerName: player.name,
                        from: { kind: 'unassigned' },
                        to: { kind: 'seat', tableNumber: i + 1, seatNumber: j + 1 },
                        reason: 'random'
                    });
                } else {
                    tableSeats.push({
                        seatNumber: j + 1,
                        player: null
                    });
                }
            }
            this.tables.push({
                tableNumber: i + 1,
                seats: tableSeats
            });
        }

        // Update counts
        this.playersRemaining = shuffledPlayers.length;
        this.totalEntries = shuffledPlayers.length;

        this.save();
        this.broadcastState();
        this.broadcastMoves(moves);
    }

    public bustPlayer(playerId: number) {
        let bustedPlayer: Player | null = null;

        for (const table of this.tables) {
            for (const seat of table.seats) {
                if (seat.player && seat.player.id === playerId) {
                    bustedPlayer = seat.player;
                    seat.player = null;
                    break;
                }
            }
            if (bustedPlayer) break;
        }

        // Unassigned players can bust too — most importantly this makes an
        // accidental un-bust reversible even when no seat is available.
        if (!bustedPlayer) {
            const idx = this.unassignedPlayers.findIndex(p => p.id === playerId);
            if (idx !== -1) {
                [bustedPlayer] = this.unassignedPlayers.splice(idx, 1);
            }
        }

        if (bustedPlayer) {
            this.playersRemaining--;
            this.bustedPlayers.push(bustedPlayer);
            if (bustedPlayer.id != null) {
                this.bustElapsed[bustedPlayer.id] = this.elapsedTime;
            }
            devLog(`Player ${bustedPlayer.name} busted and removed from seat.`);
            this.emitSoundCue('eliminate');
            this.checkTableHealth();
            this.broadcastState();
        }
    }

    public unbustPlayer(playerId: number) {
        const playerIndex = this.bustedPlayers.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
            const player = this.bustedPlayers[playerIndex];
            this.bustedPlayers.splice(playerIndex, 1);
            if (player.id != null) delete this.bustElapsed[player.id];

            // Move to unassigned players
            this.unassignedPlayers.push(player);
            this.playersRemaining++;

            devLog(`Player ${player.name} unbusted and moved to unassigned.`);

            // If every seat is already taken (e.g. an auto-merge just filled the
            // room), open a fresh table so the player has somewhere to go —
            // otherwise the tournament would deadlock with an unseatable player.
            this.ensureSeatCapacity();

            this.checkTableHealth();
            this.broadcastState();
        }
    }

    // Add empty tables until every unassigned player has a seat available.
    private ensureSeatCapacity() {
        if (this.tables.length === 0) return;
        let emptySeats = this.tables.reduce((n, t) => n + t.seats.filter(s => !s.player).length, 0);
        while (emptySeats < this.unassignedPlayers.length) {
            const tableNumber = Math.max(...this.tables.map(t => t.tableNumber)) + 1;
            const seats: Seat[] = [];
            for (let j = 0; j < this.playersPerTable; j++) {
                seats.push({ seatNumber: j + 1, player: null });
            }
            this.tables.push({ tableNumber, seats });
            devLog(`Opened table ${tableNumber} to make room for unassigned players.`);
            emptySeats += this.playersPerTable;
        }
    }

    private checkTableHealth() {
        if (!this.tables || this.tables.length === 0) return;

        // active players per table
        const tableCounts = this.tables.map(t =>
            t.seats.filter(s => s.player).length
        );

        // Unassigned players count toward capacity: a merge or final-table
        // collapse must never remove seats that pending players still need.
        const totalActive = tableCounts.reduce((a, b) => a + b, 0) + this.unassignedPlayers.length;

        // -- FINAL TABLE SHUFFLE --
        // When everyone left fits on a single table, redraw all seats onto
        // table 1 (once). Takes precedence over merge/balance since it
        // collapses the field entirely. Requires >1 table so a tournament that
        // started on a single table isn't reshuffled on its first bust.
        if (this.shuffleFinalTable && this.tables.length > 1 &&
            totalActive > 0 && totalActive <= this.playersPerTable) {
            this.collapseToFinalTable();
            return;
        }

        // -- AUTO MERGE CHECK --
        if (this.autoMerge && this.tables.length > 1) {
            // Can we fit everyone into N-1 tables?
            const possibleCapacity = (this.tables.length - 1) * this.playersPerTable;
            if (totalActive <= possibleCapacity) {
                this.mergeTables();
                return; // Merging effectively rebalances, so return
            }
        }

        // -- AUTO BALANCE CHECK --
        if (this.autoBalance && this.tables.length > 1) {
            const minCount = Math.min(...tableCounts);
            const maxCount = Math.max(...tableCounts);

            if (maxCount - minCount >= 2) {
                devLog('Tables unbalanced! Balancing...');
                this.balanceTables();
            }
        }
    }

    private mergeTables() {
        devLog('Merging tables...');
        this.pauseTimer();

        // Strategy: Take the last table, move its active players to empty spots in other tables.
        // Then remove the last table.
        // Rinse and repeat if we could merge multiple times, but one step is fine per check.

        const tableToRemoveIndex = this.tables.length - 1;
        const tableToRemove = this.tables[tableToRemoveIndex];
        const moves: SeatMove[] = [];

        const playersToMove = tableToRemove.seats
            .filter(s => s.player)
            .map(s => ({ player: s.player!, fromSeat: s.seatNumber }));

        // Remove the table
        this.tables.splice(tableToRemoveIndex, 1);

        // Distribute players
        for (const { player, fromSeat } of playersToMove) {
            let seated = false;
            for (const table of this.tables) {
                // Find empty spot
                const emptySeat = table.seats.find(s => s.player === null);
                if (emptySeat) {
                    moves.push({
                        playerName: player.name,
                        from: { kind: 'seat', tableNumber: tableToRemove.tableNumber, seatNumber: fromSeat },
                        to: { kind: 'seat', tableNumber: table.tableNumber, seatNumber: emptySeat.seatNumber },
                        reason: 'merge'
                    });

                    emptySeat.player = player;
                    seated = true;
                    break;
                }
            }
            if (!seated) {
                console.error('CRITICAL: Could not find seat for merged player', player.name);
                // Fallback: This shouldn't happen if math was right.
            }
        }

        this.broadcastMoves(moves);

        // Re-check health after merge (might need balancing now)
        this.checkTableHealth();
    }

    // Redraw the final table: gather every remaining seated player, shuffle
    // them, and reseat them all on a single table (number 1). Called once from
    // checkTableHealth when the field first collapses to one table's worth.
    private collapseToFinalTable() {
        devLog('Final table reached — redrawing seats...');
        this.pauseTimer();

        const active: { player: Player; from: SeatLocation }[] = [];
        for (const table of this.tables) {
            for (const seat of table.seats) {
                if (seat.player) {
                    active.push({
                        player: seat.player,
                        from: { kind: 'seat', tableNumber: table.tableNumber, seatNumber: seat.seatNumber }
                    });
                }
            }
        }
        // Pending players get drawn into the final table too — the capacity
        // check in checkTableHealth already counted them.
        for (const player of this.unassignedPlayers) {
            active.push({ player, from: { kind: 'unassigned' } });
        }
        this.unassignedPlayers = [];

        const shuffled = shuffle(active);

        const seats: Seat[] = [];
        for (let j = 0; j < this.playersPerTable; j++) {
            seats.push({ seatNumber: j + 1, player: j < shuffled.length ? shuffled[j].player : null });
        }
        this.tables = [{ tableNumber: 1, seats }];

        const moves: SeatMove[] = shuffled.map((entry, j) => ({
            playerName: entry.player.name,
            from: entry.from,
            to: { kind: 'seat', tableNumber: 1, seatNumber: j + 1 },
            reason: 'final-table'
        }));
        this.broadcastMoves(moves);
    }

    private balanceTables() {
        // Simple balancing: take from max table, give to min table.
        // Repeat until balanced.
        // Balanced means max - min <= 1.

        // Like merge and final-table, players are never moved with the blinds
        // clock running — the operator restarts it once everyone is settled.
        this.pauseTimer();

        let loops = 0;
        const moves: SeatMove[] = [];

        while (loops < 100) { // Safety break
            const tableCounts = this.tables.map(t => ({
                id: t.tableNumber,
                count: t.seats.filter(s => s.player).length,
                table: t
            }));

            tableCounts.sort((a, b) => a.count - b.count); // Ascending
            const minTable = tableCounts[0];
            const maxTable = tableCounts[tableCounts.length - 1];

            if (maxTable.count - minTable.count <= 1) break;

            // Move one player from max to min
            const playerToMoveSeat = maxTable.table.seats.find(s => s.player);
            const targetSeat = minTable.table.seats.find(s => s.player === null);

            if (playerToMoveSeat && playerToMoveSeat.player && targetSeat) {
                devLog(`Moving ${playerToMoveSeat.player.name} from Table ${maxTable.id} to Table ${minTable.id}`);

                moves.push({
                    playerName: playerToMoveSeat.player.name,
                    from: { kind: 'seat', tableNumber: maxTable.id, seatNumber: playerToMoveSeat.seatNumber },
                    to: { kind: 'seat', tableNumber: minTable.id, seatNumber: targetSeat.seatNumber },
                    reason: 'balance'
                });

                targetSeat.player = playerToMoveSeat.player;
                playerToMoveSeat.player = null;
            } else {
                console.error('Could not balance tables despite count mismatch');
                break;
            }
            loops++;
        }
        if (moves.length > 0) {
            this.broadcastMoves(moves);
        }
    }

    private save() {
        if (!this.tournamentId) return;
        updateTournamentState(this.tournamentId, this.getStateForSave());
    }

    private broadcastState() {
        this.save();
        const state = this.getState();
        for (const window of this.windows) {
            if (!window.isDestroyed()) {
                window.webContents.send('timer-update', state);
            }
        }
    }

    private broadcastMoves(moves: SeatMove[]) {
        if (moves.length === 0) return;
        for (const window of this.windows) {
            if (!window.isDestroyed()) {
                window.webContents.send('seat-moves-notification', moves);
            }
        }
    }

    public getState(): TournamentState {
        return {
            id: this.tournamentId ?? undefined,
            currentLevelIndex: this.currentLevelIndex,
            timeLeftInLevel: this.timeLeftInLevel,
            isPaused: this.isPaused,
            playersRemaining: this.playersRemaining,
            totalEntries: this.totalEntries,
            nextLevel: this.levels[this.currentLevelIndex + 1],
            currentLevel: this.levels[this.currentLevelIndex],
            levels: this.levels,
            tables: this.tables,
            unassignedPlayers: this.unassignedPlayers,
            bustedPlayers: this.bustedPlayers,
            isActive: !!this.tournamentId,
            name: this.name,
            autoBalance: this.autoBalance,
            autoMerge: this.autoMerge,
            shuffleFinalTable: this.shuffleFinalTable,
            startingChips: this.startingChips,
            timeUntilNextBreak: this.computeTimeUntilNextBreak(),
            elapsedTime: this.elapsedTime,
            prizes: this.prizes,
            entryFee: this.entryFee
        };
    }

    private prizeForPlace(place: number): number {
        return this.prizes.find(p => p.place === place)?.amount ?? 0;
    }

    // Players still in the tournament (seated or waiting to be seated). They take
    // the top places; their relative order is decided by the operator at finalize.
    private getSurvivors(): Player[] {
        const seated = this.tables.flatMap(t => t.seats.map(s => s.player).filter((p): p is Player => p !== null));
        return [...seated, ...this.unassignedPlayers];
    }

    // Provisional standings for the finalize dialog. Survivors are pre-ordered by
    // current seating; busted players have fixed places from elimination order.
    public getStandings(): StandingRow[] {
        const survivors = this.getSurvivors();
        const numSurvivors = survivors.length;
        const rows: StandingRow[] = [];

        survivors.forEach((p, i) => {
            const place = i + 1;
            rows.push({
                place,
                playerId: p.id!,
                name: p.name,
                photoPath: p.photo_path ?? null,
                playtimeSec: this.elapsedTime,
                prize: this.prizeForPlace(place),
                isSurvivor: true,
            });
        });

        // bustedPlayers[0] = first eliminated = last place.
        this.bustedPlayers.forEach((p, index) => {
            const place = numSurvivors + (this.bustedPlayers.length - index);
            rows.push({
                place,
                playerId: p.id!,
                name: p.name,
                photoPath: p.photo_path ?? null,
                playtimeSec: p.id != null ? (this.bustElapsed[p.id] ?? this.elapsedTime) : this.elapsedTime,
                prize: this.prizeForPlace(place),
                isSurvivor: false,
            });
        });

        return rows.sort((a, b) => a.place - b.place);
    }

    // Persist final results and archive. `orderedSurvivorIds` is the operator's
    // chosen order for the still-seated players (places 1..n). Returns the
    // archived tournament id (or null if there was nothing to finalize).
    public finalize(orderedSurvivorIds: number[]): number | null {
        if (!this.tournamentId) return null;
        this.pauseTimer();

        const survivors = this.getSurvivors();
        const survivorById = new Map(survivors.map(p => [p.id!, p]));

        // Use the operator's order, but fall back to seating order for any
        // survivor id that's missing/unknown so no one is dropped.
        const orderedSurvivors: Player[] = [];
        for (const id of orderedSurvivorIds) {
            const p = survivorById.get(id);
            if (p) { orderedSurvivors.push(p); survivorById.delete(id); }
        }
        for (const p of survivors) {
            if (survivorById.has(p.id!)) orderedSurvivors.push(p);
        }

        const numSurvivors = orderedSurvivors.length;
        const results: { player_id: number; place: number; playtime_sec: number; prize: number; entry_fee: number }[] = [];

        orderedSurvivors.forEach((p, i) => {
            const place = i + 1;
            results.push({
                player_id: p.id!,
                place,
                playtime_sec: this.elapsedTime,
                prize: this.prizeForPlace(place),
                entry_fee: this.entryFee,
            });
        });

        this.bustedPlayers.forEach((p, index) => {
            const place = numSurvivors + (this.bustedPlayers.length - index);
            results.push({
                player_id: p.id!,
                place,
                playtime_sec: p.id != null ? (this.bustElapsed[p.id] ?? this.elapsedTime) : this.elapsedTime,
                prize: this.prizeForPlace(place),
                entry_fee: this.entryFee,
            });
        });

        const archivedId = this.tournamentId;
        saveTournamentResults(archivedId, results.filter(r => r.player_id != null));
        archiveTournament(archivedId);
        this.tournamentId = null;
        this.clearInMemory();
        this.broadcastState();
        return archivedId;
    }

    // Clear the live singleton without archiving (archiving is handled by the
    // caller — either reset() or finalize()).
    private clearInMemory() {
        this.levels = [];
        this.tables = [];
        this.unassignedPlayers = [];
        this.bustedPlayers = [];
        this.playersRemaining = 0;
        this.totalEntries = 0;
        this.currentLevelIndex = 0;
        this.timeLeftInLevel = 0;
        this.name = '';
        this.startingChips = 0;
        this.elapsedTime = 0;
        this.prizes = [];
        this.entryFee = 0;
        this.bustElapsed = {};
    }

    private computeTimeUntilNextBreak(): number | null {
        if (this.levels.length === 0) return null;
        const current = this.levels[this.currentLevelIndex];
        if (current?.isBreak) return 0;
        let total = this.timeLeftInLevel;
        for (let i = this.currentLevelIndex + 1; i < this.levels.length; i++) {
            if (this.levels[i].isBreak) return total;
            total += this.levels[i].duration;
        }
        return null;
    }
}

export const tournamentManager = new TournamentManager();
