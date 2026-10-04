#!/usr/bin/env node
/*
 * Converts the Open Hymnal Project's ABC Plus scores into content-src/open-hymnal/songs.json.
 * (openhymnal.org — public domain / freely distributable, maintained by Brian J. Dumont.)
 *
 *   node tools/parse-open-hymnal.js <folder of .abc files> [out.json]
 *
 * Lyrics live in ABC "w:" lines under the melody voice, e.g.
 *     w: 1.~Bless- ed a- ssu- rance, Je- sus is mine!
 * Rules used:
 *  - a run of consecutive w: lines is one musical phrase; line j of each run belongs to verse j+1
 *  - a run with fewer lines than the rest is sung by every verse, i.e. the refrain
 *  - "-" ends a syllable (join to the next word), "~" joins two words on one note,
 *    "*" and "_" are held/blank notes, "|" is a bar line
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const out = process.argv[3] || path.join(__dirname, '..', 'content-src', 'open-hymnal', 'songs.json');

function readText(file) {
  const buf = fs.readFileSync(file);
  const utf8 = buf.toString('utf8');
  // The archive mixes UTF-8 and Latin-1 (accented words like "blessèd").
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

/** "1.~Bless- ed a- ssu- rance," -> "Blessed assurance," */
function lyricLine(raw) {
  const tokens = raw.replace(/\\$/, '').trim().split(/\s+/);
  let outStr = '';
  let join = false;
  for (let tok of tokens) {
    tok = tok.replace(/\|/g, '').replace(/[_*]/g, '').replace(/\\-/g, '-');
    if (!tok) continue;
    const parts = tok.split('~'); // '~' = two words under one note
    let piece = parts.join(' ').trim();
    if (!piece) continue;
    const continues = piece.endsWith('-');
    if (continues) piece = piece.slice(0, -1);
    outStr += (join || !outStr ? '' : ' ') + piece;
    join = continues;
  }
  return outStr.replace(/\s+([,;:.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Break a flowing stanza into projection lines. ABC line breaks follow the music (often mid-sentence),
 * so lines are rebuilt at punctuation, aiming for ~46 characters and never splitting a word.
 */
function reflow(text, max = 44, minPunct = 22) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  let breakAt = -1; // length of `line` at the last punctuation worth breaking on
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > max && line) {
      if (breakAt > 0 && breakAt < line.length) {
        lines.push(line.slice(0, breakAt).trim());
        line = `${line.slice(breakAt).trim()} ${w}`.trim();
      } else {
        lines.push(line);
        line = w;
      }
      breakAt = /[,;:.!?—]$/.test(line) && line.length >= minPunct ? line.length : -1;
      continue;
    }
    line = next;
    if (/[,;:.!?—]$/.test(w) && line.length >= minPunct) breakAt = line.length;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function parseFile(file) {
  const text = readText(file).replace(/\r/g, '');
  const lines = text.split('\n');
  const meta = { title: null, credits: [], scripture: null };
  const runs = [];
  let run = null;
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    if (/^%/.test(l)) continue;
    const m = l.match(/^([A-Za-z]):\s?(.*)$/);
    if (!m) { run = null; continue; }
    const [, field, value] = m;
    const body = value.replace(/\s*%.*$/, '').trim();
    if (field === 'T' && !meta.title) meta.title = body;
    else if (field === 'C') meta.credits.push(body);
    else if (field === 'N' && /scripture/i.test(body)) meta.scripture = body;
    if (field === 'w') {
      if (!run) { run = []; runs.push(run); }
      run.push(body);
      continue;
    }
    run = null;
  }
  if (!meta.title || !runs.length) return null;

  const widths = runs.map((r) => r.length);
  const maxV = Math.max(...widths);
  const verses = Array.from({ length: maxV }, () => []);
  const refrain = [];
  for (const r of runs) {
    if (r.length === maxV) r.forEach((ln, i) => verses[i].push(lyricLine(ln)));
    else r.forEach((ln) => refrain.push(lyricLine(ln))); // sung by every verse
  }

  // One flowing string per verse: the w: breaks follow the music, not the poetry, so they are re-flowed below.
  let verseTexts = verses
    .map((v) => v.map((x, j) => (j === 0 ? x.replace(/^\d{1,2}\s*\.\s*/, '') : x)).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean);
  let refrainText = refrain.map((x) => x.replace(/^(refrain|chorus)\s*[:.]?\s*/i, '')).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!verseTexts.length) return null;

  // The refrain's pick-up words sit at the end of every verse ("...was slain. So I'll" + "cherish the old
  // rugged cross"). Any wording every verse ends with really belongs to the refrain.
  // (Only verse 1 carries the words; the other verses hold the note, so the tail is taken from verse 1
  // and removed from any other verse that repeats it.)
  if (refrainText) {
    const m2 = verseTexts[0].match(/[.!?;]\s+(\S.{0,40})$/);
    const tail = m2 && m2[1].trim();
    if (tail && tail.split(' ').length <= 6) {
      verseTexts = verseTexts.map((t) => (t.endsWith(tail) ? t.slice(0, -tail.length).replace(/[,\s]+$/, '') : t));
      refrainText = `${tail} ${refrainText}`.replace(/\s{2,}/g, ' ').trim();
    }
  }

  const sections = verseTexts.map((t, i) => ({ type: 'verse', label: `Verse ${i + 1}`, text: reflow(t) }));
  if (refrainText) sections.splice(1, 0, { type: 'chorus', label: 'Chorus', text: reflow(refrainText) });

  const wordsCredit = meta.credits.find((c) => /^words/i.test(c));
  const author = wordsCredit
    ? wordsCredit.replace(/^words\s*:?\s*/i, '').replace(/[,;]?\s*\d{4}.*$/, '').replace(/\.$/, '').trim() || null
    : null;
  const musicCredit = meta.credits.find((c) => /^music/i.test(c));
  return {
    key: path.basename(file, '.abc'),
    title: meta.title.replace(/\s+/g, ' ').trim(),
    author,
    source: musicCredit ? musicCredit.replace(/^music[^:]*:\s*/i, '').replace(/\.$/, '').trim() : null,
    copyright: 'Public Domain',
    tags: [],
    sections,
  };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.abc')).sort();
const songs = [];
const skipped = [];
for (const f of files) {
  try {
    const s = parseFile(path.join(dir, f));
    if (s) songs.push(s);
    else skipped.push(f);
  } catch (e) {
    skipped.push(`${f} (${e.message})`);
  }
}
// Same hymn set to two tunes: keep the version with the most verses.
const byTitle = new Map();
for (const s of songs) {
  const k = s.title.toLowerCase();
  const prev = byTitle.get(k);
  if (!prev || s.sections.length > prev.sections.length) byTitle.set(k, s);
}
const final = [...byTitle.values()].sort((a, b) => a.title.localeCompare(b.title));
final.forEach((s, i) => { s.number = String(i + 1); s.key = s.key || String(i + 1); });
fs.writeFileSync(out, JSON.stringify(final, null, 1));
console.log(`${final.length} hymns (${files.length} files, ${skipped.length} without lyrics) -> ${out}`);
if (skipped.length) console.log('no lyrics:', skipped.slice(0, 10).join(', '));
