// Bible translations. Kept in their own SQLite file (data/bibles.sqlite) so the song library stays small
// and quick to save; Bible text only changes when a translation is installed or removed.
//
// Import formats: Zefania XML, OpenSong XML, OSIS XML, CSV (book,chapter,verse,text), JSON
// (RG pack format { books: [{ n|name, chapters: [[verse text]] }] }, or [{ abbrev, chapters }]).
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { paths, writeFileAtomic } = require('./store');
const B = require('../renderer/shared/bible');

const FILE = () => path.join(paths.data, 'bibles.sqlite');
let db = null;

async function open() {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) });
  let buf = null;
  try { buf = fs.readFileSync(FILE()); } catch (_) { /* first run */ }
  db = buf ? new SQL.Database(buf) : new SQL.Database();
  db.exec(`CREATE TABLE IF NOT EXISTS bibles (id TEXT PRIMARY KEY, name TEXT, abbrev TEXT, language TEXT, copyright TEXT, pack_id TEXT, version TEXT, installed_at TEXT);
    CREATE TABLE IF NOT EXISTS verses (bible_id TEXT, book INTEGER, chapter INTEGER, verse INTEGER, text TEXT, PRIMARY KEY (bible_id, book, chapter, verse)) WITHOUT ROWID;`);
}

function flush() {
  writeFileAtomic(FILE(), Buffer.from(db.export()));
}

function all(sql, params) {
  const st = db.prepare(sql);
  try {
    st.bind(params || []);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}

function list() {
  return all('SELECT b.*, (SELECT COUNT(*) FROM verses v WHERE v.bible_id = b.id) AS verses FROM bibles b ORDER BY name');
}

function get(id) {
  return all('SELECT * FROM bibles WHERE id = ?', [id])[0] || null;
}

/** Replace a translation's text. verses: [{ book, chapter, verse, text }] */
function install(meta, verses) {
  if (!verses.length) throw new Error('No verses found in this file.');
  const id = meta.id;
  db.exec('BEGIN');
  try {
    db.run('DELETE FROM verses WHERE bible_id = ?', [id]);
    db.run('INSERT OR REPLACE INTO bibles(id, name, abbrev, language, copyright, pack_id, version, installed_at) VALUES (?,?,?,?,?,?,?,?)', [
      id, meta.name, meta.abbrev, meta.language || 'en', meta.copyright || '', meta.pack_id || null, meta.version || '', new Date().toISOString(),
    ]);
    const st = db.prepare('INSERT OR REPLACE INTO verses(bible_id, book, chapter, verse, text) VALUES (?,?,?,?,?)');
    for (const v of verses) st.run([id, v.book, v.chapter, v.verse, v.text]);
    st.free();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  flush();
  return { id, verses: verses.length, books: new Set(verses.map((v) => v.book)).size };
}

function remove(id) {
  db.run('DELETE FROM verses WHERE bible_id = ?', [id]);
  db.run('DELETE FROM bibles WHERE id = ?', [id]);
  flush();
}

/** Which books and how many chapters each has, for the book/chapter picker. */
function structure(id) {
  return all('SELECT book, MAX(chapter) AS chapters FROM verses WHERE bible_id = ? GROUP BY book ORDER BY book', [id]);
}

function chapter(id, book, ch) {
  return all('SELECT chapter, verse, text FROM verses WHERE bible_id = ? AND book = ? AND chapter = ? ORDER BY verse', [id, book, ch]);
}

function passage(id, ref) {
  const cEnd = ref.chapterEnd || ref.chapter;
  const vStart = ref.verse || 1;
  const vEnd = ref.verse == null ? 9999 : ref.verseEnd || ref.verse;
  return all(
    `SELECT chapter, verse, text FROM verses WHERE bible_id = ? AND book = ?
       AND (chapter > ? OR (chapter = ? AND verse >= ?)) AND (chapter < ? OR (chapter = ? AND verse <= ?))
     ORDER BY chapter, verse`,
    [id, ref.book, ref.chapter, ref.chapter, vStart, cEnd, cEnd, vEnd],
  );
}

function search(id, q, limit) {
  const words = String(q || '').trim().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  return all(
    `SELECT book, chapter, verse, text FROM verses WHERE bible_id = ? AND ${words.map(() => 'text LIKE ?').join(' AND ')} ORDER BY book, chapter, verse LIMIT ?`,
    [id, ...words.map((w) => `%${w}%`), limit || 300],
  );
}

// ---------------- importers ----------------

const clean = (s) => decode(String(s)
  .replace(/<(note|NOTE|rf|RF|fn|f|x)\b[^>]*>[\s\S]*?<\/\1>/g, '') // footnotes / cross references
  .replace(/<[^>]+>/g, ''))
  .replace(/\s+/g, ' ')
  .trim();

function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) || tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? decode(m[1]) : null;
};

function parseZefania(xml) {
  const out = [];
  const name = attr((xml.match(/<XMLBIBLE\b[^>]*>/i) || [''])[0], 'biblename');
  const bookRe = /<BIBLEBOOK\b([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi;
  let bm;
  let seq = 0;
  while ((bm = bookRe.exec(xml))) {
    seq++;
    const book = +attr(bm[1], 'bnumber') || B.bookNumber(attr(bm[1], 'bname') || attr(bm[1], 'bsname')) || seq;
    const chRe = /<CHAPTER\b([^>]*)>([\s\S]*?)<\/CHAPTER>/gi;
    let cm;
    while ((cm = chRe.exec(bm[2]))) {
      const chapter = +attr(cm[1], 'cnumber');
      const vRe = /<VERS\b([^>]*)>([\s\S]*?)<\/VERS>/gi;
      let vm;
      while ((vm = vRe.exec(cm[2]))) out.push({ book, chapter, verse: +attr(vm[1], 'vnumber'), text: clean(vm[2]) });
    }
  }
  return { name, verses: out };
}

function parseOpenSong(xml) {
  const out = [];
  const bookRe = /<b\b([^>]*)>([\s\S]*?)<\/b>/g;
  let bm;
  let seq = 0;
  while ((bm = bookRe.exec(xml))) {
    seq++;
    const book = B.bookNumber(attr(bm[1], 'n')) || seq;
    const chRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = chRe.exec(bm[2]))) {
      const chapter = +attr(cm[1], 'n');
      const vRe = /<v\b([^>]*)>([\s\S]*?)<\/v>/g;
      let vm;
      while ((vm = vRe.exec(cm[2]))) {
        const n = attr(vm[1], 'n') || '';
        const first = parseInt(n, 10); // "16-17" combined verses: keep under the first number
        if (first) out.push({ book, chapter, verse: first, text: clean(vm[2]) });
      }
    }
  }
  return { name: null, verses: out };
}

function parseOSIS(xml) {
  const out = [];
  const title = (xml.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || null;
  // Container style: <verse osisID="Gen.1.1">text</verse>
  const cRe = /<verse\b([^>]*?)(?<!\/)>([\s\S]*?)<\/verse>/g;
  let m;
  while ((m = cRe.exec(xml))) {
    const id = attr(m[1], 'osisID');
    if (id) push(id, m[2]);
  }
  // Milestone style: <verse sID="Gen.1.1" osisID="Gen.1.1"/> text <verse eID="Gen.1.1"/>
  if (!out.length) {
    const sRe = /<verse\b[^>]*\bsID="([^"]+)"[^>]*\/>([\s\S]*?)<verse\b[^>]*\beID="\1"[^>]*\/>/g;
    while ((m = sRe.exec(xml))) push(m[1], m[2]);
  }
  function push(id, body) {
    const [bk, ch, vs] = id.split(/\s+/)[0].split('.');
    const book = B.bookNumber(bk);
    if (book && +ch && +vs) out.push({ book, chapter: +ch, verse: +vs, text: clean(body) });
  }
  return { name: title, verses: out };
}

function parseCSV(text) {
  const out = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (const line of lines) {
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t' || c === ';') { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur);
    if (cells.length < 4) continue;
    const book = /^\d+$/.test(cells[0].trim()) ? +cells[0] : B.bookNumber(cells[0]);
    const chapter = parseInt(cells[1], 10);
    const verse = parseInt(cells[2], 10);
    if (!book || !chapter || !verse) continue; // header row
    out.push({ book, chapter, verse, text: cells.slice(3).join(', ').trim() });
  }
  return { name: null, verses: out };
}

function parseJSON(text) {
  const data = JSON.parse(text.replace(/^﻿/, ''));
  const books = Array.isArray(data) ? data : data.books || [];
  const out = [];
  if (Array.isArray(data) && data[0] && data[0].book != null && data[0].verse != null) {
    for (const v of data) out.push({ book: +v.book || B.bookNumber(v.book), chapter: +v.chapter, verse: +v.verse, text: String(v.text).trim() });
    return { name: null, verses: out };
  }
  books.forEach((b, i) => {
    const book = b.n || (b.name && B.bookNumber(b.name)) || i + 1;
    (b.chapters || []).forEach((ch, ci) => ch.forEach((t, vi) => {
      if (t != null && String(t).trim()) out.push({ book, chapter: ci + 1, verse: vi + 1, text: String(t).trim() });
    }));
  });
  return { name: data.name || null, abbrev: data.abbrev || null, copyright: data.copyright || null, verses: out };
}

function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  let r;
  if (ext === '.json') r = parseJSON(text);
  else if (ext === '.csv' || ext === '.tsv' || ext === '.txt') r = parseCSV(text);
  else if (/<XMLBIBLE/i.test(text)) r = parseZefania(text);
  else if (/<osis\b/i.test(text)) r = parseOSIS(text);
  else if (/<bible\b/i.test(text) && /<b\s+n=/.test(text)) r = parseOpenSong(text);
  else throw new Error('Unrecognised Bible format. Supported: Zefania XML, OpenSong XML, OSIS XML, CSV (book,chapter,verse,text), JSON.');
  r.verses = r.verses.filter((v) => v.book >= 1 && v.book <= 66 && v.text);
  if (!r.verses.length) throw new Error('No verses could be read from this file.');
  const base = path.basename(file, ext);
  const guess = (r.name || base).match(/\b(NIV|KJV|NKJV|HCSB|CSB|ESV|NLT|NASB|RSV|NRSV|ASV|WEB|GNT|AMP|MSG)\b/i);
  return {
    name: r.name || base,
    abbrev: r.abbrev || (guess ? guess[1].toUpperCase() : base.slice(0, 6).toUpperCase()),
    copyright: r.copyright || '',
    verses: r.verses,
    books: new Set(r.verses.map((v) => v.book)).size,
  };
}

module.exports = { open, list, get, install, remove, structure, chapter, passage, search, parseFile, parseJSON };
