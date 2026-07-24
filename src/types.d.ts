export interface Player {
    id?: number;
    name: string;
    nickname?: string;
    email?: string;
    photo_path?: string;
}

export interface Structure {
    id?: number;
    name: string;
    starting_chips: number;
    data: string; // JSON-encoded Level[]
}

export interface Seat {
    seatNumber: number;
    player: Player | null; // null if empty seat
}

export interface Table {
    tableNumber: number;
    seats: Seat[];
}

export interface Level {
    smallBlind: number;
    bigBlind: number;
    ante?: number;
    duration: number;
    isBreak?: boolean;
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
    isSurvivor: boolean;
}

export interface ArchivedTournament {
    id: number;
    name: string;
    start_date: string;
    end_date: string;
    structure_name: string | null;
    entry_fee: number;
    currency: string;
    player_count: number;
    prize_pool: number;
    winner_name: string | null;
}

export interface TournamentResultRow {
    place: number;
    player_id: number;
    playtime_sec: number;
    prize: number;
    entry_fee: number;
    name: string | null;
    nickname: string | null;
    photo_path: string | null;
    is_deleted: number;
}

export interface TournamentResultsData {
    tournament: {
        id: number;
        name: string;
        start_date: string;
        end_date: string;
        entry_fee: number;
        currency: string;
        structure_name: string | null;
    };
    results: TournamentResultRow[];
}

export interface PlayerHistoryRow {
    tournament_id: number;
    name: string;
    start_date: string;
    place: number;
    playtime_sec: number;
    prize: number;
    entry_fee: number;
}

export interface PlayerProfileData {
    player: Player & { is_deleted?: number };
    stats: {
        tournaments: number;
        total_playtime: number;
        total_earnings: number;
        best_place: number | null;
        wins: number;
        cashes: number;
    };
    history: PlayerHistoryRow[];
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

export type Language = 'en' | 'fr';
export type AccentName = 'moss' | 'slate' | 'terracotta' | 'plum' | 'charcoal';
export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF';

export interface ProjectorTheme {
    backgroundType: 'color' | 'image';
    backgroundColor: string;          // hex, e.g. '#f5f5f5'
    backgroundImage: string | null;   // absolute file path, or null
    textColor: string;                // hex, e.g. '#1a1a1a'
    logoPath: string | null;          // absolute file path; null = bundled default logo
    textShadow: boolean;              // soft halo behind text for legibility
    textShadowColor: string;          // hex
    textShadowBlur: number;           // px blur radius (strength)
    textOutline: boolean;             // stroke around each glyph
    textOutlineColor: string;         // hex
    textOutlineWidth: number;         // px stroke width
}

// Result of the backup export/import IPC calls. `canceled` means the user
// dismissed the native dialog (not an error). `path` is the written archive
// (export); `backupPath` is the automatic pre-import safety copy (import).
export interface BackupOperationResult {
    ok: boolean;
    canceled?: boolean;
    path?: string;
    backupPath?: string;
    error?: string;
}

export interface AppSettings {
    language: Language;
    accentColor: AccentName;
    currency: CurrencyCode;
    projector: ProjectorTheme;
}

export interface TournamentState {
    id?: number;
    currentLevelIndex: number;
    timeLeftInLevel: number;
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
    elapsedTime: number;
    prizes: Prize[];
    entryFee?: number;
}

declare global {
    // package.json version, injected by Vite's `define` (see vite.config.ts).
    const __APP_VERSION__: string;

    interface Window {
        // Channel-whitelisted raw bridge (see electron/preload.ts): `on` accepts
        // 'timer-update' | 'structures-updated', `send` accepts the two timer
        // controls. Everything else must go through window.api.
        ipcRenderer: {
            on: <T = unknown>(channel: 'timer-update' | 'structures-updated', listener: (arg: T) => void) => () => void;
            send: (channel: 'start-timer' | 'pause-timer') => void;
        };
        api: {
            getPlayers: () => Promise<Player[]>;
            addPlayer: (player: Player & { photoPath?: string }) => Promise<void>;
            updatePlayer: (player: Player & { photoPath?: string }) => Promise<void>;
            deletePlayer: (id: number) => Promise<void>;
            saveStructure: (structure: Structure) => Promise<{ lastInsertRowid: number | bigint }>;
            getStructure: (id: number) => Promise<Structure>;
            updateStructure: (structure: Structure) => Promise<void>;
            deleteStructure: (id: number) => Promise<void>;
            randomizeSeating: (playersPerTable?: number) => Promise<void>;
            bustPlayer: (playerId: number) => Promise<void>;
            unbustPlayer: (playerId: number) => Promise<void>;
            seatPlayer: (playerId: number, tableNumber: number, seatNumber: number) => Promise<void>;
            openProjector: () => Promise<void>;
            getStructures: () => Promise<Structure[]>;
            openStructureEditor: (id?: number) => Promise<void>;
            createTournament: (config: { structureId: number; playerIds: number[]; maxPlayersPerTable: number; name: string; autoBalance: boolean; autoMerge: boolean; shuffleFinalTable: boolean; prizes: Prize[]; entryFee: number }) => Promise<{ success: boolean }>;
            getTournamentState: () => Promise<TournamentState>;
            getStandings: () => Promise<StandingRow[]>;
            finalizeTournament: (orderedSurvivorIds: number[]) => Promise<number | null>;
            getTournamentResults: (id: number) => Promise<TournamentResultsData | null>;
            getPlayerProfile: (id: number) => Promise<PlayerProfileData | null>;
            getRunningTournaments: () => Promise<{ id: number; name: string; start_date: string }[]>;
            switchTournament: (id: number) => Promise<void>;
            stopTournament: () => Promise<void>;
            setTimeLeft: (seconds: number) => void;
            nextLevel: () => void;
            previousLevel: () => void;
            getArchivedTournaments: () => Promise<ArchivedTournament[]>;
            deleteTournament: (id: number) => Promise<void>;
            onSeatMoves: (callback: (moves: SeatMove[]) => void) => () => void;
            getSettings: () => Promise<Record<string, string>>;
            setSetting: (key: string, value: string) => Promise<Record<string, string>>;
            importProjectorImage: (sourcePath: string) => Promise<string>;
            exportData: () => Promise<BackupOperationResult>;
            importData: () => Promise<BackupOperationResult>;
            getPathForFile: (file: File) => string;
            onSettingsUpdate: (callback: (settings: Record<string, string>) => void) => () => void;
            onSoundCue: (callback: (cue: string) => void) => () => void;
        }
    }
}
