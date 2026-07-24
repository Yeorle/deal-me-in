import AdmZip from 'adm-zip';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getAllRowsForExport, replaceAllData, DataDumpRows, PlayerExportRow, StructureExportRow, TournamentExportRow, TournamentResultExportRow, SettingExportRow } from './db';

// Full-data backup archive (.dmibak — a plain zip):
//   manifest.json   format id/version, app version, export date, row counts
//   data.json       dump of all five tables, primary keys preserved
//   photos/*        player photos (verbatim copies from userData/photos)
//   projector/*     projector images (verbatim copies from userData/projector)
//
// The DB stores absolute media paths in three places (Players.photo_path,
// embedded players inside Tournaments.state JSON, backgroundImage/logoPath in
// the projectorTheme setting), and absolute paths are wrong on any other
// machine. Export rewrites them to archive-relative paths (photos/<file>,
// projector/<file>); import rewrites them back to absolute paths under the
// destination userData. Everything path-related below is pure so it can run
// under vitest with `electron` and `./db` mocked.

export const BACKUP_FORMAT = 'dealmein-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  format: string;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  counts: Record<string, number>;
}

export interface MediaFileRef {
  absPath: string;
  zipPath: string;
}

interface EmbeddedPlayerRef {
  photo_path?: string | null;
}

interface StateSnapshotShape {
  tables?: { seats?: { player?: EmbeddedPlayerRef | null }[] }[];
  unassignedPlayers?: EmbeddedPlayerRef[];
  bustedPlayers?: EmbeddedPlayerRef[];
}

// `rewrite` returns the replacement value, or null to leave the path as-is.
type PathRewrite = (value: string) => string | null;

function rewriteStatePhotoPaths(stateJson: string | null, rewrite: PathRewrite): string | null {
  if (!stateJson) return stateJson;
  try {
    const state = JSON.parse(stateJson) as StateSnapshotShape;
    let changed = false;
    const visit = (p: EmbeddedPlayerRef | null | undefined) => {
      if (p && typeof p.photo_path === 'string' && p.photo_path) {
        const next = rewrite(p.photo_path);
        if (next !== null && next !== p.photo_path) {
          p.photo_path = next;
          changed = true;
        }
      }
    };
    for (const table of state.tables ?? []) {
      for (const seat of table.seats ?? []) visit(seat.player);
    }
    for (const p of state.unassignedPlayers ?? []) visit(p);
    for (const p of state.bustedPlayers ?? []) visit(p);
    return changed ? JSON.stringify(state) : stateJson;
  } catch {
    // Unparseable snapshot — keep it verbatim rather than fail the backup.
    return stateJson;
  }
}

function rewriteProjectorThemePaths(value: string, rewrite: PathRewrite): string {
  try {
    const theme = JSON.parse(value) as { backgroundImage?: string | null; logoPath?: string | null };
    let changed = false;
    for (const key of ['backgroundImage', 'logoPath'] as const) {
      const current = theme[key];
      if (typeof current === 'string' && current) {
        const next = rewrite(current);
        if (next !== null && next !== current) {
          theme[key] = next;
          changed = true;
        }
      }
    }
    return changed ? JSON.stringify(theme) : value;
  } catch {
    return value;
  }
}

// Absolute paths → archive-relative, collecting the set of files to pack.
// Deduped by absolute path; a basename collision between distinct files gets a
// uniquifying prefix (can't happen with importFileToUserData names, but a
// backup must never silently pack the wrong file).
export function relativizeDump(rows: DataDumpRows): { dump: DataDumpRows; files: MediaFileRef[] } {
  const dump = structuredClone(rows);
  const byAbsPath = new Map<string, string>();
  const usedZipPaths = new Set<string>();
  const register = (absPath: string, folder: 'photos' | 'projector'): string => {
    const existing = byAbsPath.get(absPath);
    if (existing) return existing;
    let zipPath = `${folder}/${path.basename(absPath)}`;
    let i = 2;
    while (usedZipPaths.has(zipPath)) {
      zipPath = `${folder}/${i}-${path.basename(absPath)}`;
      i++;
    }
    byAbsPath.set(absPath, zipPath);
    usedZipPaths.add(zipPath);
    return zipPath;
  };

  for (const p of dump.players) {
    if (p.photo_path) p.photo_path = register(p.photo_path, 'photos');
  }
  for (const t of dump.tournaments) {
    t.state = rewriteStatePhotoPaths(t.state, abs => register(abs, 'photos'));
  }
  for (const s of dump.settings) {
    if (s.key === 'projectorTheme') {
      s.value = rewriteProjectorThemePaths(s.value, abs => register(abs, 'projector'));
    }
  }
  return { dump, files: [...byAbsPath].map(([absPath, zipPath]) => ({ absPath, zipPath })) };
}

const ARCHIVE_RELATIVE = /^(photos|projector)\/[^/\\]+$/;

// Archive-relative paths → absolute paths under the destination userData.
// Values that don't match the archive convention are left untouched.
export function absolutizeDump(dump: DataDumpRows, userDataDir: string): DataDumpRows {
  const out = structuredClone(dump);
  const toAbs: PathRewrite = (value) =>
    ARCHIVE_RELATIVE.test(value) ? path.join(userDataDir, ...value.split('/')) : null;

  for (const p of out.players) {
    if (p.photo_path) {
      const abs = toAbs(p.photo_path);
      if (abs !== null) p.photo_path = abs;
    }
  }
  for (const t of out.tournaments) {
    t.state = rewriteStatePhotoPaths(t.state, toAbs);
  }
  for (const s of out.settings) {
    if (s.key === 'projectorTheme') {
      s.value = rewriteProjectorThemePaths(s.value, toAbs);
    }
  }
  return out;
}

export function buildManifest(dump: DataDumpRows, appVersion: string): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    counts: {
      players: dump.players.length,
      structures: dump.structures.length,
      tournaments: dump.tournaments.length,
      results: dump.tournamentResults.length,
      settings: dump.settings.length,
    },
  };
}

export function validateManifest(json: unknown): BackupManifest {
  const m = json as Partial<BackupManifest> | null;
  if (!m || typeof m !== 'object' || m.format !== BACKUP_FORMAT) {
    throw new Error('This file is not a Deal Me In backup.');
  }
  if (typeof m.formatVersion !== 'number' || !Number.isInteger(m.formatVersion) || m.formatVersion < 1) {
    throw new Error('This backup has an invalid format version.');
  }
  if (m.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error('This backup was created by a newer version of the app. Update the app, then import again.');
  }
  return m as BackupManifest;
}

function num(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown, dflt: string): string {
  return typeof v === 'string' ? v : dflt;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function reqId(v: unknown, table: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new Error(`Invalid backup: a row in "${table}" has a missing or invalid id.`);
  }
  return v;
}

type Raw = Record<string, unknown>;

// Shape-check data.json and normalize every row: rows from older exports may
// miss columns added later — fill them with the same defaults migrateSchema()
// would (and never let `undefined` reach better-sqlite3, which rejects it).
export function validateDump(json: unknown): DataDumpRows {
  const d = json as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    throw new Error('Invalid backup: data.json is not an object.');
  }
  for (const key of ['players', 'structures', 'tournaments', 'tournamentResults', 'settings'] as const) {
    if (!Array.isArray(d[key])) {
      throw new Error(`Invalid backup: data.json is missing the "${key}" table.`);
    }
  }
  const players = (d.players as Raw[]).map((p): PlayerExportRow => ({
    id: reqId(p.id, 'players'),
    name: str(p.name, ''),
    nickname: strOrNull(p.nickname),
    email: strOrNull(p.email),
    photo_path: strOrNull(p.photo_path),
    is_deleted: num(p.is_deleted, 0) ? 1 : 0,
  }));
  const structures = (d.structures as Raw[]).map((s): StructureExportRow => ({
    id: reqId(s.id, 'structures'),
    name: str(s.name, ''),
    starting_chips: num(s.starting_chips, 0),
    data: strOrNull(s.data),
  }));
  const tournaments = (d.tournaments as Raw[]).map((t): TournamentExportRow => ({
    id: reqId(t.id, 'tournaments'),
    name: str(t.name, ''),
    start_date: strOrNull(t.start_date),
    end_date: strOrNull(t.end_date),
    status: str(t.status, 'running'),
    state: strOrNull(t.state),
    entry_fee: num(t.entry_fee, 0),
    currency: str(t.currency, 'EUR'),
    structure_id: numOrNull(t.structure_id),
    structure_name: strOrNull(t.structure_name),
  }));
  const tournamentResults = (d.tournamentResults as Raw[]).map((r): TournamentResultExportRow => ({
    id: reqId(r.id, 'tournamentResults'),
    tournament_id: reqId(r.tournament_id, 'tournamentResults'),
    player_id: reqId(r.player_id, 'tournamentResults'),
    place: num(r.place, 0),
    playtime_sec: num(r.playtime_sec, 0),
    prize: num(r.prize, 0),
    entry_fee: num(r.entry_fee, 0),
  }));
  const settings = (d.settings as Raw[]).map((s): SettingExportRow => {
    if (typeof s.key !== 'string' || !s.key) {
      throw new Error('Invalid backup: a settings row has no key.');
    }
    return { key: s.key, value: str(s.value, '') };
  });
  return { players, structures, tournaments, tournamentResults, settings };
}

// Only flat entries directly inside photos/ or projector/ are extractable —
// everything else (nested dirs, ../ traversal, absolute paths) is ignored.
export function sanitizeZipEntryName(entryName: string): { folder: 'photos' | 'projector'; basename: string } | null {
  const m = /^(photos|projector)\/([^/\\]+)$/.exec(entryName);
  if (!m) return null;
  const basename = m[2];
  if (basename === '.' || basename === '..') return null;
  return { folder: m[1] as 'photos' | 'projector', basename };
}

// ---------------------------------------------------------------------------
// IO — main process only.

export function exportAllData(targetFilePath: string): void {
  const rows = getAllRowsForExport();
  const { dump, files } = relativizeDump(rows);
  const manifest = buildManifest(dump, app.getVersion());

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('data.json', Buffer.from(JSON.stringify(dump)));
  for (const f of files) {
    // A dangling media path must not abort the backup — skip missing files.
    if (fs.existsSync(f.absPath)) {
      zip.addFile(f.zipPath, fs.readFileSync(f.absPath));
    }
  }

  // Write to a temp name and rename, so a failed write (disk full, read-only
  // target) never leaves a truncated archive behind.
  const tmpPath = targetFilePath + '.tmp';
  try {
    zip.writeZip(tmpPath);
    fs.renameSync(tmpPath, targetFilePath);
  } catch (e) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw e;
  }
}

function parseJsonEntry(zip: AdmZip, entryName: string): unknown {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    throw new Error(`This file is not a Deal Me In backup (missing ${entryName}).`);
  }
  try {
    return JSON.parse(entry.getData().toString('utf-8'));
  } catch {
    throw new Error(`Invalid backup: ${entryName} is not valid JSON.`);
  }
}

// Full replace. Validates the entire archive before the first write, then
// writes a safety backup of the current data, extracts media, and swaps the DB
// contents in one transaction. Every in-memory consumer (tournament singleton,
// open windows, renderer settings) is stale after this returns — the caller
// must rehydrate the singleton (tournamentManager.reloadFromDb()) and reload
// every window.
export function importAllData(sourceFilePath: string): { safetyBackupPath: string } {
  const userDataDir = app.getPath('userData');

  let zip: AdmZip;
  try {
    zip = new AdmZip(sourceFilePath);
  } catch {
    throw new Error('This file could not be read as a backup archive.');
  }
  validateManifest(parseJsonEntry(zip, 'manifest.json'));
  const dump = validateDump(parseJsonEntry(zip, 'data.json'));

  const backupsDir = path.join(userDataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackupPath = path.join(backupsDir, `pre-import-${stamp}.dmibak`);
  exportAllData(safetyBackupPath);

  for (const entry of zip.getEntries()) {
    const safe = sanitizeZipEntryName(entry.entryName);
    if (!safe) continue;
    const destDir = path.join(userDataDir, safe.folder);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, safe.basename), entry.getData());
  }

  replaceAllData(absolutizeDump(dump, userDataDir));
  return { safetyBackupPath };
}
