#!/usr/bin/env node
/*
 * Builds the content packs that ship inside the installer (content/*.rgpkg) from content-src/.
 *
 *   node tools/build-packs.js
 *
 * Each folder in content-src/ with a manifest.json becomes one pack. Songs come from
 * songs.json and/or *.txt files in RG hymnbook format. Bump "version" in a pack's
 * manifest.json whenever its content changes: installed copies upgrade when they see a
 * newer version, and songs edited locally in the app are kept.
 *
 * Kimeru hymns whose English title matches an English hymn get a shared link key, which is
 * what the app's English/Kimeru toggle uses.
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { parseHymnbookText } = require('../src/main/importers');
const L = require('../src/renderer/shared/lyrics');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'content-src');
const OUT = path.join(ROOT, 'content');
fs.mkdirSync(OUT, { recursive: true });

const packs = [];
for (const dir of fs.readdirSync(SRC)) {
  const base = path.join(SRC, dir);
  const mf = path.join(base, 'manifest.json');
  if (!fs.existsSync(mf)) continue;
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  let songs = [];
  if (fs.existsSync(path.join(base, 'songs.json'))) songs = JSON.parse(fs.readFileSync(path.join(base, 'songs.json'), 'utf8'));
  for (const f of fs.readdirSync(base).filter((f) => f.endsWith('.txt'))) {
    songs = songs.concat(parseHymnbookText(fs.readFileSync(path.join(base, f), 'utf8'), {
      language: manifest.language, folder: manifest.folder, titleFromFirstLine: !!manifest.titleFromFirstLine,
    }));
  }
  packs.push({ dir, base, manifest, songs });
}

// ---- cross-language links (English <-> Kimeru) ----
const key = (s) => L.searchNormalize(s || '').replace(/\s+/g, ' ').trim();
const english = packs.filter((p) => p.manifest.language === 'en').flatMap((p) => p.songs);
const englishIndex = english.map((s) => ({ s, k: key(s.title) }));
const linkOf = (s) => `hymn:${key(s.title).replace(/ /g, '-')}`;
let linked = 0;
for (const p of packs.filter((p) => p.manifest.language && p.manifest.language !== 'en')) {
  for (const s of p.songs) {
    const k = key(s.alt_title);
    let hit = null;
    if (s.link === 'none') { delete s.link; continue; }
    if (s.link) hit = englishIndex.find((e) => linkOf(e.s) === s.link); // "@link hymn:..." set by hand
    // Short titles ("Holy, Holy, Holy") only match exactly; longer ones may match the start of a first line.
    else if (k.length >= 10) hit = englishIndex.find((e) => e.k === k) || (k.split(' ').length >= 4 && englishIndex.find((e) => e.k.startsWith(k) || (k.startsWith(e.k) && e.k.length >= 14)));
    if (!hit) continue;
    const link = linkOf(hit.s);
    hit.s.link = link;
    s.link = link;
    linked++;
  }
}

for (const p of packs) {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(p.manifest, null, 2)));
  zip.addFile('songs.json', Buffer.from(JSON.stringify(p.songs)));
  for (const sub of ['themes', 'media', 'bibles']) {
    const d = path.join(p.base, sub);
    if (fs.existsSync(d)) zip.addLocalFolder(d, sub);
  }
  const cl = path.join(p.base, 'CHANGELOG.md');
  if (fs.existsSync(cl)) zip.addLocalFile(cl);
  const file = path.join(OUT, `${p.manifest.id}.rgpkg`);
  zip.writeZip(file);
  const themes = fs.existsSync(path.join(p.base, 'themes')) ? fs.readdirSync(path.join(p.base, 'themes')).length : 0;
  console.log(`${path.relative(ROOT, file)}  v${p.manifest.version}  ${p.songs.length} songs, ${themes} themes`);
}
console.log(`${linked} songs linked to an English hymn`);
