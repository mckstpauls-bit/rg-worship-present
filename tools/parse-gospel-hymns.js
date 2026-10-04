#!/usr/bin/env node
/*
 * Converts the OCR text of "Gospel Hymns Nos. 1 to 6 Complete" (Sankey, McGranahan & Stebbins, 1895, words
 * edition, public domain; archive.org/details/1895gospelhymns1-6briever) into
 * content-src/gospel-hymns/songs.json.
 *
 *   node tools/parse-gospel-hymns.js
 *
 * Layout facts used:
 *  - each hymn's first line starts with a capitalised first word ("WORK, for the night is coming")
 *  - verses 2+ start with their number; the chorus starts with "Cho.—"
 *  - hymn numbers / page numbers sit on their own lines; running headers say "Gospel Hymns Nos. 1 to 6"
 *  - "||: ... :||" marks repeats and "..., etc." abbreviates a repeated line
 * Hymns whose opening the parser had to guess are tagged "proofread".
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'content-src', 'gospel-hymns', 'source', 'gospel-hymns-1-6_djvu.txt');
const OUT = path.join(ROOT, 'content-src', 'gospel-hymns', 'songs.json');

const raw = fs.readFileSync(SRC, 'utf8').replace(/\r/g, '');
const lines = raw.split('\n');
const indexAt = lines.findIndex((l, i) => i > 1000 && /^INDEX/.test(l.trim()));
const body = lines.slice(0, indexAt > 0 ? indexAt : lines.length);

const freq = new Map();
for (const w of raw.toLowerCase().match(/[a-z’']+/g) || []) freq.set(w, (freq.get(w) || 0) + 1);

const isHeader = (l) => /gospel\s+h[a-z]{2,5}s?\b|nos\.\s*\S+\s+to\s+6|complete[.\-]?\s*$/i.test(l);
const letters = (s) => s.replace(/[^A-Za-z]/g, '');
const isJunk = (l) => {
  const t = l.trim();
  if (!t) return false;
  const lt = letters(t).length;
  return lt < 3 || lt / t.replace(/\s/g, '').length < 0.6;
};

function isStart(l) {
  const words = l.trim().split(/\s+/);
  const w0 = letters(words[0] || '');
  const w1 = letters(words[1] || '');
  if (w0.length >= 2 && w0 === w0.toUpperCase() && !/^(I{2,3}|IV|V|VI)$/.test(w0)) return true;
  if (/^[IOA]$/.test(w0) && w1.length >= 2 && w1 === w1.toUpperCase()) return true;
  return false;
}

const VERSE = /^\s*(\d{1,2}|[sS]|:\d)\s+(?=[“"‘'(]?[A-Z])/;
const CHORUS = /^\s*(Cho|Ref|Chorus|Refrain)\.?\s*[—–\-:]+\s*/i;

const hymns = [];
let cur = null;
let sec = null;
let pendingNumber = null;
let lastNumber = 0;

for (const rawLine of body.slice(200)) {
  const l = rawLine.replace(/\s+$/, '');
  const t = l.trim();
  if (!t) continue;
  if (isHeader(t)) { pendingNumber = null; continue; }
  if (/^\d{1,3}$/.test(t)) { pendingNumber = +t; continue; }
  if (isJunk(t)) continue;
  if (isStart(t)) {
    const n = pendingNumber && pendingNumber > lastNumber && pendingNumber <= lastNumber + 6 ? pendingNumber : lastNumber + 1;
    lastNumber = n;
    pendingNumber = null;
    cur = { number: n, sections: [] };
    sec = { type: 'verse', lines: [t] };
    cur.sections.push(sec);
    hymns.push(cur);
    continue;
  }
  pendingNumber = null;
  if (!cur) continue;
  const ch = t.match(CHORUS);
  if (ch) {
    sec = { type: 'chorus', lines: [t.slice(ch[0].length)] };
    cur.sections.push(sec);
    continue;
  }
  const v = t.match(VERSE);
  if (v && sec && sec.lines.length >= 2) {
    sec = { type: 'verse', lines: [t.slice(v[0].length)] };
    cur.sections.push(sec);
    continue;
  }
  sec.lines.push(t);
}

function cleanLine(s) {
  return s
    .replace(/\|\s*\|\s*[:;]?|[:;]\s*\|\s*\|?/g, '') // ||: repeat marks :||
    .replace(/\s+\S+,\s+e[tl][ce]\.?\s*\d*\s*$/i, '') // "Till I fancy, etc."
    .replace(/[•»«■□|^~_<>]/g, '')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/’/g, '’')
    .trim();
}

function fixFirstWord(line) {
  // "WORK, for the night" -> "Work, for the night"; "I WILL sing" -> "I will sing"
  return line.replace(/^([IOA]\s+)?([A-Z’']{2,})/, (m, pre, w) => {
    const lower = w.toLowerCase();
    const word = ['god', 'lord', 'jesus', 'christ', 'saviour', 'savior'].includes(lower) || !pre ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    return (pre || '') + word;
  });
}

const songs = [];
for (const h of hymns) {
  const sections = h.sections
    .map((s) => ({ type: s.type, lines: s.lines.map(cleanLine).filter((x) => letters(x).length >= 2) }))
    .filter((s) => s.lines.length);
  if (!sections.length) continue;
  sections[0].lines[0] = fixFirstWord(sections[0].lines[0]);
  let vn = 0;
  const out = sections.map((s) => ({
    type: s.type,
    label: s.type === 'chorus' ? 'Chorus' : `Verse ${++vn}`,
    text: s.lines.join('\n'),
  }));
  const choruses = out.filter((s) => s.type === 'chorus');
  // The chorus is printed once; keep the first and drop identical repeats.
  const seen = new Set();
  const dedup = out.filter((s) => s.type !== 'chorus' || (!seen.has(s.text) && seen.add(s.text)));
  const title = dedup[0].text.split('\n')[0].replace(/[;:,.!?—\-]+$/, '').trim();
  const tags = [];
  const totalLines = dedup.reduce((a, s) => a + s.text.split('\n').length, 0);
  if (totalLines < 4 || totalLines > 70 || choruses.length > 2) tags.push('proofread');
  songs.push({ key: String(h.number), number: String(h.number), title, tags, sections: dedup });
}

// Duplicate numbers (a missed start merges or shifts hymns): keep the first.
const byNum = new Map();
for (const s of songs) if (!byNum.has(s.number)) byNum.set(s.number, s);
const final = [...byNum.values()].filter((s) => +s.number <= 739);
fs.writeFileSync(OUT, JSON.stringify(final, null, 1));
console.log(`${final.length} hymns (last number ${lastNumber}) -> ${path.relative(ROOT, OUT)}; ${final.filter((s) => s.tags.length).length} tagged proofread`);
