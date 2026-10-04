#!/usr/bin/env node
/*
 * Converts the OCR text of "Wesleyan Methodist Hymn Book" (1869, public domain,
 * archive.org/details/wesleyanmethodis00wesl) into content-src/methodist-hymnal/songs.json.
 *
 *   node tools/parse-wesleyan-ocr.js
 *
 * OCR problems handled here:
 *  - running page headers ("THE GOODNESS OF GOD. 39"), section headings, footnotes, page letters
 *  - verse numbers misread ("8" for 3, "&" for 5, "t" for 1) - verses are renumbered in order
 *  - the drop capital on each hymn's first line ("/^OME, sinners" = "Come, sinners"), repaired
 *    by matching against the book's own index of first lines
 *  - stray symbols inside words ("You<r")
 * Anything the repair can't confirm is tagged "proofread" so it can be found and fixed in the app.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'content-src', 'methodist-hymnal', 'source', 'wesleyanmethodis00wesl_djvu.txt');
const OUT = path.join(ROOT, 'content-src', 'methodist-hymnal', 'songs.json');
const FIXES = JSON.parse(fs.readFileSync(path.join(ROOT, 'content-src', 'methodist-hymnal', 'first-line-fixes.json'), 'utf8'));

const raw = fs.readFileSync(SRC, 'utf8').replace(/\r/g, '');
const lines = raw.split('\n');

const indexStart = lines.findIndex((l, i) => i > 1000 && /^INDEX\s+TO\s+THE\s+HYMNS/.test(l.trim()));
const subjectIndex = lines.findIndex((l, i) => i > indexStart && /^AN\s+INDEX/.test(l.trim()));
const body = lines.slice(0, indexStart);

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

// ---------- first-line index ----------
const firstLines = [];
for (const l of lines.slice(indexStart, subjectIndex)) {
  // "Come, ye that love the  29" - page numbers are often missing or garbled, so they're optional
  const m = l.trim().match(/^([A-Z][A-Za-z',;!?]*\s+[^0-9]{4,}?)[\s\d,.]*$/);
  if (!m || /INDEX|PAGE|PAOE|PAGB/.test(m[1])) continue;
  const words = m[1].replace(/\s+/g, ' ').trim().split(' ');
  if (words.length < 3) continue;
  firstLines.push({ words, n: words.map(norm) });
}

// ---------- word frequencies (for choosing between repair candidates) ----------
const freq = new Map();
for (const w of raw.toLowerCase().match(/[a-z']+/g) || []) freq.set(w, (freq.get(w) || 0) + 1);

// ---------- split into hymns ----------
const HEADER = /^(.{0,40}?)\]?\s*H[YTV]\s?M\s?N\s+(\d{1,4})\s*[.,]/;
const hymns = [];
let cur = null;
for (const l of body) {
  const m = l.match(HEADER);
  if (m && /HYMN|HTMN|HVMN|HYMX/i.test(l)) {
    cur = { number: parseInt(m[2], 10), authorRaw: m[1], lines: [] };
    hymns.push(cur);
    continue;
  }
  if (cur) cur.lines.push(l);
}

const AUTHORS = [
  [/c\.?\s*w\w{4,6}/i, 'Charles Wesley'],
  [/j\.?\s*w\w{4,6}/i, 'John Wesley'],
  [/watts/i, 'Isaac Watts'],
  [/doddridge/i, 'Philip Doddridge'],
  [/montgomery/i, 'James Montgomery'],
  [/cowper/i, 'William Cowper'],
  [/newton/i, 'John Newton'],
  [/steele/i, 'Anne Steele'],
  [/heber/i, 'Reginald Heber'],
  [/toplady/i, 'Augustus Toplady'],
  [/anon/i, 'Anonymous'],
  [/wesley|weslev|weslef|wesler|ite8ley/i, 'Charles Wesley'],
];

function author(rawName) {
  const s = rawName.replace(/[^\w.\s]/g, ' ').trim();
  for (const [re, name] of AUTHORS) if (re.test(s)) return name;
  const cleaned = s.replace(/[._]+/g, ' ').trim();
  if (!cleaned || cleaned.length < 3) return null;
  return cleaned.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function isRunningHeader(l) {
  const t = l.trim();
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.75;
}

function isJunk(l) {
  const t = l.trim();
  if (!t) return false;
  if (/^\*/.test(t)) return true; // footnote
  if (/^[A-Z0-9]{1,3}$/.test(t)) return true; // page signature / stray number
  if (/^[\W\d_]+$/.test(t)) return true; // punctuation only
  return false;
}

const VERSE_START = /^\s*(\d{1,2}|[&$§]|[tlI])\s+(\S.*)$/;
const SHORT_WORDS = new Set(['of', 'to', 'in', 'on', 'my', 'be', 'we', 'he', 'me', 'so', 'no', 'oh', 'or', 'at', 'as', 'by', 'if', 'is', 'it', 'do', 'go', 'up', 'us', 'an', 'am', 'lo', 'ye', 'o']);

function cleanWords(s) {
  return s
    .replace(/(^|\s)0(?=[\s,!])/g, '$1O') // "0 Lord" -> "O Lord"
    .replace(/\s*[•■]\s*$/, '')
    .replace(/Jesn/g, 'Jesu')
    .replace(/[<>\\|{}^~_`]/g, '')
    .replace(/\s+([;:!?,.])/g, '$1')
    .replace(/"\s+/g, '"')
    .replace(/\s{2,}/g, ' ')
    .replace(/—\s*/g, '—')
    .trim();
}

function capitalise(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/** Repair the drop-capital first line. Returns { text, confident }. */
function repairFirstLine(text) {
  let tokens = text.trim().split(/\s+/);
  // drop leading tokens that are pure OCR junk (no letters, or tiny non-words)
  while (tokens.length > 1 && (/^[^A-Za-z]+$/.test(tokens[0]) || (/^[^a-z]{1,2}$/.test(tokens[0].replace(/[^A-Za-z]/g, '')) && /[^A-Za-z]/.test(tokens[0])))) tokens.shift();
  const hn = tokens.map(norm);

  // 1) match against the index of first lines: pick the alignment with the longest run of equal words
  let best = null;
  for (const e of firstLines) {
    for (let k = 0; k <= 2 && k < e.n.length; k++) {
      for (let p = 0; p <= 2 && p < hn.length; p++) {
        let run = 0;
        while (k + run < e.n.length && p + run < hn.length && e.n[k + run] && e.n[k + run] === hn[p + run]) run++;
        const enough = run >= 3 || (run >= 2 && k + run === e.n.length);
        if (enough && (!best || run > best.run || (run === best.run && k < best.k))) best = { e, k, p, run };
      }
    }
  }
  if (best) {
    const { e, k, p } = best;
    // index words before k supply the (drop-cap) opening; OCR words from p on are kept
    const prefix = e.words.slice(0, k).map((w, i) => (i === 0 ? capitalise(w) : w.toLowerCase()));
    const rest = tokens.slice(p);
    return { text: fixCaps(prefix.concat(rest).join(' ')), confident: true };
  }

  // 2) fall back: fix the small-caps first word using word frequencies
  const first = tokens[0].replace(/[^A-Za-z']/g, '');
  const trail = tokens[0].slice(tokens[0].search(/[^A-Za-z'][^A-Za-z']*$/) >= 0 ? tokens[0].search(/[^A-Za-z']*$/) : tokens[0].length);
  const lower = first.toLowerCase();
  let best2 = lower;
  let bestF = freq.get(lower) || 0;
  const cands = [];
  for (const c of 'abcdefghijklmnopqrstuvwxyz') {
    cands.push(c + lower, c + lower.slice(1), c + lower.slice(2));
    for (let i = 1; i < lower.length; i++) cands.push(lower.slice(0, i) + c + lower.slice(i + 1));
  }
  for (const cand of cands) {
    const f = freq.get(cand) || 0;
    if (f > bestF * 3 && f >= 3) { best2 = cand; bestF = f; }
  }
  tokens[0] = capitalise(best2) + trail;
  return { text: fixCaps(tokens.join(' ')), confident: false };
}

/** Small caps after the drop capital: "JESUS, the Name" -> "Jesus, the Name". Keeps "O", "I", "LORD". */
function fixCaps(s) {
  const tokens = s.split(' ');
  for (let i = 0; i < Math.min(3, tokens.length); i++) {
    const w = tokens[i];
    const letters = w.replace(/[^A-Za-z]/g, '');
    if (letters.length > 1 && letters === letters.toUpperCase()) {
      tokens[i] = i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase();
      if (['god', 'lord', 'jesus', 'christ'].includes(tokens[i].replace(/[^a-z]/gi, '').toLowerCase())) tokens[i] = capitalise(tokens[i]);
    }
  }
  return tokens.join(' ');
}

/** Second line of verse 1 starts with the tail of the drop capital ("ll In hell", "I A For you"). */
function stripDropCapTail(s) {
  const tokens = s.trim().split(/\s+/);
  const isJunkToken = (t) => {
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (!letters || /\d/.test(t)) return true;
    if (/[a-z][A-Z]|[A-Z]{2}[a-z]/.test(letters) && (freq.get(letters.toLowerCase()) || 0) < 5) return true;
    if (letters.length <= 2 && !SHORT_WORDS.has(letters.toLowerCase()) && !/^(I|A)$/.test(letters)) return true;
    return /^(ll|l|j|jj)$/i.test(letters);
  };
  // strip up to the last junk token among the first three ("It 1. Redeem'd", "I A For you", "tf My Friend")
  let cut = 0;
  for (let i = 0; i < Math.min(3, tokens.length - 1); i++) {
    if (isJunkToken(tokens[i]) || (cut === i && i > 0 && /^(I|A)$/.test(tokens[i])) || (/^(I|A)$/.test(tokens[i]) && /^[A-Z]/.test(tokens[i + 1]) && isJunkOrCapsNext(tokens, i))) cut = i + 1;
  }
  if (cut && /^[A-Z"']/.test(tokens[cut] || '')) return tokens.slice(cut).join(' ');
  return s.trim();
}

/** "I A For you": a lone I/A is junk only when another junk token or a single capital follows it. */
function isJunkOrCapsNext(tokens, i) {
  const next = tokens[i + 1] || '';
  return /^[A-Z]$/.test(next) || /^[^A-Za-z]+$/.test(next);
}

function parseHymn(h) {
  const verses = [];
  let v = null;
  let started = false;
  for (const rawLine of h.lines) {
    if (isRunningHeader(rawLine) || isJunk(rawLine)) continue;
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    // Scripture references under the header ("1 Thess. iv. 15, 17", "Luke xiv. 16-24.") look like verse 1
    if (!started && (/\b[ivxlc]+\.\s*\d/i.test(line) || /\d+\s*[,—–-]\s*\d+\.?\s*$/.test(line) || /^\s*\S+\s+[A-Z][a-z]+\.\s/.test(line))) continue;
    const m = line.match(VERSE_START);
    const startsVerse = m && (!started || (v && v.length >= 2));
    if (startsVerse) {
      v = [m[2]];
      verses.push(v);
      started = true;
      continue;
    }
    if (!started) continue; // subtitle, metre notes
    v.push(line.trim());
  }
  if (!verses.length) return null;
  const tags = [];
  const first = repairFirstLine(verses[0][0]);
  verses[0][0] = first.text;
  if (verses[0][1]) verses[0][1] = stripDropCapTail(verses[0][1]);
  const fix = FIXES.fixes[String(h.number)];
  if (fix && fix.line1) verses[0][0] = fix.line1;
  if (fix && fix.line2 && verses[0].length > 1) verses[0][1] = fix.line2;
  if (!first.confident && !fix && !FIXES.ok.includes(h.number)) tags.push('proofread');
  const sections = verses.map((ls, i) => ({ type: 'verse', label: `Verse ${i + 1}`, text: ls.map(cleanWords).filter(Boolean).join('\n') }));
  const title = sections[0].text.split('\n')[0].replace(/[;:,.!?—-]+$/, '').trim();
  return { key: String(h.number), number: String(h.number), title, author: author(h.authorRaw), tags, sections };
}

const seen = new Set();
const songs = [];
for (const h of hymns) {
  if (seen.has(h.number)) continue;
  const s = parseHymn(h);
  if (!s) continue;
  seen.add(h.number);
  songs.push(s);
}
songs.sort((a, b) => Number(a.number) - Number(b.number));
fs.writeFileSync(OUT, JSON.stringify(songs, null, 1));
const flagged = songs.filter((s) => s.tags.includes('proofread')).length;
console.log(`${songs.length} hymns written to ${path.relative(ROOT, OUT)} (${flagged} first lines need proofreading)`);
