/*
 * Lyrics model shared by the main process (CommonJS) and the renderers (window.RGLyrics).
 *
 * A song's lyrics are stored as an array of sections:
 *   { type: 'verse' | 'chorus' | 'bridge' | 'pre-chorus' | 'tag' | 'intro' | 'ending' | 'other',
 *     label: 'Verse 1', text: 'line\nline' }
 *
 * The editor works with a plain-text form:
 *   [Verse 1]
 *   line
 *   line
 *
 *   [Chorus]
 *   ...
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RGLyrics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TYPE_WORDS = {
    verse: 'verse', v: 'verse', stanza: 'verse',
    chorus: 'chorus', c: 'chorus', ch: 'chorus', cho: 'chorus', refrain: 'chorus', ref: 'chorus', r: 'chorus',
    bridge: 'bridge', b: 'bridge',
    'pre-chorus': 'pre-chorus', prechorus: 'pre-chorus', pc: 'pre-chorus',
    tag: 'tag', t: 'tag', intro: 'intro', i: 'intro', ending: 'ending', e: 'ending', outro: 'ending',
  };
  const TYPE_LABEL = {
    verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', 'pre-chorus': 'Pre-Chorus',
    tag: 'Tag', intro: 'Intro', ending: 'Ending', other: 'Section',
  };
  const TYPE_SHORT = { verse: 'V', chorus: 'C', bridge: 'B', 'pre-chorus': 'P', tag: 'T', intro: 'I', ending: 'E', other: 'S' };

  function nfc(s) {
    return (s == null ? '' : String(s)).normalize('NFC');
  }

  /** Lowercase, strip diacritics (ĩ -> i, ũ -> u) so searches work without special keyboards. */
  function searchNormalize(s) {
    return nfc(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  /** Parse "[Verse 2]" / "Chorus" / "V2" style labels. Returns {type, number} or null. */
  function parseLabel(raw, extraChorusWords) {
    const s = nfc(raw).trim().replace(/^\[|\]$/g, '').replace(/[:.]$/, '').trim();
    const m = s.match(/^([\p{L}-]+)\s*(\d+)?$/u);
    if (!m) return null;
    const word = m[1].toLowerCase();
    let type = TYPE_WORDS[word];
    if (!type && extraChorusWords && extraChorusWords.map((w) => w.toLowerCase()).includes(word)) type = 'chorus';
    if (!type) return null;
    return { type, number: m[2] ? parseInt(m[2], 10) : null };
  }

  function makeLabel(type, number) {
    const base = TYPE_LABEL[type] || 'Section';
    return number ? `${base} ${number}` : base;
  }

  /** Editor text -> sections. Untagged stanzas (split by blank lines) become numbered verses. */
  function textToSections(text, opts) {
    const extra = (opts && opts.chorusWords) || [];
    const lines = nfc(text).replace(/\r\n?/g, '\n').split('\n');
    const sections = [];
    let cur = null;
    let verseCount = 0;
    const flush = () => {
      if (cur) {
        cur.text = cur.lines.join('\n').replace(/^\n+|\n+$/g, '');
        delete cur.lines;
        if (cur.text || cur.explicit) sections.push(cur);
        delete cur.explicit;
      }
      cur = null;
    };
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, '');
      const bracket = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (bracket) {
        flush();
        const p = parseLabel(bracket[1], extra);
        const type = p ? p.type : 'other';
        let number = p ? p.number : null;
        if (type === 'verse') {
          if (number == null) number = verseCount + 1;
          verseCount = Math.max(verseCount, number);
        }
        cur = { type, label: p ? makeLabel(type, number) : bracket[1].trim(), lines: [], explicit: true };
        continue;
      }
      if (!line.trim()) {
        // Blank line: ends an untagged stanza; inside a tagged section it's kept as a slide break.
        if (cur && cur.explicit) {
          if (cur.lines.length && cur.lines[cur.lines.length - 1] !== '') cur.lines.push('');
        } else flush();
        continue;
      }
      if (!cur) {
        verseCount += 1;
        cur = { type: 'verse', label: makeLabel('verse', verseCount), lines: [] };
      }
      cur.lines.push(line.trim());
    }
    flush();
    return sections;
  }

  function sectionsToText(sections) {
    return (sections || []).map((s) => `[${s.label}]\n${s.text}`).join('\n\n');
  }

  function shortCode(section) {
    const n = (section.label.match(/(\d+)\s*$/) || [])[1] || '';
    return (TYPE_SHORT[section.type] || 'S') + n;
  }

  /**
   * Resolve the order in which sections are shown.
   *  - explicit sequence "V1 C V2 C" wins
   *  - otherwise, if autoChorus and the song has exactly one chorus, it is repeated after each verse
   */
  function resolveOrder(song, opts) {
    const sections = song.sections || [];
    const byCode = new Map(sections.map((s, i) => [shortCode(s).toUpperCase(), i]));
    const seq = (song.sequence || '').trim();
    if (seq) {
      const order = seq.split(/[\s,]+/).map((c) => byCode.get(c.toUpperCase())).filter((i) => i != null);
      if (order.length) return order;
    }
    const choruses = sections.map((s, i) => (s.type === 'chorus' ? i : -1)).filter((i) => i >= 0);
    const autoChorus = !opts || opts.autoChorus !== false;
    if (autoChorus && choruses.length === 1) {
      const c = choruses[0];
      const order = [];
      sections.forEach((s, i) => {
        if (i === c) return;
        order.push(i);
        if (s.type === 'verse') order.push(c);
      });
      // Chorus written before any verse (e.g. some hymnals print it first): show it first too.
      if (c === 0) order.unshift(c);
      if (!order.includes(c)) order.push(c);
      return order;
    }
    return sections.map((_, i) => i);
  }

  /** Split a section's text into slide-sized chunks. Blank lines inside a section force a split. */
  function chunkSection(text, maxLines) {
    const parts = nfc(text).split(/\n\s*\n/);
    const out = [];
    for (const part of parts) {
      const lines = part.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) continue;
      if (!maxLines || lines.length <= maxLines) {
        out.push(lines.join('\n'));
        continue;
      }
      const n = Math.ceil(lines.length / maxLines);
      const per = Math.ceil(lines.length / n);
      for (let i = 0; i < lines.length; i += per) out.push(lines.slice(i, i + per).join('\n'));
    }
    return out;
  }

  /**
   * Build the slide list for a song.
   * Returns [{ label, code, text, sectionIndex, first }]
   */
  function buildSlides(song, opts) {
    const maxLines = (opts && opts.maxLines) || 0;
    const sections = song.sections || [];
    const order = resolveOrder(song, opts);
    const slides = [];
    order.forEach((idx) => {
      const s = sections[idx];
      if (!s) return;
      const chunks = chunkSection(s.text, maxLines);
      chunks.forEach((text, k) => {
        slides.push({
          label: chunks.length > 1 ? `${s.label} (${k + 1}/${chunks.length})` : s.label,
          code: shortCode(s),
          type: s.type,
          text,
          sectionIndex: idx,
        });
      });
    });
    if (slides.length) slides[0].first = true;
    return slides;
  }

  return { nfc, searchNormalize, parseLabel, makeLabel, textToSections, sectionsToText, shortCode, resolveOrder, chunkSection, buildSlides };
});
