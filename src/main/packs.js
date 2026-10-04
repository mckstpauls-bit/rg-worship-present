// Content packs (.rgpkg): versioned zip bundles of songs, themes and media, independent of the app version.
//
//   manifest.json   { id, name, version, type: "content", description, minAppVersion }
//   songs.json      [ { key, title, number, author, source, copyright, language, folder, tags,
//                       link, sequence, theme, sections: [{type,label,text}] | lyrics: "[Verse 1]\n..." } ]
//   themes/*.json   { key, name, background, font, ... }
//   media/**        files copied to <data>/media/packs/<id>/
//   CHANGELOG.md    optional, shown in the app
//
// Installing a pack upserts by "<packId>:<key>". Songs/themes the user has edited in the app are kept
// unless the import is forced, so a hymnal update never silently wipes local corrections.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { app } = require('electron');
const db = require('./db');
const { paths } = require('./store');
const L = require('../renderer/shared/lyrics');
const bibles = require('./bibles');

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Read a pack from a .rgpkg/.zip file or an unpacked folder into a uniform object. */
function readPack(src) {
  const entries = new Map(); // relative path -> () => Buffer
  if (fs.statSync(src).isDirectory()) {
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else entries.set(path.relative(src, full).split(path.sep).join('/'), () => fs.readFileSync(full));
      }
    };
    walk(src);
  } else {
    const zip = new AdmZip(src);
    for (const e of zip.getEntries()) if (!e.isDirectory) entries.set(e.entryName.replace(/\\/g, '/'), () => e.getData());
  }
  const readJson = (name) => {
    const get = entries.get(name);
    return get ? JSON.parse(get().toString('utf8').replace(/^﻿/, '')) : null;
  };
  const manifest = readJson('manifest.json');
  if (!manifest || !manifest.id || !manifest.version) throw new Error('Not a valid content pack: manifest.json with id and version is required.');
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.id)) throw new Error(`Invalid pack id "${manifest.id}"`);
  let songs = readJson('songs.json') || [];
  for (const [name] of entries) {
    if (/^songs\/.+\.json$/i.test(name)) songs = songs.concat(readJson(name));
  }
  const themes = [];
  for (const [name] of entries) if (/^themes\/.+\.json$/i.test(name)) themes.push(readJson(name));
  const media = [...entries.keys()].filter((n) => n.startsWith('media/'));
  const bibleFiles = [...entries.keys()].filter((n) => /^bibles\/.+\.json$/i.test(n));
  const changelog = entries.has('CHANGELOG.md') ? entries.get('CHANGELOG.md')().toString('utf8') : '';
  return { manifest, songs, themes, media, bibleFiles, changelog, entries };
}

function mediaType(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.mp4', '.webm', '.mov', '.m4v', '.ogv'].includes(ext)) return 'video';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image';
  return null;
}

function installPack(src, { force = false } = {}) {
  const pack = readPack(src);
  const m = pack.manifest;
  if (m.minAppVersion && compareVersions(app.getVersion(), m.minAppVersion) < 0) {
    throw new Error(`Pack "${m.name}" needs RG-Present ${m.minAppVersion} or newer (this is ${app.getVersion()}).`);
  }
  const stats = { pack: m.id, version: m.version, added: 0, updated: 0, keptLocalEdits: 0, themes: 0, media: 0, bibles: 0 };

  // Bible translations go to their own database.
  for (const name of pack.bibleFiles) {
    const text = pack.entries.get(name)().toString('utf8');
    const parsed = bibles.parseJSON(text);
    const meta = JSON.parse(text.replace(/^﻿/, ''));
    bibles.install({
      id: meta.key || (meta.abbrev || m.id).toLowerCase(), name: meta.name || m.name, abbrev: meta.abbrev || 'BIBLE',
      language: meta.language || m.language, copyright: meta.copyright, pack_id: m.id, version: m.version,
    }, parsed.verses);
    stats.bibles++;
  }

  // Media first (files on disk), then DB rows in one transaction.
  const mediaRoot = path.join(paths.media, 'packs', m.id);
  const mediaRows = [];
  for (const name of pack.media) {
    const rel = name.slice('media/'.length);
    const out = path.join(mediaRoot, rel);
    if (!out.startsWith(mediaRoot)) continue; // zip-slip guard
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, pack.entries.get(name)());
    const type = mediaType(out);
    if (type) mediaRows.push({ name: path.basename(rel), rel_path: `packs/${m.id}/${rel}`, type, folder: m.name, pack_id: m.id });
  }

  db.transaction(() => {
    for (const row of mediaRows) db.addMedia(row);
    stats.media = mediaRows.length;

    for (const t of pack.themes) {
      const id = `${m.id}:${t.key || t.id}`;
      const existing = db.one('SELECT user_modified FROM themes WHERE id = ?', [id]);
      if (existing && existing.user_modified && !force) continue;
      db.saveTheme({ ...t, id, pack_id: m.id }, { fromPack: true });
      stats.themes++;
    }

    pack.songs.forEach((s, i) => {
      const key = s.key || s.number || String(i + 1);
      const uid = `${m.id}:${key}`;
      const existing = db.getSongByUid(uid);
      if (existing && existing.user_modified && !force) {
        stats.keptLocalEdits++;
        return;
      }
      const sections = s.sections || L.textToSections(s.lyrics || '');
      db.saveSong({
        id: existing ? existing.id : undefined,
        uid,
        pack_id: m.id,
        title: s.title,
        alt_title: s.alt_title,
        number: s.number,
        author: s.author,
        source: s.source || m.name,
        copyright: s.copyright || 'Public Domain',
        language: s.language || m.language,
        folder: s.folder || m.folder || m.name,
        tags: s.tags || [],
        link_key: s.link || null,
        sequence: s.sequence,
        theme_id: s.theme ? (s.theme.includes(':') ? s.theme : `${m.id}:${s.theme}`) : null,
        sections,
      }, { fromPack: true });
      if (existing) stats.updated++;
      else stats.added++;
    });

    db.recordPack(m);
    db.log('content', m.version, `Installed pack "${m.name}" ${m.version}: ` + (stats.bibles && !pack.songs.length ? `${stats.bibles} Bible translation(s)` : `${stats.added} added, ${stats.updated} updated, ${stats.keptLocalEdits} local edits kept`));
  });
  db.flushNow();
  return stats;
}

/** Install/upgrade the packs shipped inside the app's resources folder. */
function installBundledPacks() {
  const dir = paths.bundledContent;
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(rgpkg|zip)$/i.test(f)) continue;
    const file = path.join(dir, f);
    try {
      const { manifest } = readPack(file);
      const installed = db.getPack(manifest.id);
      if (installed && compareVersions(manifest.version, installed.version) <= 0) continue;
      results.push(installPack(file));
    } catch (e) {
      results.push({ pack: f, error: e.message });
    }
  }
  return results;
}

/** Export songs (optionally one folder) as a pack, e.g. to move a corrected hymnal to another PC. */
function exportPack(file, { id, name, version, folder }) {
  const songs = db.all(`SELECT id FROM songs ${folder ? 'WHERE folder = ?' : ''}`, folder ? [folder] : []).map((r) => db.getSong(r.id));
  const zip = new AdmZip();
  const manifest = { id, name, version, type: 'content', exportedAt: new Date().toISOString(), exportedBy: `RG-Present ${app.getVersion()}` };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  const out = songs.map((s) => ({
    key: s.uid ? s.uid.split(':').slice(1).join(':') : `local-${s.id}`,
    title: s.title, alt_title: s.alt_title, number: s.number, author: s.author, source: s.source, copyright: s.copyright,
    language: s.language, folder: s.folder, tags: s.tags, link: s.link_key, sequence: s.sequence, sections: s.sections,
  }));
  zip.addFile('songs.json', Buffer.from(JSON.stringify(out, null, 2)));
  zip.writeZip(file);
  return { count: out.length };
}

module.exports = { readPack, installPack, installBundledPacks, exportPack, compareVersions, mediaType };
