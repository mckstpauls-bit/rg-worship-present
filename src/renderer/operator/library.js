/* Library: folders, search, song peek, media, saved services. */
(function () {
  const { $, $$ } = App;
  const rg = window.rg;

  const Library = {
    folder: '',
    results: [],
    sel: -1,
    selected: null,
  };
  window.Library = Library;

  Library.loadFolders = async () => {
    const folders = await rg.invoke('songs:folders');
    const total = folders.reduce((a, f) => a + f.count, 0);
    const box = $('#folders');
    box.innerHTML = '';
    const mk = (name, label, count) => {
      const b = document.createElement('button');
      b.className = 'folder' + (Library.folder === name ? ' active' : '');
      b.innerHTML = `<span>${App.esc(label)}</span><span class="count">${count}</span>`;
      b.onclick = () => {
        Library.folder = name;
        Library.loadFolders();
        Library.search();
      };
      box.appendChild(b);
    };
    mk('', 'All songs', total);
    for (const f of folders) mk(f.folder, f.folder, f.count);
  };

  let searchSeq = 0;
  Library.search = async () => {
    const seq = ++searchSeq;
    const q = $('#search').value;
    const rows = await rg.invoke('songs:search', { q, folder: Library.folder || null, limit: 1500 });
    if (seq !== searchSeq) return; // a newer search finished first
    Library.results = rows;
    Library.sel = rows.length ? 0 : -1;
    renderList();
    if (rows.length) Library.peek(rows[0].id);
    else $('#songPeek').innerHTML = `<p class="muted">No songs match “${App.esc(q)}”.</p>`;
  };

  function renderList() {
    const list = $('#songList');
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    Library.results.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'song-row' + (i === Library.sel ? ' sel' : '');
      row.draggable = true;
      row.innerHTML = `<span class="n">${App.esc(s.number || '')}</span><span>${App.esc(s.title)}</span><span class="aka">${App.esc(s.alt_title || '')}</span><span class="fd">${App.esc(s.folder || '')}</span>`;
      row.addEventListener('click', () => select(i));
      row.addEventListener('dblclick', () => App.addSong(s.id));
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-rg-song', String(s.id));
        e.dataTransfer.effectAllowed = 'copy';
      });
      frag.appendChild(row);
    });
    list.appendChild(frag);
  }

  function select(i) {
    Library.sel = i;
    $$('.song-row', $('#songList')).forEach((r, k) => r.classList.toggle('sel', k === i));
    const row = $$('.song-row', $('#songList'))[i];
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (Library.results[i]) Library.peek(Library.results[i].id);
  }

  Library.peek = async (id) => {
    const s = await App.getSong(id, true);
    Library.selected = s;
    const box = $('#songPeek');
    if (!s) { box.innerHTML = ''; return; }
    const meta = [s.number && `No. ${s.number}`, s.author, s.alt_title && `English: ${s.alt_title}`, s.folder].filter(Boolean).map(App.esc).join(' · ');
    box.innerHTML = `<div class="actions">
        <button class="btn small primary" data-a="add"><i data-icon="plus"></i>Add to service</button>
        <button class="btn small" data-a="edit"><i data-icon="edit"></i>Edit</button>
        <button class="btn small" data-a="preview">Preview</button>
      </div>
      <h3>${App.esc(s.title)}</h3><div class="meta">${meta}${s.tags.includes('proofread') ? ' · <span style="color:var(--gold)">needs proofreading</span>' : ''}</div>
      ${s.sections.map((x) => `<div class="sec ${x.type}"><b>${App.esc(x.label)}</b><p>${App.esc(x.text)}</p></div>`).join('')}`;
    RGIcons.hydrate(box);
    box.querySelector('[data-a="add"]').onclick = () => App.addSong(s.id);
    box.querySelector('[data-a="edit"]').onclick = () => Dialogs.editSong(s);
    box.querySelector('[data-a="preview"]').onclick = () => App.setPreview({ type: 'song', songId: s.id, title: s.title, number: s.number, folder: s.folder, language: s.language }, null, 0);
  };

  // ---------- media ----------
  Library.loadMedia = async () => {
    const items = await rg.invoke('media:list');
    const grid = $('#mediaGrid');
    grid.innerHTML = '';
    if (!items.length) grid.innerHTML = '<p class="muted">No media yet. Add photos or looping videos for backgrounds and announcements.</p>';
    for (const m of items) {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.draggable = true;
      const url = RGRender.mediaUrl(m.rel_path);
      card.innerHTML = (m.type === 'video' ? `<video class="thumb" src="${url}" muted preload="metadata"></video>` : `<img class="thumb" src="${url}" loading="lazy">`) +
        `<div class="cap">${App.esc(m.name)}</div>` + (m.rel_path.startsWith('user/') ? '<button class="mini del" title="Remove"><i data-icon="trash"></i></button>' : '');
      card.addEventListener('dblclick', () => App.addMediaItem(m));
      card.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-rg-media', JSON.stringify(m)));
      const del = card.querySelector('.del');
      if (del) del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove “${m.name}” from the media library?`)) return;
        await rg.invoke('media:delete', m.id);
        Library.loadMedia();
      };
      grid.appendChild(card);
    }
    RGIcons.hydrate(grid);
  };

  // ---------- saved services ----------
  Library.loadServices = async () => {
    const list = await rg.invoke('services:list');
    const box = $('#servicesList');
    box.innerHTML = list.length ? '' : '<p class="muted">No saved services yet. Build one in the Service panel and press Ctrl+S.</p>';
    for (const s of list) {
      const row = document.createElement('div');
      row.className = 'svc-row';
      row.innerHTML = `<i data-icon="book"></i><b>${App.esc(s.name)}</b><span class="muted">${new Date(s.updated_at).toLocaleString()}</span>
        <button class="btn small" data-a="open">Open</button><button class="mini" data-a="del" title="Delete"><i data-icon="trash"></i></button>`;
      row.querySelector('[data-a="open"]').onclick = () => App.openService(s.id);
      row.addEventListener('dblclick', () => App.openService(s.id));
      row.querySelector('[data-a="del"]').onclick = async () => {
        if (!confirm(`Delete saved service “${s.name}”?`)) return;
        await rg.invoke('services:delete', s.id);
        Library.loadServices();
      };
      box.appendChild(row);
    }
    RGIcons.hydrate(box);
  };

  Library.init = () => {
    let t;
    $('#search').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(Library.search, 120);
    });
    $('#search').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); select(Math.min(Library.sel + 1, Library.results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); select(Math.max(Library.sel - 1, 0)); }
      if (e.key === 'Enter' && Library.results[Library.sel]) { e.preventDefault(); App.addSong(Library.results[Library.sel].id); }
    });
    $('#songList').addEventListener('keydown', (e) => {
      // Arrow keys here browse the list; they must not reach the live-slide shortcuts.
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); select(Math.min(Library.sel + 1, Library.results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); select(Math.max(Library.sel - 1, 0)); }
      if (e.key === 'Enter' && Library.results[Library.sel]) { e.preventDefault(); e.stopPropagation(); App.addSong(Library.results[Library.sel].id); }
    });
    $$('#libTabs .tab').forEach((tab) => {
      tab.onclick = () => {
        $$('#libTabs .tab').forEach((x) => x.classList.toggle('active', x === tab));
        $$('.lib-body').forEach((b) => (b.hidden = b.dataset.body !== tab.dataset.tab));
        if (tab.dataset.tab === 'media') Library.loadMedia();
        if (tab.dataset.tab === 'services') Library.loadServices();
      };
    });
  };

  Library.refresh = async () => {
    App.songCache.clear();
    await Library.loadFolders();
    await Library.search();
  };
})();
