import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import AdmZip from 'adm-zip';

// backup.ts imports electron (app.getPath/getVersion) and the db layer for its
// IO half; both are mocked so the pure dump/path logic runs under plain Node.
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/mock/userData'),
        getVersion: vi.fn(() => '1.0.0'),
        isPackaged: true,
    },
}));

vi.mock('../electron/db', () => ({
    getAllRowsForExport: vi.fn(),
    replaceAllData: vi.fn(),
}));

import {
    relativizeDump,
    absolutizeDump,
    buildManifest,
    validateManifest,
    validateDump,
    sanitizeZipEntryName,
    exportAllData,
    importAllData,
    BACKUP_FORMAT,
    BACKUP_FORMAT_VERSION,
} from '../electron/backup';
import { getAllRowsForExport, replaceAllData } from '../electron/db';
import type { DataDumpRows } from '../electron/db';
import { app } from 'electron';

const SRC = '/home/alice/.config/deal-me-in';
const DST = '/home/bob/.config/deal-me-in';

function makeRows(root = SRC): DataDumpRows {
    const photoPath = (name: string) => path.join(root, 'photos', name);
    const state = {
        tables: [
            {
                id: 1,
                seats: [
                    { seatNumber: 1, player: { id: 1, name: 'Alice', photo_path: photoPath('111-aaa.jpg') } },
                    { seatNumber: 2, player: null },
                ],
            },
        ],
        unassignedPlayers: [{ id: 2, name: 'Bob', photo_path: photoPath('222-bbb.png') }],
        bustedPlayers: [{ id: 3, name: 'Carol', photo_path: null }],
    };
    return {
        players: [
            { id: 1, name: 'Alice', nickname: 'A', email: 'a@example.com', photo_path: photoPath('111-aaa.jpg'), is_deleted: 0 },
            { id: 2, name: 'Bob', nickname: null, email: null, photo_path: photoPath('222-bbb.png'), is_deleted: 0 },
            { id: 3, name: '', nickname: null, email: null, photo_path: null, is_deleted: 1 },
        ],
        structures: [{ id: 1, name: 'Turbo', starting_chips: 10000, data: '[]' }],
        tournaments: [
            {
                id: 7,
                name: 'Friday Game',
                start_date: '2026-07-01 20:00:00',
                end_date: null,
                status: 'running',
                state: JSON.stringify(state),
                entry_fee: 20,
                currency: 'EUR',
                structure_id: 1,
                structure_name: 'Turbo',
            },
        ],
        tournamentResults: [
            { id: 1, tournament_id: 7, player_id: 3, place: 3, playtime_sec: 3600, prize: 0, entry_fee: 20 },
        ],
        settings: [
            { key: 'currency', value: 'EUR' },
            {
                key: 'projectorTheme',
                value: JSON.stringify({
                    backgroundType: 'image',
                    backgroundImage: path.join(root, 'projector', '333-ccc.png'),
                    logoPath: path.join(root, 'projector', '444-ddd.svg'),
                    textColor: '#1a1a1a',
                }),
            },
        ],
    };
}

describe('relativizeDump', () => {
    it('rewrites paths in all three locations and collects the files', () => {
        const rows = makeRows();
        const { dump, files } = relativizeDump(rows);

        expect(dump.players[0].photo_path).toBe('photos/111-aaa.jpg');
        expect(dump.players[1].photo_path).toBe('photos/222-bbb.png');
        expect(dump.players[2].photo_path).toBeNull();

        const state = JSON.parse(dump.tournaments[0].state!);
        expect(state.tables[0].seats[0].player.photo_path).toBe('photos/111-aaa.jpg');
        expect(state.unassignedPlayers[0].photo_path).toBe('photos/222-bbb.png');
        expect(state.bustedPlayers[0].photo_path).toBeNull();

        const theme = JSON.parse(dump.settings[1].value);
        expect(theme.backgroundImage).toBe('projector/333-ccc.png');
        expect(theme.logoPath).toBe('projector/444-ddd.svg');

        // Files deduped: Alice's photo is referenced by her row AND the state.
        expect(files).toHaveLength(4);
        expect(files).toContainEqual({ absPath: path.join(SRC, 'photos', '111-aaa.jpg'), zipPath: 'photos/111-aaa.jpg' });
        expect(files).toContainEqual({ absPath: path.join(SRC, 'projector', '444-ddd.svg'), zipPath: 'projector/444-ddd.svg' });
    });

    it('does not mutate its input', () => {
        const rows = makeRows();
        const before = structuredClone(rows);
        relativizeDump(rows);
        expect(rows).toEqual(before);
    });

    it('uniquifies zip paths when two distinct files share a basename', () => {
        const rows = makeRows();
        rows.players[0].photo_path = '/a/photos/same.jpg';
        rows.players[1].photo_path = '/b/photos/same.jpg';
        rows.tournaments = [];
        const { dump, files } = relativizeDump(rows);
        expect(dump.players[0].photo_path).not.toBe(dump.players[1].photo_path);
        expect(new Set(files.map(f => f.zipPath)).size).toBe(files.length);
    });

    it('keeps an unparseable state snapshot verbatim', () => {
        const rows = makeRows();
        rows.tournaments[0].state = 'not json {';
        const { dump } = relativizeDump(rows);
        expect(dump.tournaments[0].state).toBe('not json {');
    });
});

describe('absolutizeDump', () => {
    it('round-trips: relativize then absolutize lands under the destination userData', () => {
        const { dump } = relativizeDump(makeRows());
        const restored = absolutizeDump(dump, DST);

        expect(restored.players[0].photo_path).toBe(path.join(DST, 'photos', '111-aaa.jpg'));
        expect(restored.players[2].photo_path).toBeNull();

        const state = JSON.parse(restored.tournaments[0].state!);
        expect(state.tables[0].seats[0].player.photo_path).toBe(path.join(DST, 'photos', '111-aaa.jpg'));
        expect(state.unassignedPlayers[0].photo_path).toBe(path.join(DST, 'photos', '222-bbb.png'));

        const theme = JSON.parse(restored.settings[1].value);
        expect(theme.backgroundImage).toBe(path.join(DST, 'projector', '333-ccc.png'));
        expect(theme.logoPath).toBe(path.join(DST, 'projector', '444-ddd.svg'));

        // Everything that is not a media path survives untouched, ids included.
        expect(restored.players.map(p => p.id)).toEqual([1, 2, 3]);
        expect(restored.tournaments[0].id).toBe(7);
        expect(restored.tournamentResults).toEqual(makeRows().tournamentResults);
        expect(restored.settings[0]).toEqual({ key: 'currency', value: 'EUR' });
    });

    it('leaves values that are not archive-relative untouched', () => {
        const rows = makeRows();
        const { dump } = relativizeDump(rows);
        dump.players[0].photo_path = '/already/absolute.jpg';
        const restored = absolutizeDump(dump, DST);
        expect(restored.players[0].photo_path).toBe('/already/absolute.jpg');
    });
});

describe('manifest', () => {
    it('builds a valid manifest that validates', () => {
        const { dump } = relativizeDump(makeRows());
        const manifest = buildManifest(dump, '1.0.0');
        expect(manifest.format).toBe(BACKUP_FORMAT);
        expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
        expect(manifest.counts).toEqual({ players: 3, structures: 1, tournaments: 1, results: 1, settings: 2 });
        expect(() => validateManifest(manifest)).not.toThrow();
    });

    it('rejects a foreign or missing format id', () => {
        expect(() => validateManifest(null)).toThrow(/not a Deal Me In backup/);
        expect(() => validateManifest({ format: 'other', formatVersion: 1 })).toThrow(/not a Deal Me In backup/);
    });

    it('rejects a newer formatVersion but accepts older ones', () => {
        expect(() => validateManifest({ format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION + 1 })).toThrow(/newer version/);
        expect(() => validateManifest({ format: BACKUP_FORMAT, formatVersion: 1 })).not.toThrow();
    });
});

describe('validateDump', () => {
    it('accepts a full dump unchanged', () => {
        const { dump } = relativizeDump(makeRows());
        expect(validateDump(JSON.parse(JSON.stringify(dump)))).toEqual(dump);
    });

    it('rejects a dump missing a table', () => {
        const { dump } = relativizeDump(makeRows());
        const bad = { ...dump } as Record<string, unknown>;
        delete bad.structures;
        expect(() => validateDump(bad)).toThrow(/missing the "structures" table/);
        expect(() => validateDump(null)).toThrow();
        expect(() => validateDump([])).toThrow();
    });

    it('fills defaults for columns missing from older exports', () => {
        const dump = validateDump({
            players: [{ id: 1, name: 'Old' }],
            structures: [{ id: 1, name: 'S' }],
            tournaments: [{ id: 1, name: 'T', status: 'archived' }],
            tournamentResults: [{ id: 1, tournament_id: 1, player_id: 1, place: 1 }],
            settings: [{ key: 'language' }],
        });
        expect(dump.players[0]).toEqual({ id: 1, name: 'Old', nickname: null, email: null, photo_path: null, is_deleted: 0 });
        expect(dump.structures[0].starting_chips).toBe(0);
        expect(dump.tournaments[0].entry_fee).toBe(0);
        expect(dump.tournaments[0].currency).toBe('EUR');
        expect(dump.tournaments[0].structure_id).toBeNull();
        expect(dump.tournamentResults[0].playtime_sec).toBe(0);
        expect(dump.settings[0].value).toBe('');
    });

    it('rejects rows without a usable id', () => {
        const base = { players: [], structures: [], tournaments: [], tournamentResults: [], settings: [] };
        expect(() => validateDump({ ...base, players: [{ name: 'NoId' }] })).toThrow(/invalid id/);
        expect(() => validateDump({ ...base, tournamentResults: [{ id: 1, player_id: 1 }] })).toThrow(/invalid id/);
    });
});

describe('sanitizeZipEntryName', () => {
    it('accepts flat entries in the two media folders', () => {
        expect(sanitizeZipEntryName('photos/123-abc.jpg')).toEqual({ folder: 'photos', basename: '123-abc.jpg' });
        expect(sanitizeZipEntryName('projector/bg.png')).toEqual({ folder: 'projector', basename: 'bg.png' });
    });

    it('rejects traversal, absolute paths, nesting and foreign entries', () => {
        expect(sanitizeZipEntryName('../evil.sh')).toBeNull();
        expect(sanitizeZipEntryName('photos/../../evil.sh')).toBeNull();
        expect(sanitizeZipEntryName('photos/..')).toBeNull();
        expect(sanitizeZipEntryName('photos/sub/a.jpg')).toBeNull();
        expect(sanitizeZipEntryName('/etc/passwd')).toBeNull();
        expect(sanitizeZipEntryName('photos\\..\\evil.sh')).toBeNull();
        expect(sanitizeZipEntryName('manifest.json')).toBeNull();
        expect(sanitizeZipEntryName('data.json')).toBeNull();
    });
});

describe('exportAllData / importAllData round-trip', () => {
    let srcDir: string;
    let dstDir: string;
    let archivePath: string;

    beforeEach(() => {
        vi.clearAllMocks();
        srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmi-src-'));
        dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmi-dst-'));
        archivePath = path.join(srcDir, 'backup.dmibak');
        for (const [rel, content] of [
            ['photos/111-aaa.jpg', 'img-alice'],
            ['photos/222-bbb.png', 'img-bob'],
            ['projector/333-ccc.png', 'img-bg'],
            ['projector/444-ddd.svg', 'img-logo'],
        ] as const) {
            const abs = path.join(srcDir, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
        }
        vi.mocked(getAllRowsForExport).mockReturnValue(makeRows(srcDir));
        vi.mocked(app.getPath).mockReturnValue(dstDir);
    });

    it('writes an archive that imports on a different userData with rewritten paths', () => {
        exportAllData(archivePath);
        expect(fs.existsSync(archivePath)).toBe(true);
        expect(fs.existsSync(archivePath + '.tmp')).toBe(false);

        const { safetyBackupPath } = importAllData(archivePath);

        // Media landed under the destination userData with original basenames.
        expect(fs.readFileSync(path.join(dstDir, 'photos', '111-aaa.jpg'), 'utf-8')).toBe('img-alice');
        expect(fs.readFileSync(path.join(dstDir, 'projector', '333-ccc.png'), 'utf-8')).toBe('img-bg');

        // The DB swap received rows identical to the source, paths re-rooted.
        expect(replaceAllData).toHaveBeenCalledTimes(1);
        const restored = vi.mocked(replaceAllData).mock.calls[0][0];
        expect(restored).toEqual(makeRows(dstDir));

        // A safety backup of the pre-import data was written first.
        expect(safetyBackupPath.startsWith(path.join(dstDir, 'backups'))).toBe(true);
        expect(fs.existsSync(safetyBackupPath)).toBe(true);
    });

    it('skips dangling media paths instead of aborting the export', () => {
        fs.unlinkSync(path.join(srcDir, 'photos', '222-bbb.png'));
        expect(() => exportAllData(archivePath)).not.toThrow();
        expect(() => importAllData(archivePath)).not.toThrow();
        expect(fs.existsSync(path.join(dstDir, 'photos', '111-aaa.jpg'))).toBe(true);
        expect(fs.existsSync(path.join(dstDir, 'photos', '222-bbb.png'))).toBe(false);
    });

    it('rejects a non-backup file without touching the database', () => {
        const bogus = path.join(srcDir, 'not-a-backup.dmibak');
        fs.writeFileSync(bogus, 'this is not a zip');
        expect(() => importAllData(bogus)).toThrow(/could not be read/);
        expect(replaceAllData).not.toHaveBeenCalled();
    });

    it('rejects an archive from a newer format version before any write', () => {
        exportAllData(archivePath);
        // Rewrite the manifest in place to claim a future version.
        const zip = new AdmZip(archivePath);
        const manifest = JSON.parse(zip.readAsText('manifest.json'));
        manifest.formatVersion = BACKUP_FORMAT_VERSION + 1;
        zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
        zip.writeZip(archivePath);

        expect(() => importAllData(archivePath)).toThrow(/newer version/);
        expect(replaceAllData).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(dstDir, 'photos', '111-aaa.jpg'))).toBe(false);
    });
});
