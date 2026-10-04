// Hymn/song importers: plain text, RG hymnbook text, CSV, Word (.docx) and PowerPoint (.pptx).
// Pure Node (no Electron imports) so tools/build-packs.js can reuse the same parser.
//
// Every importer returns an array of songs:
//   { key, number, title, alt_title, author, language, folder, sections: [{type,label,text}] }
const fs = require('fs');
const path = require('path');
const L = require('../renderer/shared/lyrics');

const DEFAULT_CHORUS_WORDS = ['chorus', 'refrain', 'cho', 'ch', 'ref', 'korasi', 'kiitiko'];

function isChorusLabel(line, chorusWords) {
  const w = line.trim().replace(/[:.\-\s]+$/, '').toLowerCase();
  return chorusWords.includes(w);
}

/**
 * RG hymnbook text format (what content-src/kimeru-hymns uses, and what the app exports):
 *   ### 12. English or original title        <- starts a song; number optional
 *   @folder Liturgy                           <- optional per-song overrides (@author, @language, @title)
 *   [Verse 1] / [Chorus] ...                  <- sections (untagged stanzas become verses)
 *   # comment lines are ignored
 */
function parseHymnbookText(text, opts = {}) {
  const songs = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const sections = L.textToSections(cur.body.join('\n'), { chorusWords: opts.chorusWords });
    if (sections.length) {
      const firstLine = sections[0].text.split('\n')[0].replace(/[;:,.!?]+$/, '');
      songs.push({
        key: cur.key,
        number: cur.number,
        // Hymnbook headings are usually the English title; show the first line in the song's own language.
        title: cur.meta.title || (opts.titleFromFirstLine ? firstLine : cur.heading),
        alt_title: opts.titleFromFirstLine ? cur.heading : null,
        author: cur.meta.author || opts.author || null,
        language: cur.meta.language || opts.language || null,
        folder: cur.meta.folder || opts.folder || null,
        link: cur.meta.link || undefined,
        sections,
      });
    }
    cur = null;
  };
  for (const raw of L.nfc(text).replace(/\r\n?/g, '\n').split('\n')) {
    const h = raw.match(/^###\s*(?:([A-Za-z]?\d+[A-Za-z]?)\s*[.)]\s*)?(.*)$/);
    if (h) {
      flush();
      const number = h[1] || null;
      cur = { key: number || h[2].trim(), number, heading: h[2].trim(), meta: {}, body: [] };
      continue;
    }
    if (!cur) continue;
    const meta = raw.match(/^@(\w+)\s+(.*)$/);
    if (meta) {
      cur.meta[meta[1].toLowerCase()] = meta[2].trim();
      continue;
    }
    if (/^#(?!#)/.test(raw)) continue;
    cur.body.push(raw);
  }
  flush();
  return songs;
}

/**
 * Loose plain-text import for files typed or pasted by people:
 *  - "Title: ..." blocks, or songs separated by lines of --- / ===, or numbered headings "12. Title"
 *  - stanzas separated by blank lines; leading "1." / "2)" verse numbers are removed
 *  - a stanza starting with Chorus/Refrain (or a word from settings) becomes the chorus
 */
function parsePlainText(text, opts = {}) {
  const t = L.nfc(text).replace(/\r\n?/g, '\n');
  if (/^###/m.test(t)) return parseHymnbookText(t, opts);
  const chorusWords = [...DEFAULT_CHORUS_WORDS, ...(opts.chorusWords || [])].map((w) => w.toLowerCase());

  let blocks;
  if (/^\s*title\s*:/im.test(t)) blocks = t.split(/^(?=\s*title\s*:)/im);
  else if (/^\s*(-{3,}|={3,})\s*$/m.test(t)) blocks = t.split(/^\s*(?:-{3,}|={3,})\s*$/m);
  else {
    // numbered headings: a line "12. Some Title" whose next non-empty line starts a verse ("1." or text)
    const lines = t.split('\n');
    const heads = [];
    lines.forEach((l, i) => {
      if (/^\s*\d{1,4}\s*[.)]\s*\S/.test(l) && (i === 0 || !lines[i - 1].trim())) {
        const next = lines.slice(i + 1).find((x) => x.trim());
        if (next && /^\s*1\s*[.)]/.test(next)) heads.push(i);
      }
    });
    if (heads.length > 1) blocks = heads.map((start, k) => lines.slice(start, heads[k + 1] ?? lines.length).join('\n'));
    else blocks = [t];
  }

  const songs = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length) continue;
    const meta = {};
    while (lines.length && /^\s*(title|number|author|language|folder|english)\s*:/i.test(lines[0])) {
      const [, k, v] = lines.shift().match(/^\s*(\w+)\s*:\s*(.*)$/);
      meta[k.toLowerCase()] = v.trim();
    }
    let number = meta.number || null;
    let title = meta.title;
    if (!title) {
      const first = lines.shift() || 'Untitled';
      const m = first.match(/^\s*(\d{1,4})\s*[.)]\s*(.*)$/);
      if (m && !/^\s*1\s*[.)]/.test(first)) {
        number = number || m[1];
        title = m[2].trim();
      } else if (m && lines.length && !/^\s*\d/.test(lines[0])) {
        number = number || m[1];
        title = m[2].trim();
      } else title = first.trim();
    }
    const sections = stanzasToSections(lines.join('\n'), chorusWords);
    if (!sections.length) continue;
    songs.push({
      key: number || title,
      number,
      title: title.replace(/[.;:]+$/, ''),
      alt_title: meta.english || null,
      author: meta.author || opts.author || null,
      language: meta.language || opts.language || null,
      folder: meta.folder || opts.folder || null,
      sections,
    });
  }
  return songs;
}

function stanzasToSections(text, chorusWords) {
  if (/^\s*\[[^\]]+\]\s*$/m.test(text)) return L.textToSections(text, { chorusWords });
  const stanzas = text.split(/\n\s*\n/).map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean)).filter((s) => s.length);
  const sections = [];
  let verse = 0;
  for (const st of stanzas) {
    let type = 'verse';
    if (isChorusLabel(st[0], chorusWords)) {
      st.shift();
      type = 'chorus';
    } else {
      const m = st[0].match(/^(chorus|refrain|cho|ref)\s*[:.-]\s*(.*)$/i);
      if (m) {
        type = 'chorus';
        st[0] = m[2];
      }
    }
    if (type === 'verse') {
      const m = st[0].match(/^\s*(\d{1,2})\s*[.):-]\s*(.*)$/);
      if (m) st[0] = m[2];
      verse = m ? parseInt(m[1], 10) : verse + 1;
    }
    const lines = st.filter(Boolean);
    if (!lines.length) continue;
    sections.push({ type, label: type === 'chorus' ? 'Chorus' : `Verse ${verse}`, text: lines.join('\n') });
  }
  return sections;
}

/** CSV with a header row. Recognised columns: title, number, author, language, folder, english,
 *  lyrics/text/words (tagged or blank-line separated), or verse1..verseN + chorus. */
function parseCSV(text, opts = {}) {
  const rows = csvRows(L.nfc(text).replace(/^﻿/, ''));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
  const col = (name) => header.indexOf(name);
  const chorusWords = [...DEFAULT_CHORUS_WORDS, ...(opts.chorusWords || [])];
  const songs = [];
  for (const r of rows.slice(1)) {
    const get = (n) => (col(n) >= 0 ? (r[col(n)] || '').trim() : '');
    const title = get('title') || get('name');
    if (!title) continue;
    let sections;
    const lyrics = get('lyrics') || get('text') || get('words');
    if (lyrics) sections = stanzasToSections(lyrics, chorusWords);
    else {
      sections = [];
      header.forEach((h, i) => {
        const m = h.match(/^(verse|v)(\d+)$/);
        if (m && (r[i] || '').trim()) sections.push({ type: 'verse', label: `Verse ${m[2]}`, text: r[i].trim() });
      });
      const chorus = get('chorus') || get('refrain');
      if (chorus) sections.splice(Math.min(1, sections.length), 0, { type: 'chorus', label: 'Chorus', text: chorus });
    }
    if (!sections.length) continue;
    songs.push({
      key: get('number') || title, number: get('number') || null, title, alt_title: get('english') || null,
      author: get('author') || opts.author || null, language: get('language') || opts.language || null,
      folder: get('folder') || opts.folder || null, sections,
    });
  }
  return songs;
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** Word: paragraphs -> lines, empty paragraphs -> stanza breaks, headings -> new songs. */
async function parseDocx(buffer, opts = {}) {
  const mammoth = require('mammoth');
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const out = [];
  const re = /<(h[1-6]|p)[^>]*>([\s\S]*?)<\/\1>|<p\s*\/>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1] || 'p';
    const text = decodeEntities((m[2] || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')).trim();
    if (/^h/.test(tag)) out.push('', `### ${text}`);
    else out.push(text);
  }
  const text = out.join('\n');
  return /^###/m.test(text) ? parseHymnbookText(text, { ...opts, titleFromFirstLine: false }) : parsePlainText(text, opts);
}

/** PowerPoint: each slide's text in order. Slides that are only pictures can't be imported as text. */
function parsePptx(buffer, opts = {}) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buffer);
  const slides = zip.getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => parseInt(a.entryName.match(/\d+/)[0], 10) - parseInt(b.entryName.match(/\d+/)[0], 10));
  const parts = [];
  let withText = 0;
  for (const s of slides) {
    const xml = s.getData().toString('utf8');
    const paras = [];
    for (const p of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []) {
      const t = decodeEntities(p.replace(/<a:br\/>/g, '\n').replace(/<[^>]+>/g, ''));
      paras.push(t);
    }
    const text = paras.join('\n').trim();
    if (text) withText++;
    parts.push(text);
  }
  if (!withText) {
    const err = new Error(`This PowerPoint has ${slides.length} slides but no text on them (the words are pictures). Save the hymns as text (.txt/.docx), or transcribe them first.`);
    err.code = 'NO_TEXT';
    throw err;
  }
  return parsePlainText(parts.join('\n\n'), opts);
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

async function parseFile(file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);
  if (ext === '.docx') return parseDocx(buf, opts);
  if (ext === '.pptx') return parsePptx(buf, opts);
  if (ext === '.csv') return parseCSV(buf.toString('utf8'), opts);
  if (ext === '.json') {
    const data = JSON.parse(buf.toString('utf8'));
    return (Array.isArray(data) ? data : data.songs || []).map((s) => ({ ...s, sections: s.sections || L.textToSections(s.lyrics || '') }));
  }
  return parsePlainText(buf.toString('utf8'), opts);
}

module.exports = { parseFile, parseHymnbookText, parsePlainText, parseCSV, parseDocx, parsePptx, DEFAULT_CHORUS_WORDS };
