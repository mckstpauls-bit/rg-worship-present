// SQLite library database (sql.js / WebAssembly, so there is no native module to rebuild per Electron version).
// The whole DB is held in memory and flushed to disk atomically shortly after every change.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { paths, writeFileAtomic } = require('./store');
const L = require('../renderer/shared/lyrics');

// Each entry upgrades the schema by one version. Never edit a shipped migration; append a new one.
const MIGRATIONS = [
  // v1
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE songs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     uid TEXT UNIQUE,
     pack_id TEXT,
     title TEXT NOT NULL,
     alt_title TEXT,
     number TEXT,
     author TEXT,
     source TEXT,
     copyright TEXT,
     language TEXT,
     folder TEXT,
     tags TEXT,
     link_key TEXT,
     sequence TEXT,
     theme_id TEXT,
     sections TEXT NOT NULL,
     search TEXT,
     user_modified INTEGER DEFAULT 0,
     created_at TEXT,
     updated_at TEXT
   );
   CREATE INDEX idx_songs_folder ON songs(folder);
   CREATE INDEX idx_songs_link ON songs(link_key);
   CREATE TABLE themes (id TEXT PRIMARY KEY, pack_id TEXT, name TEXT, data TEXT, user_modified INTEGER DEFAULT 0, updated_at TEXT);
   CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id TEXT, name TEXT, rel_path TEXT UNIQUE, type TEXT, folder TEXT, created_at TEXT);
   CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, data TEXT, updated_at TEXT);
   CREATE TABLE packs (id TEXT PRIMARY KEY, name TEXT, version TEXT, type TEXT, installed_at TEXT, manifest TEXT);
   CREATE TABLE changelog (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, scope TEXT, version TEXT, message TEXT);`,
];
const SCHEMA_VERSION = MIGRATIONS.length;

let db = null;
let flushTimer = null;

function now() {
  return new Date().toISOString();
}

async function open() {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) });
  let existing = null;
  try {
    existing = fs.readFileSync(paths.db);
  } catch (_) { /* new install */ }
  db = existing ? new SQL.Database(existing) : new SQL.Database();
  migrate(!!existing);
  return db;
}

function getSchemaVersion() {
  try {
    const r = one('SELECT value FROM meta WHERE key = ?', ['schema_version']);
    return r ? parseInt(r.value, 10) : 0;
  } catch (_) {
    return 0;
  }
}

function migrate(hadFile) {
  const from = getSchemaVersion();
  if (from > SCHEMA_VERSION) {
    throw new Error(`Library database is schema v${from} but this app only understands up to v${SCHEMA_VERSION}. Update RG-Present.`);
  }
  if (from === SCHEMA_VERSION) return;
  if (hadFile) {
    // Keep a copy of the pre-migration DB so a bad upgrade can be rolled back by hand.
    fs.copyFileSync(paths.db, path.join(paths.backups, `library.v${from}.${Date.now()}.sqlite`));
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', ['schema_version', String(v + 1)]);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  log('schema', String(SCHEMA_VERSION), `Database schema migrated v${from} -> v${SCHEMA_VERSION}`);
  flushNow();
}

function all(sql, params) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params || []);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function one(sql, params) {
  return all(sql, params)[0] || null;
}

function run(sql, params) {
  db.run(sql, params || []);
  scheduleFlush();
}

function lastId() {
  return one('SELECT last_insert_rowid() AS id').id;
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNow, 400);
}

function flushNow() {
  clearTimeout(flushTimer);
  if (!db) return;
  writeFileAtomic(paths.db, Buffer.from(db.export()));
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    scheduleFlush();
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function log(scope, version, message) {
  db.run('INSERT INTO changelog(at, scope, version, message) VALUES (?, ?, ?, ?)', [now(), scope, version || '', message]);
  scheduleFlush();
}

// ---------- songs ----------

function rowToSong(r) {
  if (!r) return null;
  return { ...r, sections: JSON.parse(r.sections || '[]'), tags: r.tags ? r.tags.split(',').filter(Boolean) : [], user_modified: !!r.user_modified };
}

function buildSearch(s) {
  const text = (s.sections || []).map((x) => x.text).join(' ');
  return L.searchNormalize([s.number, s.title, s.alt_title, s.author, (s.tags || []).join(' '), text].join(' '));
}

function searchSongs({ q, folder, limit }) {
  const where = [];
  const params = [];
  if (folder) {
    where.push('folder = ?');
    params.push(folder);
  }
  const terms = L.searchNormalize(q || '').split(' ').filter(Boolean);
  for (const t of terms) {
    where.push('search LIKE ?');
    params.push(`%${t}%`);
  }
  const nq = L.searchNormalize(q || '');
  const sql = `SELECT id, title, alt_title, number, author, language, folder, link_key, pack_id, user_modified,
      CASE WHEN ? != '' AND (lower(title) LIKE ? OR lower(alt_title) LIKE ? OR number = ?) THEN 0 ELSE 1 END AS rank
    FROM songs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY rank, CAST(number AS INTEGER) = 0, CAST(number AS INTEGER), title COLLATE NOCASE
    LIMIT ?`;
  return all(sql, [nq, `${nq}%`, `${nq}%`, (q || '').trim(), ...params, limit || 1000]);
}

function getSong(id) {
  return rowToSong(one('SELECT * FROM songs WHERE id = ?', [id]));
}

function getSongByUid(uid) {
  return rowToSong(one('SELECT * FROM songs WHERE uid = ?', [uid]));
}

function linkedSongs(linkKey) {
  if (!linkKey) return [];
  return all('SELECT id, title, language FROM songs WHERE link_key = ? ORDER BY language', [linkKey]);
}

/** Insert or update. Edits made in the app set user_modified so pack updates won't overwrite them. */
function saveSong(song, { fromPack } = {}) {
  const s = {
    ...song,
    title: L.nfc(song.title).trim() || 'Untitled',
    sections: (song.sections || []).map((x) => ({ type: x.type, label: L.nfc(x.label), text: L.nfc(x.text) })),
  };
  const fields = {
    uid: s.uid || null,
    pack_id: s.pack_id || null,
    title: s.title,
    alt_title: s.alt_title ? L.nfc(s.alt_title) : null,
    number: s.number ? String(s.number) : null,
    author: s.author || null,
    source: s.source || null,
    copyright: s.copyright || null,
    language: s.language || null,
    folder: s.folder || 'Songs',
    tags: (s.tags || []).join(','),
    link_key: s.link_key || null,
    sequence: s.sequence || null,
    theme_id: s.theme_id || null,
    sections: JSON.stringify(s.sections),
    search: buildSearch(s),
    user_modified: fromPack ? 0 : s.pack_id ? 1 : 0,
    updated_at: now(),
  };
  if (s.id) {
    const cols = Object.keys(fields).filter((k) => k !== 'uid' && k !== 'pack_id');
    run(`UPDATE songs SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => fields[c]), s.id]);
    return s.id;
  }
  fields.created_at = fields.updated_at;
  const cols = Object.keys(fields);
  run(`INSERT INTO songs(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => fields[c]));
  return lastId();
}

function deleteSong(id) {
  run('DELETE FROM songs WHERE id = ?', [id]);
}

function folders() {
  return all('SELECT folder, COUNT(*) AS count FROM songs GROUP BY folder ORDER BY folder COLLATE NOCASE');
}

// ---------- themes ----------

function listThemes() {
  return all('SELECT * FROM themes ORDER BY name COLLATE NOCASE').map((r) => ({ ...JSON.parse(r.data), id: r.id, name: r.name, pack_id: r.pack_id }));
}

function saveTheme(theme, { fromPack } = {}) {
  const id = theme.id || `user:${Date.now().toString(36)}`;
  const existing = one('SELECT pack_id FROM themes WHERE id = ?', [id]);
  const packId = theme.pack_id || (existing && existing.pack_id) || null;
  run('INSERT OR REPLACE INTO themes(id, pack_id, name, data, user_modified, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, packId, theme.name || 'Theme', JSON.stringify({ ...theme, id }), fromPack ? 0 : packId ? 1 : 0, now(),
  ]);
  return id;
}

function deleteTheme(id) {
  run('DELETE FROM themes WHERE id = ?', [id]);
}

// ---------- media ----------

function listMedia() {
  return all('SELECT * FROM media ORDER BY folder, name COLLATE NOCASE');
}

function addMedia({ name, rel_path, type, folder, pack_id }) {
  run('INSERT OR REPLACE INTO media(pack_id, name, rel_path, type, folder, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    pack_id || null, name, rel_path, type, folder || 'Media', now(),
  ]);
}

function deleteMedia(id) {
  const m = one('SELECT * FROM media WHERE id = ?', [id]);
  run('DELETE FROM media WHERE id = ?', [id]);
  return m;
}

// ---------- services ----------

function listServices() {
  return all('SELECT id, name, updated_at FROM services ORDER BY updated_at DESC');
}

function saveService({ id, name, data }) {
  if (id) {
    run('UPDATE services SET name = ?, data = ?, updated_at = ? WHERE id = ?', [name, JSON.stringify(data), now(), id]);
    return id;
  }
  run('INSERT INTO services(name, data, updated_at) VALUES (?, ?, ?)', [name, JSON.stringify(data), now()]);
  return lastId();
}

function getService(id) {
  const r = one('SELECT * FROM services WHERE id = ?', [id]);
  return r ? { ...r, data: JSON.parse(r.data) } : null;
}

function deleteService(id) {
  run('DELETE FROM services WHERE id = ?', [id]);
}

// ---------- packs / changelog ----------

function listPacks() {
  return all('SELECT id, name, version, type, installed_at FROM packs ORDER BY name');
}

function getPack(id) {
  return one('SELECT * FROM packs WHERE id = ?', [id]);
}

function recordPack(manifest) {
  run('INSERT OR REPLACE INTO packs(id, name, version, type, installed_at, manifest) VALUES (?, ?, ?, ?, ?, ?)', [
    manifest.id, manifest.name, manifest.version, manifest.type || 'content', now(), JSON.stringify(manifest),
  ]);
}

function listChangelog(limit) {
  return all('SELECT * FROM changelog ORDER BY id DESC LIMIT ?', [limit || 200]);
}

module.exports = {
  SCHEMA_VERSION, open, flushNow, transaction, all, one, run, log, getSchemaVersion,
  searchSongs, getSong, getSongByUid, linkedSongs, saveSong, deleteSong, folders,
  listThemes, saveTheme, deleteTheme,
  listMedia, addMedia, deleteMedia,
  listServices, saveService, getService, deleteService,
  listPacks, getPack, recordPack, listChangelog,
};
