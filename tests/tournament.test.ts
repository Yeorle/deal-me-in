import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindow } from 'electron';

// The engine imports electron (BrowserWindow type, powerSaveBlocker) and the
// db layer (which opens SQLite inside Electron's userData). Both are mocked so
// the pure tournament logic can run under plain Node.
vi.mock('electron', () => ({
    BrowserWindow: class { },
    powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
    app: { isPackaged: true }, // silences devLog output in test runs
}));

vi.mock('../electron/db', () => ({
    getRunningTournament: vi.fn(() => undefined),
    getTournamentById: vi.fn(() => undefined),
    createTournament: vi.fn(() => ({ lastInsertRowid: 1 })),
    updateTournamentState: vi.fn(),
    archiveTournament: vi.fn(),
    saveTournamentResults: vi.fn(),
}));

import { TournamentManager, shuffle, Player, Prize } from '../electron/tournament';
import { archiveTournament, saveTournamentResults, updateTournamentState, getTournamentById, getRunningTournament } from '../electron/db';

function fakeWindow(): BrowserWindow {
    return {
        on: vi.fn(),
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
    } as unknown as BrowserWindow;
}

// Email is deliberately present: every broadcast/snapshot must sanitize it
// away (see getState()/getStateForSave()).
function makePlayers(n: number): Player[] {
    return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}`, email: `p${i + 1}@example.com` }));
}

interface SetupOptions {
    players?: number;
    playersPerTable?: number;
    autoBalance?: boolean;
    autoMerge?: boolean;
    shuffleFinalTable?: boolean;
    prizes?: Prize[];
}

function setup(opts: SetupOptions = {}) {
    const manager = new TournamentManager();
    manager.initialize(
        fakeWindow(),
        [
            { smallBlind: 100, bigBlind: 200, duration: 900 },
            { smallBlind: 200, bigBlind: 400, duration: 900 },
        ],
        makePlayers(opts.players ?? 10),
        opts.playersPerTable ?? 9,
        'Test Tournament',
        opts.autoBalance ?? true,
        opts.autoMerge ?? true,
        opts.shuffleFinalTable ?? false,
        10000,
        opts.prizes ?? [],
        { entryFee: 50, currency: 'EUR', structureId: 1, structureName: 'Turbo' },
    );
    manager.randomizeSeating();
    return manager;
}

function seatedCount(manager: TournamentManager): number {
    return manager.getState().tables.reduce(
        (n, t) => n + t.seats.filter(s => s.player).length, 0);
}

function tableCounts(manager: TournamentManager): number[] {
    return manager.getState().tables.map(t => t.seats.filter(s => s.player).length);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('shuffle', () => {
    it('returns a permutation of the input without mutating it', () => {
        const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const copy = [...input];
        const result = shuffle(input);
        expect(input).toEqual(copy);
        expect(result).toHaveLength(input.length);
        expect([...result].sort((a, b) => a - b)).toEqual(copy);
    });
});

describe('seating', () => {
    it('seats all players across the derived number of tables', () => {
        const manager = setup({ players: 10, playersPerTable: 9 });
        const state = manager.getState();
        expect(state.tables).toHaveLength(2);
        expect(state.unassignedPlayers).toHaveLength(0);
        expect(seatedCount(manager)).toBe(10);
        // Balanced 5/5, not 9/1.
        expect(tableCounts(manager)).toEqual([5, 5]);
    });
});

describe('bust / unbust', () => {
    it('moves a player to bustedPlayers and back', () => {
        const manager = setup({ players: 10, playersPerTable: 5, autoMerge: false, autoBalance: false });
        manager.bustPlayer(3);
        let state = manager.getState();
        expect(state.bustedPlayers.map(p => p.id)).toEqual([3]);
        expect(state.playersRemaining).toBe(9);

        manager.unbustPlayer(3);
        state = manager.getState();
        expect(state.bustedPlayers).toHaveLength(0);
        expect(state.playersRemaining).toBe(10);
        expect(state.unassignedPlayers.map(p => p.id)).toEqual([3]);
    });

    it('can bust a player who is still unassigned (reversible un-bust)', () => {
        const manager = setup({ players: 10, playersPerTable: 5, autoMerge: false, autoBalance: false });
        manager.bustPlayer(3);
        manager.unbustPlayer(3); // now unassigned
        manager.bustPlayer(3);   // must not be a silent no-op
        const state = manager.getState();
        expect(state.bustedPlayers.map(p => p.id)).toEqual([3]);
        expect(state.unassignedPlayers).toHaveLength(0);
        expect(state.playersRemaining).toBe(9);
    });
});

describe('auto-merge', () => {
    it('collapses to fewer tables when the field fits', () => {
        const manager = setup({ players: 10, playersPerTable: 9 });
        manager.bustPlayer(1); // 9 active fit on one 9-seat table
        const state = manager.getState();
        expect(state.tables).toHaveLength(1);
        expect(seatedCount(manager)).toBe(9);
    });

    it('un-busting after a merge into a full room does not deadlock (C1)', () => {
        const manager = setup({ players: 10, playersPerTable: 9 });
        manager.bustPlayer(1);                       // merge → one full 9/9 table
        expect(manager.getState().tables).toHaveLength(1);

        manager.unbustPlayer(1);                     // room is full — must open a table
        const state = manager.getState();
        const emptySeats = state.tables.reduce(
            (n, t) => n + t.seats.filter(s => !s.player).length, 0);
        expect(emptySeats).toBeGreaterThanOrEqual(state.unassignedPlayers.length);
        expect(state.playersRemaining).toBe(10);

        manager.randomizeSeating();                  // and the player can actually sit down
        expect(manager.getState().unassignedPlayers).toHaveLength(0);
        expect(seatedCount(manager)).toBe(10);
    });

    it('never merges away seats that unassigned players still need', () => {
        const manager = setup({ players: 10, playersPerTable: 9 });
        manager.bustPlayer(1);   // merge to one table
        manager.unbustPlayer(1); // new table opened, player unassigned (10 total again)
        // Health check must not immediately merge the fresh table away:
        // 9 seated + 1 unassigned = 10 > 9 seats.
        expect(manager.getState().tables.length).toBeGreaterThan(1);
    });
});

describe('auto-balance', () => {
    it('rebalances when tables differ by 2+ and pauses the clock', () => {
        const manager = setup({ players: 10, playersPerTable: 5, autoMerge: false });
        // Bust two players from the same table to force a 3/5 imbalance.
        const state = manager.getState();
        const firstTable = state.tables[0];
        const ids = firstTable.seats.filter(s => s.player).map(s => s.player!.id!);
        manager.bustPlayer(ids[0]);
        manager.bustPlayer(ids[1]);

        const counts = tableCounts(manager);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        expect(manager.getState().isPaused).toBe(true);
    });
});

describe('final table', () => {
    it('collapses everyone onto table 1 when the field fits one table', () => {
        const manager = setup({ players: 10, playersPerTable: 9, shuffleFinalTable: true, autoMerge: false });
        manager.bustPlayer(1); // 9 left → final table
        const state = manager.getState();
        expect(state.tables).toHaveLength(1);
        expect(state.tables[0].tableNumber).toBe(1);
        expect(seatedCount(manager)).toBe(9);
        expect(state.unassignedPlayers).toHaveLength(0);
    });
});

describe('standings and prizes', () => {
    const prizes: Prize[] = [
        { place: 1, amount: 500 },
        { place: 3, amount: 200 },
    ];

    it('orders busted players by reverse elimination and maps prizes by place (gaps preserved)', () => {
        const manager = setup({ players: 4, playersPerTable: 9, prizes });
        manager.bustPlayer(1); // first out → 4th place
        manager.bustPlayer(2); // second out → 3rd place

        const standings = manager.getStandings();
        expect(standings.map(r => r.place)).toEqual([1, 2, 3, 4]);

        const byPlace = new Map(standings.map(r => [r.place, r]));
        expect(byPlace.get(3)!.playerId).toBe(2);
        expect(byPlace.get(4)!.playerId).toBe(1);
        // Prize gap: place 2 gets nothing, place 3 keeps its 200.
        expect(byPlace.get(1)!.prize).toBe(500);
        expect(byPlace.get(2)!.prize).toBe(0);
        expect(byPlace.get(3)!.prize).toBe(200);

        expect(byPlace.get(1)!.isSurvivor).toBe(true);
        expect(byPlace.get(4)!.isSurvivor).toBe(false);
    });

    it('finalize writes one result row per player in operator order and archives', () => {
        const manager = setup({ players: 4, playersPerTable: 9, prizes });
        manager.bustPlayer(1);
        manager.bustPlayer(2);

        // Operator says player 4 beat player 3.
        const archivedId = manager.finalize([4, 3]);
        expect(archivedId).toBe(1);
        expect(archiveTournament).toHaveBeenCalledWith(1);
        expect(saveTournamentResults).toHaveBeenCalledTimes(1);

        const [tournamentId, rows] = vi.mocked(saveTournamentResults).mock.calls[0];
        expect(tournamentId).toBe(1);
        const byPlace = new Map(rows.map(r => [r.place, r]));
        expect(byPlace.get(1)!.player_id).toBe(4);
        expect(byPlace.get(2)!.player_id).toBe(3);
        expect(byPlace.get(3)!.player_id).toBe(2);
        expect(byPlace.get(4)!.player_id).toBe(1);
        expect(byPlace.get(1)!.prize).toBe(500);
        expect(byPlace.get(2)!.prize).toBe(0);
        expect(byPlace.get(3)!.prize).toBe(200);
        expect(rows.every(r => r.entry_fee === 50)).toBe(true);

        // Singleton cleared.
        const state = manager.getState();
        expect(state.isActive).toBe(false);
        expect(state.tables).toHaveLength(0);
    });

    it('falls back to seating order for survivor ids the operator did not order', () => {
        const manager = setup({ players: 3, playersPerTable: 9, prizes });
        const archivedId = manager.finalize([]); // no operator input at all
        expect(archivedId).toBe(1);
        const [, rows] = vi.mocked(saveTournamentResults).mock.calls[0];
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map(r => r.place))).toEqual(new Set([1, 2, 3]));
    });
});

describe('timer / elapsed time', () => {
    it('reconciles elapsedTime and timeLeftInLevel on pause between ticks', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        try {
            vi.setSystemTime(0);
            const manager = setup({ players: 4, playersPerTable: 9 });
            manager.startTimer();
            vi.advanceTimersByTime(1000); // a few ticks; Date.now() = 1_000
            expect(manager.getState().elapsedTime).toBe(1);

            // The wall clock ran on but no tick fired (main process blocked,
            // system suspend, …). Pausing must capture every elapsed second —
            // survivors' playtime at finalize depends on this.
            vi.setSystemTime(15_900);
            manager.pauseTimer();
            const state = manager.getState();
            expect(state.elapsedTime).toBe(15);
            expect(state.timeLeftInLevel).toBe(885);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not double-count overshoot when a tick spans a level boundary', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        try {
            vi.setSystemTime(0);
            const manager = setup({ players: 4, playersPerTable: 9 });
            manager.startTimer();
            vi.setSystemTime(10_000);
            vi.advanceTimersByTime(250);
            expect(manager.getState().elapsedTime).toBe(10);

            // Jump to 905s and tick: level 1 (900s) crossed with a 5s overshoot.
            vi.setSystemTime(905_000);
            vi.advanceTimersByTime(250);
            expect(manager.getState().currentLevelIndex).toBe(1);
            expect(manager.getState().timeLeftInLevel).toBe(895);

            vi.setSystemTime(906_000);
            vi.advanceTimersByTime(250);
            // Without the overshoot fix this reads 911 — the 5 overshoot
            // seconds were counted a second time against the re-anchored
            // segment.
            expect(manager.getState().elapsedTime).toBe(906);
            expect(manager.getState().timeLeftInLevel).toBe(894);
        } finally {
            vi.useRealTimers();
        }
    });

    it('startTimer without a live tournament does not run the clock', () => {
        const manager = new TournamentManager();
        manager.toggleTimer();
        expect(manager.getState().isPaused).toBe(true);
    });
});

describe('sanitization', () => {
    it('strips email from both the broadcast state and the persisted snapshot', () => {
        const manager = setup({ players: 4 });
        const state = manager.getState();
        const anySeated = state.tables[0].seats.find(s => s.player)!.player!;
        expect(anySeated.name).toBeTruthy();
        expect('email' in anySeated).toBe(false);

        const lastSave = vi.mocked(updateTournamentState).mock.calls.at(-1)![1];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const savedPlayer = (lastSave as any).tables[0].seats.find((s: any) => s.player).player;
        expect('email' in savedPlayer).toBe(false);
    });
});

describe('seating edge cases', () => {
    it('busting before the first seating keeps totalEntries intact', () => {
        const manager = new TournamentManager();
        manager.initialize(
            fakeWindow(),
            [{ smallBlind: 100, bigBlind: 200, duration: 900 }],
            makePlayers(10),
            9,
            'Test Tournament',
            true, true, false,
            10000,
            [],
            { entryFee: 50, currency: 'EUR', structureId: 1, structureName: 'Turbo' },
        );
        manager.bustPlayer(1); // player is still unassigned — a "no-show" bust
        manager.randomizeSeating();
        const state = manager.getState();
        // totalEntries must stay 10 (it is persisted and shown in history);
        // playersRemaining tracks the 9 live players.
        expect(state.totalEntries).toBe(10);
        expect(state.playersRemaining).toBe(9);
        expect(seatedCount(manager)).toBe(9);
    });

    it('randomizeSeating adopts a requested table size into playersPerTable', () => {
        const manager = new TournamentManager();
        manager.initialize(
            fakeWindow(),
            [{ smallBlind: 100, bigBlind: 200, duration: 900 }],
            makePlayers(10),
            9, // default playersPerTable — overridden below
            'Test Tournament',
            true, true, false,
            10000,
            [],
            { entryFee: 50, currency: 'EUR', structureId: 1, structureName: 'Turbo' },
        );
        manager.randomizeSeating(5); // fresh seating with a different ppt
        const state = manager.getState();
        // Tables are built at 5 seats and playersPerTable is adopted — merge/
        // balance/capacity math uses this.playersPerTable, so a mismatch would
        // strand players in the merge fallback.
        expect(state.tables).toHaveLength(2);
        for (const table of state.tables) {
            expect(table.seats).toHaveLength(5);
        }
        expect(seatedCount(manager)).toBe(10);
    });
});

describe('removePlayerFromTournament (delete while running)', () => {
    it('drops the player from every live list so no result row is written', () => {
        const manager = setup({ players: 5, playersPerTable: 9, autoMerge: false, autoBalance: false });
        manager.bustPlayer(2);
        manager.removePlayerFromTournament(1); // was seated

        const state = manager.getState();
        expect(state.bustedPlayers.map(p => p.id)).toEqual([2]);
        expect(state.playersRemaining).toBe(3);
        expect(seatedCount(manager)).toBe(3);

        const standings = manager.getStandings();
        expect(standings.find(r => r.playerId === 1)).toBeUndefined();
        expect(standings).toHaveLength(4);

        manager.finalize(standings.filter(r => r.isSurvivor).map(r => r.playerId));
        const [, rows] = vi.mocked(saveTournamentResults).mock.calls.at(-1)!;
        expect(rows.find(r => r.player_id === 1)).toBeUndefined();
        expect(rows).toHaveLength(4);
    });
});

describe('switchTournament', () => {
    it('aborts without pausing/saving the live clock when the target is not running', () => {
        const manager = setup({ players: 4 });
        manager.startTimer();
        expect(manager.getState().isPaused).toBe(false);

        vi.mocked(updateTournamentState).mockClear();
        manager.switchTournament(42); // getTournamentById is mocked → undefined

        expect(manager.getState().isPaused).toBe(false);
        // The stale save() must not have been flushed either.
        expect(updateTournamentState).not.toHaveBeenCalled();
    });
});

describe('reloadFromDb (backup import)', () => {
    it('discards the live tournament without archiving or writing through the old id', () => {
        const manager = setup({ players: 4 });
        expect(manager.getState().isActive).toBe(true);

        vi.mocked(updateTournamentState).mockClear();
        manager.reloadFromDb();

        // The old row must be neither archived nor overwritten — after a backup
        // import its id belongs to freshly imported data.
        expect(archiveTournament).not.toHaveBeenCalled();
        expect(updateTournamentState).not.toHaveBeenCalled();

        // No running tournament in the (mocked) DB → singleton ends up empty.
        const state = manager.getState();
        expect(state.isActive).toBe(false);
        expect(state.tables).toHaveLength(0);
        expect(state.bustedPlayers).toHaveLength(0);
    });
});

describe('state hydration hardening', () => {
    it('clamps a non-positive playersPerTable so seating cannot loop forever', () => {
        const manager = new TournamentManager();
        manager.initialize(
            fakeWindow(),
            [{ smallBlind: 100, bigBlind: 200, duration: 900 }],
            makePlayers(10),
            0, // invalid — would make Math.ceil(n/0) = Infinity loop forever
            'Test Tournament',
            true, true, false,
            10000,
            [],
            { entryFee: 50, currency: 'EUR', structureId: 1, structureName: 'Turbo' },
        );
        manager.randomizeSeating();
        const state = manager.getState();
        expect(state.tables).toHaveLength(2);
        expect(seatedCount(manager)).toBe(10);
        for (const table of state.tables) {
            expect(table.seats).toHaveLength(9);
        }
    });

    it('applies sane defaults to a snapshot missing core fields', () => {
        // A legacy/hand-edited row without currentLevelIndex/timeLeft/etc.
        // must not hydrate into undefined/NaN fields.
        vi.mocked(getRunningTournament).mockImplementationOnce(() => ({
            id: 7,
            name: 'Legacy',
            state: JSON.stringify({ levels: [{ smallBlind: 100, bigBlind: 200, duration: 900 }] }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any));
        const manager = new TournamentManager();
        manager.load();
        const state = manager.getState();
        expect(state.isActive).toBe(true);
        expect(state.currentLevelIndex).toBe(0);
        expect(state.timeLeftInLevel).toBe(900);
        expect(state.totalEntries).toBe(0);
        expect(state.playersRemaining).toBe(0);
    });
});

describe('updatePlayerInfo (roster edit while running)', () => {
    it('refreshes name/photo across seats, unassigned and busted lists', () => {
        const manager = setup({ players: 5, playersPerTable: 9, autoMerge: false, autoBalance: false });
        manager.bustPlayer(2);
        manager.bustPlayer(3);
        manager.unbustPlayer(3); // player 3 is now unassigned

        manager.updatePlayerInfo(1, { name: 'Renamed', photo_path: '/new/path.png' });
        const state = manager.getState();
        const seated1 = state.tables.flatMap(t => t.seats).find(s => s.player?.id === 1)?.player;
        expect(seated1?.name).toBe('Renamed');
        expect(seated1?.photo_path).toBe('/new/path.png');

        manager.updatePlayerInfo(2, { name: 'Busted Renamed' });
        expect(manager.getState().bustedPlayers.find(p => p.id === 2)?.name).toBe('Busted Renamed');

        // Untouched players keep their values.
        expect(state.unassignedPlayers.find(p => p.id === 3)?.name).toBe('Player 3');
    });
});

describe('state persistence round-trip', () => {
    it('preserves bustElapsed (playtime) across save → restore so a late finalize is correct', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        try {
            vi.setSystemTime(0);
            const manager = setup({ players: 5, playersPerTable: 9, autoMerge: false, autoBalance: false });
            manager.startTimer();
            vi.advanceTimersByTime(30_000);
            manager.pauseTimer();
            manager.bustPlayer(2); // player 2's playtime = 30s, recorded in bustElapsed

            // Rehydrate the persisted snapshot like a restart/switch would.
            const savedState = vi.mocked(updateTournamentState).mock.calls.at(-1)![1];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const row = { id: 1, name: 'Test Tournament', status: 'running', state: JSON.stringify(savedState) } as any;
            vi.mocked(getTournamentById).mockReturnValueOnce(row);

            manager.switchTournament(1);
            expect(manager.getState().playersRemaining).toBe(4);

            manager.finalize(manager.getStandings().filter(r => r.isSurvivor).map(r => r.playerId));
            const [, rows] = vi.mocked(saveTournamentResults).mock.calls.at(-1)!;
            expect(rows.find(r => r.player_id === 2)!.playtime_sec).toBe(30);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('reset (archive without results)', () => {
    it('archives the row, writes no results, and clears the singleton', () => {
        const manager = setup({ players: 5, playersPerTable: 9 });
        manager.bustPlayer(2);
        expect(manager.getState().isActive).toBe(true);

        manager.reset();

        expect(archiveTournament).toHaveBeenCalledWith(1);
        // Unlike finalize(), the stop path records no per-player results.
        expect(saveTournamentResults).not.toHaveBeenCalled();

        const state = manager.getState();
        expect(state.isActive).toBe(false);
        expect(state.tables).toHaveLength(0);
        expect(state.bustedPlayers).toHaveLength(0);
        expect(state.playersRemaining).toBe(0);
        expect(state.levels).toHaveLength(0);
    });
});

describe('level controls', () => {
    it('skips forward (no-op at the last level) and re-anchors the running clock', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        try {
            vi.setSystemTime(0);
            const manager = setup({ players: 4 });
            manager.startTimer();
            vi.advanceTimersByTime(10_000);

            manager.goToNextLevel();
            const state = manager.getState();
            expect(state.currentLevelIndex).toBe(1);
            expect(state.timeLeftInLevel).toBe(900);

            // The clock must keep counting from the new level's start.
            vi.advanceTimersByTime(60_000);
            expect(manager.getState().elapsedTime).toBe(70);
            expect(manager.getState().timeLeftInLevel).toBe(840);

            // At the last level skip is a no-op.
            manager.goToNextLevel();
            expect(manager.getState().currentLevelIndex).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('goes back: restarts the level when >10s in, otherwise jumps to the previous level', () => {
        const manager = setup({ players: 4 });

        // Fresh level (0s in): "back" at index 0 restarts the current level.
        manager.goToPreviousLevel();
        expect(manager.getState().currentLevelIndex).toBe(0);
        expect(manager.getState().timeLeftInLevel).toBe(900);

        manager.goToNextLevel(); // now on level 2
        manager.setTimeLeftInLevel(895); // 5s into level 2 (< 10s)

        manager.goToPreviousLevel();
        expect(manager.getState().currentLevelIndex).toBe(0);
        expect(manager.getState().timeLeftInLevel).toBe(900);

        // >10s into a level: restart it instead of jumping back.
        manager.goToNextLevel();
        manager.setTimeLeftInLevel(870); // 30s in
        manager.goToPreviousLevel();
        expect(manager.getState().currentLevelIndex).toBe(1);
        expect(manager.getState().timeLeftInLevel).toBe(900);
    });

    it('setTimeLeftInLevel clamps to [0, level duration]', () => {
        const manager = setup({ players: 4 });
        manager.setTimeLeftInLevel(300);
        expect(manager.getState().timeLeftInLevel).toBe(300);
        manager.setTimeLeftInLevel(-5);
        expect(manager.getState().timeLeftInLevel).toBe(0);
        manager.setTimeLeftInLevel(10_000);
        expect(manager.getState().timeLeftInLevel).toBe(900);
    });

    it('auto-pauses when the final level runs out', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        try {
            vi.setSystemTime(0);
            const manager = new TournamentManager();
            manager.initialize(
                fakeWindow(),
                [{ smallBlind: 100, bigBlind: 200, duration: 900 }], // single level
                makePlayers(4),
                9,
                'Test Tournament',
                true, true, false,
                10000,
                [],
                { entryFee: 50, currency: 'EUR', structureId: 1, structureName: 'Turbo' },
            );
            manager.randomizeSeating();
            manager.startTimer();
            vi.advanceTimersByTime(900_000 + 1_000);

            const state = manager.getState();
            expect(state.isPaused).toBe(true);
            expect(state.timeLeftInLevel).toBe(0);
            expect(state.elapsedTime).toBe(900);
        } finally {
            vi.useRealTimers();
        }
    });

    it('resumes cleanly after a pause, counting only the running segments', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        try {
            vi.setSystemTime(0);
            const manager = setup({ players: 4 });
            manager.startTimer();
            vi.advanceTimersByTime(15_000);
            manager.pauseTimer();
            expect(manager.getState().elapsedTime).toBe(15);

            // 60s of wall-clock pause time must not count toward the tournament.
            vi.advanceTimersByTime(60_000);
            manager.startTimer();
            vi.advanceTimersByTime(3_000);

            const state = manager.getState();
            expect(state.elapsedTime).toBe(18);
            expect(state.timeLeftInLevel).toBe(882);
        } finally {
            vi.useRealTimers();
        }
    });
});
