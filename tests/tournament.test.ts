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
import { archiveTournament, saveTournamentResults, updateTournamentState } from '../electron/db';

function fakeWindow(): BrowserWindow {
    return {
        on: vi.fn(),
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
    } as unknown as BrowserWindow;
}

function makePlayers(n: number): Player[] {
    return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}` }));
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
