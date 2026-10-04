/* Scripture tab: pick a translation, type a reference or search words, select verses, add to the service. */
(function () {
  const { $ } = App;
  const rg = window.rg;
  const B = window.RGBible;
  const esc = App.esc;

  const S = {
    bibles: [],
    bibleId: null,
    structure: [],
    book: 43, // John
    chapter: 3,
    verses: [],
    sel: null, // { start, end } verse numbers in the current chapter
    anchor: null,
  };
  window.Scripture = S;

  S.bible = () => S.bibles.find((b) => b.id === S.bibleId);

  S.loadBibles = async () => {
    S.bibles = await rg.invoke('bible:list');
    if (!S.bibles.find((b) => b.id === S.bibleId)) {
      S.bibleId = (S.bibles.find((b) => b.id === App.settings.defaultBibleId) || S.bibles[0] || {}).id || null;
    }
    const sel = $('#bibleSelect');
    sel.innerHTML = S.bibles.map((b) => `<option value="${esc(b.id)}" ${b.id === S.bibleId ? 'selected' : ''}>${esc(b.abbrev)} — ${esc(b.name)}</option>`).join('')
      || '<option value="">No Bible installed</option>';
    await S.loadStructure();
  };

  S.loadStructure = async () => {
    S.structure = S.bibleId ? await rg.invoke('bible:structure', S.bibleId) : [];
    const box = $('#bookList');
    box.innerHTML = S.structure.map((b) => `<button class="folder ${b.book === S.book ? 'active' : ''}" data-book="${b.book}"><span>${esc(B.bookName(b.book))}</span><span class="count">${b.chapters}</span></button>`).join('')
      || '<p class="muted" style="padding:8px">Import a Bible to get started.</p>';
    box.querySelectorAll('[data-book]').forEach((el) => (el.onclick = () => S.open(+el.dataset.book, 1)));
    if (S.structure.length) await S.open(S.book, S.chapter, S.sel, true);
  };

  /** Show a chapter, optionally with a verse range selected. */
  S.open = async (book, chapter, sel, keepScroll) => {
    const info = S.structure.find((b) => b.book === book);
    if (!info) return;
    S.book = book;
    S.chapter = Math.max(1, Math.min(chapter, info.chapters));
    S.verses = await rg.invoke('bible:chapter', { id: S.bibleId, book, chapter: S.chapter });
    const last = S.verses.length ? S.verses[S.verses.length - 1].verse : 1;
    S.sel = sel ? { start: Math.min(sel.start, last), end: Math.min(sel.end, last) } : null;
    S.anchor = S.sel ? S.sel.start : null;
    document.querySelectorAll('#bookList .folder').forEach((el) => el.classList.toggle('active', +el.dataset.book === book));
    const active = document.querySelector('#bookList .folder.active');
    if (active && !keepScroll) active.scrollIntoView({ block: 'nearest' });
    $('#chapterChips').innerHTML = Array.from({ length: info.chapters }, (_, i) => `<button class="chip ${i + 1 === S.chapter ? 'on' : ''}" data-ch="${i + 1}">${i + 1}</button>`).join('');
    $('#chapterChips').querySelectorAll('[data-ch]').forEach((el) => (el.onclick = () => S.open(S.book, +el.dataset.ch)));
    const on = $('#chapterChips .chip.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    renderVerses();
    renderPeek();
  };

  function renderVerses() {
    const list = $('#verseList');
    list.innerHTML = `<div class="chapter-title">${esc(B.bookName(S.book))} ${S.chapter}</div>` + S.verses.map((v) =>
      `<div class="verse-row ${inSel(v.verse) ? 'sel' : ''}" data-v="${v.verse}"><span class="vn">${v.verse}</span><span>${esc(v.text)}</span></div>`).join('');
    const first = list.querySelector('.verse-row.sel');
    if (first) first.scrollIntoView({ block: 'center' });
    else list.scrollTop = 0;
  }

  /** Repaint the highlight without rebuilding the list, so dragging stays smooth. */
  function paintSelection() {
    $('#verseList').querySelectorAll('.verse-row').forEach((r) => r.classList.toggle('sel', inSel(+r.dataset.v)));
  }

  const verseAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const row = el && el.closest('.verse-row');
    return row && $('#verseList').contains(row) ? +row.dataset.v : null;
  };

  function selectTo(v) {
    if (v == null || S.anchor == null) return;
    S.sel = { start: Math.min(S.anchor, v), end: Math.max(S.anchor, v) };
    paintSelection();
  }

  /**
   * Press and drag down the list to take a range; Shift+click extends from the last verse touched.
   * Works the same with a mouse and with a finger on a touch screen.
   */
  function setupVerseSelection() {
    const list = $('#verseList');
    let dragging = false;

    list.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.verse-row');
      if (!row || e.button > 0) return;
      const v = +row.dataset.v;
      if (e.shiftKey && S.anchor != null) selectTo(v);
      else {
        S.anchor = v;
        S.sel = { start: v, end: v };
        paintSelection();
      }
      dragging = true;
      at = { x: e.clientX, y: e.clientY };
      clearInterval(scrollTimer);
      scrollTimer = setInterval(autoScroll, 40);
      list.setPointerCapture(e.pointerId);
      e.preventDefault(); // no text selection or scroll-drag while choosing verses
    });

    // Dragging near the top or bottom edge scrolls the list, so a long reading can be taken in one go.
    let at = null;
    let scrollTimer = null;
    const EDGE = 30;

    const extendToPointer = () => {
      if (!at) return;
      const r = list.getBoundingClientRect();
      const y = Math.min(Math.max(at.y, r.top + 2), r.bottom - 2);
      selectTo(verseAt(at.x, y));
    };

    const autoScroll = () => {
      if (!dragging || !at) return;
      const r = list.getBoundingClientRect();
      const up = at.y - r.top;
      const down = r.bottom - at.y;
      let dy = 0;
      if (up < EDGE) dy = -Math.max(6, (EDGE - up) * 0.9);
      else if (down < EDGE) dy = Math.max(6, (EDGE - down) * 0.9);
      if (dy) {
        list.scrollTop += dy;
        extendToPointer();
      }
    };

    list.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      at = { x: e.clientX, y: e.clientY };
      extendToPointer();
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      at = null;
      clearInterval(scrollTimer);
      scrollTimer = null;
      try { list.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
      renderPeek();
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);

    // Double-tap puts that verse on the screen at once, leaving the service and preview alone.
    // (To take a whole range live, drag it and use "Go live" beside it.)
    list.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.verse-row');
      if (row) S.takeLive(+row.dataset.v);
    });
  }

  /** Send a verse (or the current selection) straight to the audience screen. */
  S.takeLive = async (verse) => {
    if (!S.bibleId) return;
    if (verse != null) {
      S.sel = { start: verse, end: verse };
      S.anchor = verse;
      paintSelection();
      renderPeek();
    }
    await App.goLive(S.item(), null, 0);
    App.toast(`Live: ${B.formatReference(S.ref())}`);
  };

  const inSel = (v) => S.sel && v >= S.sel.start && v <= S.sel.end;

  S.ref = () => {
    if (!S.sel) return { book: S.book, chapter: S.chapter, verse: null, chapterEnd: S.chapter, verseEnd: null };
    return { book: S.book, chapter: S.chapter, verse: S.sel.start, chapterEnd: S.chapter, verseEnd: S.sel.end };
  };

  function renderPeek() {
    const box = $('#scripturePeek');
    const b = S.bible();
    if (!b) { box.innerHTML = ''; return; }
    const ref = S.ref();
    const verses = S.verses.filter((v) => ref.verse == null || (v.verse >= ref.verse && v.verse <= ref.verseEnd));
    const many = verses.length > 1 || ref.verse == null;
    box.innerHTML = `<div class="actions">
        <button class="btn small primary" data-a="add"><i data-icon="plus"></i>${many ? 'Add reading' : 'Add to service'}</button>
        <button class="btn small" data-a="preview">Preview</button>
        <button class="btn small" data-a="live">Go live</button>
      </div>
      <h3>${esc(B.formatReference(ref))} <span class="muted" style="font-weight:500">${esc(b.abbrev)}</span></h3>
      <div class="meta">${ref.verse == null
        ? 'Whole chapter · tap a verse, or drag down the list to take a range'
        : `${verses.length} verse${verses.length > 1 ? 's' : ''} · added as one reading`}</div>
      <p class="passage">${verses.slice(0, 60).map((v) => `<sup>${v.verse}</sup>${esc(v.text)}`).join(' ')}${verses.length > 60 ? ' …' : ''}</p>
      ${b.copyright ? `<p class="muted" style="font-size:11px">${esc(b.copyright)}</p>` : ''}`;
    RGIcons.hydrate(box);
    box.querySelector('[data-a="add"]').onclick = () => S.addToService();
    box.querySelector('[data-a="preview"]').onclick = () => App.setPreview(S.item(), null, 0);
    box.querySelector('[data-a="live"]').onclick = async () => { await App.setPreview(S.item(), null, 0); App.goLive(); };
  }

  S.item = () => {
    const ref = S.ref();
    const b = S.bible();
    return { type: 'scripture', bibleId: S.bibleId, abbrev: b ? b.abbrev : '', ref, title: B.formatReference(ref) };
  };

  S.addToService = () => {
    if (!S.bibleId) return;
    const item = App.addItem(S.item());
    App.setPreview(item, App.service.items.indexOf(item), 0);
  };

  // Reference or word search typed into the box.
  let t;
  async function onInput(e) {
    const q = $('#scriptureSearch').value.trim();
    const ref = B.parseReference(q);
    const box = $('#scriptureResults');
    if (!q) { box.hidden = true; $('#verseList').hidden = false; return; }
    if (ref && /\d/.test(q)) {
      box.hidden = true;
      $('#verseList').hidden = false;
      const sel = ref.verse != null ? { start: ref.verse, end: ref.chapterEnd === ref.chapter ? ref.verseEnd : 999 } : null;
      await S.open(ref.book, ref.chapter, sel);
      if (e && e.key === 'Enter') S.addToService();
      return;
    }
    if (q.length < 3) return;
    const hits = await rg.invoke('bible:search', { id: S.bibleId, q });
    $('#verseList').hidden = true;
    box.hidden = false;
    const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const mark = (s) => words.reduce((acc, w) => acc.replace(new RegExp(`(${w})`, 'gi'), '<mark>$1</mark>'), esc(s));
    box.innerHTML = `<div class="chapter-title">${hits.length >= 300 ? '300+' : hits.length} verses containing “${esc(q)}”</div>` +
      hits.map((h) => `<div class="verse-row" data-b="${h.book}" data-c="${h.chapter}" data-v="${h.verse}"><span class="vn ref">${esc(B.bookName(h.book))} ${h.chapter}:${h.verse}</span><span>${mark(h.text)}</span></div>`).join('');
    box.querySelectorAll('.verse-row').forEach((row) => (row.onclick = () => {
      box.hidden = true;
      $('#verseList').hidden = false;
      S.open(+row.dataset.b, +row.dataset.c, { start: +row.dataset.v, end: +row.dataset.v });
    }));
  }

  S.init = async () => {
    $('#scriptureSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(onInput, 180); });
    $('#scriptureSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); onInput(e); }
    });
    setupVerseSelection();
    $('#bibleSelect').addEventListener('change', async () => {
      S.bibleId = $('#bibleSelect').value;
      await S.loadStructure();
    });
    await S.loadBibles();
  };
})();
