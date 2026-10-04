/*
 * Slide renderer shared by the audience output, the operator's preview/live monitors and thumbnails,
 * so what the operator sees is exactly what goes on the wall.
 *
 * Everything is laid out on a fixed 1920x1080 stage and scaled to fit its container.
 *
 * Payload:
 *  { mode: 'slide' | 'media' | 'blank',
 *    text, label, first, item: {title, number, author, copyright, kind},
 *    theme, media: {type, url}, logoUrl,
 *    cover: null | 'black' | 'logo' | 'clear',
 *    transition: {type: 'fade' | 'cut', ms}, fontFallback }
 */
(function () {
  const W = 1920;
  const H = 1080;

  function mediaUrl(rel) {
    if (!rel) return '';
    if (/^(rgmedia|https?|data|file):/.test(rel)) return rel;
    return 'rgmedia://media/' + rel.split('/').map(encodeURIComponent).join('/');
  }

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function bgKey(p) {
    if (p.mode === 'media' && p.media) return 'media:' + p.media.url;
    const b = (p.theme && p.theme.background) || {};
    return (b.type || 'color') + ':' + (b.value || '#000') + '|' + ((p.theme && p.theme.overlay) || '');
  }

  function buildBackground(p) {
    const layer = el('div', 'rg-layer rg-bg');
    if (p.mode === 'media' && p.media) {
      addMedia(layer, p.media.type, mediaUrl(p.media.url), 'contain');
      return layer;
    }
    const b = (p.theme && p.theme.background) || { type: 'color', value: '#000' };
    if (b.type === 'image' || b.type === 'video') addMedia(layer, b.type, mediaUrl(b.value), 'cover');
    else layer.style.background = b.value || '#000';
    if (p.theme && p.theme.overlay) el('div', 'rg-fill', layer).style.background = p.theme.overlay;
    return layer;
  }

  function addMedia(parent, type, url, fit) {
    if (type === 'video') {
      const v = el('video', 'rg-fill rg-media', parent);
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      v.style.objectFit = fit;
      v.play().catch(() => {});
    } else {
      const i = el('img', 'rg-fill rg-media', parent);
      i.src = url;
      i.style.objectFit = fit;
    }
  }

  /** Remaining time as "5:00" / "1:02:30"; empty once it reaches zero. */
  function countdownText(until) {
    let left = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    const s = left % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
  }

  function buildCountdown(p) {
    const layer = el('div', 'rg-layer rg-text-layer');
    const t = p.theme || {};
    const f = t.font || {};
    const family = [f.family ? `"${f.family}"` : '', p.fontFallback || '"Segoe UI", sans-serif'].filter(Boolean).join(', ');
    const box = el('div', 'rg-box rg-countdown', layer);
    box.style.cssText = 'left:8%;top:12%;width:84%;height:70%;flex-direction:column;align-items:center;justify-content:center;gap:28px';
    const clock = el('div', 'rg-clock', box);
    clock.style.cssText = `font-family:${family};font-weight:${f.weight || 600};color:${f.color || '#fff'};` +
      'font-size:300px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:.02em;' +
      (f.shadow ? 'text-shadow:0 4px 18px rgba(0,0,0,.6);' : '');
    const msg = el('div', 'rg-cd-msg', box);
    msg.style.cssText = `font-family:${family};color:${f.color || '#fff'};opacity:.86;font-size:64px;text-align:center;white-space:pre-wrap;` +
      (f.shadow ? 'text-shadow:0 3px 12px rgba(0,0,0,.6);' : '');
    msg.textContent = p.text || '';
    const tick = () => {
      const v = countdownText(p.until);
      clock.textContent = v;
      if (v === '0:00' && p.endText) { clock.textContent = ''; msg.textContent = p.endText; }
    };
    tick();
    layer._tick = tick;
    return layer;
  }

  function buildText(p, opts) {
    if (p.mode === 'countdown') return buildCountdown(p);
    const layer = el('div', 'rg-layer rg-text-layer');
    if (p.mode !== 'slide' || !p.text) return layer;
    const t = p.theme || {};
    const f = t.font || {};
    const box = t.box || { x: 7, y: 9, w: 86, h: 74 };
    if (t.band) {
      const band = el('div', 'rg-band', layer);
      band.style.cssText = `left:0;right:0;top:${box.y - 3}%;height:${box.h + 6}%;background:${t.band}`;
    }
    const boxEl = el('div', 'rg-box', layer);
    boxEl.style.cssText = `left:${box.x}%;top:${box.y}%;width:${box.w}%;height:${box.h}%;` +
      `align-items:${{ top: 'flex-start', middle: 'center', bottom: 'flex-end' }[t.valign || 'middle']};` +
      `justify-content:${{ left: 'flex-start', center: 'center', right: 'flex-end' }[t.align || 'center']};`;
    const text = el('div', 'rg-text', boxEl);
    text.textContent = p.text;
    const family = [f.family ? `"${f.family}"` : '', p.fontFallback || '"Segoe UI", sans-serif'].filter(Boolean).join(', ');
    text.style.cssText = `font-family:${family};font-weight:${f.weight || 600};color:${f.color || '#fff'};` +
      `line-height:${f.lineHeight || 1.25};text-align:${t.align || 'center'};` +
      (f.uppercase ? 'text-transform:uppercase;' : '') +
      (f.shadow ? 'text-shadow:0 3px 14px rgba(0,0,0,.65),0 1px 3px rgba(0,0,0,.8);' : '') +
      (f.outline ? `-webkit-text-stroke:${f.outline}px rgba(0,0,0,.85);paint-order:stroke fill;` : '');
    const footer = t.footer || {};
    if (p.item && p.item.kind === 'scripture' && p.item.reference && footer.scripture !== false) {
      // Scripture always shows its reference: people look for it.
      const ft = el('div', 'rg-footer rg-ref', layer);
      ft.textContent = p.item.reference + (p.item.abbrev ? `  ·  ${p.item.abbrev}` : '');
      ft.style.cssText = `font-size:${Math.max(30, (footer.size || 26) + 8)}px;color:${footer.color || 'rgba(255,255,255,.75)'};font-family:${family};text-align:${t.align === 'left' ? 'left' : 'center'};font-weight:600`;
    } else if (footer.show && p.item && p.item.kind === 'song') {
      const ft = el('div', 'rg-footer', layer);
      ft.textContent = (footer.template || '{title}')
        .replace('{title}', p.item.title || '')
        .replace('{number}', p.item.number ? `${p.item.number}.` : '')
        .replace('{author}', p.item.author || '')
        .replace('{copyright}', p.item.copyright || '')
        .replace(/\s+/g, ' ')
        .trim();
      ft.style.cssText = `font-size:${footer.size || 26}px;color:${footer.color || 'rgba(255,255,255,.7)'};font-family:${family};text-align:${t.align === 'left' ? 'left' : 'center'}`;
    }
    layer._fit = () => fitText(text, boxEl, f.maxSize || 92, f.minSize || 28);
    if (!opts || opts.fit !== false) layer._fit();
    return layer;
  }

  /** Largest font size (binary search) at which the text fits its box without wrapping overflow. */
  function fitText(text, box, max, min) {
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    if (!bw || !bh) return;
    let lo = min;
    let hi = max;
    let best = min;
    for (let i = 0; i < 9 && lo <= hi; i++) {
      const mid = Math.floor((lo + hi) / 2);
      text.style.fontSize = mid + 'px';
      if (text.scrollHeight <= bh && text.scrollWidth <= bw + 1) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    text.style.fontSize = best + 'px';
  }

  function coverLayer(kind, logoUrl) {
    const c = el('div', 'rg-layer rg-cover');
    if (kind === 'black') c.style.background = '#000';
    if (kind === 'logo') {
      c.style.background = '#000';
      if (logoUrl) addMedia(c, /\.(mp4|webm|mov|m4v)$/i.test(logoUrl) ? 'video' : 'image', mediaUrl(logoUrl), 'contain');
    }
    return c;
  }

  /** A live, transitioning stage (output window and monitors). */
  function createStage(container, opts) {
    opts = opts || {};
    container.classList.add('rg-viewport');
    const stage = el('div', 'rg-stage', container);
    const bgHost = el('div', 'rg-host', stage);
    const textHost = el('div', 'rg-host', stage);
    const coverHost = el('div', 'rg-host', stage);
    let curBgKey = null;
    let curCover = null;
    let tickTimer = null;
    let lastPayload = null;

    function scale() {
      const s = Math.min(container.clientWidth / W, container.clientHeight / H) || 0;
      stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    }
    const ro = new ResizeObserver(scale);
    ro.observe(container);
    scale();

    function swap(host, layer, ms) {
      const old = [...host.children];
      layer.style.opacity = ms ? '0' : '1';
      host.appendChild(layer);
      if (layer._fit) layer._fit();
      if (!ms) {
        old.forEach((o) => o.remove());
        return;
      }
      layer.style.transition = `opacity ${ms}ms ease`;
      requestAnimationFrame(() => requestAnimationFrame(() => (layer.style.opacity = '1')));
      old.forEach((o) => {
        o.style.transition = `opacity ${ms}ms ease`;
        o.style.opacity = '0';
      });
      setTimeout(() => old.forEach((o) => o.remove()), ms + 60);
    }

    function show(p) {
      lastPayload = p;
      clearInterval(tickTimer);
      const ms = opts.noTransitions || !p.transition || p.transition.type === 'cut' ? 0 : p.transition.ms || 400;
      const k = bgKey(p);
      if (k !== curBgKey) {
        swap(bgHost, buildBackground(p), ms);
        curBgKey = k;
      }
      const textLayer = buildText(p, { fit: false });
      swap(textHost, textLayer, ms);
      // A countdown keeps counting after it is shown.
      if (textLayer._tick) tickTimer = setInterval(() => textLayer._tick(), 250);
      const cover = p.cover || null;
      if (cover !== curCover) {
        if (cover === 'clear') swap(coverHost, el('div', 'rg-layer'), ms);
        else swap(coverHost, cover ? coverLayer(cover, p.logoUrl) : el('div', 'rg-layer'), ms);
        textHost.style.transition = `opacity ${ms}ms ease`;
        textHost.style.opacity = cover === 'clear' ? '0' : '1';
        curCover = cover;
      }
    }

    return {
      show,
      refit() {
        const l = textHost.lastElementChild;
        if (l && l._fit) l._fit();
      },
      get payload() { return lastPayload; },
      destroy() { clearInterval(tickTimer); ro.disconnect(); container.innerHTML = ''; },
    };
  }

  /** A static render (thumbnails, editor previews). */
  function renderStatic(container, p) {
    container.innerHTML = '';
    const st = createStage(container, { noTransitions: true });
    st.show({ ...p, transition: { type: 'cut' } });
    return st;
  }

  window.RGRender = { createStage, renderStatic, mediaUrl, W, H };
})();
