#!/usr/bin/env node
/*
 * "Sacred Songs & Solos" (Sankey) was scanned from a two-column page, and on some pages the OCR read
 * the two columns interleaved, so the lines of a hymn come out shuffled:
 *
 *   Rescue the perishing, care for the   the grave:
 *   dying,                               Snatch them in pity from sin and
 *
 * Those hymns are unusable on a screen, and there is no safe way to put the columns back automatically.
 * This keeps only the hymns with no sign of that damage, and marks what it keeps for proofreading.
 *
 *   node tools/filter-sacred-songs.js
 *     content-src/sacred-songs-solos/source/raw-songs.json  ->  content-src/sacred-songs-solos/songs.json
 */
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'content-src', 'sacred-songs-solos');
const SRC = path.join(base, 'source', 'raw-songs.json');
const OUT = path.join(base, 'songs.json');

/** Returns why a hymn looks damaged, or null when it looks clean. */
function damage(h) {
  for (const sec of h.sections || []) {
    const lines = sec.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      // A stray fragment mid-stanza is the signature of an interleaved column.
      if (l.length < 12 && i < lines.length - 1) return 'fragment';
      if (/\b(\w+)\s+\1\b/i.test(l)) return 'repeated word';
      if (/\w\s-\s*\w|\.\./.test(l)) return 'split word';
    }
  }
  if (!h.title || h.title.length > 46 || h.title.length < 8) return 'title length';
  if (/["]/.test(h.title)) return 'title punctuation';
  return null;
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const kept = [];
const reasons = {};
for (const h of raw) {
  const why = damage(h);
  if (why) {
    reasons[why] = (reasons[why] || 0) + 1;
    continue;
  }
  kept.push({
    ...h,
    source: 'Sacred Songs & Solos (Sankey)',
    copyright: 'Public Domain',
    // The source scan is imperfect even where it looks clean, so every hymn invites a check.
    tags: [...new Set([...(h.tags || []), 'proofread'])],
  });
}
fs.writeFileSync(OUT, JSON.stringify(kept, null, 1));
console.log(`${kept.length} of ${raw.length} hymns kept -> ${path.relative(path.join(__dirname, '..'), OUT)}`);
console.log('dropped:', Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(', '));
