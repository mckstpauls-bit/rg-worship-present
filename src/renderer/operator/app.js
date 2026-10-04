/* Operator core: service (schedule), preview, live output, keyboard control. */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const rg = window.rg;
  const L = window.RGLyrics;

  const App = {
    settings: null,
    themes: new Map(),
    service: { id: null, name: 'Untitled service', items: [] },
    dirty: false,
    preview: null, // { index, item, r (resolved), slide }
    live: null,
    cover: null,
    auto: { on: false, timer: null },
    songCache: new Map(),
    $, $$,
  };
  window.App = App;

  // ---------- helpers ----------
  let toastTimer;
  App.toast = (msg, isError) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2400);
  };
  App.uid = () => Math.random().toString(36).slice(2, 10);
  App.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  App.langLabel = (code) => ({ en: 'EN', mer: 'KIM', sw: 'SW' }[code] || (code || '?').toUpperCase().slice(0, 3));

  App.loadThemes = async () => {
    const list = await rg.invoke('themes:list');
    App.themes = new Map(list.map((t) => [t.id, t]));
  };
  App.themeFor = (id) => App.themes.get(id) || App.themes.get(App.settings.defaultThemeId) || App.themes.values().next().value || {};

  App.getSong = async (id, fresh) => {
    if (!fresh && App.songCache.has(id)) return App.songCache.get(id);
    const s = await rg.invoke('songs:get', id);
    if (s) App.songCache.set(id, s);
    return s;
  };

  // ---------- resolving items to slides ----------
  App.resolve = async (item) => {
    const opts = { maxLines: App.settings.maxLinesPerSlide, autoChorus: App.settings.autoChorus };
    if (item.type === 'song') {
      const song = await App.getSong(item.songId);
      if (!song) return { kind: 'song', title: `${item.title} (missing)`, slides: [], theme: App.themeFor(item.themeId) };
      return {
        kind: 'song', song, title: song.title, number: song.number, author: song.author, copyright: song.copyright,
        slides: L.buildSlides(song, opts), theme: App.themeFor(item.themeId || song.theme_id),
      };
    }
    if (item.type === 'custom') {
      const sections = L.textToSections(item.text || '');
      return { kind: 'custom', title: item.title, slides: L.buildSlides({ sections }, { ...opts, autoChorus: false }), theme: App.themeFor(item.themeId) };
    }
    if (item.type === 'scripture') {
      const B = window.RGBible;
      const verses = await rg.invoke('bible:passage', { id: item.bibleId, ref: item.ref });
      const title = `${B.formatReference(item.ref)}${item.abbrev ? ` (${item.abbrev})` : ''}`;
      if (!verses.length) return { kind: 'scripture', title: `${title}: not in this Bible`, slides: [], theme: App.themeFor(item.themeId) };
      const slides = B.buildScriptureSlides(verses, item.ref, { maxChars: App.settings.scriptureMaxChars, verseNumbers: App.settings.scriptureVerseNumbers });
      return { kind: 'scripture', title, abbrev: item.abbrev, slides, theme: App.themeFor(item.themeId || App.settings.scriptureThemeId) };
    }
    if (item.type === 'countdown') {
      return { kind: 'countdown', title: item.title, slides: [{ label: 'Countdown', code: '', text: item.message || '', countdown: item }], theme: App.themeFor(item.themeId) };
    }
    if (item.type === 'media') {
      return { kind: 'media', title: item.title, slides: [{ label: item.mediaType === 'video' ? 'Video' : 'Image', code: '', text: '', media: { type: item.mediaType, url: item.rel } }], theme: App.themeFor(item.themeId) };
    }
    return { kind: 'unknown', title: '?', slides: [], theme: App.themeFor() };
  };

  App.payload = (r, i, extra) => {
    const s = r.slides[i] || {};
    const t = App.settings.transition || {};
    const next = r.slides[i + 1];
    return {
      mode: s.countdown ? 'countdown' : s.media ? 'media' : r.slides.length ? 'slide' : 'blank',
      until: s.countdown ? App.countdownUntil(s.countdown) : null,
      endText: s.countdown ? s.countdown.endText || '' : '',
      text: s.text || '',
      label: s.label || '',
      first: !!s.first,
      media: s.media || null,
      item: { title: r.title, number: r.number, author: r.author, copyright: r.copyright, kind: r.kind, reference: s.reference, abbrev: r.abbrev },
      theme: r.theme,
      logoUrl: App.settings.logoMedia,
      fontFallback: App.settings.fontFallback,
      transition: { type: t.type || 'fade', ms: t.ms || 450 },
      next: next ? next.text || next.label : '',
      cover: null,
      ...(extra || {}),
    };
  };

  // ---------- slide grids ----------
  function renderSlides(container, r, selIndex, onPick, onDbl) {
    container.innerHTML = '';
    const cards = r.slides.map((s, i) => {
      const card = document.createElement('button');
      card.className = 'slide-card' + (i === selIndex ? ' sel' : '');
      card.innerHTML = `<div class="thumb"></div><span class="num">${i + 1}</span><div class="cap"><span class="k ${s.type === 'chorus' ? 'type-chorus' : ''}">${App.esc(s.code || '')}</span><span>${App.esc(s.label)}</span></div>`;
      card.addEventListener('click', () => onPick(i));
      if (onDbl) card.addEventListener('dblclick', () => onDbl(i));
      container.appendChild(card);
      return card;
    });
    // Render thumbnails progressively so long hymns don't block the UI.
    let k = 0;
    const step = () => {
      const end = Math.min(k + 4, cards.length);
      for (; k < end; k++) {
        if (!cards[k].isConnected) return;
        RGRender.renderStatic(cards[k].querySelector('.thumb'), App.payload(r, k));
      }
      if (k < cards.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return cards;
  }

  function markSel(container, i) {
    $$('.slide-card', container).forEach((c, k) => c.classList.toggle('sel', k === i));
    const c = $$('.slide-card', container)[i];
    if (c) c.scrollIntoView({ block: 'nearest' });
  }

  // ---------- preview ----------
  App.setPreview = async (item, index, slideIndex) => {
    const r = await App.resolve(item);
    App.preview = { item, index, r, slide: Math.min(slideIndex || 0, Math.max(0, r.slides.length - 1)) };
    $('#previewTitle').textContent = r.title + (r.number ? `  ·  ${r.number}` : '');
    renderSlides($('#previewSlides'), r, App.preview.slide, (i) => App.previewSlide(i), (i) => { App.previewSlide(i); App.goLive(); });
    App.previewStage.show(App.payload(r, App.preview.slide, { transition: { type: 'cut' } }));
    App.renderSchedule();
    App.updateLangToggle();
  };

  App.previewSlide = (i) => {
    if (!App.preview) return;
    App.preview.slide = i;
    markSel($('#previewSlides'), i);
    App.previewStage.show(App.payload(App.preview.r, i, { transition: { type: 'cut' } }));
  };

  App.refreshPreview = async () => {
    if (App.preview) await App.setPreview(App.preview.item, App.preview.index, App.preview.slide);
    if (App.live) {
      App.live.r = await App.resolve(App.live.item);
      App.live.slide = Math.min(App.live.slide, Math.max(0, App.live.r.slides.length - 1));
      renderLiveSlides();
      App.sendLive();
    }
  };

  let langToggleSeq = 0;
  App.updateLangToggle = async () => {
    // Two previews in quick succession: only the newest may show its toggle.
    const seq = ++langToggleSeq;
    const box = $('#langToggle');
    box.hidden = true;
    const stale = () => seq !== langToggleSeq;
    const p = App.preview;
    if (p && p.item.type === 'scripture') {
      // Switch the passage between installed translations (KJV / NIV / HCSB ...).
      const list = await rg.invoke('bible:list');
      if (stale() || list.length < 2) return;
      box.innerHTML = '';
      for (const b of list) {
        const btn = document.createElement('button');
        btn.textContent = b.abbrev;
        btn.title = b.name;
        btn.className = b.id === p.item.bibleId ? 'on' : '';
        btn.onclick = async () => {
          p.item.bibleId = b.id;
          p.item.abbrev = b.abbrev;
          p.item.title = `${window.RGBible.formatReference(p.item.ref)}`;
          App.markDirty();
          await App.setPreview(p.item, p.index, p.slide);
        };
        box.appendChild(btn);
      }
      box.hidden = false;
      return;
    }
    if (!p || p.item.type !== 'song' || !p.r.song || !p.r.song.link_key) return;
    const linked = await rg.invoke('songs:linked', p.r.song.link_key);
    if (stale() || linked.length < 2) return;
    box.innerHTML = '';
    for (const s of linked) {
      const b = document.createElement('button');
      b.textContent = App.langLabel(s.language);
      b.title = s.title;
      b.className = s.id === p.item.songId ? 'on' : '';
      b.onclick = async () => {
        p.item.songId = s.id;
        p.item.title = s.title;
        p.item.language = s.language;
        App.markDirty();
        await App.setPreview(p.item, p.index, p.slide);
      };
      box.appendChild(b);
    }
    box.hidden = false;
  };

  // ---------- live ----------
  function renderLiveSlides() {
    renderSlides($('#liveSlides'), App.live.r, App.live.slide, (i) => App.liveSlide(i));
    $('#liveTitle').textContent = App.live.r.title + (App.live.r.number ? `  ·  ${App.live.r.number}` : '');
  }

  App.goLive = async (item, index, slide) => {
    // A "minutes from now" countdown restarts whenever it goes live.
    const target = item || (App.preview && App.preview.item);
    if (target && target.type === 'countdown' && target.mode !== 'clock') target._startedAt = new Date().toISOString();
    if (item) {
      const r = await App.resolve(item);
      App.live = { item, index, r, slide: slide || 0 };
    } else {
      if (!App.preview) return;
      App.live = { ...App.preview };
    }
    renderLiveSlides();
    App.sendLive();
    App.renderSchedule();
    App.restartAuto();
  };

  App.liveSlide = (i) => {
    if (!App.live) return;
    App.live.slide = Math.max(0, Math.min(i, App.live.r.slides.length - 1));
    markSel($('#liveSlides'), App.live.slide);
    App.sendLive();
    App.restartAuto();
  };

  App.sendLive = () => {
    const t = $('#transitionSelect').value;
    const base = App.settings.transition || {};
    const transition = t === 'cut' ? { type: 'cut', ms: 0 } : { type: 'fade', ms: t === 'slow' ? 1200 : base.ms || 450 };
    const p = App.live
      ? App.payload(App.live.r, App.live.slide, { cover: App.cover, transition })
      : { mode: 'blank', cover: App.cover || 'black', transition, logoUrl: App.settings.logoMedia };
    rg.sendOutput(p);
    App.liveStage.show(p);
    ['black', 'clear', 'logo'].forEach((c) => $('#btn' + c[0].toUpperCase() + c.slice(1)).classList.toggle('on', App.cover === c));
  };

  App.next = () => {
    if (!App.live) return;
    if (App.live.slide < App.live.r.slides.length - 1) return App.liveSlide(App.live.slide + 1);
    // At the end of an item: carry on with the next service item.
    const ni = (App.live.index ?? -1) + 1;
    const nextItem = App.service.items[ni];
    if (App.live.index != null && nextItem) {
      App.goLive(nextItem, ni, 0);
      App.setPreview(App.service.items[ni + 1] || nextItem, App.service.items[ni + 1] ? ni + 1 : ni, 0);
    } else App.stopAuto();
  };
  App.prev = () => App.live && App.liveSlide(App.live.slide - 1);

  App.setCover = (c) => {
    App.cover = App.cover === c ? null : c;
    App.sendLive();
  };

  App.jumpToVerse = (n) => {
    if (!App.live) return;
    const i = App.live.r.slides.findIndex((s) => s.type === 'verse' && new RegExp(`\\b${n}\\b`).test(s.label));
    if (i >= 0) App.liveSlide(i);
  };
  App.jumpToChorus = () => {
    if (!App.live) return;
    const from = App.live.slide + 1;
    const all = App.live.r.slides;
    const i = [...all.keys()].find((k) => k >= from && all[k].type === 'chorus') ?? all.findIndex((s) => s.type === 'chorus');
    if (i >= 0) App.liveSlide(i);
  };

  /**
   * When the countdown should hit zero. A fixed clock time ("10:30") is used for a service start;
   * a length in minutes restarts from now each time the item is sent live.
   */
  App.countdownUntil = (cd) => {
    if (cd.mode === 'clock' && cd.at) {
      const [h, m] = String(cd.at).split(':').map(Number);
      const d = new Date();
      d.setHours(h || 0, m || 0, 0, 0);
      if (d.getTime() < Date.now() - 60 * 60 * 1000) d.setDate(d.getDate() + 1); // after midnight
      return d.toISOString();
    }
    const base = cd._startedAt ? new Date(cd._startedAt).getTime() : Date.now();
    return new Date(base + (cd.minutes || 5) * 60000).toISOString();
  };

  // ---------- auto advance ----------
  App.restartAuto = () => {
    clearTimeout(App.auto.timer);
    if (!App.auto.on || !App.live) return;
    const secs = Math.max(2, parseInt($('#autoSecs').value, 10) || 8);
    App.auto.timer = setTimeout(() => {
      if (!App.live) return;
      if (App.live.slide < App.live.r.slides.length - 1) App.liveSlide(App.live.slide + 1);
      else App.liveSlide(0); // loop (announcement loops before the service)
    }, secs * 1000);
  };
  App.toggleAuto = () => {
    App.auto.on = !App.auto.on;
    $('#btnAuto').classList.toggle('on', App.auto.on);
    App.restartAuto();
  };
  App.stopAuto = () => {
    App.auto.on = false;
    $('#btnAuto').classList.remove('on');
    clearTimeout(App.auto.timer);
  };

  // ---------- service / schedule ----------
  App.markDirty = () => {
    App.dirty = true;
    App.renderServiceName();
    clearTimeout(App._autosave);
    App._autosave = setTimeout(() => rg.invoke('service:autosave', { service: App.service, dirty: App.dirty }), 600);
  };

  App.renderServiceName = () => {
    $('#serviceName').innerHTML = App.esc(App.service.name) + (App.dirty ? '<span class="dirty">●</span>' : '');
  };

  App.addItem = (item, at) => {
    item.id = item.id || App.uid();
    if (at == null || at > App.service.items.length) App.service.items.push(item);
    else App.service.items.splice(at, 0, item);
    App.markDirty();
    App.renderSchedule();
    return item;
  };

  App.addSong = async (songId, at) => {
    const s = await App.getSong(songId, true);
    if (!s) return;
    const item = App.addItem({ type: 'song', songId: s.id, title: s.title, number: s.number, folder: s.folder, language: s.language }, at);
    const index = App.service.items.indexOf(item);
    App.setPreview(item, index, 0);
  };

  App.removeItem = (i) => {
    App.service.items.splice(i, 1);
    if (App.preview && App.preview.index === i) App.preview.index = null;
    App.markDirty();
    App.renderSchedule();
  };

  App.moveItem = (from, to) => {
    if (from === to || from + 1 === to) return;
    const [it] = App.service.items.splice(from, 1);
    App.service.items.splice(to > from ? to - 1 : to, 0, it);
    App.markDirty();
    App.renderSchedule();
  };

  function itemIcon(it) {
    return { song: 'music', custom: 'text', scripture: 'book', countdown: 'clock', media: it.mediaType === 'video' ? 'video' : 'image' }[it.type] || 'file';
  }

  App.renderSchedule = () => {
    const ol = $('#schedule');
    ol.innerHTML = '';
    $('#scheduleEmpty').hidden = App.service.items.length > 0;
    App.service.items.forEach((it, i) => {
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.index = i;
      const isPrev = App.preview && App.preview.item === it;
      const isLive = App.live && App.live.item === it;
      li.className = (isPrev ? 'preview ' : '') + (isLive ? 'live' : '');
      const sub = it.type === 'song' ? [it.number && `#${it.number}`, it.folder, it.language && App.langLabel(it.language)].filter(Boolean).join(' · ')
        : it.type === 'scripture' ? `Scripture · ${it.abbrev || ''}`
        : it.type === 'countdown' ? (it.mode === 'clock' ? `Counts down to ${it.at}` : `${it.minutes} minute countdown`)
        : it.type === 'custom' ? 'Text slide' : 'Media';
      li.innerHTML = `<i class="grip" data-icon="grip"></i><span class="kind ${it.type}"><i data-icon="${itemIcon(it)}"></i></span>
        <span class="t"><b>${App.esc(it.title)}</b><small>${App.esc(sub)}</small></span>
        <button class="mini rm" title="Remove"><i data-icon="x"></i></button>`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.rm')) return App.removeItem(i);
        App.setPreview(it, i, 0);
      });
      li.addEventListener('dblclick', (e) => {
        if (e.target.closest('.rm')) return;
        App.goLive(it, i, 0);
      });
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-rg-item', String(i));
        e.dataTransfer.effectAllowed = 'move';
      });
      ol.appendChild(li);
    });
    RGIcons.hydrate(ol);
  };

  function setupScheduleDnD() {
    const ol = $('#schedule');
    const panel = $('#schedulePanel');
    const clear = () => $$('li', ol).forEach((li) => li.classList.remove('drop-before', 'drop-after'));
    const targetIndex = (e) => {
      const li = e.target.closest('li');
      if (!li) return App.service.items.length;
      const r = li.getBoundingClientRect();
      return parseInt(li.dataset.index, 10) + (e.clientY > r.top + r.height / 2 ? 1 : 0);
    };
    panel.addEventListener('dragover', (e) => {
      const types = e.dataTransfer.types;
      if (!types.includes('application/x-rg-item') && !types.includes('application/x-rg-song') && !types.includes('application/x-rg-media')) return;
      e.preventDefault();
      clear();
      const li = e.target.closest('li');
      if (li) {
        const r = li.getBoundingClientRect();
        li.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
      } else ol.classList.add('drag-over');
    });
    panel.addEventListener('dragleave', (e) => {
      if (!panel.contains(e.relatedTarget)) { clear(); ol.classList.remove('drag-over'); }
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      clear();
      ol.classList.remove('drag-over');
      const at = targetIndex(e);
      const item = e.dataTransfer.getData('application/x-rg-item');
      const song = e.dataTransfer.getData('application/x-rg-song');
      const media = e.dataTransfer.getData('application/x-rg-media');
      if (item !== '') App.moveItem(parseInt(item, 10), at);
      else if (song) App.addSong(parseInt(song, 10), at);
      else if (media) App.addMediaItem(JSON.parse(media), at);
    });
  }

  App.addMediaItem = (m, at) => {
    const item = App.addItem({ type: 'media', title: m.name, rel: m.rel_path, mediaType: m.type }, at);
    App.setPreview(item, App.service.items.indexOf(item), 0);
  };

  App.newService = async () => {
    if (App.dirty && App.service.items.length && !confirm('Start a new service? Unsaved changes to this one will be lost.')) return;
    App.service = { id: null, name: 'Untitled service', items: [] };
    App.dirty = false;
    App.preview = null;
    App.renderServiceName();
    App.renderSchedule();
    $('#previewSlides').innerHTML = '';
    $('#previewTitle').textContent = '';
    App.previewStage.show({ mode: 'blank', transition: { type: 'cut' } });
    rg.invoke('service:autosave', { service: App.service, dirty: false });
  };

  App.saveService = async (asNew) => {
    let name = App.service.name;
    if (!App.service.id || asNew || name === 'Untitled service') {
      name = await App.prompt('Save service', 'Service name', name === 'Untitled service' ? `Service ${new Date().toLocaleDateString()}` : name);
      if (!name) return;
    }
    App.service.name = name;
    App.service.id = await rg.invoke('services:save', { id: asNew ? null : App.service.id, name, data: { items: App.service.items } });
    App.dirty = false;
    App.renderServiceName();
    rg.invoke('service:autosave', { service: App.service, dirty: false });
    App.toast('Service saved');
    if (window.Library) Library.loadServices();
  };

  App.openService = async (id) => {
    const svc = await rg.invoke('services:get', id);
    if (!svc) return;
    if (App.dirty && App.service.items.length && !confirm('Open this service? Unsaved changes to the current one will be lost.')) return;
    App.service = { id: svc.id, name: svc.name, items: svc.data.items || [] };
    App.dirty = false;
    App.renderServiceName();
    App.renderSchedule();
    if (App.service.items[0]) App.setPreview(App.service.items[0], 0, 0);
    App.toast(`Opened “${svc.name}”`);
  };

  // ---------- keyboard ----------
  function setupKeys() {
    document.addEventListener('keydown', (e) => {
      const inField = e.target.matches('input, textarea, select, [contenteditable]');
      const modal = document.querySelector('.modal');
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); return App.saveService(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); return Dialogs.openService(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); return App.newService(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); return $('#search').focus(); }
      if (modal || inField) {
        if (inField && e.key === 'Escape') e.target.blur();
        return;
      }
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': case ' ': case 'ArrowDown': e.preventDefault(); App.next(); break;
        case 'ArrowLeft': case 'PageUp': case 'ArrowUp': e.preventDefault(); App.prev(); break;
        case 'Enter': e.preventDefault(); App.goLive(); break;
        case 'b': case 'B': case '.': App.setCover('black'); break;
        case 'c': case 'C': App.setCover('clear'); break;
        case 'l': case 'L': App.setCover('logo'); break;
        case 'r': case 'R': App.jumpToChorus(); break;
        case 'Escape': App.cover = null; App.sendLive(); break;
        default:
          if (/^[1-9]$/.test(e.key)) App.jumpToVerse(parseInt(e.key, 10));
      }
    });
  }

  // ---------- splitters ----------
  function setupSplitters() {
    const ws = $('#workspace');
    const saved = (() => { try { return JSON.parse(localStorage.getItem('rg.layout') || '{}'); } catch (_) { return {}; } })();
    for (const [k, v] of Object.entries(saved)) ws.style.setProperty(k, v);
    $$('.splitter').forEach((sp) => {
      sp.addEventListener('mousedown', (e) => {
        e.preventDefault();
        sp.classList.add('dragging');
        const kind = sp.dataset.split;
        const rect = ws.getBoundingClientRect();
        const move = (ev) => {
          if (kind === 'schedule') ws.style.setProperty('--schedule-w', Math.max(220, Math.min(520, ev.clientX - rect.left - 8)) + 'px');
          if (kind === 'preview') {
            const left = $('#previewPanel').getBoundingClientRect().left;
            ws.style.setProperty('--preview-w', Math.max(320, ev.clientX - left) + 'px');
          }
          if (kind === 'library') ws.style.setProperty('--library-h', Math.max(180, Math.min(rect.height - 280, rect.bottom - ev.clientY - 8)) + 'px');
          App.liveStage.refit();
          App.previewStage.refit();
        };
        const up = () => {
          sp.classList.remove('dragging');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          const out = {};
          for (const k of ['--schedule-w', '--preview-w', '--library-h']) if (ws.style.getPropertyValue(k)) out[k] = ws.style.getPropertyValue(k);
          try { localStorage.setItem('rg.layout', JSON.stringify(out)); } catch (_) { /* storage unavailable */ }
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
    });
  }

  App.setWindowsState = (st) => {
    $('#btnOutput').classList.toggle('on', !!st.output);
    $('#btnStage').classList.toggle('on', !!st.stage);
    const second = st.displays && st.displays.length > 1;
    $('#btnOutput').title = st.output
      ? second ? 'Audience output is on (click to turn off)' : 'Output is showing in a window: connect a projector/TV to present full-screen'
      : 'Audience output is off (click to turn on)';
  };

  App.initCore = () => {
    App.previewStage = RGRender.createStage($('#previewMonitor'), { noTransitions: true });
    App.liveStage = RGRender.createStage($('#liveMonitor'));
    App.previewStage.show({ mode: 'blank', transition: { type: 'cut' } });
    App.liveStage.show({ mode: 'blank', cover: 'black', transition: { type: 'cut' } });
    setupScheduleDnD();
    setupKeys();
    setupSplitters();
    $('#autoSecs').value = App.settings.autoAdvanceSeconds || 8;
    $('#autoSecs').addEventListener('change', () => {
      rg.invoke('settings:set', { autoAdvanceSeconds: parseInt($('#autoSecs').value, 10) || 8 });
      App.restartAuto();
    });
    $('#transitionSelect').value = App.settings.transition && App.settings.transition.type === 'cut' ? 'cut' : 'fade';
  };
})();
