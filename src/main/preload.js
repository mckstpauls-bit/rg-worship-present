// Bridge between pages and the main process. Only the channels listed here are reachable.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'app:info', 'app:changelog', 'app:open-data-folder',
  'settings:get', 'settings:set', 'displays:list', 'windows:state',
  'songs:search', 'songs:get', 'songs:linked', 'songs:save', 'songs:delete', 'songs:folders',
  'themes:list', 'themes:save', 'themes:delete',
  'media:list', 'media:import', 'media:delete',
  'service:autosave', 'service:load-autosave', 'services:list', 'services:save', 'services:get', 'services:delete',
  'packs:list', 'packs:import', 'packs:export',
  'import:pick', 'import:parse', 'import:commit',
  'updates:status', 'updates:check', 'updates:download-app', 'updates:apply-app', 'updates:cancel',
  'updates:install-pack', 'updates:rollback',
  'bible:list', 'bible:structure', 'bible:chapter', 'bible:passage', 'bible:search', 'bible:remove', 'bible:pick', 'bible:install-pending',
]);
const EVENTS = new Set(['output:render', 'windows:state', 'updates:progress', 'updates:outcome', 'content:changed']);

contextBridge.exposeInMainWorld('rg', {
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error(`Blocked IPC event: ${channel}`);
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
  sendOutput(payload) {
    ipcRenderer.send('output:send', payload);
  },
});
