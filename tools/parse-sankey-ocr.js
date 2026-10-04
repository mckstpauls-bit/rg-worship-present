#!/usr/bin/env node
/*
 * Converts the OCR text of Sankey's "Sacred Songs and Solos: Twelve Hundred Hymns" (words edition,
 * Marshall, Morgan & Scott, c.1921; archive.org/details/sacredsongssolos00sank) into
 * content-src/sacred-songs-solos/songs.json.
 *
 *   node tools/parse-sankey-ocr.js
 *
 * How hymns are found: the book's "Index to First Lines" gives every hymn's number and opening words.
 * Each hymn is located in the body by fuzzy-matching those words in number order, and runs until the
 * next hymn starts. Inside a hymn:
 *  - verse 1 is unnumbered, later verses start with "2", "3"...; the chorus is printed once, after verse 1
 *  - "[word" at the end of a line is overflow from the line above; short lowercase fragments are wrap-arounds
 *  - metre lines ("8.7.8.7."), cross-reference marks ("(S.S.\ 395)"), page headers are removed
 * Hymns whose shape can't be confirmed are tagged "proofread".
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'content-src', 'sacred-songs-solos', 'source', 'sacredsongssolos00sank_djvu.txt');
const OUT = path.join(ROOT, 'content-src', 'sacred-songs-solos', 'songs.json');

const lines = fs.readFileSync(SRC, 'utf8').replace(/\r/g, '').split('\n');
const bodyStart = lines.findIndex((l) => /^1\s+\($/.test(l.trim()));
const indexStart = lines.findIndex((l, i) => i > bodyStart + 1000 && /INDEX\s+TO\s+FIRST\s+LINES/i.test(l));
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

// Word frequencies from this book and the Wesleyan hymnal, used to repair one-letter OCR slips ("Jasus").
const freq = new Map();
const wesley = path.join(ROOT, 'content-src', 'methodist-hymnal', 'source', 'wesleyanmethodis00wesl_djvu.txt');
for (const text of [lines.join(' '), fs.existsSync(wesley) ? fs.readFileSync(wesley, 'utf8') : '']) {
  for (const w of text.toLowerCase().match(/[a-z']+/g) || []) freq.set(w, (freq.get(w) || 0) + 1);
}
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
function spellFix(word) {
  const lower = word.toLowerCase();
  if (lower.length < 4 || (freq.get(lower) || 0) > 2 || /[^a-z']/.test(lower)) return word;
  let best = null;
  let bestF = 30;
  for (let i = 0; i < lower.length; i++) {
    for (const c of ALPHA) {
      const cand = lower.slice(0, i) + c + lower.slice(i + 1);
      const f = freq.get(cand) || 0;
      if (f > bestF) { best = cand; bestF = f; }
    }
  }
  if (!best) return word;
  return word[0] === word[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best;
}

// ---------- index of first lines ----------
const index = new Map(); // number -> [prefix words]
for (const raw of lines.slice(indexStart + 1)) {
  const l = raw.trim();
  const m = l.match(/^([A-Z"'(][^0-9]*?)[\s.·,]*?([lI]?\d{1,4})\s*$/);
  if (!m) continue;
  let num = m[2].replace(/^[lI]/, '1');
  if (+num > 1200) num = m[2].replace(/^[lI]/, '');
  const n = +num;
  if (!n || n > 1200) continue;
  const words = m[1].replace(/[.·]+$/, '').replace(/\s+/g, ' ').trim();
  if (norm(words).length < 5) continue;
  if (!index.has(n)) index.set(n, []);
  index.get(n).push(words);
}

// ---------- helpers ----------
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const METER = /^[\W\d]{0,14}((\d{1,2}\s*[.,]\s*){2,}\d{0,2}[.,*?\s)]*|[PCLS]\s*\.\s*M\b.*|\d+s\b.*|Irregular.*)$/i;
function isJunk(l) {
  const t = l.trim();
  if (!t) return false;
  if (METER.test(t)) return true;
  if (/^\(?\s*S\.?\s*S\.?/.test(t) && t.length < 16) return true;
  if (/^[\d\s()[\]\\/^*.,;:'"!?&$%#@|~_<>-]+$/.test(t)) return true; // numbers and symbols only
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length <= 3 && t.length < 14) return true; // "(72a)", "Oi J (sOO/"
  if (letters.length >= 5 && letters === letters.toUpperCase() && !/[a-z]/.test(t)) return true; // running header
  if (/^\d{1,4}\s+\(/.test(t) && letters.length < 6) return true;
  return false;
}

/** Positions of every hymn's first line, found in number order. */
function locate() {
  const bodyNorm = lines.map((l, i) => (i >= bodyStart && i < indexStart ? norm(l) : ''));
  const starts = new Map();
  let pos = bodyStart;
  for (let n = 1; n <= 1200; n++) {
    const cands = index.get(n);
    if (!cands) continue;
    let found = -1;
    for (const words of cands) {
      const key = norm(words).slice(0, 18);
      if (key.length < 6) continue;
      const limit = Math.min(indexStart, pos + 2500);
      for (let i = pos; i < limit && found < 0; i++) {
        if (!bodyNorm[i]) continue;
        const hay = (bodyNorm[i] + bodyNorm[i + 1]).slice(0, key.length);
        // drop capitals and small caps sometimes lose the first letter
        if (hay === key || lev(hay, key) <= Math.max(1, Math.floor(key.length / 8)) || hay.slice(0, key.length - 1) === key.slice(1)) found = i;
      }
      if (found >= 0) break;
    }
    if (found >= 0) {
      starts.set(n, found);
      pos = found + 2;
    }
  }
  return starts;
}

/** Fix overflow brackets and wrapped fragments; returns clean lines with blank markers kept as ''. */
function tidy(raw) {
  const out = [];
  for (let l of raw) {
    l = l.replace(/\s+/g, ' ').trim();
    if (!l) { out.push(''); continue; }
    if (isJunk(l)) continue;
    // "Praising my Saviour all the day long ; [blood." -> overflow word belongs to the previous text line
    const ov = l.match(/^(.*?)\s*\[([^\]]+)$/);
    if (ov) {
      l = ov[1].trim();
      let k = out.length - 1;
      while (k >= 0 && !out[k]) k--;
      if (k >= 0) out[k] = `${out[k]} ${ov[2].trim()}`;
      if (!l) continue;
    }
    // wrap-around fragment ("love.", "Him !", "filled,")
    let k = out.length - 1;
    while (k >= 0 && !out[k]) k--;
    if (k >= 0 && k === out.length - 1 && /^[a-z]/.test(l) && l.split(' ').length <= 3 && !/^\d/.test(l)) {
      out[k] = `${out[k]} ${l}`;
      continue;
    }
    if (k >= 0 && /-$/.test(out[k]) && /^[a-z]/.test(l)) { // "trem-" + "bling soul"
      out[k] = out[k].replace(/-$/, '') + l;
      continue;
    }
    out.push(l);
  }
  return out;
}

function clean(s) {
  return s
    .replace(/([A-Za-z]+)- ([a-z]+)/g, (m, a, b) => ((freq.get((a + b).toLowerCase()) || 0) > 0 ? a + b : m)) // "ring- ing"
    .replace(/[A-Za-z']+/g, spellFix)
    .replace(/\s+([;:!?,.])/g, '$1')
    .replace(/(["“])\s+/g, '$1')
    .replace(/\s+(["”])(\s|$)/g, '$1$2')
    .replace(/\.\s*\.\s*\./g, '…')
    .replace(/\s{2,}/g, ' ')
    .replace(/[|\\{}<>^~_]/g, '')
    .replace(/(^|\s)0(?=\s)/g, '$1O')
    .replace(/\bI(?=[a-z]{2,})/g, (m, o, str) => m) // leave as-is; placeholder for future fixes
    .trim();
}

function parseHymn(n, raw) {
  const ls = tidy(raw);
  // Section headings printed between hymns ("Service and Reward") end up after the last verse.
  for (;;) {
    let k = ls.length - 1;
    while (k >= 0 && !ls[k]) k--;
    if (k < 1) break;
    const t = ls[k];
    if (t.split(' ').length <= 4 && !/[.,;:!?'")]$/.test(t)) ls.splice(k);
    else break;
  }
  // numbered verse starts: "2 Perfect submission", "3 And though..."; OCR may read 3 as "8" or 5 as "&"
  const segs = [];
  let cur = { num: 1, lines: [] };
  let expect = 2;
  for (const l of ls) {
    if (!l) { cur.lines.push(''); continue; }
    const m = l.match(/^([0-9&$SZ]{1,2})[.,]?\s+([A-Z"'(“‘].*)$/);
    const val = m ? ({ '&': 5, $: 5, S: 5, Z: 2 }[m[1]] || +m[1]) : null;
    const plausible = m && (val === expect || val === expect + 1 || (m[1] === '8' && expect === 3) || (/[&$S]/.test(m[1]) && expect === 5));
    if (plausible && cur.lines.some(Boolean)) {
      segs.push(cur);
      const num = /[&$S]/.test(m[1]) ? 5 : m[1] === '8' && expect === 3 ? 3 : val;
      cur = { num, lines: [m[2]] };
      expect = num + 1;
      continue;
    }
    cur.lines.push(l);
  }
  segs.push(cur);
  for (const s of segs) {
    while (s.lines.length && !s.lines[s.lines.length - 1]) s.lines.pop();
    while (s.lines.length && !s.lines[0]) s.lines.shift();
  }
  const textLines = (s) => s.lines.filter(Boolean);
  const sections = [];
  let proofread = false;

  // Typical verse length from numbered verses (all but the last, which may carry trailing noise).
  const counts = segs.slice(1).map((s) => textLines(s).length).filter((c) => c >= 2);
  const L = mode(counts.length > 1 ? counts.slice(0, -1).concat(counts.slice(-1)) : counts);
  const first = textLines(segs[0]);
  const versesInFirst = segs[1] ? Math.max(1, segs[1].num - 1) : 1;

  if (!L || segs.length === 1) {
    // No numbered verses: use blank-line blocks as stanzas, unless the scan is double-spaced
    // (every line its own block); then fall back to four-line stanzas.
    let blocks = splitBlocks(segs[0].lines);
    if (blocks.length > 2 && blocks.filter((b) => b.length < 3).length > blocks.length / 3) {
      const all = blocks.flat();
      blocks = [];
      for (let i = 0; i < all.length; i += 4) blocks.push(all.slice(i, i + 4));
      proofread = true;
    }
    blocks.forEach((b, i) => sections.push({ type: 'verse', label: `Verse ${i + 1}`, text: b.join('\n') }));
    if (blocks.length === 1 && first.length > 10) proofread = true;
  } else {
    const need = versesInFirst * L;
    if (first.length < need) {
      proofread = true;
      sections.push({ type: 'verse', label: 'Verse 1', text: first.join('\n') });
    } else {
      sections.push({ type: 'verse', label: 'Verse 1', text: first.slice(0, L).join('\n') });
      const extra = first.length - need;
      let at = L;
      if (extra > 0 && extra < 3 && L >= 4) {
        // One or two spare lines are wrap-around leftovers, not a chorus.
        sections[0].text += '\n' + first.slice(at, at + extra).join('\n');
        at += extra;
        proofread = true;
      } else if (extra > 0) {
        sections.push({ type: 'chorus', label: 'Chorus', text: first.slice(at, at + extra).join('\n') });
        at += extra;
      }
      for (let v = 2; v <= versesInFirst; v++, at += L) sections.push({ type: 'verse', label: `Verse ${v}`, text: first.slice(at, at + L).join('\n') });
    }
    for (const s of segs.slice(1)) {
      const t = textLines(s);
      if (!t.length) continue;
      // A later segment much longer than a verse usually means a following hymn wasn't found in the index.
      if (t.length > L * 2 + 2) { proofread = true; sections.push({ type: 'verse', label: `Verse ${s.num}`, text: t.slice(0, L).join('\n') }); break; }
      sections.push({ type: 'verse', label: `Verse ${s.num}`, text: t.join('\n') });
    }
  }
  for (const s of sections) s.text = s.text.split('\n').map(clean).filter(Boolean).join('\n');
  const good = sections.filter((s) => s.text);
  if (!good.length) return null;
  let title = good[0].text.split('\n')[0].replace(/[;:,.!?—-]+$/, '').replace(/^["“'‘*]+\s*/, '').trim();
  // A first line that swallowed overflow from other lines makes a bad title: use the index's wording.
  if (title.length > 52 || /[*…]|\S+[;:?!]\s+\S+\s+\S+[;:?!]|;\s\S+\s\S+$/.test(title)) {
    const idx = (index.get(n) || [])[0];
    if (idx) title = idx.replace(/[\s.·,]+$/, '');
    proofread = true;
  }
  return { key: String(n), number: String(n), title, tags: proofread ? ['proofread'] : [], sections: good };
}

function splitBlocks(ls) {
  const blocks = [];
  let b = [];
  for (const l of ls) {
    if (!l) { if (b.length) blocks.push(b); b = []; } else b.push(l);
  }
  if (b.length) blocks.push(b);
  return blocks;
}

function mode(arr) {
  const c = new Map();
  for (const x of arr) c.set(x, (c.get(x) || 0) + 1);
  let best = 0;
  let bc = 0;
  for (const [k, v] of c) if (v > bc || (v === bc && k < best)) { best = k; bc = v; }
  return best;
}

// ---------- run ----------
const starts = locate();
const nums = [...starts.keys()].sort((a, b) => a - b);
const songs = [];
nums.forEach((n, i) => {
  const from = starts.get(n);
  const to = i + 1 < nums.length ? starts.get(nums[i + 1]) : indexStart;
  const s = parseHymn(n, lines.slice(from, to));
  if (s) songs.push(s);
});
fs.writeFileSync(OUT, JSON.stringify(songs, null, 1));
const flagged = songs.filter((s) => s.tags.includes('proofread')).length;
const withChorus = songs.filter((s) => s.sections.some((x) => x.type === 'chorus')).length;
console.log(`index entries: ${index.size}, located: ${starts.size}`);
console.log(`${songs.length} hymns -> ${path.relative(ROOT, OUT)} (${withChorus} with chorus, ${flagged} tagged proofread)`);
