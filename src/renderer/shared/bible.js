/*
 * Bible book list and scripture reference parsing, shared by main (CommonJS) and renderers (window.RGBible).
 * Books are numbered 1-66 in Protestant canon order; that number is how verses are stored.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RGBible = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // [name, OSIS id, extra aliases...]
  const RAW = [
    ['Genesis', 'Gen', 'gn', 'ge'], ['Exodus', 'Exod', 'ex', 'exo'], ['Leviticus', 'Lev', 'lv', 'le'], ['Numbers', 'Num', 'nm', 'nu'],
    ['Deuteronomy', 'Deut', 'dt', 'de'], ['Joshua', 'Josh', 'js', 'jos'], ['Judges', 'Judg', 'jg', 'jdg', 'jdgs'], ['Ruth', 'Ruth', 'rt', 'ru'],
    ['1 Samuel', '1Sam', '1sm', '1sa'], ['2 Samuel', '2Sam', '2sm', '2sa'], ['1 Kings', '1Kgs', '1ki', '1kg', '1k'], ['2 Kings', '2Kgs', '2ki', '2kg', '2k'],
    ['1 Chronicles', '1Chr', '1ch', '1chron'], ['2 Chronicles', '2Chr', '2ch', '2chron'], ['Ezra', 'Ezra', 'ezr'], ['Nehemiah', 'Neh', 'ne'],
    ['Esther', 'Esth', 'est', 'es'], ['Job', 'Job', 'jb'], ['Psalms', 'Ps', 'psalm', 'psa', 'pss', 'psm'], ['Proverbs', 'Prov', 'pr', 'prv', 'pro'],
    ['Ecclesiastes', 'Eccl', 'ec', 'ecc', 'qoh'], ['Song of Solomon', 'Song', 'song of songs', 'sos', 'so', 'canticles', 'sng'], ['Isaiah', 'Isa', 'is'], ['Jeremiah', 'Jer', 'je', 'jr'],
    ['Lamentations', 'Lam', 'la'], ['Ezekiel', 'Ezek', 'eze', 'ezk'], ['Daniel', 'Dan', 'da', 'dn'], ['Hosea', 'Hos', 'ho'],
    ['Joel', 'Joel', 'jl'], ['Amos', 'Amos', 'am'], ['Obadiah', 'Obad', 'ob'], ['Jonah', 'Jonah', 'jon', 'jnh'],
    ['Micah', 'Mic', 'mi'], ['Nahum', 'Nah', 'na'], ['Habakkuk', 'Hab', 'hb'], ['Zephaniah', 'Zeph', 'zep', 'zp'],
    ['Haggai', 'Hag', 'hg'], ['Zechariah', 'Zech', 'zec', 'zc'], ['Malachi', 'Mal', 'ml'], ['Matthew', 'Matt', 'mt', 'mat'],
    ['Mark', 'Mark', 'mk', 'mr', 'mrk'], ['Luke', 'Luke', 'lk', 'lu'], ['John', 'John', 'jn', 'jhn', 'joh'], ['Acts', 'Acts', 'ac', 'act'],
    ['Romans', 'Rom', 'ro', 'rm'], ['1 Corinthians', '1Cor', '1co'], ['2 Corinthians', '2Cor', '2co'], ['Galatians', 'Gal', 'ga'],
    ['Ephesians', 'Eph', 'ep'], ['Philippians', 'Phil', 'php', 'pp'], ['Colossians', 'Col', 'co'], ['1 Thessalonians', '1Thess', '1th', '1ts'],
    ['2 Thessalonians', '2Thess', '2th', '2ts'], ['1 Timothy', '1Tim', '1ti', '1tm'], ['2 Timothy', '2Tim', '2ti', '2tm'], ['Titus', 'Titus', 'ti', 'tt'],
    ['Philemon', 'Phlm', 'phm', 'pm', 'philem'], ['Hebrews', 'Heb', 'he'], ['James', 'Jas', 'jm', 'ja'], ['1 Peter', '1Pet', '1pe', '1pt', '1p'],
    ['2 Peter', '2Pet', '2pe', '2pt', '2p'], ['1 John', '1John', '1jn', '1jo', '1j'], ['2 John', '2John', '2jn', '2jo', '2j'], ['3 John', '3John', '3jn', '3jo', '3j'],
    ['Jude', 'Jude', 'jud', 'jd'], ['Revelation', 'Rev', 're', 'rv', 'revelations', 'apocalypse'],
  ];
  const BOOKS = RAW.map(([name, osis, ...aliases], i) => ({ n: i + 1, name, osis, aliases }));

  const norm = (s) => String(s || '').toLowerCase()
    .replace(/^(i{1,3})\s+(?=[a-z])/, (m, r) => `${r.length} `) // "II Kings" -> "2 kings"
    .replace(/^(first|1st)\s+/, '1 ').replace(/^(second|2nd)\s+/, '2 ').replace(/^(third|3rd)\s+/, '3 ')
    .replace(/[^a-z0-9]/g, '');

  const exact = new Map();
  for (const b of BOOKS) for (const a of [b.name, b.osis, ...b.aliases]) exact.set(norm(a), b);

  /** Find a book from a name, abbreviation or unambiguous prefix ("Philipp", "1 Cor", "Jn"). */
  function findBook(s) {
    const k = norm(s);
    if (!k) return null;
    if (exact.has(k)) return exact.get(k);
    const hits = BOOKS.filter((b) => norm(b.name).startsWith(k));
    if (hits.length === 1 || (hits.length && k.length >= 3)) return hits[0];
    return null;
  }

  /** Book number from a name or OSIS id, as found in imported Bible files. */
  function bookNumber(nameOrId) {
    const b = findBook(nameOrId);
    return b ? b.n : null;
  }

  /**
   * Parse "John 3:16", "Jn 3 16-18", "Gen 1", "Rom 8:28-9:2", "1 Cor 13:4,7" (commas become a range),
   * "Ps 23:1-". Returns { book, chapter, verse, chapterEnd, verseEnd } (verse null = whole chapter).
   */
  function parseReference(input) {
    const s = String(input || '').trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
    const m = s.match(/^((?:[1-3]|i{1,3})?\s*[a-z][a-z .]*?)\s*(\d+)(?:\s*[:. ]\s*(\d+)(?:\s*[-,]\s*(\d+)(?:\s*[:.]\s*(\d+))?)?)?\s*-?\s*$/i);
    if (!m) {
      const b = findBook(s);
      return b ? { book: b.n, chapter: 1, verse: null, chapterEnd: 1, verseEnd: null } : null;
    }
    const b = findBook(m[1]);
    if (!b) return null;
    const chapter = +m[2];
    const verse = m[3] ? +m[3] : null;
    let chapterEnd = chapter;
    let verseEnd = verse;
    if (m[4] && m[5]) { chapterEnd = +m[4]; verseEnd = +m[5]; } // 8:28-9:2
    else if (m[4]) verseEnd = +m[4];
    else if (verse != null && /-\s*$/.test(s)) verseEnd = 999; // "Ps 23:4-" = to end of chapter
    if (chapterEnd < chapter || (chapterEnd === chapter && verseEnd != null && verseEnd < verse)) { chapterEnd = chapter; verseEnd = verse; }
    return { book: b.n, chapter, verse, chapterEnd, verseEnd };
  }

  function bookName(n) {
    return (BOOKS[n - 1] || {}).name || `Book ${n}`;
  }

  /** "John 3:16-18", "Romans 8:28–9:2", "Psalms 23". */
  function formatReference(r) {
    const name = bookName(r.book);
    if (r.verse == null) return `${name} ${r.chapter}`;
    if (r.chapterEnd && r.chapterEnd !== r.chapter) return `${name} ${r.chapter}:${r.verse}–${r.chapterEnd}:${r.verseEnd}`;
    if (r.verseEnd && r.verseEnd !== r.verse) return `${name} ${r.chapter}:${r.verse}–${r.verseEnd}`;
    return `${name} ${r.chapter}:${r.verse}`;
  }

  /**
   * Split verses [{chapter, verse, text}] into slides. Verses are kept whole unless one alone is too long.
   * Each slide gets its own reference ("John 3:16–17").
   */
  function buildScriptureSlides(verses, ref, opts) {
    const maxChars = (opts && opts.maxChars) || 320;
    const perSlide = (opts && opts.versesPerSlide) || 0;
    const showNumbers = !opts || opts.verseNumbers !== false;
    const multiChapter = verses.length && verses[0].chapter !== verses[verses.length - 1].chapter;
    const slides = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const a = cur[0];
      const z = cur[cur.length - 1];
      const r = { book: ref.book, chapter: a.chapter, verse: a.verse, chapterEnd: z.chapter, verseEnd: z.verse };
      slides.push({
        label: `${a.chapter}:${a.verse}${cur.length > 1 ? `–${z.chapter !== a.chapter ? z.chapter + ':' : ''}${z.verse}` : ''}`,
        code: '',
        type: 'scripture',
        reference: formatReference(r),
        text: cur.map((v) => (showNumbers ? sup(`${multiChapter && v.verse === 1 ? v.chapter + ':' : ''}${v.verse}`) : '') + v.text).join(' '),
      });
      cur = [];
    };
    for (const v of verses) {
      const len = cur.reduce((n, x) => n + x.text.length, 0);
      if (cur.length && ((perSlide && cur.length >= perSlide) || (!perSlide && len + v.text.length > maxChars))) flush();
      cur.push(v);
    }
    flush();
    if (slides.length) slides[0].first = true;
    return slides;
  }

  /** Superscript verse numbers (¹⁶) read like a printed Bible and don't compete with the text. */
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', ':': 'ː' };
  function sup(n) { return String(n).replace(/[0-9:]/g, (d) => SUP[d]) + ' '; }

  return { BOOKS, findBook, bookNumber, bookName, parseReference, formatReference, buildScriptureSlides };
});
