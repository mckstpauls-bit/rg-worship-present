// Paths and settings. All user data lives under %APPDATA%/RG-Present, never next to the app binaries,
// so app updates and content updates can't clobber each other.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function dataDir() {
  return path.join(app.getPath('userData'), 'data');
}

const paths = {
  get data() { return dataDir(); },
  get db() { return path.join(dataDir(), 'library.sqlite'); },
  get backups() { return path.join(dataDir(), 'backups'); },
  get media() { return path.join(dataDir(), 'media'); },
  get settings() { return path.join(dataDir(), 'settings.json'); },
  get autosave() { return path.join(dataDir(), 'service.autosave.json'); },
  /** Content packs bundled with the app (read-only). */
  get bundledContent() {
    return app.isPackaged ? path.join(process.resourcesPath, 'content') : path.join(__dirname, '..', '..', 'content');
  },
  get changelog() {
    return app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'CHANGELOG.md') : path.join(__dirname, '..', '..', 'CHANGELOG.md');
  },
};

function ensureDirs() {
  for (const d of [paths.data, paths.backups, paths.media]) fs.mkdirSync(d, { recursive: true });
}

/** Write via temp file + rename so a power cut mid-write never leaves a truncated file. */
function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const DEFAULT_SETTINGS = {
  uiTheme: 'dark',
  outputDisplayId: null, // null = first non-primary display
  outputEnabled: true,
  stageEnabled: false,
  stageDisplayId: null,
  defaultThemeId: 'rg-core:classic-dark',
  transition: { type: 'fade', ms: 450 },
  maxLinesPerSlide: 6,
  autoChorus: true,
  fontFallback: '"Segoe UI", "Noto Sans", "Arial Unicode MS", sans-serif',
  chorusWords: [],
  logoMedia: 'packs/rg-core/logo.svg',
  autoAdvanceSeconds: 8,
  outputResolution: { width: 1920, height: 1080 },
  defaultBibleId: 'kjv',
  scriptureMaxChars: 320, // characters of Bible text per slide (whole verses are kept together)
  scriptureVerseNumbers: true,
  // Updates: a URL or a folder on a network share holding updates.json. Empty = never check.
  updateFeedUrl: '',
  autoCheckUpdates: true,
  lastUpdateCheckAt: null,
};

let cache = null;

function loadSettings() {
  if (cache) return cache;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(paths.settings, 'utf8'));
  } catch (_) { /* first run or unreadable: fall back to defaults */ }
  cache = { ...DEFAULT_SETTINGS, ...saved, transition: { ...DEFAULT_SETTINGS.transition, ...(saved.transition || {}) } };
  return cache;
}

function saveSettings(patch) {
  cache = { ...loadSettings(), ...patch };
  writeFileAtomic(paths.settings, JSON.stringify(cache, null, 2));
  return cache;
}

module.exports = { paths, ensureDirs, writeFileAtomic, loadSettings, saveSettings, DEFAULT_SETTINGS };
