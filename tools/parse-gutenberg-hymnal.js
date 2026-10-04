#!/usr/bin/env node
/*
 * Converts a typed (not OCR) Project Gutenberg hymnal into an RG-Present songs.json.
 *
 *   node tools/parse-gutenberg-hymnal.js <pgNNNN.txt> <out songs.json>
 *
 * Handles the common Gutenberg hymnal layout:
 *   235     Woodworth. L.M.            <- hymn number + tune/metre
 *   _Coming in Humility._    (489)    <- optional topic line(s)
 *   Just as I am, without one plea,   <- verse 1 (no number)
 *   2 Just as I am, and waiting not   <- later verses start with their number
 *   Cho.--O Lamb of God, I come!      <- chorus
 *        Charlotte Elliott, 1836.     <- author line, indented
 */
const fs = require('fs');

const [, , src, out] = process.argv;
let text = fs.readFileSync(src, 'utf8').replace(/\r/g, '');
const start = text.indexOf('*** START OF');
const end = text.indexOf('*** END OF');
text = text.slice(start > 0 ? text.indexOf('\n', start) : 0, end > 0 ? end : undefined);
// Stop at the indexes at the back of the book.
const idx = text.search(/\n\s*INDEX OF (FIRST LINES|SUBJECTS|TUNES|AUTHORS)/);
if (idx > 0) text = text.slice(0, idx);
const lines = text.split('\n');

const HEADER = /^(\d{1,4})(?:\s{2,}(.*))?$/;
const AUTHOR = /^\s{3,}(?:[A-Z][\w.'’\- ]+(?:,\s*(?:\d{4}|[a-z ]+\d{4}|tr\.|alt\.)[^\n]*)?|Anon\.?|Anonymous\.?|Unknown\.?)\s*$/;
const TOPIC = /^\s*_[^_]+_\.?\s*(\(\d+\))?\s*$|^\s{10,}\S.*$/; // "_Coming in Humility._ (489)" or a centred title
const CHORUS = /^\s*(Cho(?:rus)?|Ref(?:rain)?)\.?\s*[-—–:]+\s*/i;

const hymns = [];
let h = null;
let prevHeader = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i].replace(/\s+$/, '');
  const m = l.match(HEADER);
  // A header is a number one higher than the last, followed (soon) by text.
  // Numbers occasionally skip (a hymn whose header is missing in the source), so allow small jumps when a tune name follows.
  if (m && (+m[1] === prevHeader + 1 || (m[2] && +m[1] > prevHeader && +m[1] <= prevHeader + 4))) {
    prevHeader = +m[1];
    h = { number: m[1], tune: (m[2] || '').trim(), raw: [] };
    hymns.push(h);
    continue;
  }
  if (h) h.raw.push(l);
}

function parse(h) {
  const rawLines = h.raw.filter((l) => !/^\s*\[(Footnote|Illustration)/i.test(l));
  // Skip topic/title lines before the first lyric line.
  let i = 0;
  while (i < rawLines.length && (!rawLines[i].trim() || TOPIC.test(rawLines[i]))) i++;
  const sections = [];
  let sec = null;
  let author = null;
  let verseNo = 0;
  for (; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const t = raw.trim();
    if (!t) { sec = null; continue; }
    if (AUTHOR.test(raw) && raw.search(/\S/) >= 4 && (i === rawLines.length - 1 || !rawLines.slice(i + 1).some((x) => x.trim() && !AUTHOR.test(x)))) {
      author = t.replace(/\.$/, '');
      continue;
    }
    if (/^\s*_.*_\.?\s*$/.test(raw)) continue; // italic notes
    const ch = t.match(CHORUS);
    if (ch) {
      sec = { type: 'chorus', lines: [t.slice(ch[0].length)] };
      sections.push(sec);
      continue;
    }
    const v = t.match(/^(\d{1,2})\.?\s+(?=\S)/);
    if (!sec || (v && +v[1] === verseNo + 1 && sec.type === 'verse')) {
      verseNo = v ? +v[1] : verseNo + 1;
      sec = { type: 'verse', lines: [v ? t.slice(v[0].length) : t] };
      sections.push(sec);
      continue;
    }
    sec.lines.push(t);
  }
  if (!sections.length) return null;
  let vn = 0;
  const seen = new Set();
  const out = sections
    .map((s) => ({ type: s.type, label: s.type === 'chorus' ? 'Chorus' : `Verse ${++vn}`, text: s.lines.map(tidy).filter(Boolean).join('\n') }))
    .filter((s) => s.text && (s.type !== 'chorus' || (!seen.has(s.text) && seen.add(s.text))));
  if (!out.length) return null;
  const title = out[0].text.split('\n')[0].replace(/[;:,.!?—\-]+$/, '').trim();
  const authorName = author ? author.replace(/[.,]\s*(\d{4}|alt\.|tr\.).*$/i, '').replace(/^Amen$/, '').trim() || null : null;
  return { key: h.number, number: h.number, title, author: authorName, tags: [], sections: out };
}

function tidy(s) {
  return s.replace(/--/g, '—').replace(/_/g, '').replace(/\s{2,}/g, ' ').trim();
}

const songs = hymns.map(parse).filter(Boolean);
fs.writeFileSync(out, JSON.stringify(songs, null, 1));
console.log(`${songs.length} hymns (headers found: ${hymns.length}) -> ${out}`);
