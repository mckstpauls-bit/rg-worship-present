# RG-Present

Worship presentation software for Windows: an EasyWorship-style operator screen with a modern look.
Ships with **3,070 public-domain hymns** (English and Kimeru) and the **King James Version** of the Bible.
Works fully offline.

## Run it

```bash
npm install
npm run build-packs    # builds content/*.rgpkg from content-src/
npm start
```

Build the installer (`dist/RG-Present-Setup-<version>.exe`):

```bash
npm run dist
```

## Using it

| Key | Action |
| --- | --- |
| → / Space / PgDn | Next slide (moves on to the next service item at the end) |
| ← / PgUp | Previous slide |
| Enter | Send preview to live |
| 1–9 | Jump to that verse |
| R | Jump to the chorus |
| B / . | Black screen |
| C | Clear text (keep background) |
| L | Logo screen |
| Esc | Remove black/clear/logo |
| Ctrl+F / Ctrl+S / Ctrl+O / Ctrl+N | Search / save / open / new service |

- Double-click a song, or drag it into the Service panel. Click an item to preview it; double-click to go live.
- Songs that exist in both English and Kimeru show an **EN / KIM** switch in Preview.
- The audience output goes to the first non-primary screen (change it in Settings). With one screen it
  opens as a window and moves to the projector automatically when one is connected.
- **Stage** opens a musician-facing display: current slide, next slide, clock.
- The current service autosaves on every change and comes back after a crash or power cut.

## What's in the library

| Pack | Songs |
| --- | --- |
| The Open Hymnal (2014.06) | 292 curated classics with verse/chorus structure |
| The Christian Hymn Book (1870) | 1,324 |
| Wesleyan Methodist Hymn Book (1869) | 773 |
| The Otterbein Hymnal (1890) | 545 |
| Iuku ria Rwimbo (Kimeru) | 132 hymns + 4 liturgy texts |

All are public domain. Sources are kept in `content-src/*/source/` with the converter that produced them
in `tools/`, so any pack can be rebuilt or corrected.

## Scripture

The **Scripture** tab has a book/chapter browser, a reference box and a whole-Bible word search.

- References understood: `John 3:16-18`, `jn 3 16`, `Ps 23`, `1 Cor 13:4-7`, `Rom 8:28-9:2`, `II Kings 2:11`.
- Click a verse to select it, Shift+click for a range, then **Add to service** (or press Enter in the box).
- Passages split into slides on whole verses; the reference is always shown on screen.
- Switch a passage between translations from the Preview panel.

### Adding another translation

RG-Present ships only with the public-domain KJV. Add translations your church is licensed to use:

- **In the app**: Settings → *Import Bible…*, or the **+** next to the translation list in the Scripture tab.
- **From the command line** (useful for setting up several machines):

```bash
RG-Present.exe --install-bible "C:\path\to\bible.json" --abbrev NIV
```

Accepted formats: Zefania XML, OpenSong XML, OSIS XML, CSV (`book,chapter,verse,text`) and JSON.
`tools/convert-niv-pdf-text.js` converts a text-based Bible PDF that has been run through `pypdf`,
checking the result chapter by chapter against the KJV's verse counts.

## Keeping every computer up to date

RG-Present updates itself from **one folder you control** — a web address, or a share such as
`\church-servergpresent`. Nothing is contacted unless you set a source.

**Publish an update** from the development machine:

```bash
npm run dist                         # build the installer
npm run build-packs                  # rebuild content/*.rgpkg
npm run make-feed -- "\church-servergpresent" --notes "Fixed hymn 212, added 3 Kimeru hymns"
```

That copies the installer and every pack into the folder and writes `updates.json` with SHA-256
checksums. Pass `--no-app` to publish only content.

**On each church computer**, once: Settings → Updates → paste the folder or URL. After that:

- RG-Present checks quietly a few seconds after it starts (switch off with the checkbox).
- Settings → Updates → **Check now** shows what is waiting, with release notes.
- A program update downloads with a progress bar; **Install and restart** does the rest.
- Song, theme and Bible pack updates install straight away — no restart, and **songs you have edited in
  the app are never overwritten**.

### If an update goes wrong

- Every download is verified against its checksum before anything is run or installed.
- The library, Bibles and settings are backed up before a program update is applied.
- If the new version fails to finish starting twice in a row, the next launch offers to put the previous
  version back and restore that backup. The same rollback is in Settings → Updates.
- An install that fails or is cancelled is reported on the next start, and the working version keeps running.

The feed format, if you prefer to write it by hand:

```json
{
  "feedVersion": 1,
  "app":   { "version": "1.2.0", "file": "RG-Present-Setup-1.2.0.exe",
             "sha256": "…", "size": 121405722, "notes": "What changed", "minVersion": "1.0.0" },
  "packs": [ { "id": "open-hymnal-2014", "name": "The Open Hymnal", "version": "1.1.0",
               "file": "open-hymnal-2014.rgpkg", "sha256": "…", "notes": "12 hymns corrected" } ]
}
```

`file` is a name next to `updates.json`, or a full URL.

## Updating content without a new app release

Content lives in **content packs** (`.rgpkg`, a zip), kept apart from the program:

```
manifest.json   { "id", "name", "version", "language", "folder" }
songs.json      [ { "key", "number", "title", "alt_title", "author", "sections": [{ "type", "label", "text" }] } ]
bibles/*.json   Bible translations
themes/*.json   slide themes
media/*         backgrounds, logos
CHANGELOG.md
```

- **In the app**: Settings → *Install / update pack…*, or **Import** for TXT, CSV, Word (.docx) or text
  PowerPoints. Re-importing a file with the same hymn numbers into the same folder updates those songs
  (use this to fix typos).
- **Shipped packs**: edit `content-src/…`, bump `version` in its `manifest.json`, run `npm run build-packs`.
  Installed copies upgrade automatically on next start. **Songs edited inside the app are never overwritten
  by a pack update.**
- Kimeru hymns use the text format in `content-src/kimeru-hymns/iuku-ria-rwimbo.txt`:
  `### 12. English title`, then `[Verse 1]`, `[Chorus]` sections. `@link hymn:…` ties a hymn to its English
  version; `@title` overrides the displayed title.

## Versions

App version (`package.json`), database schema (`MIGRATIONS` in `src/main/db.js`) and each content pack are
versioned independently. All three are shown in Settings with a change log. The library is backed up before
any schema upgrade (`%APPDATA%/RG-Present/data/backups`).

## Where things are

| Path | What |
| --- | --- |
| `src/main/` | Electron main process: windows, song database, Bible database, packs, importers |
| `src/renderer/operator/` | Operator UI |
| `src/renderer/output/`, `stage/` | Audience output and stage display |
| `src/renderer/shared/` | Lyrics model, Bible model and slide renderer used by every screen |
| `content-src/` | Source for the bundled content packs |
| `src/main/updater.js` | Update feed, downloads, checksums, rollback |
| `tools/` | Converters for each hymnal and Bible, `make-icons.js`, `make-update-feed.js` |
| `build/icon.svg` | App icon source (`npm run make-icons` rebuilds `icon.ico`/`icon.png`) |
| `%APPDATA%/RG-Present/data` | Library database, Bibles, media, settings, autosave |

## Not built yet

Browser panel with region sharing, phone/tablet remote.
