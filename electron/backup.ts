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

// Import guards against a zip bomb / pathological archive. Backups hold small
// JSON plus user photos, so these are far above any legitimate payload while
// still bounding the synchronous main-process decompression.
const MAX_ENTRY_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

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
// When userDataDir is given, register() refuses to pack anything outside
// <userDataDir>/<folder> — export must never turn an arbitrary readable file
// on disk into part of the shareable archive (defense in depth: today only
// importFileToUserData writes these paths, but nothing else enforces it).
export function relativizeDump(rows: DataDumpRows, userDataDir?: string): { dump: DataDumpRows; files: MediaFileRef[] } {
  const dump = structuredClone(rows);
  const byAbsPath = new Map<string, string>();
  const usedZipPaths = new Set<string>();
  const register = (absPath: string, folder: 'photos' | 'projector'): string => {
    if (userDataDir) {
      const root = path.join(userDataDir, folder) + path.sep;
      if (!absPath.startsWith(root)) return absPath;
    }
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
  const toAbs: PathRewrite = (value) => {
    if (!ARCHIVE_RELATIVE.test(value)) return null;
    // `[^/\\]+` matches the literal ".." — reject dot segments so a
    // hand-crafted "photos/.." can't resolve to userData itself.
    const parts = value.split('/');
    if (parts.some(seg => seg === '.' || seg === '..')) return null;
    return path.join(userDataDir, ...parts);
  };

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

// For INTEGER columns (place, playtime_sec, starting_chips): SQLite stores
// 1.5 in an INTEGER-affinity column as REAL — reject fractions like reqId does.
function numInt(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isInteger(v) ? v : dflt;
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
    starting_chips: numInt(s.starting_chips, 0),
    data: strOrNull(s.data),
  }));
  const tournaments = (d.tournaments as Raw[]).map((t): TournamentExportRow => {
    const id = reqId(t.id, 'tournaments');
    const status = str(t.status, 'running');
    const state = strOrNull(t.state);
    // A running tournament's state drives engine hydration. A null/array/
    // primitive payload would otherwise be accepted here and only rejected
    // later by the engine, leaving a "running" row the app can't load.
    if (status === 'running') {
      let parsed: unknown;
      try {
        parsed = state === null ? null : JSON.parse(state);
      } catch {
        throw new Error(`Invalid backup: running tournament ${id} has a corrupt state snapshot.`);
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid backup: running tournament ${id} has an invalid state snapshot.`);
      }
    }
    return {
      id,
      name: str(t.name, ''),
      start_date: strOrNull(t.start_date),
      end_date: strOrNull(t.end_date),
      status,
      state,
      entry_fee: num(t.entry_fee, 0),
      currency: str(t.currency, 'EUR'),
      structure_id: numOrNull(t.structure_id),
      structure_name: strOrNull(t.structure_name),
    };
  });
  const tournamentResults = (d.tournamentResults as Raw[]).map((r): TournamentResultExportRow => ({
    id: reqId(r.id, 'tournamentResults'),
    tournament_id: reqId(r.tournament_id, 'tournamentResults'),
    player_id: reqId(r.player_id, 'tournamentResults'),
    place: numInt(r.place, 0),
    playtime_sec: numInt(r.playtime_sec, 0),
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

// Referential-integrity / uniqueness checks that better-sqlite3 would enforce
// (and therefore make replaceAllData throw). They must run BEFORE anything is
// written — the transaction rolls the DB back cleanly, but media files are
// extracted on disk and must never be clobbered by an import that then fails.
export function validateReferentialIntegrity(dump: DataDumpRows): void {
  const checkUniqueIds = (rows: { id: number }[], table: string) => {
    const seen = new Set<number>();
    for (const r of rows) {
      if (seen.has(r.id)) {
        throw new Error(`Invalid backup: duplicate id ${r.id} in "${table}".`);
      }
      seen.add(r.id);
    }
  };
  checkUniqueIds(dump.players, 'players');
  checkUniqueIds(dump.structures, 'structures');
  checkUniqueIds(dump.tournaments, 'tournaments');
  checkUniqueIds(dump.tournamentResults, 'tournamentResults');

  const seenKeys = new Set<string>();
  for (const s of dump.settings) {
    if (seenKeys.has(s.key)) {
      throw new Error(`Invalid backup: duplicate settings key "${s.key}".`);
    }
    seenKeys.add(s.key);
  }

  const playerIds = new Set(dump.players.map(p => p.id));
  const tournamentIds = new Set(dump.tournaments.map(t => t.id));
  const seenPairs = new Set<string>();
  for (const r of dump.tournamentResults) {
    if (!tournamentIds.has(r.tournament_id)) {
      throw new Error(`Invalid backup: a result references missing tournament ${r.tournament_id}.`);
    }
    if (!playerIds.has(r.player_id)) {
      throw new Error(`Invalid backup: a result references missing player ${r.player_id}.`);
    }
    const pair = `${r.tournament_id}:${r.player_id}`;
    if (seenPairs.has(pair)) {
      throw new Error('Invalid backup: duplicate result rows for the same tournament and player.');
    }
    seenPairs.add(pair);
  }

  // Tournaments.structure_id has no FK in the schema, so a dangling
  // value would import fine but leave the tournament un-resumable (its
  // structure can't be re-opened). Validate it like the enforced references.
  const structureIds = new Set(dump.structures.map(s => s.id));
  for (const t of dump.tournaments) {
    if (t.structure_id != null && !structureIds.has(t.structure_id)) {
      throw new Error(`Invalid backup: tournament ${t.id} references missing structure ${t.structure_id}.`);
    }
  }
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

export function exportAllData(targetFilePath: string, userDataDir?: string): void {
  const rows = getAllRowsForExport();
  // Explicit root (or the app userData) so export only ever packs files the
  // app manages — never an arbitrary path that happens to sit in the DB.
  const { dump, files } = relativizeDump(rows, userDataDir ?? app.getPath('userData'));
  const manifest = buildManifest(dump, app.getVersion());

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('data.json', Buffer.from(JSON.stringify(dump)));
  for (const f of files) {
    // A dangling/unreadable media path must not abort the backup — skip it.
    // existsSync only proves the path exists: a directory, a permission error,
    // or a transient lock still throws from readFileSync and would abort the
    // whole export (including the automatic pre-import safety backup).
    try {
      zip.addFile(f.zipPath, fs.readFileSync(f.absPath));
    } catch {
      // skip unreadable media
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

// Thrown when media files could not be extracted AFTER the DB swap already
// committed. The caller must not resume the previously loaded in-memory
// tournament state in this case — doing so would let the next tick's save()
// overwrite the freshly imported rows. The singleton must be rehydrated from
// the imported DB instead.
export class MediaExtractionError extends Error {
    readonly dbCommitted = true;
    constructor(failedEntries: string[], safetyBackupPath: string) {
        super(
            `The database was imported, but ${failedEntries.length} media file(s) could not be ` +
            `restored (${failedEntries.join(', ')}). Your previous data was saved to ${safetyBackupPath}.`
        );
        this.name = 'MediaExtractionError';
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

// Full replace. Validates the entire archive before the first write (row
// shapes AND referential integrity/uniqueness, so the swap below cannot throw
// on well-formed-but-inconsistent data), then writes a safety backup of the
// current data, swaps the DB contents in one transaction, and only then
// extracts media files — a failed import must not clobber existing photos.
// Every in-memory consumer (tournament singleton, open windows, renderer
// settings) is stale after this returns — the caller must rehydrate the
// singleton (tournamentManager.reloadFromDb()) and reload every window.
export function importAllData(sourceFilePath: string): { safetyBackupPath: string } {
  const userDataDir = app.getPath('userData');

  let zip: AdmZip;
  try {
    zip = new AdmZip(sourceFilePath);
  } catch {
    throw new Error('This file could not be read as a backup archive.');
  }
  // Reject an archive that would decompress to an unreasonable size BEFORE
  // reading any entry (AdmZip loads the whole file up front and getData()
  // inflates synchronously on the main process).
  let totalUncompressed = 0;
  for (const entry of zip.getEntries()) {
    const size = entry.header.size;
    if (size > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error('Invalid backup: the archive contains an unexpectedly large entry.');
    }
    totalUncompressed += size;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Invalid backup: the archive expands to an unreasonable size.');
    }
  }
  validateManifest(parseJsonEntry(zip, 'manifest.json'));
  const dump = validateDump(parseJsonEntry(zip, 'data.json'));
  validateReferentialIntegrity(dump);

  const backupsDir = path.join(userDataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackupPath = path.join(backupsDir, `pre-import-${stamp}.dmibak`);
  exportAllData(safetyBackupPath);

  replaceAllData(absolutizeDump(dump, userDataDir));

  // Media extraction comes last: from here on the DB swap has committed, so
  // only a disk-level failure could leave media missing behind live
  // references. Extract each file independently so one bad entry doesn't
  // abort the rest; if any fail, report it — the DB swap has committed, so
  // the caller must rehydrate rather than resume the old in-memory state.
  const extractionFailures: string[] = [];
  for (const entry of zip.getEntries()) {
    const safe = sanitizeZipEntryName(entry.entryName);
    if (!safe) continue;
    const destDir = path.join(userDataDir, safe.folder);
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, safe.basename), entry.getData());
    } catch {
      extractionFailures.push(`${safe.folder}/${safe.basename}`);
    }
  }
  if (extractionFailures.length > 0) {
    throw new MediaExtractionError(extractionFailures, safetyBackupPath);
  }

  return { safetyBackupPath };
}
