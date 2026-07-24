import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let db: Database.Database | undefined;

export function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'poker_manager.db');
  console.log('Initializing database at:', dbPath);
  // Statement logging is dev-only: in production the ~1/sec state save would
  // log a multi-KB UPDATE line forever.
  db = new Database(dbPath, { verbose: app.isPackaged ? undefined : console.log });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const createPlayers = `
    CREATE TABLE IF NOT EXISTS Players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nickname TEXT,
      email TEXT,
      photo_path TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
  `;

  const createStructures = `
    CREATE TABLE IF NOT EXISTS Structures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      starting_chips INTEGER DEFAULT 0,
      data JSON
    );
  `;

  const createTournaments = `
    CREATE TABLE IF NOT EXISTS Tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'running',
      state JSON,
      entry_fee REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      structure_id INTEGER,
      structure_name TEXT
    );
  `;

  const createTournamentResults = `
    CREATE TABLE IF NOT EXISTS TournamentResults (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL,
      player_id     INTEGER NOT NULL,
      place         INTEGER NOT NULL,
      playtime_sec  INTEGER NOT NULL DEFAULT 0,
      prize         REAL NOT NULL DEFAULT 0,
      entry_fee     REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (tournament_id) REFERENCES Tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id)     REFERENCES Players(id),
      UNIQUE (tournament_id, player_id)
    );
  `;

  const createSettings = `
    CREATE TABLE IF NOT EXISTS Settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;

  db.transaction(() => {
    db!.exec(createPlayers);
    db!.exec(createStructures);
    db!.exec(createTournaments);
    db!.exec(createTournamentResults);
    db!.exec(createSettings);
    db!.exec('CREATE INDEX IF NOT EXISTS idx_results_tournament ON TournamentResults(tournament_id)');
    db!.exec('CREATE INDEX IF NOT EXISTS idx_results_player ON TournamentResults(player_id)');
    migrateSchema(db!);
  })();

  // Seed default data if empty
  const playerCount = db.prepare('SELECT COUNT(*) as count FROM Players').get() as { count: number };
  if (playerCount.count === 0) {
    const insertPlayer = db.prepare('INSERT INTO Players (name, nickname, email) VALUES (?, ?, ?)');
    const players = [
      ['Daniel Negreanu', 'Kid Poker', 'daniel@example.com'],
      ['Phil Ivey', 'The Tiger Woods of Poker', 'phil.i@example.com'],
      ['Doyle Brunson', 'Texas Dolly', 'doyle@example.com'],
      ['Phil Hellmuth', 'The Poker Brat', 'phil.h@example.com'],
      ['Erik Seidel', 'Sly', 'erik@example.com'],
      ['Chris Moneymaker', 'Money', 'chris@example.com'],
      ['Vanessa Selbst', 'V', 'vanessa@example.com'],
      ['Tom Dwan', 'durrrr', 'tom@example.com'],
      ['Dan Smith', 'Cowboy', 'dan@example.com'],
      ['Fedor Holz', 'CrownUpGuy', 'fedor@example.com']
    ];
    players.forEach(p => insertPlayer.run(p));
    console.log('Seeded default players.');
  }

  const structureCount = db.prepare('SELECT COUNT(*) as count FROM Structures').get() as { count: number };
  if (structureCount.count === 0) {
    const insertStructure = db.prepare('INSERT INTO Structures (name, starting_chips, data) VALUES (?, ?, ?)');
    const demoLevels = [
      { smallBlind: 100, bigBlind: 200, ante: 0, duration: 15 },
      { smallBlind: 200, bigBlind: 400, ante: 0, duration: 15 },
      { smallBlind: 300, bigBlind: 600, ante: 0, duration: 15 },
      { smallBlind: 400, bigBlind: 800, ante: 0, duration: 15 },
      { smallBlind: 500, bigBlind: 1000, ante: 100, duration: 15 },
      { smallBlind: 600, bigBlind: 1200, ante: 200, duration: 15 },
    ];
    insertStructure.run('Standard Turbo', 10000, JSON.stringify(demoLevels));
    insertStructure.run('Deep Stack', 25000, JSON.stringify(demoLevels));
    console.log('Seeded default structures.');
  }

  console.log('Database initialized.');
}

// Idempotent column additions for databases created before these features.
// Safe to run on every startup — only adds columns that are missing.
function migrateSchema(database: Database.Database) {
  const hasColumn = (table: string, column: string): boolean => {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return cols.some(c => c.name === column);
  };

  if (!hasColumn('Players', 'is_deleted')) {
    database.exec('ALTER TABLE Players ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('Tournaments', 'entry_fee')) {
    database.exec('ALTER TABLE Tournaments ADD COLUMN entry_fee REAL NOT NULL DEFAULT 0');
  }
  if (!hasColumn('Tournaments', 'currency')) {
    database.exec("ALTER TABLE Tournaments ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'");
  }
  if (!hasColumn('Tournaments', 'structure_id')) {
    database.exec('ALTER TABLE Tournaments ADD COLUMN structure_id INTEGER');
  }
  if (!hasColumn('Tournaments', 'structure_name')) {
    database.exec('ALTER TABLE Tournaments ADD COLUMN structure_name TEXT');
  }
}

export function getDB() {
  if (!db) {
    throw new Error('Database not initialized!');
  }
  return db;
}

export function getPlayers() {
  const stmt = getDB().prepare('SELECT * FROM Players WHERE is_deleted = 0 ORDER BY id');
  return stmt.all();
}

export function addPlayer(player: { name: string; nickname?: string; email?: string; photo_path?: string }) {
  const stmt = getDB().prepare(`
        INSERT INTO Players (name, nickname, email, photo_path)
        VALUES (@name, @nickname, @email, @photo_path)
    `);
  return stmt.run({
    ...player,
    nickname: player.nickname || null,
    email: player.email || null,
    photo_path: player.photo_path || null
  });
}

export function saveStructure(structure: { name: string; starting_chips: number; data: string }) {
  const stmt = getDB().prepare(`
        INSERT INTO Structures (name, starting_chips, data)
        VALUES (@name, @starting_chips, @data)
    `);
  return stmt.run(structure);
}

export function getStructures() {
  const stmt = getDB().prepare('SELECT * FROM Structures ORDER BY id');
  return stmt.all();
}

export function getPlayer(id: number) {
  const stmt = getDB().prepare('SELECT * FROM Players WHERE id = ?');
  return stmt.get(id);
}

// Best-effort file removal — a missing file is fine, anything else is logged.
function tryUnlink(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to delete file:', filePath, e);
    }
  }
}

// Blank a player's PII inside every tournament's `state` JSON snapshot.
// Snapshots embed full Player objects (tables / unassignedPlayers /
// bustedPlayers) and outlive the player row, so "delete player" must scrub
// them too or the data would remain readable in the DB indefinitely.
function scrubPlayerFromTournamentStates(playerId: number) {
  const rows = getDB().prepare('SELECT id, state FROM Tournaments').all() as { id: number; state: string | null }[];
  const update = getDB().prepare('UPDATE Tournaments SET state = ? WHERE id = ?');
  for (const row of rows) {
    if (!row.state) continue;
    try {
      const state = JSON.parse(row.state);
      let changed = false;
      const scrub = (p: { id?: number; name?: string; nickname?: string | null; email?: string | null; photo_path?: string | null } | null | undefined) => {
        if (p && p.id === playerId) {
          p.name = '';
          p.nickname = null;
          p.email = null;
          p.photo_path = null;
          changed = true;
        }
      };
      for (const table of state.tables ?? []) {
        for (const seat of table.seats ?? []) scrub(seat.player);
      }
      for (const p of state.unassignedPlayers ?? []) scrub(p);
      for (const p of state.bustedPlayers ?? []) scrub(p);
      if (changed) update.run(JSON.stringify(state), row.id);
    } catch {
      // Unparseable snapshot — nothing we can scrub.
    }
  }
}

export function updatePlayer(player: { id: number; name: string; nickname?: string; email?: string; photo_path?: string }) {
  const previous = getDB().prepare('SELECT photo_path FROM Players WHERE id = ?').get(player.id) as { photo_path: string | null } | undefined;
  // is_deleted guard: writing onto a soft-deleted row would half-resurrect it
  // (PII back on a row that stays hidden from every list).
  const stmt = getDB().prepare(`
    UPDATE Players
    SET name = @name, nickname = @nickname, email = @email, photo_path = @photo_path
    WHERE id = @id AND is_deleted = 0
  `);
  const result = stmt.run({
    ...player,
    nickname: player.nickname || null,
    email: player.email || null,
    photo_path: player.photo_path || null
  });
  // A replaced photo would otherwise be orphaned in userData/photos forever.
  if (previous?.photo_path && previous.photo_path !== (player.photo_path || null)) {
    tryUnlink(previous.photo_path);
  }
  return result;
}

// Soft delete: keep the row (so TournamentResults stay linked) but strip all
// personal info and hide it from the player list. Name is blanked (rather than
// NULL) so the legacy NOT NULL constraint is satisfied; the is_deleted flag is
// the authoritative marker and historical views render a "???" placeholder.
// The photo file and all tournament state snapshots are scrubbed as well.
export function deletePlayer(id: number) {
  const row = getDB().prepare('SELECT photo_path FROM Players WHERE id = ?').get(id) as { photo_path: string | null } | undefined;
  const stmt = getDB().prepare(`
    UPDATE Players
    SET is_deleted = 1, name = '', nickname = NULL, email = NULL, photo_path = NULL
    WHERE id = ?
  `);
  const result = stmt.run(id);
  if (row?.photo_path) tryUnlink(row.photo_path);
  scrubPlayerFromTournamentStates(id);
  return result;
}

export function getStructure(id: number) {
  const stmt = getDB().prepare('SELECT * FROM Structures WHERE id = ?');
  return stmt.get(id);
}

export function updateStructure(structure: { id: number; name: string; starting_chips: number; data: string }) {
  const stmt = getDB().prepare(`
    UPDATE Structures
    SET name = @name, starting_chips = @starting_chips, data = @data
    WHERE id = @id
  `);
  return stmt.run(structure);
}

export function deleteStructure(id: number) {
  const stmt = getDB().prepare('DELETE FROM Structures WHERE id = ?');
  return stmt.run(id);
}

export interface TournamentMeta {
  entryFee: number;
  currency: string;
  structureId: number | null;
  structureName: string | null;
}

export function createTournament(name: string, state: object, meta: TournamentMeta) {
  const stmt = getDB().prepare(`
        INSERT INTO Tournaments (name, start_date, status, state, entry_fee, currency, structure_id, structure_name)
        VALUES (@name, datetime('now', 'localtime'), 'running', @state, @entry_fee, @currency, @structure_id, @structure_name)
    `);
  return stmt.run({
    name,
    state: JSON.stringify(state),
    entry_fee: meta.entryFee,
    currency: meta.currency,
    structure_id: meta.structureId,
    structure_name: meta.structureName,
  });
}

export function getRunningTournament() {
  const stmt = getDB().prepare(`
        SELECT * FROM Tournaments
        WHERE status = 'running'
        ORDER BY id DESC
        LIMIT 1
    `);
  return stmt.get();
}

export function getRunningTournaments() {
  const stmt = getDB().prepare(`
        SELECT id, name, start_date
        FROM Tournaments
        WHERE status = 'running'
        ORDER BY id DESC
    `);
  return stmt.all();
}

export function getTournamentById(id: number) {
  const stmt = getDB().prepare('SELECT * FROM Tournaments WHERE id = ?');
  return stmt.get(id);
}

export function archiveTournament(id: number) {
  const stmt = getDB().prepare(`
        UPDATE Tournaments 
        SET status = 'archived', end_date = datetime('now', 'localtime')
        WHERE id = ?
    `);
  return stmt.run(id);
}

export function updateTournamentState(id: number, state: object) {
  const stmt = getDB().prepare(`
        UPDATE Tournaments 
        SET state = @state 
        WHERE id = @id
    `);
  return stmt.run({ id, state: JSON.stringify(state) });
}

export function getArchivedTournaments() {
  const stmt = getDB().prepare(`
        SELECT
          t.id, t.name, t.start_date, t.end_date, t.structure_name, t.entry_fee, t.currency,
          (SELECT COUNT(*) FROM TournamentResults r WHERE r.tournament_id = t.id) AS player_count,
          (SELECT COALESCE(SUM(r.prize), 0) FROM TournamentResults r WHERE r.tournament_id = t.id) AS prize_pool,
          (SELECT p.name FROM TournamentResults r
             JOIN Players p ON p.id = r.player_id
             WHERE r.tournament_id = t.id AND r.place = 1 LIMIT 1) AS winner_name
        FROM Tournaments t
        WHERE t.status = 'archived'
        ORDER BY t.end_date DESC
    `);
  return stmt.all();
}

export function deleteTournament(id: number) {
  const stmt = getDB().prepare('DELETE FROM Tournaments WHERE id = ?');
  return stmt.run(id);
}

export interface TournamentResultInput {
  player_id: number;
  place: number;
  playtime_sec: number;
  prize: number;
  entry_fee: number;
}

// Replace any existing results for the tournament, then insert the new set.
export function saveTournamentResults(tournamentId: number, results: TournamentResultInput[]) {
  const database = getDB();
  const del = database.prepare('DELETE FROM TournamentResults WHERE tournament_id = ?');
  const ins = database.prepare(`
        INSERT INTO TournamentResults (tournament_id, player_id, place, playtime_sec, prize, entry_fee)
        VALUES (@tournament_id, @player_id, @place, @playtime_sec, @prize, @entry_fee)
    `);
  database.transaction(() => {
    del.run(tournamentId);
    for (const r of results) {
      ins.run({ tournament_id: tournamentId, ...r });
    }
  })();
}

export function getTournamentResults(id: number) {
  const tournament = getDB().prepare(`
        SELECT id, name, start_date, end_date, entry_fee, currency, structure_name
        FROM Tournaments WHERE id = ?
    `).get(id);
  if (!tournament) return null;

  const results = getDB().prepare(`
        SELECT r.place, r.player_id, r.playtime_sec, r.prize, r.entry_fee,
               p.name, p.nickname, p.photo_path, p.is_deleted
        FROM TournamentResults r
        JOIN Players p ON p.id = r.player_id
        WHERE r.tournament_id = ?
        ORDER BY r.place ASC
    `).all(id);

  return { tournament, results };
}

export function getPlayerProfile(id: number) {
  // Soft-deleted players are not reachable/editable via their profile URL —
  // resurrecting PII on a row flagged is_deleted must not be possible.
  const player = getDB().prepare('SELECT * FROM Players WHERE id = ? AND is_deleted = 0').get(id);
  if (!player) return null;

  const stats = getDB().prepare(`
        SELECT
          COUNT(*) AS tournaments,
          COALESCE(SUM(playtime_sec), 0) AS total_playtime,
          COALESCE(SUM(prize - entry_fee), 0) AS total_earnings,
          MIN(place) AS best_place,
          SUM(CASE WHEN place = 1 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN prize > 0 THEN 1 ELSE 0 END) AS cashes
        FROM TournamentResults WHERE player_id = ?
    `).get(id);

  const history = getDB().prepare(`
        SELECT r.tournament_id, t.name, t.start_date, r.place, r.playtime_sec, r.prize, r.entry_fee
        FROM TournamentResults r
        JOIN Tournaments t ON t.id = r.tournament_id
        WHERE r.player_id = ?
        ORDER BY t.start_date DESC
    `).all(id);

  return { player, stats, history };
}

// ---------------------------------------------------------------------------
// Full-database dump helpers for backup export/import (see electron/backup.ts).

export interface PlayerExportRow {
  id: number;
  name: string;
  nickname: string | null;
  email: string | null;
  photo_path: string | null;
  is_deleted: number;
}

export interface StructureExportRow {
  id: number;
  name: string;
  starting_chips: number;
  data: string | null;
}

export interface TournamentExportRow {
  id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  state: string | null;
  entry_fee: number;
  currency: string;
  structure_id: number | null;
  structure_name: string | null;
}

export interface TournamentResultExportRow {
  id: number;
  tournament_id: number;
  player_id: number;
  place: number;
  playtime_sec: number;
  prize: number;
  entry_fee: number;
}

export interface SettingExportRow {
  key: string;
  value: string;
}

export interface DataDumpRows {
  players: PlayerExportRow[];
  structures: StructureExportRow[];
  tournaments: TournamentExportRow[];
  tournamentResults: TournamentResultExportRow[];
  settings: SettingExportRow[];
}

// Unlike getPlayers(), this must NOT filter is_deleted: soft-deleted rows have
// to round-trip through a backup or result joins break after import.
export function getAllRowsForExport(): DataDumpRows {
  const database = getDB();
  return {
    players: database.prepare('SELECT id, name, nickname, email, photo_path, is_deleted FROM Players ORDER BY id').all() as PlayerExportRow[],
    structures: database.prepare('SELECT id, name, starting_chips, data FROM Structures ORDER BY id').all() as StructureExportRow[],
    tournaments: database.prepare('SELECT id, name, start_date, end_date, status, state, entry_fee, currency, structure_id, structure_name FROM Tournaments ORDER BY id').all() as TournamentExportRow[],
    tournamentResults: database.prepare('SELECT id, tournament_id, player_id, place, playtime_sec, prize, entry_fee FROM TournamentResults ORDER BY id').all() as TournamentResultExportRow[],
    settings: database.prepare('SELECT key, value FROM Settings ORDER BY key').all() as SettingExportRow[],
  };
}

// Full-replace restore: wipe all five tables and re-insert with original ids
// (TournamentResults references player_id/tournament_id, Tournaments references
// structure_id). One transaction so any failure leaves the previous data intact.
export function replaceAllData(rows: DataDumpRows) {
  const database = getDB();
  const insertPlayer = database.prepare(`
    INSERT INTO Players (id, name, nickname, email, photo_path, is_deleted)
    VALUES (@id, @name, @nickname, @email, @photo_path, @is_deleted)
  `);
  const insertStructure = database.prepare(`
    INSERT INTO Structures (id, name, starting_chips, data)
    VALUES (@id, @name, @starting_chips, @data)
  `);
  const insertTournament = database.prepare(`
    INSERT INTO Tournaments (id, name, start_date, end_date, status, state, entry_fee, currency, structure_id, structure_name)
    VALUES (@id, @name, @start_date, @end_date, @status, @state, @entry_fee, @currency, @structure_id, @structure_name)
  `);
  const insertResult = database.prepare(`
    INSERT INTO TournamentResults (id, tournament_id, player_id, place, playtime_sec, prize, entry_fee)
    VALUES (@id, @tournament_id, @player_id, @place, @playtime_sec, @prize, @entry_fee)
  `);
  const insertSetting = database.prepare('INSERT INTO Settings (key, value) VALUES (@key, @value)');

  database.transaction(() => {
    // Children first so the TournamentResults FKs never dangle mid-transaction;
    // parents first on insert for the same reason.
    database.prepare('DELETE FROM TournamentResults').run();
    database.prepare('DELETE FROM Tournaments').run();
    database.prepare('DELETE FROM Players').run();
    database.prepare('DELETE FROM Structures').run();
    database.prepare('DELETE FROM Settings').run();
    for (const p of rows.players) insertPlayer.run(p);
    for (const s of rows.structures) insertStructure.run(s);
    for (const t of rows.tournaments) insertTournament.run(t);
    for (const r of rows.tournamentResults) insertResult.run(r);
    for (const s of rows.settings) insertSetting.run(s);
  })();
}

export function getSettings(): Record<string, string> {
  const rows = getDB().prepare('SELECT key, value FROM Settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export function setSetting(key: string, value: string) {
  const stmt = getDB().prepare(`
    INSERT INTO Settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  return stmt.run({ key, value });
}
