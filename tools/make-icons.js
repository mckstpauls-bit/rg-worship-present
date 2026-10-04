#!/usr/bin/env node
/*
 * Renders build/icon.svg into the icons the installer and windows need:
 *   build/icon.ico   (16-256px, PNG-compressed entries — Windows Vista and later)
 *   build/icon.png   (512px, used by electron-builder and the About box)
 *
 *   npx electron tools/make-icons.js
 *
 * Electron does the rendering, so there is no image toolchain to install.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

let win = null;

async function shot(svg, size) {
  // One window, resized per icon: creating a fresh offscreen window per size fails after the first.
  if (!win) {
    win = new BrowserWindow({
      width: size, height: size, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', useContentSize: true, webPreferences: { offscreen: true },
    });
  }
  win.setContentSize(size, size);
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
  // A file is used rather than a data: URL — long data URLs fail to load.
  const tmp = path.join(app.getPath('temp'), `rg-icon-${size}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 200));
  const img = await win.webContents.capturePage();
  fs.rmSync(tmp, { force: true });
  return img.toPNG();
}

/** ICO directory + PNG-compressed entries. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o); // 0 means 256
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
  const entries = [];
  for (const size of SIZES) entries.push({ size, png: await shot(svg, size) });
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(entries));
  fs.writeFileSync(path.join(BUILD, 'icon.png'), await shot(svg, 512));
  console.log(`build/icon.ico (${SIZES.join(', ')}px) and build/icon.png written`);
  app.exit(0);
});
