/* Modal dialogs: song editor, text slide, themes, settings, import, open service. */
(function () {
  const { $, $$ } = App;
  const rg = window.rg;
  const L = window.RGLyrics;
  const esc = App.esc;

  const Dialogs = {};
  window.Dialogs = Dialogs;

  function modal({ title, body, footer, narrow, onClose }) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal ${narrow ? 'narrow' : ''}" role="dialog" aria-label="${esc(title)}">
      <header><h3>${esc(title)}</h3><button class="mini" data-close title="Close (Esc)"><i data-icon="x"></i></button></header>
      <div class="body">${body}</div>
      ${footer ? `<footer>${footer}</footer>` : ''}</div>`;
    const m = root.firstElementChild;
    RGIcons.hydrate(m);
    const close = () => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('[data-close]').onclick = close;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    return { m, close, q: (s) => m.querySelector(s), qa: (s) => [...m.querySelectorAll(s)] };
  }

  App.prompt = (title, label, value) => new Promise((resolve) => {
    let done = false;
    const d = modal({
      title, narrow: true,
      body: `<label class="field full"><span>${esc(label)}</span><input id="pv" value="${esc(value || '')}"></label>`,
      footer: '<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>OK</button>',
      onClose: () => { if (!done) resolve(null); },
    });
    const input = d.q('#pv');
    input.focus();
    input.select();
    const ok = () => { done = true; const v = input.value.trim(); d.close(); resolve(v || null); };
    d.q('[data-ok]').onclick = ok;
    d.q('[data-cancel]').onclick = () => d.close();
    input.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  });

  function themeOptions(selected, includeDefault) {
    const opts = [...App.themes.values()].map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    return (includeDefault ? `<option value="">Default theme</option>` : '') + opts;
  }

  function slidePreview(d, getSong, getThemeId) {
    const mon = RGRender.createStage(d.q('#edMonitor'), { noTransitions: true });
    const grid = d.q('#edSlides');
    let sel = 0;
    const draw = () => {
      const song = getSong();
      const slides = L.buildSlides(song, { maxLines: App.settings.maxLinesPerSlide, autoChorus: App.settings.autoChorus });
      const r = { kind: 'song', title: song.title, number: song.number, author: song.author, slides, theme: App.themeFor(getThemeId()) };
      sel = Math.min(sel, Math.max(0, slides.length - 1));
      mon.show(App.payload(r, sel, { transition: { type: 'cut' } }));
      grid.innerHTML = slides.map((s, i) => `<button class="slide-card ${i === sel ? 'sel' : ''}" data-i="${i}"><div class="cap"><span class="k">${esc(s.code)}</span><span>${esc(s.label)}</span></div></button>`).join('');
      grid.querySelectorAll('.slide-card').forEach((b) => (b.onclick = () => { sel = +b.dataset.i; draw(); }));
    };
    return draw;
  }

  // ---------- song editor ----------
  Dialogs.editSong = async (song) => {
    const s = song || { title: '', sections: [], folder: window.Library && Library.folder ? Library.folder : 'Songs', language: '' };
    const folders = (await rg.invoke('songs:folders')).map((f) => f.folder);
    const isPack = !!s.pack_id;
    const d = modal({
      title: song ? 'Edit song' : 'New song',
      body: `<div class="split-2">
        <div class="form-grid">
          <label class="field full"><span>Title</span><input id="fTitle" value="${esc(s.title)}"></label>
          <label class="field"><span>Also known as / English title</span><input id="fAlt" value="${esc(s.alt_title || '')}"></label>
          <label class="field"><span>Number</span><input id="fNumber" value="${esc(s.number || '')}"></label>
          <label class="field"><span>Author</span><input id="fAuthor" value="${esc(s.author || '')}"></label>
          <label class="field"><span>Copyright</span><input id="fCopy" value="${esc(s.copyright || '')}"></label>
          <label class="field"><span>Folder</span><input id="fFolder" list="folderList" value="${esc(s.folder || 'Songs')}"><datalist id="folderList">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist></label>
          <label class="field"><span>Language</span><input id="fLang" list="langList" value="${esc(s.language || '')}" placeholder="en, mer (Kimeru), sw…"><datalist id="langList"><option value="en"><option value="mer"><option value="sw"></datalist></label>
          <label class="field"><span>Order</span><input id="fSeq" value="${esc(s.sequence || '')}" placeholder="e.g. V1 C V2 C B C (blank = automatic)"></label>
          <label class="field"><span>Theme</span><select id="fTheme">${themeOptions(s.theme_id, true)}</select></label>
          <label class="field"><span>Translation link</span><input id="fLink" value="${esc(s.link_key || '')}" placeholder="same key on the English and Kimeru song"><small>Songs sharing this key get the EN/KIM switch in Preview.</small></label>
          <label class="field full"><span>Lyrics</span><textarea id="fLyrics" rows="16" spellcheck="false">${esc(L.sectionsToText(s.sections))}</textarea>
            <small>Start sections with [Verse 1], [Chorus], [Bridge]… A blank line inside a section starts a new slide. Untagged stanzas become verses.</small></label>
        </div>
        <div class="editor-preview"><div class="monitor" id="edMonitor"></div><div class="slides" id="edSlides"></div>
          ${isPack ? '<div class="notice">This song came from a content pack. Your edits are kept when the pack is updated.</div>' : ''}
          ${(s.tags || []).includes('proofread') ? '<div class="notice warn">Marked for proofreading: the scan this hymn came from was hard to read. Remove the tag by saving after you have checked it.</div>' : ''}
        </div></div>`,
      footer: `<div class="left">${song ? '<button class="btn danger" data-del><i data-icon="trash"></i>Delete</button>' : ''}</div>
        ${song ? '<button class="btn" data-copy>Save as new</button>' : ''}<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Save</button>`,
    });
    const read = () => ({
      ...s,
      title: d.q('#fTitle').value.trim(),
      alt_title: d.q('#fAlt').value.trim() || null,
      number: d.q('#fNumber').value.trim() || null,
      author: d.q('#fAuthor').value.trim() || null,
      copyright: d.q('#fCopy').value.trim() || null,
      folder: d.q('#fFolder').value.trim() || 'Songs',
      language: d.q('#fLang').value.trim() || null,
      sequence: d.q('#fSeq').value.trim() || null,
      theme_id: d.q('#fTheme').value || null,
      link_key: d.q('#fLink').value.trim() || null,
      sections: L.textToSections(d.q('#fLyrics').value, { chorusWords: App.settings.chorusWords }),
      tags: (s.tags || []).filter((t) => t !== 'proofread'),
    });
    const draw = slidePreview(d, read, () => d.q('#fTheme').value);
    let t;
    d.m.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 150); });
    draw();
    d.q('#fTitle').focus();
    const save = async (asNew) => {
      const data = read();
      if (!data.title) return App.toast('Give the song a title', true);
      if (!data.sections.length) return App.toast('Add some lyrics', true);
      if (asNew) { delete data.id; delete data.uid; delete data.pack_id; }
      const saved = await rg.invoke('songs:save', data);
      App.songCache.set(saved.id, saved);
      d.close();
      App.toast('Song saved');
      await Library.refresh();
      await App.refreshPreview();
    };
    d.q('[data-save]').onclick = () => save(false);
    d.q('[data-cancel]').onclick = () => d.close();
    if (song) {
      d.q('[data-copy]').onclick = () => save(true);
      d.q('[data-del]').onclick = async () => {
        if (!confirm(`Delete “${song.title}” from the library?`)) return;
        await rg.invoke('songs:delete', song.id);
        d.close();
        Library.refresh();
      };
    }
  };

  // ---------- text / announcement slide ----------
  Dialogs.editCustom = (item) => {
    const it = item || { type: 'custom', title: 'Announcement', text: '', themeId: '' };
    const d = modal({
      title: item ? 'Edit text slide' : 'New text slide',
      body: `<div class="split-2"><div class="form-grid">
          <label class="field full"><span>Title (operator only)</span><input id="cTitle" value="${esc(it.title)}"></label>
          <label class="field full"><span>Theme</span><select id="cTheme">${themeOptions(it.themeId, true)}</select></label>
          <label class="field full"><span>Text</span><textarea id="cText" rows="14">${esc(it.text)}</textarea><small>Each blank-line-separated block is one slide. Use [Slide name] to label slides.</small></label>
        </div><div class="editor-preview"><div class="monitor" id="edMonitor"></div><div class="slides" id="edSlides"></div></div></div>`,
      footer: '<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>' + (item ? 'Save' : 'Add to service') + '</button>',
    });
    const read = () => ({ title: d.q('#cTitle').value, sections: L.textToSections(d.q('#cText').value) });
    const draw = slidePreview(d, read, () => d.q('#cTheme').value);
    d.m.addEventListener('input', draw);
    draw();
    d.q('#cText').focus();
    d.q('[data-cancel]').onclick = () => d.close();
    d.q('[data-save]').onclick = () => {
      it.title = d.q('#cTitle').value.trim() || 'Text slide';
      it.text = d.q('#cText').value;
      it.themeId = d.q('#cTheme').value || null;
      d.close();
      if (item) {
        App.markDirty();
        App.renderSchedule();
        App.refreshPreview();
      } else {
        const added = App.addItem(it);
        App.setPreview(added, App.service.items.indexOf(added), 0);
      }
    };
  };

  Dialogs.editPreview = () => {
    const p = App.preview;
    if (!p) return;
    if (p.item.type === 'song' && p.r.song) Dialogs.editSong(p.r.song);
    else if (p.item.type === 'custom') Dialogs.editCustom(p.item);
    else if (p.item.type === 'countdown') Dialogs.editCountdown(p.item);
  };

  // ---------- media picker ----------
  Dialogs.addMedia = async () => {
    const items = await rg.invoke('media:list');
    const d = modal({
      title: 'Add image or video',
      body: `<div class="media-bar" style="padding:0 0 10px"><button class="btn" data-import><i data-icon="plus"></i>Add files…</button></div>
        <div class="media-grid" style="padding:0">${items.map((m, i) => `<div class="media-card" data-i="${i}" style="cursor:pointer">${m.type === 'video' ? `<video class="thumb" src="${RGRender.mediaUrl(m.rel_path)}" muted preload="metadata"></video>` : `<img class="thumb" src="${RGRender.mediaUrl(m.rel_path)}">`}<div class="cap">${esc(m.name)}</div></div>`).join('') || '<p class="muted">No media yet.</p>'}</div>`,
    });
    d.qa('.media-card').forEach((c) => (c.onclick = () => { App.addMediaItem(items[+c.dataset.i]); d.close(); }));
    d.q('[data-import]').onclick = async () => {
      const added = await rg.invoke('media:import');
      d.close();
      if (added.length) Dialogs.addMedia();
    };
  };

  // ---------- themes ----------
  Dialogs.themes = async () => {
    await App.loadThemes();
    const media = await rg.invoke('media:list');
    let cur = App.themes.get(App.settings.defaultThemeId) || App.themes.values().next().value;
    const d = modal({
      title: 'Themes',
      body: `<div class="theme-layout"><div class="theme-list" id="tList"></div><div class="form-grid" id="tForm"></div>
        <div class="editor-preview"><div class="monitor" id="edMonitor"></div>
        <label class="field"><span>Preview text</span><textarea id="tSample" rows="4">Great is Thy faithfulness, O God my Father,\nThere is no shadow of turning with Thee</textarea></label></div></div>`,
      footer: `<div class="left"><button class="btn" data-dup>Duplicate</button><button class="btn danger" data-del>Delete</button></div>
        <button class="btn" data-default>Use as default</button><button class="btn primary" data-save>Save theme</button>`,
    });
    const mon = RGRender.createStage(d.q('#edMonitor'), { noTransitions: true });
    const draw = () => {
      const t = read();
      mon.show({ mode: 'slide', text: d.q('#tSample').value, theme: t, item: { kind: 'song', title: 'Sample Hymn', number: '12' }, fontFallback: App.settings.fontFallback, transition: { type: 'cut' } });
    };
    const list = () => {
      d.q('#tList').innerHTML = [...App.themes.values()].map((t) => `<button class="theme-item ${cur && t.id === cur.id ? 'active' : ''}" data-id="${esc(t.id)}"><span class="sw" style="background:${t.background && t.background.type !== 'image' && t.background.type !== 'video' ? esc(t.background.value) : '#333'}"></span><span>${esc(t.name)}</span>${t.id === App.settings.defaultThemeId ? '<span class="badge">default</span>' : ''}</button>`).join('');
      d.qa('.theme-item').forEach((b) => (b.onclick = () => { cur = App.themes.get(b.dataset.id); form(); list(); }));
    };
    const mediaOpts = (type, value) => media.filter((m) => m.type === type).map((m) => `<option value="${esc(m.rel_path)}" ${m.rel_path === value ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    const form = () => {
      const t = cur || {};
      const b = t.background || { type: 'color', value: '#000000' };
      const f = t.font || {};
      const box = t.box || { x: 7, y: 9, w: 86, h: 74 };
      const ft = t.footer || {};
      d.q('#tForm').innerHTML = `
        <label class="field full"><span>Name</span><input data-k="name" value="${esc(t.name || '')}"></label>
        <label class="field"><span>Background</span><select data-k="bgType">${['color', 'gradient', 'image', 'video'].map((x) => `<option ${b.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field" ${b.type === 'color' ? '' : 'hidden'}><span>Colour</span><input type="color" data-k="bgColor" value="${/^#[0-9a-f]{6}$/i.test(b.value) ? b.value : '#000000'}"></label>
        <label class="field" ${b.type === 'gradient' ? '' : 'hidden'}><span>CSS gradient</span><input data-k="bgGradient" value="${esc(b.type === 'gradient' ? b.value : 'linear-gradient(160deg, #1b2a4e, #070b16)')}"></label>
        <label class="field" ${b.type === 'image' ? '' : 'hidden'}><span>Image</span><select data-k="bgImage"><option value="">Choose…</option>${mediaOpts('image', b.value)}</select></label>
        <label class="field" ${b.type === 'video' ? '' : 'hidden'}><span>Looping video</span><select data-k="bgVideo"><option value="">Choose…</option>${mediaOpts('video', b.value)}</select></label>
        <label class="field"><span>Darken background</span><input type="range" min="0" max="85" data-k="overlay" value="${Math.round(parseFloat(((t.overlay || '').match(/[\d.]+\)$/) || ['0'])[0]) * 100)}"></label>
        <label class="field"><span>Font</span><input data-k="family" list="fontList" value="${esc(f.family || 'Segoe UI')}"><datalist id="fontList">${['Segoe UI', 'Segoe UI Semibold', 'Calibri', 'Cambria', 'Georgia', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Bahnschrift', 'Candara', 'Constantia', 'Corbel', 'Palatino Linotype', 'Times New Roman'].map((x) => `<option value="${x}">`).join('')}</datalist></label>
        <label class="field"><span>Weight</span><select data-k="weight">${[400, 500, 600, 700, 800].map((w) => `<option ${+f.weight === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        <label class="field"><span>Text colour</span><input type="color" data-k="color" value="${f.color && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#ffffff'}"></label>
        <label class="field"><span>Largest size (px)</span><input type="number" data-k="maxSize" value="${f.maxSize || 92}"></label>
        <label class="field"><span>Smallest size (px)</span><input type="number" data-k="minSize" value="${f.minSize || 30}"></label>
        <label class="field"><span>Line spacing</span><input type="number" step="0.05" data-k="lineHeight" value="${f.lineHeight || 1.25}"></label>
        <label class="field"><span>Horizontal</span><select data-k="align">${['left', 'center', 'right'].map((x) => `<option ${(t.align || 'center') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field"><span>Vertical</span><select data-k="valign">${['top', 'middle', 'bottom'].map((x) => `<option ${(t.valign || 'middle') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field check"><input type="checkbox" data-k="shadow" ${f.shadow ? 'checked' : ''}> Text shadow</label>
        <label class="field check"><input type="checkbox" data-k="uppercase" ${f.uppercase ? 'checked' : ''}> UPPERCASE</label>
        <label class="field"><span>Text box left / top (%)</span><span style="display:flex;gap:6px"><input type="number" data-k="bx" value="${box.x}"><input type="number" data-k="by" value="${box.y}"></span></label>
        <label class="field"><span>Text box width / height (%)</span><span style="display:flex;gap:6px"><input type="number" data-k="bw" value="${box.w}"><input type="number" data-k="bh" value="${box.h}"></span></label>
        <label class="field check"><input type="checkbox" data-k="footer" ${ft.show ? 'checked' : ''}> Show song title footer</label>
        <label class="field"><span>Footer text</span><input data-k="footerTpl" value="${esc(ft.template || '{number} {title}')}"><small>{number} {title} {author} {copyright}</small></label>`;
      d.q('[data-k="bgType"]').onchange = () => { cur = read(); cur.background.type = d.q('[data-k="bgType"]').value; form(); };
      draw();
    };
    const v = (k) => d.q(`[data-k="${k}"]`);
    const read = () => {
      const t = cur || {};
      const type = v('bgType').value;
      const value = { color: v('bgColor').value, gradient: v('bgGradient').value, image: v('bgImage').value, video: v('bgVideo').value }[type];
      const dark = (+v('overlay').value || 0) / 100;
      return {
        ...t,
        name: v('name').value.trim() || 'Untitled theme',
        background: { type, value },
        overlay: dark ? `rgba(0,0,0,${dark})` : '',
        font: { ...(t.font || {}), family: v('family').value.trim(), weight: +v('weight').value, color: v('color').value, maxSize: +v('maxSize').value || 92, minSize: +v('minSize').value || 28, lineHeight: +v('lineHeight').value || 1.25, shadow: v('shadow').checked, uppercase: v('uppercase').checked },
        align: v('align').value,
        valign: v('valign').value,
        box: { x: +v('bx').value, y: +v('by').value, w: +v('bw').value, h: +v('bh').value },
        footer: { ...(t.footer || {}), show: v('footer').checked, template: v('footerTpl').value },
      };
    };
    d.m.addEventListener('input', () => draw());
    d.m.addEventListener('change', () => draw());
    list();
    form();
    const persist = async (t) => {
      const id = await rg.invoke('themes:save', t);
      await App.loadThemes();
      cur = App.themes.get(id);
      list();
      form();
      App.refreshPreview();
      return id;
    };
    d.q('[data-save]').onclick = async () => { await persist(read()); App.toast('Theme saved'); };
    d.q('[data-dup]').onclick = async () => { const t = read(); delete t.id; delete t.pack_id; t.name += ' copy'; await persist(t); };
    d.q('[data-default]').onclick = async () => {
      const id = await persist(read());
      App.settings = await rg.invoke('settings:set', { defaultThemeId: id });
      list();
      App.refreshPreview();
      App.toast('Default theme set');
    };
    d.q('[data-del]').onclick = async () => {
      if (!cur || !confirm(`Delete theme “${cur.name}”?`)) return;
      await rg.invoke('themes:delete', cur.id);
      await App.loadThemes();
      cur = App.themes.values().next().value;
      list();
      form();
    };
  };

  // ---------- settings ----------
  Dialogs.settings = async () => {
    const s = App.settings;
    const [displays, info, changelog, media, bibleList] = await Promise.all([rg.invoke('displays:list'), rg.invoke('app:info'), rg.invoke('app:changelog'), rg.invoke('media:list'), rg.invoke('bible:list')]);
    const dispOpts = (sel) => `<option value="">Automatic (first non-primary screen)</option>` + displays.map((x) => `<option value="${x.id}" ${String(sel) === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    const d = modal({
      title: 'Settings',
      body: `<div class="split-2"><div>
        <div class="section-title">Screens</div>
        <div class="form-grid">
          <label class="field full"><span>Audience output screen</span><select data-k="outputDisplayId">${dispOpts(s.outputDisplayId)}</select>
            <small>${displays.length > 1 ? `${displays.length} screens detected.` : 'Only one screen detected: the output opens in a window. Connect the projector/TV and it moves there automatically.'}</small></label>
          <label class="field full"><span>Stage display screen</span><select data-k="stageDisplayId">${dispOpts(s.stageDisplayId)}</select></label>
        </div>
        <div class="section-title">Slides</div>
        <div class="form-grid">
          <label class="field"><span>Default transition</span><select data-k="transitionType"><option value="fade" ${s.transition.type !== 'cut' ? 'selected' : ''}>Fade</option><option value="cut" ${s.transition.type === 'cut' ? 'selected' : ''}>Cut</option></select></label>
          <label class="field"><span>Fade length (ms)</span><input type="number" min="100" max="3000" step="50" data-k="transitionMs" value="${s.transition.ms}"></label>
          <label class="field"><span>Max lines per slide</span><input type="number" min="0" max="16" data-k="maxLinesPerSlide" value="${s.maxLinesPerSlide}"><small>Longer verses are split. 0 = never split.</small></label>
          <label class="field check" style="align-self:center"><input type="checkbox" data-k="autoChorus" ${s.autoChorus ? 'checked' : ''}> Repeat the chorus after every verse</label>
          <label class="field full"><span>Logo screen</span><select data-k="logoMedia">${media.filter((m) => m.type === 'image' || m.type === 'video').map((m) => `<option value="${esc(m.rel_path)}" ${m.rel_path === s.logoMedia ? 'selected' : ''}>${esc(m.name)} (${esc(m.folder)})</option>`).join('')}</select><small>Add your church logo under Library → Media, then pick it here.</small></label>
        </div>
        <div class="section-title">Scripture</div>
        <div class="form-grid">
          <label class="field"><span>Default Bible</span><select data-k="defaultBibleId">${bibleList.map((b) => `<option value="${esc(b.id)}" ${b.id === s.defaultBibleId ? 'selected' : ''}>${esc(b.abbrev)} — ${esc(b.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Scripture theme</span><select data-k="scriptureThemeId">${themeOptions(s.scriptureThemeId, true)}</select></label>
          <label class="field"><span>Text per slide (characters)</span><input type="number" min="80" max="1200" step="20" data-k="scriptureMaxChars" value="${s.scriptureMaxChars}"><small>Whole verses stay together.</small></label>
          <label class="field check"><input type="checkbox" data-k="scriptureVerseNumbers" ${s.scriptureVerseNumbers ? 'checked' : ''}> Show verse numbers</label>
        </div>
        <div class="section-title">Language</div>
        <div class="form-grid">
          <label class="field full"><span>Fallback fonts (for Kimeru ĩ ũ and other letters)</span><input data-k="fontFallback" value="${esc(s.fontFallback)}"></label>
          <label class="field full"><span>Extra words that mean “chorus” when importing</span><input data-k="chorusWords" value="${esc((s.chorusWords || []).join(', '))}" placeholder="e.g. Kiitiko, Korasi"></label>
        </div>
      </div><div>
        <div class="section-title">Versions</div>
        <dl class="kv"><dt>RG-Present</dt><dd>${esc(info.appVersion)}</dd><dt>Database schema</dt><dd>v${info.schemaVersion}</dd><dt>Data folder</dt><dd><a href="#" data-open-data>${esc(info.dataDir)}</a></dd></dl>
        <div class="about-card">
          <div class="about-mark"><i data-icon="package"></i></div>
          <div><b>Created by ${esc(info.publisher || 'RG DEV Industries')}</b>
          <div class="muted">Support and feedback: <a href="#" data-mail>${esc(info.contactEmail || '')}</a></div></div>
        </div>
        <div class="section-title">Content packs</div>
        ${info.packs.map((p) => `<div class="pack-row"><i data-icon="package"></i><b>${esc(p.name)}</b><span class="muted">v${esc(p.version)}</span></div>`).join('')}
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn small" data-pack-import><i data-icon="package"></i>Install / update pack…</button><button class="btn small" data-pack-export>Export songs as pack…</button></div>
        <div class="section-title">Bibles</div>
        ${bibleList.map((b) => `<div class="pack-row"><i data-icon="book"></i><b>${esc(b.abbrev)} — ${esc(b.name)}</b><span class="muted">${b.verses.toLocaleString()} verses</span><button class="mini" data-rm-bible="${esc(b.id)}" title="Remove"><i data-icon="trash"></i></button></div>`).join('') || '<p class="muted">None installed.</p>'}
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn small" data-bible-import><i data-icon="book"></i>Import Bible...</button></div>
        <div class="section-title">Updates</div>
        <div class="pack-row"><i data-icon="import"></i><b>Update source</b><span class="muted">${s.updateFeedUrl ? esc(s.updateFeedUrl) : 'not set'}</span></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn small" data-updates><i data-icon="import"></i>Check for updates…</button></div>
        <div class="section-title">Change log</div>
        <div class="log">${changelog.entries.map((e) => `<div><span class="muted">${new Date(e.at).toLocaleString()} · ${esc(e.scope)}</span><br>${esc(e.message)}</div>`).join('') || '<span class="muted">Nothing yet.</span>'}</div>
      </div></div>`,
      footer: '<button class="btn" data-cancel>Close</button><button class="btn primary" data-save>Save settings</button>',
    });
    const v = (k) => d.q(`[data-k="${k}"]`);
    d.q('[data-open-data]').onclick = (e) => { e.preventDefault(); rg.invoke('app:open-data-folder'); };
    d.q('[data-mail]').onclick = (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(info.contactEmail || '').then(() => App.toast('Email address copied'), () => {});
    };
    d.q('[data-cancel]').onclick = () => d.close();
    d.q('[data-pack-import]').onclick = () => { d.close(); Dialogs.installPack(); };
    d.q('[data-bible-import]').onclick = () => { d.close(); Dialogs.importBible(); };
    d.q('[data-updates]').onclick = () => { d.close(); Dialogs.updates({ checkNow: true }); };
    d.qa('[data-rm-bible]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Remove this Bible translation?')) return;
      await rg.invoke('bible:remove', b.dataset.rmBible);
      d.close();
      await Scripture.loadBibles();
      Dialogs.settings();
    }));
    d.q('[data-pack-export]').onclick = async () => {
      const r = await rg.invoke('packs:export', { folder: Library.folder || null });
      if (r) App.toast(`Exported ${r.count} songs`);
    };
    d.q('[data-save]').onclick = async () => {
      App.settings = await rg.invoke('settings:set', {
        outputDisplayId: v('outputDisplayId').value || null,
        stageDisplayId: v('stageDisplayId').value || null,
        transition: { type: v('transitionType').value, ms: Math.max(100, +v('transitionMs').value || 450) },
        maxLinesPerSlide: Math.max(0, +v('maxLinesPerSlide').value || 0),
        autoChorus: v('autoChorus').checked,
        logoMedia: v('logoMedia').value || s.logoMedia,
        fontFallback: v('fontFallback').value.trim() || s.fontFallback,
        chorusWords: v('chorusWords').value.split(',').map((x) => x.trim()).filter(Boolean),
        defaultBibleId: (v('defaultBibleId') && v('defaultBibleId').value) || s.defaultBibleId,
        scriptureThemeId: v('scriptureThemeId').value || null,
        scriptureMaxChars: Math.max(80, +v('scriptureMaxChars').value || 320),
        scriptureVerseNumbers: v('scriptureVerseNumbers').checked,
      });
      d.close();
      App.toast('Settings saved');
      App.refreshPreview();
    };
  };

  Dialogs.installPack = async () => {
    try {
      const r = await rg.invoke('packs:import');
      if (!r) return;
      App.toast(`Pack installed: ${r.added} added, ${r.updated} updated${r.keptLocalEdits ? `, ${r.keptLocalEdits} of your edits kept` : ''}`);
      await App.loadThemes();
      Library.refresh();
    } catch (e) {
      App.toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
    }
  };

  // ---------- import hymns ----------
  Dialogs.importHymns = async () => {
    const files = await rg.invoke('import:pick');
    if (!files.length) return;
    const folders = (await rg.invoke('songs:folders')).map((f) => f.folder);
    const d = modal({
      title: 'Import hymns',
      body: `<div class="form-grid" style="margin-bottom:12px">
          <label class="field"><span>Folder</span><input id="iFolder" list="iFolders" value="${esc(Library.folder || 'Hymns – Kimeru')}"><datalist id="iFolders">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist></label>
          <label class="field"><span>Language</span><input id="iLang" list="iLangs" value="mer"><datalist id="iLangs"><option value="en"><option value="mer"><option value="sw"></datalist></label>
          <label class="field full"><span>If a song with the same number is already in this folder</span><select id="iMode"><option value="update">Update it (use this to fix typos)</option><option value="new">Add a separate copy</option></select></label>
        </div><div id="iResult"><p class="muted">Reading ${files.length} file(s)…</p></div>`,
      footer: '<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-go disabled>Import</button>',
    });
    d.q('[data-cancel]').onclick = () => d.close();
    let parsed = [];
    const parse = async () => {
      const options = { folder: d.q('#iFolder').value.trim(), language: d.q('#iLang').value.trim() };
      const r = await rg.invoke('import:parse', { files, options });
      parsed = r.songs;
      d.q('#iResult').innerHTML =
        r.errors.map((e) => `<div class="notice warn"><b>${esc(e.file)}</b>: ${esc(e.message)}</div>`).join('') +
        (parsed.length
          ? `<div class="notice">Found <b>${parsed.length}</b> song(s). Check the titles and section counts before importing.</div>
            <table class="import-table"><thead><tr><th>#</th><th>Title</th><th>English</th><th>Sections</th><th>File</th></tr></thead><tbody>
            ${parsed.map((s) => `<tr><td>${esc(s.number || '')}</td><td>${esc(s.title)}</td><td>${esc(s.alt_title || '')}</td><td>${s.sections.map((x) => L.shortCode(x)).join(' ')}</td><td class="muted">${esc(s._file)}</td></tr>`).join('')}</tbody></table>`
          : '');
      d.q('[data-go]').disabled = !parsed.length;
    };
    await parse();
    d.q('#iLang').onchange = parse;
    d.q('[data-go]').onclick = async () => {
      const options = { folder: d.q('#iFolder').value.trim() || 'Songs', language: d.q('#iLang').value.trim() || null, mode: d.q('#iMode').value };
      const r = await rg.invoke('import:commit', { songs: parsed.map(({ _file, ...s }) => ({ ...s, folder: s.folder || options.folder })), options });
      d.close();
      App.toast(`Imported: ${r.added} new, ${r.updated} updated`);
      Library.folder = options.folder;
      Library.refresh();
    };
  };

  // ---------- import a Bible translation ----------
  Dialogs.importBible = async () => {
    let info;
    try {
      info = await rg.invoke('bible:pick');
    } catch (e) {
      return App.toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
    }
    if (!info) return;
    const d = modal({
      title: 'Import Bible translation', narrow: true,
      body: `<div class="notice">Read <b>${info.verses.toLocaleString()}</b> verses in <b>${info.books}</b> books from ${esc(info.file)}.</div>
        <div class="form-grid">
          <label class="field full"><span>Name</span><input id="bName" value="${esc(info.name)}"></label>
          <label class="field"><span>Abbreviation</span><input id="bAbbrev" value="${esc(info.abbrev)}"><small>Shown on slides, e.g. NIV, HCSB</small></label>
          <label class="field"><span>Language</span><input id="bLang" value="en"></label>
          <label class="field full"><span>Copyright notice</span><input id="bCopy" value="${esc(info.copyright)}" placeholder="e.g. Scripture quotations taken from ..."></label>
        </div>
        <p class="muted" style="margin-top:12px">Only import translations your church is licensed to use. Importing with the same abbreviation replaces that translation.</p>`,
      footer: '<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-go>Import</button>',
    });
    d.q('[data-cancel]').onclick = () => d.close();
    d.q('[data-go]').onclick = async () => {
      const abbrev = d.q('#bAbbrev').value.trim();
      if (!abbrev) return App.toast('Give it an abbreviation', true);
      const r = await rg.invoke('bible:install-pending', { name: d.q('#bName').value.trim() || abbrev, abbrev, copyright: d.q('#bCopy').value.trim(), language: d.q('#bLang').value.trim() });
      d.close();
      App.toast(`${abbrev} installed: ${r.books} books, ${r.verses.toLocaleString()} verses`);
      Scripture.bibleId = r.id;
      Scripture.loadBibles();
    };
  };

  // ---------- countdown ----------
  Dialogs.editCountdown = (item) => {
    const now = new Date(Date.now() + 15 * 60000);
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const it = item || { type: 'countdown', title: 'Countdown', mode: 'minutes', minutes: 5, at: hhmm, message: 'The service begins in', endText: 'Welcome!', themeId: '' };
    const d = modal({
      title: item ? 'Edit countdown' : 'Add countdown', narrow: true,
      body: `<div class="form-grid">
          <label class="field full"><span>Counts down to</span><select id="kMode">
            <option value="minutes" ${it.mode !== 'clock' ? 'selected' : ''}>A number of minutes (restarts each time it goes live)</option>
            <option value="clock" ${it.mode === 'clock' ? 'selected' : ''}>A clock time (e.g. the service start)</option>
          </select></label>
          <label class="field" id="kMinWrap"><span>Minutes</span><input id="kMinutes" type="number" min="1" max="180" value="${it.minutes || 5}"></label>
          <label class="field" id="kAtWrap"><span>Time</span><input id="kAt" type="time" value="${esc(it.at || hhmm)}"></label>
          <label class="field full"><span>Message above the clock</span><input id="kMsg" value="${esc(it.message || '')}"></label>
          <label class="field full"><span>Message at zero</span><input id="kEnd" value="${esc(it.endText || '')}"></label>
          <label class="field full"><span>Theme</span><select id="kTheme">${themeOptions(it.themeId, true)}</select></label>
        </div>
        <div class="monitor" id="kMon" style="margin-top:14px"></div>`,
      footer: '<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>' + (item ? 'Save' : 'Add to service') + '</button>',
    });
    const mon = RGRender.createStage(d.q('#kMon'), { noTransitions: true });
    const read = () => ({
      ...it,
      title: 'Countdown',
      mode: d.q('#kMode').value,
      minutes: +d.q('#kMinutes').value || 5,
      at: d.q('#kAt').value,
      message: d.q('#kMsg').value,
      endText: d.q('#kEnd').value,
      themeId: d.q('#kTheme').value || null,
    });
    const draw = () => {
      const cd = read();
      d.q('#kMinWrap').hidden = cd.mode === 'clock';
      d.q('#kAtWrap').hidden = cd.mode !== 'clock';
      mon.show({
        mode: 'countdown', until: App.countdownUntil(cd), text: cd.message, endText: cd.endText,
        theme: App.themeFor(cd.themeId), item: { kind: 'countdown', title: 'Countdown' },
        fontFallback: App.settings.fontFallback, transition: { type: 'cut' },
      });
    };
    d.m.addEventListener('input', draw);
    d.m.addEventListener('change', draw);
    draw();
    d.q('[data-cancel]').onclick = () => { mon.destroy(); d.close(); };
    d.q('[data-save]').onclick = () => {
      const cd = read();
      cd.title = cd.mode === 'clock' ? `Countdown to ${cd.at}` : `${cd.minutes} minute countdown`;
      mon.destroy();
      d.close();
      if (item) {
        Object.assign(item, cd);
        App.markDirty();
        App.renderSchedule();
        App.refreshPreview();
      } else {
        const added = App.addItem(cd);
        App.setPreview(added, App.service.items.indexOf(added), 0);
      }
    };
  };

  // ---------- updates ----------
  const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  Dialogs.updates = async (opts) => {
    const st = await rg.invoke('updates:status');
    const d = modal({
      title: 'Updates',
      body: `<div id="uBody"></div>`,
      footer: `<div class="left"><button class="btn" data-check><i data-icon="import"></i>Check now</button></div>
        <button class="btn" data-close-btn>Close</button>`,
    });
    let found = null;
    let busy = false;

    const progressRow = (id) => `<div class="prog" data-prog="${esc(id)}" hidden><div class="bar"><i></i></div><span></span></div>`;

    const render = () => {
      const feedSet = !!st.feed;
      const parts = [];

      parts.push(`<div class="form-grid">
        <label class="field full"><span>Update source</span>
          <input id="uFeed" value="${esc(st.feed)}" placeholder="https://example.org/rgpresent/updates.json   or   \\\\church-server\\rgpresent">
          <small>A web address, or a folder on your network holding <b>updates.json</b>. Leave empty to never check.</small></label>
        <label class="field check"><input type="checkbox" id="uAuto" ${st.autoCheck ? 'checked' : ''}> Check automatically when RG-Present starts</label>
        <div class="field"><span>Installed</span><div>RG-Present <b>${esc(st.appVersion)}</b>${st.lastCheckedAt ? ` <span class="muted">· last checked ${new Date(st.lastCheckedAt).toLocaleString()}</span>` : ''}</div></div>
      </div>`);

      if (!st.packaged) {
        parts.push(`<div class="notice warn">This is a development build, so the program itself cannot be updated from here. Content packs still can.</div>`);
      }

      if (st.lastOutcome && st.lastOutcome.stage === 'failed') {
        parts.push(`<div class="notice warn">The last update to ${esc(st.lastOutcome.to)} did not finish. You are still running ${esc(st.appVersion)}; nothing was lost. Try again below.</div>`);
      }

      if (st.pending) {
        parts.push(`<div class="section-title">Ready to install</div>
          <div class="upd-card"><div class="upd-head"><b>RG-Present ${esc(st.pending.version)}</b><span class="badge-new">downloaded</span></div>
          ${st.pending.notes ? `<p class="upd-notes">${esc(st.pending.notes)}</p>` : ''}
          <div class="upd-actions"><button class="btn primary" data-install-app>Install and restart</button><button class="btn" data-discard>Discard</button></div>
          <p class="muted">RG-Present will close, the installer will run, and your songs, Bibles and settings stay as they are.</p></div>`);
      }

      if (found) {
        if (found.app && !st.pending) {
          parts.push(`<div class="section-title">New version</div>
            <div class="upd-card"><div class="upd-head"><b>RG-Present ${esc(found.app.version)}</b>${found.app.size ? `<span class="muted">${bytes(found.app.size)}</span>` : ''}</div>
            ${found.app.notes ? `<p class="upd-notes">${esc(found.app.notes)}</p>` : ''}
            ${found.app.blocked ? `<div class="notice warn">${esc(found.app.blocked)}</div>`
              : `<div class="upd-actions"><button class="btn primary" data-download-app ${st.packaged ? '' : 'disabled'}>Download</button></div>`}
            ${progressRow('app')}</div>`);
        }
        if (found.packs.length) {
          parts.push(`<div class="section-title">Song and Bible packs</div>` + found.packs.map((p) => `
            <div class="upd-card"><div class="upd-head"><b>${esc(p.name)}</b><span class="muted">${p.installedVersion ? `v${esc(p.installedVersion)} → ` : 'new · '}v${esc(p.version)}</span></div>
            ${p.notes ? `<p class="upd-notes">${esc(p.notes)}</p>` : ''}
            <div class="upd-actions"><button class="btn" data-install-pack="${esc(p.id)}">Install</button></div>
            ${progressRow(p.id)}</div>`).join(''));
        }
        if (!found.app && !found.packs.length && !st.pending) {
          parts.push(`<div class="notice">Everything is up to date.</div>`);
        }
      } else if (feedSet && !st.pending) {
        parts.push(`<p class="muted">Press <b>Check now</b> to see whether an update is waiting.</p>`);
      }

      if (st.rollback) {
        parts.push(`<div class="section-title">Go back</div>
          <div class="upd-card"><div class="upd-head"><b>Version ${esc(st.rollback.to)}</b><span class="muted">previously installed</span></div>
          <p class="muted">${st.rollback.installer
            ? `Reinstalls version ${esc(st.rollback.to)} and restores the library backup taken before the update.`
            : `The old installer is no longer on this computer, so only the library backup taken before the update can be restored.`}</p>
          <div class="upd-actions"><button class="btn danger" data-rollback>Roll back to ${esc(st.rollback.to)}</button></div></div>`);
      }

      d.q('#uBody').innerHTML = parts.join('');
      RGIcons.hydrate(d.m);
      wire();
    };

    const setBusy = (on) => {
      busy = on;
      d.qa('button').forEach((b) => { if (!b.hasAttribute('data-close') && !b.hasAttribute('data-close-btn')) b.disabled = on; });
    };

    const saveFeed = () => rg.invoke('settings:set', { updateFeedUrl: d.q('#uFeed').value.trim(), autoCheckUpdates: d.q('#uAuto').checked })
      .then((s) => { App.settings = s; st.feed = s.updateFeedUrl; st.autoCheck = s.autoCheckUpdates; });

    const showProgress = (id, p) => {
      const row = d.q(`[data-prog="${CSS.escape(id)}"]`);
      if (!row) return;
      row.hidden = false;
      const pct = p.total ? Math.round((p.received / p.total) * 100) : 0;
      row.querySelector('i').style.width = `${pct}%`;
      row.querySelector('span').textContent = p.total ? `${pct}%  (${bytes(p.received)} of ${bytes(p.total)})` : bytes(p.received);
    };
    const offProgress = rg.on('updates:progress', (p) => showProgress(p.id, p));

    function wire() {
      const dl = d.q('[data-download-app]');
      if (dl) dl.onclick = async () => {
        setBusy(true);
        try {
          await rg.invoke('updates:download-app', found.app);
          Object.assign(st, await rg.invoke('updates:status'));
          App.toast('Update downloaded');
          render();
        } catch (e) { App.toast(cleanErr(e), true); } finally { setBusy(false); }
      };
      const inst = d.q('[data-install-app]');
      if (inst) inst.onclick = async () => {
        if (App.live && !confirm('Something is live on the audience screen. Install the update and close RG-Present now?')) return;
        setBusy(true);
        try { await rg.invoke('updates:apply-app', {}); } catch (e) { App.toast(cleanErr(e), true); setBusy(false); }
      };
      const dis = d.q('[data-discard]');
      if (dis) dis.onclick = async () => {
        await rg.invoke('updates:cancel');
        Object.assign(st, await rg.invoke('updates:status'));
        render();
      };
      d.qa('[data-install-pack]').forEach((b) => (b.onclick = async () => {
        const info = found.packs.find((p) => p.id === b.dataset.installPack);
        setBusy(true);
        try {
          const r = await rg.invoke('updates:install-pack', info);
          App.toast(`${info.name}: ${r.added} added, ${r.updated} updated${r.keptLocalEdits ? `, ${r.keptLocalEdits} of your edits kept` : ''}`);
          found.packs = found.packs.filter((p) => p.id !== info.id);
          await App.loadThemes();
          Library.refresh();
          render();
        } catch (e) { App.toast(cleanErr(e), true); } finally { setBusy(false); }
      }));
      const rb = d.q('[data-rollback]');
      if (rb) rb.onclick = async () => {
        if (!confirm(`Go back to version ${st.rollback.to}? Your library will be restored from the backup taken before the update.`)) return;
        setBusy(true);
        try {
          const r = await rg.invoke('updates:rollback');
          if (!r.reinstalled) { App.toast(`Library restored. Run the ${r.to} installer to change the program back.`); d.close(); }
        } catch (e) { App.toast(cleanErr(e), true); setBusy(false); }
      };
    }

    const check = async () => {
      await saveFeed();
      if (!st.feed) return App.toast('Add an update source first', true);
      setBusy(true);
      try {
        found = await rg.invoke('updates:check', st.feed);
        Object.assign(st, await rg.invoke('updates:status'));
        render();
      } catch (e) { App.toast(cleanErr(e), true); } finally { setBusy(false); }
    };

    d.q('[data-check]').onclick = check;
    d.q('[data-close-btn]').onclick = () => d.close();
    d.m.addEventListener('change', (e) => { if (e.target.id === 'uFeed' || e.target.id === 'uAuto') saveFeed(); });
    const origClose = d.close;
    d.close = () => { offProgress(); origClose(); };
    render();
    if (opts && opts.found) { found = opts.found; render(); } else if (opts && opts.checkNow) check();
  };

  const cleanErr = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  /** Quiet check at startup: only speaks up when something is actually waiting. */
  Dialogs.autoCheckUpdates = async () => {
    const st = await rg.invoke('updates:status');
    if (st.pending) {
      App.toast(`RG-Present ${st.pending.version} is downloaded and ready to install`);
      return;
    }
    if (!st.feed || !st.autoCheck) return;
    try {
      const found = await rg.invoke('updates:check');
      const n = (found.app ? 1 : 0) + found.packs.length;
      if (!n) return;
      App.toast(found.app ? `RG-Present ${found.app.version} is available — open Settings → Updates` : `${n} content update${n > 1 ? 's' : ''} available`);
    } catch (_) {
      // A server that is down must never interrupt a service.
    }
  };

  // ---------- open service ----------
  Dialogs.openService = async () => {
    const list = await rg.invoke('services:list');
    const d = modal({
      title: 'Open service', narrow: true,
      body: list.length ? list.map((s) => `<div class="svc-row" data-id="${s.id}" style="cursor:pointer"><i data-icon="book"></i><b>${esc(s.name)}</b><span class="muted">${new Date(s.updated_at).toLocaleDateString()}</span></div>`).join('') : '<p class="muted">No saved services yet.</p>',
    });
    d.qa('.svc-row').forEach((r) => (r.onclick = () => { d.close(); App.openService(+r.dataset.id); }));
  };
})();
