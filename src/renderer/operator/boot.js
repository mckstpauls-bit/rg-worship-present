/* Startup: load settings and themes, restore the last service, wire up toolbar actions. */
(async function () {
  const { $, $$ } = App;
  const rg = window.rg;

  App.settings = await rg.invoke('settings:get');
  document.documentElement.dataset.theme = App.settings.uiTheme || 'dark';
  RGIcons.hydrate();
  await App.loadThemes();
  App.initCore();
  Library.init();
  await Scripture.init();
  await Library.loadFolders();
  await Library.search();

  const actions = {
    'service-new': () => App.newService(),
    'service-open': () => Dialogs.openService(),
    'service-save': () => App.saveService(),
    'import-hymns': () => Dialogs.importHymns(),
    themes: () => Dialogs.themes(),
    settings: () => Dialogs.settings(),
    'toggle-output': async () => { App.settings = await rg.invoke('settings:set', { outputEnabled: !$('#btnOutput').classList.contains('on') }); },
    'toggle-stage': async () => { App.settings = await rg.invoke('settings:set', { stageEnabled: !$('#btnStage').classList.contains('on') }); },
    'ui-theme': async () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      App.settings = await rg.invoke('settings:set', { uiTheme: t });
    },
    'add-custom': () => Dialogs.editCustom(),
    'add-media': () => Dialogs.addMedia(),
    'add-countdown': () => Dialogs.editCountdown(),
    'edit-preview': () => Dialogs.editPreview(),
    'go-live': () => App.goLive(),
    prev: () => App.prev(),
    next: () => App.next(),
    'cover-black': () => App.setCover('black'),
    'cover-clear': () => App.setCover('clear'),
    'cover-logo': () => App.setCover('logo'),
    auto: () => App.toggleAuto(),
    'new-song': () => Dialogs.editSong(null),
    'bible-import': () => Dialogs.importBible(),
    'media-import': async () => { await rg.invoke('media:import'); Library.loadMedia(); },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (b && actions[b.dataset.action]) actions[b.dataset.action]();
  });

  $('#serviceName').addEventListener('click', async () => {
    const name = await App.prompt('Rename service', 'Service name', App.service.name);
    if (name) { App.service.name = name; App.markDirty(); }
  });

  rg.on('updates:outcome', (o) => {
    if (o.kind === 'updated') App.toast(`Updated to RG-Present ${o.to}`);
    else App.toast(`The update to ${o.to} did not finish — still running ${o.from}`, true);
  });
  rg.on('content:changed', () => { App.loadThemes(); Library.refresh(); });

  rg.on('windows:state', App.setWindowsState);
  App.setWindowsState(await rg.invoke('windows:state'));

  // Crash / power-cut recovery: the service is autosaved on every change.
  const saved = await rg.invoke('service:load-autosave');
  if (saved && saved.service && saved.service.items && saved.service.items.length) {
    App.service = saved.service;
    App.dirty = !!saved.dirty;
    App.renderSchedule();
    App.setPreview(App.service.items[0], 0, 0);
    App.toast(`Restored “${App.service.name}” (${App.service.items.length} items)`);
  } else App.renderSchedule();
  App.renderServiceName();

  // Last, so a slow or unreachable update server never delays the operator screen.
  setTimeout(() => Dialogs.autoCheckUpdates(), 2500);
})().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 20px 20px;padding:12px;background:#400;color:#fff;z-index:99">${String(e && e.stack || e)}</pre>`);
});
