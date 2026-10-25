/* Inkelle .inkelle package parser. DOM-free: runs in browsers and node.
 * Layout reference: Inkelle/Services/NoteShareService.swift, docs/IPSF.md.
 * Usage: InkelleParse.parseInkelle(uint8Array, fflate) -> parsed note. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InkelleParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Logical canvas sizes (Page.canvasSize); portrait w x h.
  var PAPER = { a4: [750, 1060], letter: [819, 1060] };
  var DEFAULT_PAPER = [820, 1060];

  function decodeText(u8) {
    return new TextDecoder('utf-8').decode(u8);
  }

  function parseJSON(u8, what) {
    try { return JSON.parse(decodeText(u8)); }
    catch (e) { throw new Error('Invalid JSON in ' + what); }
  }

  function sniffMime(u8) {
    if (u8.length > 3 && u8[0] === 0x89 && u8[1] === 0x50) return 'image/png';
    if (u8.length > 2 && u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
    if (u8.length > 11 && u8[0] === 0x52 && u8[8] === 0x57) return 'image/webp';
    if (u8.length > 5 && u8[0] === 0x47 && u8[1] === 0x49) return 'image/gif';
    if (u8.length > 12 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return 'image/heic';
    return 'application/octet-stream';
  }

  // NSData.compressed(using: .zlib) is raw deflate; accept zlib-wrapped too.
  function inflateAny(u8, fflate) {
    var wrapped = u8.length > 2 && (u8[0] & 0x0f) === 8 && ((u8[0] << 8) | u8[1]) % 31 === 0;
    var order = wrapped ? ['unzlibSync', 'inflateSync'] : ['inflateSync', 'unzlibSync'];
    var lastErr;
    for (var i = 0; i < order.length; i++) {
      try { return fflate[order[i]](u8); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('inflate failed');
  }

  /** Validates an IPSF v1 document (mirrors IPSFDocument.init(from:)). */
  function parseIPSF(u8) {
    var doc = parseJSON(u8, 'IPSF');
    if (!doc || doc.ipsf !== 1) throw new Error('Unsupported IPSF version ' + (doc && doc.ipsf));
    if (!doc.canvas || !isFinite(doc.canvas.w) || !isFinite(doc.canvas.h)) throw new Error('IPSF canvas missing');
    if (!Array.isArray(doc.strokes)) throw new Error('IPSF strokes missing');
    doc.strokes.forEach(function (s) {
      var ok = Array.isArray(s.points) && s.points.every(function (p) {
        return Array.isArray(p) && p.length >= 2 && p.every(function (n) { return typeof n === 'number' && isFinite(n); });
      });
      if (s.transform != null && !(Array.isArray(s.transform) && s.transform.length === 6 &&
          s.transform.every(function (n) { return typeof n === 'number' && isFinite(n); }))) ok = false;
      if (!ok || !isFinite(s.width)) throw new Error('Malformed IPSF stroke ' + s.id);
    });
    return doc;
  }

  /** '#RRGGBB' or '#RRGGBBAA' -> {r,g,b,a} (a in 0..1). */
  function parseColor(hex, fallback) {
    var m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || ''));
    if (!m) return fallback || { r: 0, g: 0, b: 0, a: 1 };
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }

  function pageSize(pm) {
    if (pm.authoredWidth > 0 && pm.authoredHeight > 0) return { w: pm.authoredWidth, h: pm.authoredHeight };
    var p = PAPER[pm.paperSizeRaw] || DEFAULT_PAPER;
    return pm.isLandscape ? { w: p[1], h: p[0] } : { w: p[0], h: p[1] };
  }

  function findEntry(files, base, rel) {
    return files[base + rel] || null;
  }

  function parseInkelle(u8, fflate) {
    var files;
    try { files = fflate.unzipSync(u8); } catch (e) { throw new Error('Not a valid zip (.inkelle) file'); }
    var noteKey = Object.keys(files)
      .filter(function (k) { return k === 'note.json' || /(^|\/)note\.json$/.test(k); })
      .sort(function (a, b) { return a.length - b.length; })[0];
    if (!noteKey) throw new Error('note.json not found');
    var base = noteKey.slice(0, noteKey.length - 'note.json'.length);

    var manifest = parseJSON(files[noteKey], 'note.json');
    var version = manifest.version | 0;
    var pagesEntry = findEntry(files, base, 'pages.json');
    if (!pagesEntry) throw new Error('pages.json not found');
    var pageManifests = parseJSON(pagesEntry, 'pages.json');
    if (!Array.isArray(pageManifests)) throw new Error('pages.json must be an array');
    pageManifests = pageManifests.slice().sort(function (a, b) { return (a.pageIndex | 0) - (b.pageIndex | 0); });

    var warnings = [];
    var pdf = findEntry(files, base, 'document.pdf');

    var pages = pageManifests.map(function (pm, i) {
      var size = pageSize(pm);
      var ipsf = null;
      if (pm.ipsfFileName) {
        var name = String(pm.ipsfFileName).split('/').pop();
        var raw = findEntry(files, base, 'pages/' + name);
        if (raw) {
          try {
            ipsf = parseIPSF(/\.z$/.test(name) ? inflateAny(raw, fflate) : raw);
          } catch (e) { warnings.push('page ' + (i + 1) + ': ' + e.message); }
        }
      }
      var thumb = pm.thumbnailFileName
        ? findEntry(files, base, 'pages/' + String(pm.thumbnailFileName).split('/').pop()) : null;
      var images = (pm.imageAnnotations || []).map(function (ia) {
        var data = findEntry(files, base, 'images/' + String(ia.fileName).split('/').pop());
        return data ? Object.assign({}, ia, { data: data, mime: sniffMime(data) }) : null;
      }).filter(Boolean);
      return {
        index: i,
        template: pm.templateRaw || 'blank',
        size: size,
        rotation: (((pm.rotationDegrees | 0) % 360) + 360) % 360,
        pdfPageIndex: pm.pdfPageIndex | 0,
        ipsf: ipsf,
        thumbnail: thumb,
        texts: pm.textAnnotations || [],
        images: images,
        tapes: pm.tapeAnnotations || [],
        equations: pm.equationAnnotations || [],
        links: pm.linkAnnotations || [],
        shapes: (pm.shapeAnnotations || []).slice().sort(function (a, b) { return (a.zIndex | 0) - (b.zIndex | 0); }),
      };
    });

    var hasInk = pages.some(function (p) { return p.ipsf; });
    var hasThumb = pages.some(function (p) { return p.thumbnail; });
    return {
      manifest: manifest,
      version: version,
      title: manifest.title || '',
      pages: pages,
      pdf: pdf,
      hasRenderableInk: hasInk,
      legacyNoInk: !hasInk && !hasThumb && !pdf && version < 5,
      warnings: warnings,
    };
  }

  return {
    parseInkelle: parseInkelle, parseIPSF: parseIPSF, parseColor: parseColor,
    pageSize: pageSize, sniffMime: sniffMime, inflateAny: inflateAny,
  };
});
