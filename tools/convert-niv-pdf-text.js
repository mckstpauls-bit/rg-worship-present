// Converts the text extracted from NIV-Bible.pdf into RG-Present Bible JSON, checking structure against KJV.
// usage: node niv-parse.js <niv.txt> <kjv.json (RG format)> <out.json>
const fs = require('fs');
const B = require('C:/Users/Administrator/Documents/rgpresent/src/renderer/shared/bible.js');
const [, , src, kjvFile, outFile] = process.argv;

const lines = fs.readFileSync(src, 'utf8').split('\n');
const kjv = JSON.parse(fs.readFileSync(kjvFile, 'utf8'));
const kjvCount = (b, c) => (kjv.books[b - 1].chapters[c - 1] || []).length;
const kjvChapters = (b) => kjv.books[b - 1].chapters.length;

const bookNames = B.BOOKS.map((b) => b.name);
const headerName = (l) => {
  const t = l.trim().replace(/^1st /, '1 ').replace(/^2nd /, '2 ').replace(/^3rd /, '3 ');
  return t;
};

// Skip the table of contents: body starts at the second "Genesis" line.
let start = lines.findIndex((l, i) => i > 10 && l.trim() === 'Genesis' && /^1In the beginning/.test(lines[i + 1] || ''));
const tokens = []; // { kind: 'book', n } | { kind: 'psalm', n } | { kind: 'marker', n, text } | { kind: 'text', text }
let nextBook = 1;
for (let i = start; i < lines.length; i++) {
  const raw = lines[i];
  const l = raw.trim();
  if (!l || l === '<<PAGE>>') continue;
  if (nextBook <= 66 && headerName(l) === bookNames[nextBook - 1]) {
    tokens.push({ kind: 'book', n: nextBook++ });
    continue;
  }
  const ps = l.match(/^PSALM (\d+)$/);
  if (ps) { tokens.push({ kind: 'psalm', n: +ps[1] }); continue; }
  const m = l.match(/^(\d{1,3})(?=[A-Za-z"'‘“(\[])(.*)$/);
  if (m) tokens.push({ kind: 'marker', n: +m[1], text: m[2] });
  else tokens.push({ kind: 'text', text: l });
}

const verses = [];
let book = 0, ch = 0, v = 0, cur = null;
const markers = tokens.map((t, i) => i).filter((i) => tokens[i].kind === 'marker');
const nextMarker = (i) => { for (let k = i + 1; k < tokens.length; k++) { if (tokens[k].kind === 'marker') return tokens[k].n; if (tokens[k].kind !== 'text') return null; } return null; };
const issues = [];

tokens.forEach((t, i) => {
  if (t.kind === 'book') { book = t.n; ch = 0; v = 0; cur = null; return; }
  if (t.kind === 'psalm') { ch = t.n; v = 0; cur = null; return; }
  if (t.kind === 'text') {
    // "3836,000 cattle" = verse 38 + "36,000 cattle": the PDF glues verse numbers onto numbers in the text.
    const want = String(v + 1);
    const rest = t.text.slice(want.length);
    const glued = /^[0-9]{1,3}(,[0-9]{3})+(?![0-9])/.test(rest) || (/^[0-9-]/.test(rest) && nextMarker(i) === v + 2);
    if (cur && t.text.startsWith(want) && glued && v + 1 <= kjvCount(book, ch)) {
      v += 1;
      cur = { book, chapter: ch, verse: v, text: t.text.slice(want.length) };
      verses.push(cur);
      return;
    }
    if (cur) cur.text += ' ' + t.text;
    return;
  }
  const n = t.n;
  const nm = nextMarker(i);
  const isPsalms = book === 19;
  let newChapter = false;
  if (ch === 0 && !isPsalms) { ch = 1; v = 0; }
  if (!isPsalms && n === ch + 1 && (nm === 2 || (n !== v + 1 && nm !== n + 1)) && v >= Math.min(kjvCount(book, ch), 3) - 2) newChapter = true;
  else if (!isPsalms && n === 1 && v > 1) newChapter = true; // chapter shown as "1" (rare)
  if (newChapter) { ch = ch + 1; v = 1; }
  else if (n > v && (n <= v + 3 || (n <= kjvCount(book, ch) && nm === n + 1))) v = n; // normal verse (NIV omits a few verses, e.g. Matt 17:21)
  else if (n === v) { /* duplicate marker: treat as text */ if (cur) cur.text += ' ' + n + t.text; return; }
  else { issues.push(`${B.bookName(book)} ${ch}:${v} unexpected marker ${n}: ${t.text.slice(0, 40)}`); if (cur) cur.text += ' ' + n + t.text; return; }
  cur = { book, chapter: ch, verse: v, text: t.text };
  verses.push(cur);
});

const tidy = (s) => s.replace(/\s+/g, ' ')
  .replace(/ ([,;:.!?])/g, '$1')
  .replace(/(\w)- (\w)/g, '$1-$2')
  .replace(/' "/g, '\'"').replace(/ '$/, "'")
  .trim();
for (const x of verses) x.text = tidy(x.text);

// ---- compare with KJV structure ----
const byCh = new Map();
for (const x of verses) { const k = `${x.book}.${x.chapter}`; byCh.set(k, Math.max(byCh.get(k) || 0, x.verse)); }
let chapterMismatch = 0, verseMismatch = [];
for (let b = 1; b <= 66; b++) {
  const nch = Math.max(...[...byCh.keys()].filter((k) => k.startsWith(b + '.')).map((k) => +k.split('.')[1]), 0);
  if (nch !== kjvChapters(b)) { chapterMismatch++; issues.push(`${B.bookName(b)}: ${nch} chapters (KJV ${kjvChapters(b)})`); }
  for (let c = 1; c <= kjvChapters(b); c++) {
    const a = byCh.get(`${b}.${c}`) || 0, k = kjvCount(b, c);
    if (Math.abs(a - k) > 1) verseMismatch.push(`${B.bookName(b)} ${c}: ${a} vs KJV ${k}`);
  }
}
console.log('verses', verses.length, 'chapter mismatches', chapterMismatch, 'verse-count mismatches (>1)', verseMismatch.length);
console.log(issues.slice(0, 30).join('\n'));
console.log(verseMismatch.slice(0, 40).join('\n'));

const books = [];
for (const x of verses) {
  const bk = books[x.book - 1] || (books[x.book - 1] = { n: x.book, name: B.bookName(x.book), chapters: [] });
  const c = bk.chapters[x.chapter - 1] || (bk.chapters[x.chapter - 1] = []);
  c[x.verse - 1] = x.text;
}
for (const bk of books) if (bk) bk.chapters = bk.chapters.map((c) => c || []);
fs.writeFileSync(outFile, JSON.stringify({ key: 'niv', name: 'New International Version (1984)', abbrev: 'NIV', language: 'en',
  copyright: 'Scripture taken from the Holy Bible, New International Version®. Copyright © 1973, 1978, 1984 by International Bible Society.', books: books.filter(Boolean) }));
