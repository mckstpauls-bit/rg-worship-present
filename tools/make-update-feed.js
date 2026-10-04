#!/usr/bin/env node
/*
 * Builds the updates.json that RG-Present's in-app updater reads, and copies everything it refers to
 * into one folder you can publish — a web folder, or a share such as \\church-server\rgpresent.
 *
 *   node tools/make-update-feed.js <output folder> [--notes "What changed"] [--no-app]
 *
 * It takes the installer from dist/ and the content packs from content/, hashes each one, and writes:
 *
 *   <output folder>/updates.json
 *   <output folder>/RG-Present-Setup-<version>.exe
 *   <output folder>/<pack>.rgpkg
 *
 * Point Settings -> Updates at that folder (or its URL) on every church computer.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--'));
const noApp = args.includes('--no-app');
const notesIdx = args.indexOf('--notes');
const notes = notesIdx >= 0 ? args[notesIdx + 1] || '' : '';

if (!outDir) {
  console.error('usage: node tools/make-update-feed.js <output folder> [--notes "..."] [--no-app]');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

fs.mkdirSync(outDir, { recursive: true });
const feed = { feedVersion: 1, generatedAt: new Date().toISOString(), app: null, packs: [] };

// ---- installer ----
const installer = path.join(ROOT, 'dist', `RG-Present-Setup-${pkg.version}.exe`);
if (!noApp) {
  if (!fs.existsSync(installer)) {
    console.error(`No installer at ${path.relative(ROOT, installer)} — run "npm run dist" first, or pass --no-app.`);
    process.exit(1);
  }
  const name = path.basename(installer);
  fs.copyFileSync(installer, path.join(outDir, name));
  feed.app = {
    version: pkg.version,
    file: name,
    size: fs.statSync(installer).size,
    sha256: sha256(installer),
    released: new Date().toISOString().slice(0, 10),
    notes: notes || `RG-Present ${pkg.version}`,
  };
}

// ---- content packs ----
const contentDir = path.join(ROOT, 'content');
for (const f of fs.existsSync(contentDir) ? fs.readdirSync(contentDir) : []) {
  if (!f.endsWith('.rgpkg')) continue;
  const src = path.join(contentDir, f);
  const AdmZip = require('adm-zip');
  const manifest = JSON.parse(new AdmZip(src).readAsText('manifest.json'));
  fs.copyFileSync(src, path.join(outDir, f));
  feed.packs.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    file: f,
    size: fs.statSync(src).size,
    sha256: sha256(src),
    notes: manifest.description || '',
  });
}

fs.writeFileSync(path.join(outDir, 'updates.json'), JSON.stringify(feed, null, 2));
console.log(`updates.json written to ${outDir}`);
if (feed.app) console.log(`  app   ${feed.app.version}  ${(feed.app.size / 1048576).toFixed(1)} MB`);
for (const p of feed.packs) console.log(`  pack  ${p.id} ${p.version}`);
console.log('\nSet this folder (or its URL) as the update source in Settings -> Updates.');
