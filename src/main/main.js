const { app, BrowserWindow, ipcMain, screen, dialog, protocol, net, shell, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const store = require('./store');
const db = require('./db');
const packs = require('./packs');
const importers = require('./importers');
const bibles = require('./bibles');
const updater = require('./updater');

const { paths } = store;
// Dev/testing: run against a throwaway data folder without touching the real library.
if (process.env.RG_USER_DATA) app.setPath('userData', process.env.RG_USER_DATA);
const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const PUBLISHER = 'RG DEV Industries';
const CONTACT_EMAIL = 'rgdev.ke@gmail.com';

// rgmedia://media/<relative path under data/media> — lets pages load user media without file:// access.
protocol.registerSchemesAsPrivileged([
  { scheme: 'rgmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

const win = { operator: null, output: null, stage: null };
let lastOutput = null;
let pendingUpdateOutcome = null; // result of the last update attempt, shown once the UI is up
let pendingBible = null; // parsed Bible file waiting for the operator to confirm its name // replayed to output/stage windows when they (re)open

function webPrefs() {
  return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };
}

function createOperator() {
  const s = store.loadSettings();
  win.operator = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    title: 'RG-Present',
    icon: ICON,
    backgroundColor: s.uiTheme === 'light' ? '#f4f3ef' : '#12141a',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors(s.uiTheme),
    show: false,
    webPreferences: webPrefs(),
  });
  win.operator.loadFile(path.join(RENDERER, 'operator', 'index.html'));
  if (!app.isPackaged) {
    win.operator.webContents.on('console-message', (e) => console.log(`[operator:${e.level}]`, e.message, e.sourceId ? `(${path.basename(e.sourceId)}:${e.lineNumber})` : ''));
  }
  win.operator.once('ready-to-show', () => {
    win.operator.maximize();
    win.operator.show();
    // The window opened, so this build starts: clear the crash guard.
    updater.markHealthy();
    if (pendingUpdateOutcome) {
      win.operator.webContents.send('updates:outcome', pendingUpdateOutcome);
      pendingUpdateOutcome = null;
    }
  });
  win.operator.on('closed', () => {
    win.operator = null;
    for (const w of [win.output, win.stage]) if (w && !w.isDestroyed()) w.destroy();
    app.quit();
  });
}

function titleBarColors(theme) {
  return theme === 'light'
    ? { color: '#f4f3ef', symbolColor: '#2a2d36', height: 44 }
    : { color: '#12141a', symbolColor: '#d7dae3', height: 44 };
}

/** Pick the display for an output window: the configured one, else the first non-primary one. */
function pickDisplay(id) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.find((d) => String(d.id) === String(id)) || displays.find((d) => d.id !== primary.id) || null;
}

function createPresentationWindow(kind) {
  const s = store.loadSettings();
  const display = pickDisplay(kind === 'output' ? s.outputDisplayId : s.stageDisplayId);
  const operatorDisplay = win.operator ? screen.getDisplayMatching(win.operator.getBounds()) : screen.getPrimaryDisplay();
  // Never cover the operator's own screen: with one monitor the output opens as a normal window.
  const fullscreen = display && display.id !== operatorDisplay.id;
  const w = new BrowserWindow({
    title: kind === 'output' ? 'RG-Present — Audience Output' : 'RG-Present — Stage Display',
    icon: ICON,
    backgroundColor: '#000000',
    frame: !fullscreen,
    autoHideMenuBar: true,
    skipTaskbar: !!fullscreen,
    show: false,
    ...(fullscreen ? display.bounds : { width: 960, height: 540 }),
    webPreferences: webPrefs(),
  });
  w.loadFile(path.join(RENDERER, kind, 'index.html'));
  w.once('ready-to-show', () => {
    if (fullscreen) {
      w.setBounds(display.bounds);
      w.setFullScreen(true);
      w.setAlwaysOnTop(true, 'screen-saver');
      w.showInactive();
    } else w.show();
    if (lastOutput) w.webContents.send('output:render', lastOutput);
  });
  w.on('closed', () => {
    win[kind] = null;
    notifyOperator();
  });
  win[kind] = w;
  notifyOperator();
  return w;
}

function setPresentationWindow(kind, on) {
  const cur = win[kind];
  if (on && !cur) createPresentationWindow(kind);
  if (!on && cur && !cur.isDestroyed()) cur.close();
}

function reopenPresentationWindows() {
  const s = store.loadSettings();
  for (const kind of ['output', 'stage']) {
    if (win[kind] && !win[kind].isDestroyed()) win[kind].destroy();
    win[kind] = null;
  }
  if (s.outputEnabled) createPresentationWindow('output');
  if (s.stageEnabled) createPresentationWindow('stage');
}

function displaysInfo() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: `${d.label || `Display ${i + 1}`} — ${d.size.width}×${d.size.height}${d.id === primary.id ? ' (primary)' : ''}`,
    primary: d.id === primary.id,
  }));
}

function notifyOperator() {
  if (!win.operator || win.operator.isDestroyed()) return;
  win.operator.webContents.send('windows:state', {
    output: !!win.output,
    stage: !!win.stage,
    displays: displaysInfo(),
  });
}

// ---------------- IPC ----------------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

/** Progress of a running download, for the Updates dialog. */
function sendUpdateProgress(id, p) {
  if (win.operator && !win.operator.isDestroyed()) {
    win.operator.webContents.send('updates:progress', { id, received: p.received, total: p.total });
  }
}

/** A pack install can add themes; tell the operator window to reload them. */
async function loadThemesIntoRenderer() {
  if (win.operator && !win.operator.isDestroyed()) win.operator.webContents.send('content:changed');
}

function registerIpc() {
  handle('app:info', () => ({
    appVersion: app.getVersion(),
    publisher: PUBLISHER,
    contactEmail: CONTACT_EMAIL,
    schemaVersion: db.getSchemaVersion(),
    packs: db.listPacks(),
    dataDir: paths.data,
    electron: process.versions.electron,
  }));
  handle('app:changelog', () => {
    let file = '';
    try { file = fs.readFileSync(paths.changelog, 'utf8'); } catch (_) { /* not bundled */ }
    return { file, entries: db.listChangelog(300) };
  });
  handle('app:open-data-folder', () => shell.openPath(paths.data));

  handle('settings:get', () => store.loadSettings());
  handle('settings:set', (patch) => {
    const before = store.loadSettings();
    const s = store.saveSettings(patch);
    if (patch.uiTheme && win.operator) {
      win.operator.setTitleBarOverlay(titleBarColors(s.uiTheme));
      win.operator.setBackgroundColor(s.uiTheme === 'light' ? '#f4f3ef' : '#12141a');
    }
    const moved = ['outputDisplayId', 'stageDisplayId'].some((k) => k in patch && patch[k] !== before[k]);
    if (moved) reopenPresentationWindows();
    else {
      if ('outputEnabled' in patch) setPresentationWindow('output', s.outputEnabled);
      if ('stageEnabled' in patch) setPresentationWindow('stage', s.stageEnabled);
    }
    return s;
  });
  handle('displays:list', () => displaysInfo());
  handle('windows:state', () => ({ output: !!win.output, stage: !!win.stage, displays: displaysInfo() }));

  handle('songs:search', (q) => db.searchSongs(q || {}));
  handle('songs:get', (id) => db.getSong(id));
  handle('songs:linked', (linkKey) => db.linkedSongs(linkKey));
  handle('songs:save', (song) => {
    const id = db.saveSong(song);
    return db.getSong(id);
  });
  handle('songs:delete', (id) => db.deleteSong(id));
  handle('songs:folders', () => db.folders());

  handle('themes:list', () => db.listThemes());
  handle('themes:save', (theme) => db.saveTheme(theme));
  handle('themes:delete', (id) => db.deleteTheme(id));

  handle('media:list', () => db.listMedia());
  handle('media:import', async () => {
    const r = await dialog.showOpenDialog(win.operator, {
      title: 'Add images or videos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images & videos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'm4v'] }],
    });
    if (r.canceled) return [];
    const added = [];
    const dir = path.join(paths.media, 'user');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of r.filePaths) {
      const type = packs.mediaType(f);
      if (!type) continue;
      let name = path.basename(f);
      let dest = path.join(dir, name);
      for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${path.parse(name).name} (${i})${path.extname(name)}`);
      fs.copyFileSync(f, dest);
      const rel = `user/${path.basename(dest)}`;
      db.addMedia({ name: path.basename(dest), rel_path: rel, type, folder: 'My Media' });
      added.push(rel);
    }
    return added;
  });
  handle('media:delete', (id) => {
    const m = db.deleteMedia(id);
    if (m && m.rel_path.startsWith('user/')) fs.rmSync(path.join(paths.media, m.rel_path), { force: true });
  });

  handle('service:autosave', (data) => store.writeFileAtomic(paths.autosave, JSON.stringify({ savedAt: new Date().toISOString(), ...data })));
  handle('service:load-autosave', () => {
    try { return JSON.parse(fs.readFileSync(paths.autosave, 'utf8')); } catch (_) { return null; }
  });
  handle('services:list', () => db.listServices());
  handle('services:save', (svc) => db.saveService(svc));
  handle('services:get', (id) => db.getService(id));
  handle('services:delete', (id) => db.deleteService(id));

  handle('packs:list', () => db.listPacks());
  handle('packs:import', async () => {
    const r = await dialog.showOpenDialog(win.operator, {
      title: 'Install or update a content pack',
      properties: ['openFile'],
      filters: [{ name: 'RG-Present content pack', extensions: ['rgpkg', 'zip'] }],
    });
    if (r.canceled) return null;
    return packs.installPack(r.filePaths[0]);
  });
  handle('packs:export', async ({ folder }) => {
    const safe = (folder || 'All songs').replace(/[^\w\- ]+/g, '').trim() || 'songs';
    const r = await dialog.showSaveDialog(win.operator, {
      title: 'Export songs as a content pack',
      defaultPath: `${safe}.rgpkg`,
      filters: [{ name: 'RG-Present content pack', extensions: ['rgpkg'] }],
    });
    if (r.canceled) return null;
    const id = `export-${safe.toLowerCase().replace(/\s+/g, '-')}`;
    return packs.exportPack(r.filePath, { id, name: folder || 'All songs', version: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), folder });
  });

  handle('updates:status', () => updater.status());
  handle('updates:check', async (feed) => {
    const r = await updater.check(feed);
    store.saveSettings({ lastUpdateCheckAt: r.checkedAt });
    return r;
  });
  handle('updates:download-app', async (info) => updater.downloadApp(info, (p) => sendUpdateProgress('app', p)));
  handle('updates:apply-app', (opts) => updater.applyApp(opts || {}));
  handle('updates:cancel', () => updater.cancelPending());
  handle('updates:install-pack', async (info) => {
    const stats = await updater.installPackUpdate(info, (p) => sendUpdateProgress(info.id, p));
    await loadThemesIntoRenderer();
    return stats;
  });
  handle('updates:rollback', () => updater.rollback());

  handle('import:pick', async () => {
    const r = await dialog.showOpenDialog(win.operator, {
      title: 'Import hymns or songs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Song files', extensions: ['txt', 'csv', 'docx', 'pptx', 'json'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle('import:parse', async ({ files, options }) => {
    const out = [];
    const errors = [];
    const chorusWords = store.loadSettings().chorusWords || [];
    for (const f of files) {
      try {
        const songs = await importers.parseFile(f, { ...options, chorusWords });
        out.push(...songs.map((s) => ({ ...s, _file: path.basename(f) })));
      } catch (e) {
        errors.push({ file: path.basename(f), message: e.message });
      }
    }
    return { songs: out, errors };
  });
  handle('import:commit', ({ songs, options }) => {
    // Imported songs get a stable uid per folder+key so importing a corrected file updates them in place.
    let added = 0;
    let updated = 0;
    db.transaction(() => {
      for (const s of songs) {
        const folder = s.folder || options.folder || 'Songs';
        const uid = `import:${folder}:${s.number || s.key || s.title}`;
        const existing = options.mode === 'new' ? null : db.getSongByUid(uid);
        db.saveSong({
          ...s,
          id: existing ? existing.id : undefined,
          uid: existing ? existing.uid : options.mode === 'new' ? `import:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}` : uid,
          folder,
          language: s.language || options.language || null,
          link_key: (existing && existing.link_key) || s.link || null,
        });
        if (existing) updated++;
        else added++;
      }
      db.log('content', '', `Imported ${added} new and ${updated} updated songs into "${options.folder || 'Songs'}"`);
    });
    db.flushNow();
    return { added, updated };
  });

  handle('bible:list', () => bibles.list());
  handle('bible:structure', (id) => bibles.structure(id));
  handle('bible:chapter', ({ id, book, chapter }) => bibles.chapter(id, book, chapter));
  handle('bible:passage', ({ id, ref }) => bibles.passage(id, ref));
  handle('bible:search', ({ id, q }) => bibles.search(id, q, 300));
  handle('bible:remove', (id) => {
    const b = bibles.get(id);
    bibles.remove(id);
    if (b) db.log('content', '', `Removed Bible "${b.name}"`);
  });
  handle('bible:pick', async () => {
    const r = await dialog.showOpenDialog(win.operator, {
      title: 'Import a Bible translation',
      properties: ['openFile'],
      filters: [{ name: 'Bible files', extensions: ['xml', 'osis', 'json', 'csv', 'tsv', 'txt'] }],
    });
    if (r.canceled) return null;
    const parsed = bibles.parseFile(r.filePaths[0]);
    // Keep the verses in main; the dialog only needs a summary.
    pendingBible = parsed;
    return { file: path.basename(r.filePaths[0]), name: parsed.name, abbrev: parsed.abbrev, copyright: parsed.copyright, verses: parsed.verses.length, books: parsed.books };
  });
  handle('bible:install-pending', ({ name, abbrev, copyright, language }) => {
    if (!pendingBible) throw new Error('Nothing to import');
    const id = abbrev.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const r = bibles.install({ id, name, abbrev, copyright, language: language || 'en' }, pendingBible.verses);
    pendingBible = null;
    db.log('content', '', `Imported Bible "${name}" (${abbrev}): ${r.books} books, ${r.verses} verses`);
    return r;
  });

  ipcMain.on('output:send', (_e, payload) => {
    lastOutput = payload;
    for (const w of [win.output, win.stage]) if (w && !w.isDestroyed()) w.webContents.send('output:render', payload);
  });
}

/**
 * Shown when this version has failed to finish starting twice in a row and a rollback is possible.
 * It runs before any window opens, so it uses a native dialog rather than the operator UI.
 */
async function offerRecovery(boot) {
  const r = boot.rollback;
  const canReinstall = !!r.installer;
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'RG-Present did not start properly',
    message: `RG-Present ${r.from} has failed to start ${boot.unhealthyLaunches} times.`,
    detail: canReinstall
      ? `You can go back to version ${r.to}, which was working before the update. Your songs and settings from before the update will be restored too.`
      : `The installer for version ${r.to} is no longer on this computer, so the program itself cannot be put back automatically. Your songs and settings from before the update can still be restored.`,
    buttons: canReinstall ? [`Go back to ${r.to}`, 'Restore library only', 'Start anyway'] : ['Restore library', 'Start anyway'],
    defaultId: 0,
    cancelId: canReinstall ? 2 : 1,
    noLink: true,
  });
  const startAnyway = canReinstall ? response === 2 : response === 1;
  if (startAnyway) return;
  try {
    const done = updater.rollback();
    if (!done.reinstalled) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Library restored',
        message: `Your songs and settings from before the update have been restored.`,
        detail: `This computer is still running version ${r.from}. To go back to ${r.to}, run that installer again.`,
      });
    }
  } catch (e) {
    await dialog.showMessageBox({ type: 'error', title: 'Could not roll back', message: e.message });
  }
}

// ---------------- lifecycle ----------------

app.whenReady().then(async () => {
  store.ensureDirs();
  await db.open();
  await bibles.open();
  const installed = packs.installBundledPacks();
  for (const r of installed) console.log('[packs]', JSON.stringify(r));

  // RG-Present.exe --install-bible <file> [--abbrev NIV] : install a translation without opening the UI.
  const ib = process.argv.indexOf('--install-bible');
  if (ib > 0 && process.argv[ib + 1]) {
    try {
      const file = process.argv[ib + 1];
      const p = bibles.parseFile(file);
      const ab = process.argv.indexOf('--abbrev');
      const abbrev = ab > 0 ? process.argv[ab + 1] : p.abbrev;
      const r = bibles.install({ id: abbrev.toLowerCase(), name: p.name, abbrev, copyright: p.copyright, language: 'en' }, p.verses);
      db.log('content', '', `Installed Bible "${p.name}" (${abbrev}): ${r.books} books, ${r.verses} verses`);
      db.flushNow();
      console.log(`[bible] installed ${abbrev}: ${r.books} books, ${r.verses} verses`);
    } catch (e) {
      console.error('[bible] install failed:', e.message);
      process.exitCode = 1;
    }
    app.exit();
    return;
  }

  protocol.handle('rgmedia', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(paths.media, rel));
    if (!file.startsWith(path.normalize(paths.media))) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  registerIpc();
  nativeTheme.themeSource = 'dark';

  // How did the last update go, and did this version fail to start before?
  const boot = updater.startup();
  if (boot.unhealthyLaunches >= 2 && boot.rollback) await offerRecovery(boot);
  pendingUpdateOutcome = boot.outcome;

  createOperator();
  const s = store.loadSettings();
  if (s.outputEnabled) createPresentationWindow('output');
  if (s.stageEnabled) createPresentationWindow('stage');

  const onDisplays = () => {
    notifyOperator();
    // A projector plugged in or removed mid-service: move the output to wherever it now belongs.
    reopenPresentationWindows();
  };
  if (!app.isPackaged && process.env.RG_DEBUG_CAPTURE) debugCapture(process.env.RG_DEBUG_CAPTURE);
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
});

/** Dev aid: RG_DEBUG_CAPTURE=<dir> saves screenshots of every window a few seconds after start. */
function debugCapture(dir) {
  if (process.env.RG_DEBUG_JS) {
    setTimeout(() => win.operator.webContents.executeJavaScript(process.env.RG_DEBUG_JS).catch((e) => console.log('[debug-js]', e.message)), 3000);
  }
  setTimeout(async () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, w] of Object.entries(win)) {
      if (!w || w.isDestroyed()) continue;
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    }
    console.log('[capture] saved to', dir);
  }, parseInt(process.env.RG_DEBUG_DELAY || '6000', 10));
}

app.on('second-instance', () => {
  if (win.operator) {
    if (win.operator.isMinimized()) win.operator.restore();
    win.operator.focus();
  }
});

app.on('before-quit', () => db.flushNow());
app.on('window-all-closed', () => app.quit());
