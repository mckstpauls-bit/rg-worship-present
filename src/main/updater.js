/*
 * In-app updater.
 *
 * App updates and content-pack updates are both described by one JSON "feed" that the church controls:
 * a URL, or a folder on a local network share. Nothing is contacted unless a feed is configured.
 *
 *   updates.json
 *   {
 *     "feedVersion": 1,
 *     "app":   { "version": "1.1.0", "file": "RG-Present-Setup-1.1.0.exe", "sha256": "...",
 *                "size": 121405722, "notes": "What changed", "minVersion": "1.0.0" },
 *     "packs": [ { "id": "open-hymnal-2014", "version": "1.1.0", "file": "open-hymnal-2014.rgpkg",
 *                  "sha256": "...", "notes": "12 hymns corrected" } ]
 *   }
 *
 * "file" may be an absolute URL or a name relative to the feed, so dropping updates.json next to the
 * installer and the .rgpkg files on a share is enough to publish an update.
 *
 * Safety:
 *  - every download is checked against its SHA-256 before it is run or installed;
 *  - the library, Bibles and settings are backed up before an app update is applied;
 *  - if the new version will not start, the next launch offers a rollback.
 */
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { paths, writeFileAtomic, loadSettings } = require('./store');
const packs = require('./packs');
const db = require('./db');

const MAX_DOWNLOAD = 400 * 1024 * 1024; // the installer is ~120 MB; refuse anything absurd

const updatesDir = () => path.join(paths.data, 'updates');
const statePath = () => path.join(updatesDir(), 'update-state.json');
const guardPath = () => path.join(updatesDir(), 'launch-guard.json');

function ensureDir() {
  fs.mkdirSync(updatesDir(), { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readState() {
  return readJson(statePath());
}

function writeState(state) {
  ensureDir();
  if (!state) {
    fs.rmSync(statePath(), { force: true });
    return null;
  }
  writeFileAtomic(statePath(), JSON.stringify(state, null, 2));
  return state;
}

// ---------------- feed access ----------------

const isUrl = (s) => /^https?:\/\//i.test(s);

/** Resolve "file" against the feed location, for URLs and for folders / UNC shares alike. */
function resolveAgainstFeed(feed, file) {
  if (isUrl(file)) return file;
  if (isUrl(feed)) return new URL(file, feed).toString();
  const base = /\.json$/i.test(feed) ? path.dirname(feed) : feed;
  return path.resolve(base, file);
}

function feedLocation(raw) {
  const feed = String(raw || '').trim();
  if (!feed) throw new Error('No update source is set. Add one in Settings -> Updates.');
  if (isUrl(feed)) return feed;
  const local = feed.replace(/^file:\/\//i, '');
  return /\.json$/i.test(local) ? local : path.join(local, 'updates.json');
}

async function fetchBuffer(src, onProgress, expectedSize) {
  if (!isUrl(src)) {
    const stat = fs.statSync(src);
    if (stat.size > MAX_DOWNLOAD) throw new Error('That update file is unexpectedly large; refusing to copy it.');
    const buf = fs.readFileSync(src);
    if (onProgress) onProgress({ received: buf.length, total: buf.length });
    return buf;
  }
  const res = await net.fetch(src, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Update source returned ${res.status} ${res.statusText}`);
  const total = expectedSize || Number(res.headers.get('content-length')) || 0;
  if (total > MAX_DOWNLOAD) throw new Error('That update file is unexpectedly large; refusing to download it.');
  const chunks = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    received += value.length;
    if (received > MAX_DOWNLOAD) throw new Error('That update file is unexpectedly large; download stopped.');
    if (onProgress) onProgress({ received, total });
  }
  return Buffer.concat(chunks);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Read the feed and work out what is newer than what is installed. */
async function check(feedRaw) {
  const feed = feedLocation(feedRaw === undefined || feedRaw === null ? loadSettings().updateFeedUrl : feedRaw);
  const buf = await fetchBuffer(feed);
  let data;
  try {
    data = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
  } catch (_) {
    throw new Error('The update source did not return a valid updates.json file.');
  }
  const currentApp = app.getVersion();
  const result = { feed, checkedAt: new Date().toISOString(), currentApp, app: null, packs: [] };

  if (data.app && data.app.version && packs.compareVersions(data.app.version, currentApp) > 0) {
    result.app = {
      version: data.app.version,
      notes: String(data.app.notes || ''),
      size: Number(data.app.size) || 0,
      sha256: String(data.app.sha256 || '').toLowerCase(),
      url: resolveAgainstFeed(feed, data.app.file || data.app.url || ''),
      released: data.app.released || null,
      // An update may require a minimum running version, e.g. a schema step that must not be skipped.
      blocked: data.app.minVersion && packs.compareVersions(currentApp, data.app.minVersion) < 0
        ? `Install version ${data.app.minVersion} first.`
        : null,
    };
  }

  const installed = new Map(db.listPacks().map((p) => [p.id, p.version]));
  for (const p of data.packs || []) {
    if (!p.id || !p.version) continue;
    const have = installed.get(p.id);
    if (have && packs.compareVersions(p.version, have) <= 0) continue;
    result.packs.push({
      id: p.id,
      name: p.name || p.id,
      version: p.version,
      installedVersion: have || null,
      notes: String(p.notes || ''),
      sha256: String(p.sha256 || '').toLowerCase(),
      size: Number(p.size) || 0,
      url: resolveAgainstFeed(feed, p.file || p.url || ''),
    });
  }
  return result;
}

async function downloadVerified(info, onProgress) {
  if (!info.url) throw new Error('That update entry has no file to download.');
  const buf = await fetchBuffer(info.url, onProgress, info.size);
  if (info.sha256) {
    const got = sha256(buf);
    if (got !== info.sha256) {
      throw new Error(`Download does not match its checksum, so it may be damaged or tampered with.\nExpected ${info.sha256}\nGot      ${got}`);
    }
  }
  return buf;
}

// ---------------- content packs ----------------

async function installPackUpdate(info, onProgress) {
  ensureDir();
  const buf = await downloadVerified(info, onProgress);
  const file = path.join(updatesDir(), `${info.id}-${info.version}.rgpkg`);
  fs.writeFileSync(file, buf);
  try {
    return packs.installPack(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// ---------------- app update ----------------

/** Copy the library, Bibles and settings somewhere safe before the program is replaced. */
function backupData(label) {
  const dir = path.join(paths.backups, `pre-update-${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['library.sqlite', 'bibles.sqlite', 'settings.json']) {
    const src = path.join(paths.data, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  return dir;
}

/** Download the installer, verify it, and keep it ready to run. */
async function downloadApp(info, onProgress) {
  if (!app.isPackaged) throw new Error('App updates can only be installed from an installed copy of RG-Present, not from a development build.');
  if (info.blocked) throw new Error(info.blocked);
  ensureDir();
  const buf = await downloadVerified(info, onProgress);
  const file = path.join(updatesDir(), `RG-Present-Setup-${info.version}.exe`);
  fs.writeFileSync(file, buf);
  writeState({
    stage: 'downloaded',
    from: app.getVersion(),
    to: info.version,
    installer: file,
    sha256: info.sha256 || sha256(buf),
    notes: info.notes || '',
    downloadedAt: new Date().toISOString(),
  });
  return { file, version: info.version, size: buf.length };
}

/**
 * Run the downloaded installer and quit so it can replace the program.
 * The installer is re-checked against its checksum immediately before it runs.
 */
function applyApp({ silent = false } = {}) {
  const state = readState();
  if (!state || !state.installer || !fs.existsSync(state.installer)) {
    throw new Error('No downloaded update is waiting to be installed.');
  }
  if (state.sha256 && sha256(fs.readFileSync(state.installer)) !== state.sha256) {
    fs.rmSync(state.installer, { force: true });
    writeState(null);
    throw new Error('The downloaded update changed on disk and was discarded. Please download it again.');
  }
  const backupDir = backupData(state.from);
  writeState({ ...state, stage: 'installing', backupDir, startedAt: new Date().toISOString() });
  db.log('app', state.to, `Installing update ${state.from} -> ${state.to}`);
  db.flushNow();

  // NSIS: /S installs silently; without it the familiar installer window appears.
  const child = spawn(state.installer, silent ? ['/S'] : [], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 400);
  return { installer: state.installer, to: state.to };
}

function cancelPending() {
  const state = readState();
  if (state && state.stage === 'downloaded' && state.installer) fs.rmSync(state.installer, { force: true });
  writeState(null);
}

// ---------------- restart / crash handling ----------------

/**
 * Called once at startup: reports how the last update attempt went and bumps the launch counter
 * used to spot a version that will not start.
 */
function startup() {
  ensureDir();
  const version = app.getVersion();
  const state = readState();
  let outcome = null;

  if (state && state.stage === 'installing') {
    if (packs.compareVersions(version, state.to) >= 0) {
      outcome = { kind: 'updated', from: state.from, to: version, notes: state.notes || '' };
      db.log('app', version, `Updated ${state.from} -> ${version}`);
      // The installer is kept: it is what a rollback from the next update would reinstall.
      writeState({
        stage: 'installed', from: state.from, to: version,
        installer: state.installer, backupDir: state.backupDir, installedAt: new Date().toISOString(),
      });
    } else {
      outcome = { kind: 'failed', from: state.from, to: state.to };
      db.log('app', state.to, `Update to ${state.to} did not complete; still running ${version}`);
      writeState({ ...state, stage: 'failed', failedAt: new Date().toISOString() });
    }
  }

  const guard = readJson(guardPath(), { version, count: 0 });
  const count = guard.version === version ? (guard.count || 0) + 1 : 1;
  writeFileAtomic(guardPath(), JSON.stringify({ version, count, at: new Date().toISOString() }));
  // count > 1 means earlier launches of this version never finished starting.
  return { outcome, unhealthyLaunches: count - 1, rollback: rollbackTarget() };
}

/** Called once the operator window is up: this launch worked. */
function markHealthy() {
  try {
    writeFileAtomic(guardPath(), JSON.stringify({ version: app.getVersion(), count: 0, at: new Date().toISOString() }));
  } catch (_) { /* non-fatal */ }
}

/** The previous version's installer and data backup, if this version was installed by the updater. */
function rollbackTarget() {
  const state = readState();
  if (!state || state.stage !== 'installed' || !state.from) return null;
  const prev = path.join(updatesDir(), `RG-Present-Setup-${state.from}.exe`);
  const hasInstaller = fs.existsSync(prev);
  const hasBackup = !!state.backupDir && fs.existsSync(state.backupDir);
  if (!hasInstaller && !hasBackup) return null;
  return {
    from: state.to,
    to: state.from,
    installer: hasInstaller ? prev : null,
    backupDir: hasBackup ? state.backupDir : null,
  };
}

/**
 * Put the previous version back: restore the library backup and, when the old installer is still
 * cached, run it. Without that installer only the data can be restored.
 */
function rollback() {
  const target = rollbackTarget();
  if (!target) throw new Error('There is nothing to roll back to.');
  if (target.backupDir) {
    db.flushNow();
    for (const f of fs.readdirSync(target.backupDir)) {
      fs.copyFileSync(path.join(target.backupDir, f), path.join(paths.data, f));
    }
  }
  writeState({ stage: 'rolled-back', from: target.from, to: target.to, at: new Date().toISOString() });
  if (target.installer) {
    const child = spawn(target.installer, [], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => app.quit(), 400);
    return { reinstalled: true, to: target.to, restoredData: !!target.backupDir };
  }
  return { reinstalled: false, to: target.to, restoredData: !!target.backupDir };
}

function status() {
  const state = readState();
  const s = loadSettings();
  return {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    feed: s.updateFeedUrl || '',
    autoCheck: !!s.autoCheckUpdates,
    lastCheckedAt: s.lastUpdateCheckAt || null,
    pending: state && state.stage === 'downloaded' ? { version: state.to, notes: state.notes || '' } : null,
    lastOutcome: state && (state.stage === 'installed' || state.stage === 'failed')
      ? { stage: state.stage, from: state.from, to: state.to }
      : null,
    rollback: rollbackTarget(),
  };
}

module.exports = {
  check, downloadApp, applyApp, cancelPending, installPackUpdate,
  startup, markHealthy, rollback, rollbackTarget, status, readState,
};
