/* Inkelle read-only web viewer. Everything runs in the browser; the file is never uploaded. */
(function () {
  'use strict';
  var P = window.InkelleParse;

  var I18N = {
    zh: {
      home: '返回首页', heading: '在线查看器', lead: '把 .inkelle 文件拖到这里，或点击选择文件。', choose: '选择文件',
      privacy: '文件不离开你的设备：所有解析与渲染都在本机浏览器中完成，不会上传到任何服务器。',
      readonly: '只读预览：支持笔迹、纸张、文本框、图片、图形与胶带；PDF 背景以占位显示。',
      fit: '适应宽度', openOther: '打开其他文件', pdf: '此页为 PDF 背景（在线查看器暂不显示 PDF 内容，笔迹已绘制）',
      legacy: '此文件由旧版导出，无可渲染笔迹。', noPages: '此文件没有页面。', bad: '无法打开该文件：',
      warn: '部分页面笔迹损坏，已跳过：', page: '页', thumbOnly: '此页无矢量笔迹，显示导出时的缩略图。',
    },
    en: {
      home: 'Home', heading: 'Online Viewer', lead: 'Drop a .inkelle file here, or click to choose one.', choose: 'Choose file',
      privacy: 'Your file never leaves your device: parsing and rendering happen entirely in this browser, with no upload to any server.',
      readonly: 'Read-only preview: ink, paper, text boxes, images, shapes and tape are supported; PDF backgrounds show a placeholder.',
      fit: 'Fit width', openOther: 'Open another file', pdf: 'This page has a PDF background (not shown in the web viewer; ink is drawn)',
      legacy: 'This file was exported by an older version and has no renderable ink.', noPages: 'This file has no pages.', bad: 'Cannot open this file: ',
      warn: 'Some pages had damaged ink and were skipped: ', page: 'Page', thumbOnly: 'No vector ink on this page; showing the exported thumbnail.',
    },
  };
  var lang = /^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en';
  if (!navigator.language) lang = 'zh';
  var T = I18N[lang];
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = T[el.dataset.i18n]; });
  document.title = lang === 'zh' ? 'Inkelle 在线查看器' : 'Inkelle Viewer';

  var $ = function (id) { return document.getElementById(id); };
  var state = { note: null, cur: 0, zoom: 1, token: 0 };

  // ---------- paper templates (simple rules; others fall back to blank) ----------
  function drawTemplate(ctx, name, w, h) {
    ctx.save();
    ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
    function rows(alpha, lw, from, below, sp, x0, x1) {
      ctx.globalAlpha = alpha; ctx.lineWidth = lw; ctx.beginPath();
      for (var y = from; y < below; y += sp) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
    }
    function cols(alpha, lw, from, below, sp, y0, y1) {
      ctx.globalAlpha = alpha; ctx.lineWidth = lw; ctx.beginPath();
      for (var x = from; x < below; x += sp) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      ctx.stroke();
    }
    switch (name) {
      case 'lined': rows(0.55, 0.5, 70, h - 70, 34, 60, w - 60); break;
      case 'narrowRuled': rows(0.55, 0.5, 70, h - 70, 26, 60, w - 60); break;
      case 'wideRuled': rows(0.55, 0.5, 70, h - 70, 44, 60, w - 60); break;
      case 'grid': cols(0.38, 0.5, 30, w, 34, 0, h); rows(0.38, 0.5, 30, h, 34, 0, w); break;
      case 'dotted':
      case 'isometricDots': {
        ctx.globalAlpha = 0.7;
        var iso = name === 'isometricDots', step = iso ? 30 : 30, rs = iso ? 30 * Math.sqrt(3) / 2 : 30, row = 0;
        for (var y = 26; y < (iso ? h - 10 : h); y += rs, row++) {
          for (var x = 26 + (iso && row % 2 ? step / 2 : 0); x < (iso ? w - 10 : w); x += step) {
            ctx.beginPath(); ctx.arc(x, y, 1, 0, 6.2832); ctx.fill();
          }
        }
        break;
      }
      case 'millimeter': {
        var mn = 6, mj = 30, mx = Math.max(Math.floor((w - 60) / mj), 1), my = Math.max(Math.floor((h - 60) / mj), 1);
        var x0 = (w - mx * mj) / 2, y0 = (h - my * mj) / 2, x1 = x0 + mx * mj, y1 = y0 + my * mj;
        for (var pass = 0; pass < 2; pass++) {
          ctx.globalAlpha = pass ? 0.45 : 0.25; ctx.lineWidth = pass ? 0.6 : 0.3; ctx.beginPath();
          for (var i = 0; i <= mx * 5; i++) if ((i % 5 === 0) === !!pass) { ctx.moveTo(x0 + i * mn, y0); ctx.lineTo(x0 + i * mn, y1); }
          for (var j = 0; j <= my * 5; j++) if ((j % 5 === 0) === !!pass) { ctx.moveTo(x0, y0 + j * mn); ctx.lineTo(x1, y0 + j * mn); }
          ctx.stroke();
        }
        break;
      }
      default: break;
    }
    ctx.restore();
  }

  // ---------- strokes ----------
  var TRANSLUCENT = { marker: 1, pencil: 1, watercolor: 1, crayon: 1 };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var rgba = function (c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'; };

  function pointWidth(s, p) {
    if (p.length > 6 && p[6] > 0) return p[6];
    var f = p.length > 2 ? p[2] : 1;
    return s.width * clamp(0.5 + 0.5 * f, 0.4, 1.8);
  }

  function drawStroke(ctx, s) {
    var pts = s.points;
    if (!pts.length) return;
    var col = P.parseColor(s.color), tool = s.tool;
    ctx.save();
    if (s.transform) ctx.transform.apply(ctx, s.transform);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var avgW = pts.reduce(function (a, p) { return a + pointWidth(s, p); }, 0) / pts.length;
    var avgOp = pts.reduce(function (a, p) { return a + (p.length > 8 ? p[8] : 1); }, 0) / pts.length;

    if (TRANSLUCENT[tool]) {
      var alpha = col.a * clamp(avgOp, 0, 1);
      if (tool === 'marker') { if (col.a >= 0.99) alpha = 0.4 * avgOp; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'square'; }
      else if (tool === 'pencil') alpha *= 0.85;
      else if (tool === 'watercolor') alpha *= 0.6;
      else alpha *= 0.9;
      ctx.strokeStyle = rgba(col, alpha); ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = avgW;
      if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], avgW / 2, 0, 6.2832); ctx.fill(); }
      else {
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length - 1; i++) {
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); ctx.stroke();
      }
      ctx.restore(); return;
    }

    // pen / fountainPen / monoline (and unknown tools): per-segment width
    ctx.strokeStyle = rgba(col, col.a); ctx.fillStyle = ctx.strokeStyle;
    function width(i) {
      if (tool === 'monoline') return avgW;
      var w = pointWidth(s, pts[i]);
      if (tool === 'fountainPen' && pts.length > 1) {
        var a = pts[Math.min(i + 1, pts.length - 1)], b = pts[Math.max(i - 1, 0)];
        w *= 0.55 + 0.45 * Math.abs(Math.sin(Math.atan2(a[1] - b[1], a[0] - b[0]) - Math.PI / 4));
      }
      return Math.max(w, 0.3);
    }
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], width(0) / 2, 0, 6.2832); ctx.fill();
    } else {
      var px = pts[0][0], py = pts[0][1];
      for (var k = 1; k < pts.length; k++) {
        var last = k === pts.length - 1;
        var mx = last ? pts[k][0] : (pts[k - 1][0] + pts[k][0]) / 2;
        var my = last ? pts[k][1] : (pts[k - 1][1] + pts[k][1]) / 2;
        ctx.lineWidth = (width(k - 1) + width(k)) / 2;
        ctx.beginPath(); ctx.moveTo(px, py);
        if (last) ctx.lineTo(mx, my); else ctx.quadraticCurveTo(pts[k - 1][0], pts[k - 1][1], mx, my);
        ctx.stroke();
        px = mx; py = my;
      }
    }
    ctx.restore();
  }

  // ---------- shapes ----------
  function drawArrowHead(ctx, from, to, size) {
    var a = Math.atan2(to[1] - from[1], to[0] - from[0]);
    ctx.beginPath();
    ctx.moveTo(to[0] - size * Math.cos(a - 0.5), to[1] - size * Math.sin(a - 0.5));
    ctx.lineTo(to[0], to[1]);
    ctx.lineTo(to[0] - size * Math.cos(a + 0.5), to[1] - size * Math.sin(a + 0.5));
    ctx.stroke();
  }

  function drawShape(ctx, sh) {
    var v = sh.points || [];
    if (v.length < 2) return;
    var kind = sh.kindRaw, lw = sh.lineWidth || 2;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    v.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    ctx.save();
    if (sh.rotation) { var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2; ctx.translate(cx, cy); ctx.rotate(sh.rotation); ctx.translate(-cx, -cy); }
    ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(P.parseColor(sh.strokeHex, { r: 26, g: 26, b: 26, a: 1 }), 1);
    if (sh.dashRaw === 'dashed') ctx.setLineDash([lw * 3, lw * 2]);
    else if (sh.dashRaw === 'dotted') ctx.setLineDash([0, Math.max(lw, 1) * 2]);
    var closed = true;
    ctx.beginPath();
    if (kind === 'rectangle') ctx.rect(minX, minY, maxX - minX, maxY - minY);
    else if (kind === 'roundedRectangle') {
      var r = Math.min(maxX - minX, maxY - minY) * 0.2;
      ctx.moveTo(minX + r, minY); ctx.arcTo(maxX, minY, maxX, maxY, r); ctx.arcTo(maxX, maxY, minX, maxY, r);
      ctx.arcTo(minX, maxY, minX, minY, r); ctx.arcTo(minX, minY, maxX, minY, r); ctx.closePath();
    } else if (kind === 'ellipse') {
      ctx.ellipse((minX + maxX) / 2, (minY + maxY) / 2, (maxX - minX) / 2, (maxY - minY) / 2, 0, 0, 6.2832);
    } else if (kind === 'curve' && v.length >= 4) {
      closed = false; ctx.moveTo(v[0][0], v[0][1]); ctx.bezierCurveTo(v[1][0], v[1][1], v[2][0], v[2][1], v[3][0], v[3][1]);
    } else if (kind === 'line' || kind === 'arrow' || kind === 'doubleArrow') {
      closed = false; ctx.moveTo(v[0][0], v[0][1]); ctx.lineTo(v[v.length - 1][0], v[v.length - 1][1]);
    } else { // triangle, polygon, unknown kinds: polyline through the vertices
      ctx.moveTo(v[0][0], v[0][1]);
      for (var i = 1; i < v.length; i++) ctx.lineTo(v[i][0], v[i][1]);
      ctx.closePath();
    }
    if (closed && sh.fillHex) {
      var f = P.parseColor(sh.fillHex);
      ctx.fillStyle = rgba(f, f.a * (sh.fillOpacity == null ? 1 : sh.fillOpacity));
      ctx.fill();
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (kind === 'arrow' || kind === 'doubleArrow') {
      var a = v[0], b = v[v.length - 1], hs = Math.max(10, lw * 4);
      drawArrowHead(ctx, a, b, hs);
      if (kind === 'doubleArrow') drawArrowHead(ctx, b, a, hs);
    }
    ctx.restore();
  }

  // ---------- page rendering ----------
  var bitmapCache = new WeakMap();
  function loadImage(img) {
    if (bitmapCache.has(img)) return bitmapCache.get(img);
    var p = createImageBitmap(new Blob([img.data], { type: img.mime })).catch(function () { return null; });
    bitmapCache.set(img, p);
    return p;
  }

  /** Draws paper, images, shapes, ink, tape into `canvas` at `res` px per page unit. */
  async function renderPage(note, page, canvas, res, token) {
    var w = page.size.w, h = page.size.h;
    canvas.width = Math.max(1, Math.round(w * res)); canvas.height = Math.max(1, Math.round(h * res));
    var ctx = canvas.getContext('2d');
    ctx.scale(res, res);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    drawTemplate(ctx, page.template, w, h);
    if (!page.ipsf && page.thumbnail) {
      var tb = await createImageBitmap(new Blob([page.thumbnail], { type: 'image/png' })).catch(function () { return null; });
      if (tb) ctx.drawImage(tb, 0, 0, w, h);
    }
    for (var i = 0; i < page.images.length; i++) {
      var ia = page.images[i], bmp = await loadImage(ia);
      if (token !== undefined && token !== state.token) return;
      if (!bmp) continue;
      ctx.save();
      ctx.translate(ia.x + ia.width / 2, ia.y + ia.height / 2);
      ctx.rotate((ia.rotation || 0) * Math.PI / 180);
      // aspect-fill, clipped to the frame (mirrors ImageAnnotationView)
      var k = Math.max(ia.width / bmp.width, ia.height / bmp.height), dw = bmp.width * k, dh = bmp.height * k;
      ctx.beginPath(); ctx.rect(-ia.width / 2, -ia.height / 2, ia.width, ia.height); ctx.clip();
      ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    page.shapes.forEach(function (sh) { drawShape(ctx, sh); });
    if (page.ipsf) {
      // IPSF canvas may differ from the page box (e.g. PDF pages); keep the origin, scale uniformly if sizes disagree.
      ctx.save();
      var cw = page.ipsf.canvas.w, ch = page.ipsf.canvas.h;
      if (cw > 0 && ch > 0 && (Math.abs(cw - w) > 1 || Math.abs(ch - h) > 1)) ctx.scale(w / cw, h / ch);
      page.ipsf.strokes.forEach(function (s) { drawStroke(ctx, s); });
      ctx.restore();
    }
    page.tapes.forEach(function (t) {
      if (t.isRevealed) return;
      ctx.fillStyle = rgba(P.parseColor(t.colorHex, { r: 255, g: 216, b: 77, a: 1 }), 1);
      ctx.fillRect(t.x, t.y, t.width, t.height);
    });
  }

  function overlayEl(cls, box, text) {
    var el = document.createElement('div');
    el.className = 'ov ' + cls;
    el.style.left = box.x + 'px'; el.style.top = box.y + 'px';
    el.style.width = box.width + 'px'; el.style.height = box.height + 'px';
    el.textContent = text;
    return el;
  }

  function buildOverlays(stage, page) {
    page.texts.forEach(function (t) {
      var el = overlayEl('text', t, t.text);
      el.style.fontSize = t.fontSize + 'px';
      el.style.color = t.colorHex || '#000';
      el.style.fontWeight = t.fontWeight === 'bold' ? '700' : t.fontWeight === 'light' ? '300' : '400';
      if (t.fontName) el.style.fontFamily = '"' + String(t.fontName).replace(/["\\]/g, '') + '", sans-serif';
      stage.appendChild(el);
    });
    page.equations.forEach(function (q) { stage.appendChild(overlayEl('eq', q, q.latex)); });
    page.links.forEach(function (l) {
      var el = overlayEl('link', l, '');
      var url = l.externalURL && /^https?:\/\//i.test(l.externalURL) ? l.externalURL : null;
      if (url) {
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = l.label || url;
        el.appendChild(a);
      } else el.textContent = l.label || '';
      stage.appendChild(el);
    });
  }

  async function showPage(idx) {
    var note = state.note;
    if (!note) return;
    idx = clamp(idx, 0, note.pages.length - 1);
    state.cur = idx;
    var token = ++state.token;
    var page = note.pages[idx];
    var z = state.zoom, w = page.size.w, h = page.size.h, rot = page.rotation;
    var swap = rot === 90 || rot === 270;
    var box = $('pageBox');
    box.style.width = (swap ? h : w) * z + 'px'; box.style.height = (swap ? w : h) * z + 'px';
    box.textContent = '';
    var stage = document.createElement('div');
    stage.className = 'stage';
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    var tx = rot === 90 ? h * z + 'px, 0' : rot === 180 ? w * z + 'px, ' + h * z + 'px' : rot === 270 ? '0, ' + w * z + 'px' : '0, 0';
    stage.style.transform = 'translate(' + tx + ') rotate(' + rot + 'deg) scale(' + z + ')';
    var canvas = document.createElement('canvas');
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    stage.appendChild(canvas);
    box.appendChild(stage);
    if (note.pdf) {
      var ph = document.createElement('div'); ph.className = 'pdf-ph'; ph.textContent = T.pdf; stage.appendChild(ph);
    }
    buildOverlays(stage, page);
    $('pageLabel').textContent = (idx + 1) + ' / ' + note.pages.length;
    $('zoomLabel').textContent = Math.round(z * 100) + '%';
    var banner = $('banner');
    if (!page.ipsf && page.thumbnail) { banner.hidden = false; banner.textContent = T.thumbOnly; }
    else if (note.legacyNoInk) { banner.hidden = false; banner.textContent = T.legacy; }
    else if (note.warnings.length) { banner.hidden = false; banner.textContent = T.warn + note.warnings.join('; '); }
    else banner.hidden = true;
    document.querySelectorAll('#thumbs button').forEach(function (b, i) { b.classList.toggle('active', i === idx); });
    try {
      await renderPage(note, page, canvas, Math.min((window.devicePixelRatio || 1) * z, 4), token);
    } catch (e) { console.error(e); }
  }

  function fitWidth() {
    var page = state.note.pages[state.cur];
    var swap = page.rotation === 90 || page.rotation === 270;
    var avail = $('scroller').clientWidth - 32;
    state.zoom = clamp(avail / (swap ? page.size.h : page.size.w), 0.2, 4);
  }

  async function buildThumbs(note) {
    var th = $('thumbs'); th.textContent = '';
    note.pages.forEach(function (page, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('aria-label', T.page + ' ' + (i + 1));
      var c = document.createElement('canvas');
      b.appendChild(c); b.appendChild(document.createTextNode(String(i + 1)));
      b.addEventListener('click', function () { showPage(i); });
      th.appendChild(b);
      page.__thumb = c;
    });
    var tok = state.token;
    for (var i = 0; i < note.pages.length; i++) {
      var pg = note.pages[i];
      try { await renderPage(note, pg, pg.__thumb, 120 / pg.size.w); } catch (e) { /* skip */ }
      if (note !== state.note) return;
    }
  }

  function showError(msg) { var e = $('error'); e.hidden = !msg; e.textContent = msg || ''; }

  async function openFile(file) {
    showError('');
    try {
      var buf = new Uint8Array(await file.arrayBuffer());
      var note = P.parseInkelle(buf, window.fflate);
      if (!note.pages.length) throw new Error(T.noPages);
      state.note = note; state.cur = 0; state.token++;
      $('drop').hidden = true; $('viewer').hidden = false;
      $('noteTitle').textContent = note.title || file.name;
      await buildThumbs(note);
      fitWidth();
      showPage(0);
    } catch (e) {
      showError(T.bad + (e && e.message ? e.message : e));
    }
  }

  // ---------- wiring ----------
  var fileInput = $('file');
  $('pick').addEventListener('click', function () { fileInput.click(); });
  $('open').addEventListener('click', function () { fileInput.click(); });
  $('drop').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', function () { if (fileInput.files[0]) openFile(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); $('drop').classList.add('over'); });
  });
  document.addEventListener('dragleave', function () { $('drop').classList.remove('over'); });
  document.addEventListener('drop', function (e) {
    e.preventDefault(); $('drop').classList.remove('over');
    var f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) openFile(f);
  });
  $('prev').addEventListener('click', function () { showPage(state.cur - 1); });
  $('next').addEventListener('click', function () { showPage(state.cur + 1); });
  function zoomBy(f) { state.zoom = clamp(state.zoom * f, 0.2, 4); showPage(state.cur); }
  $('zoomIn').addEventListener('click', function () { zoomBy(1.25); });
  $('zoomOut').addEventListener('click', function () { zoomBy(0.8); });
  $('fit').addEventListener('click', function () { fitWidth(); showPage(state.cur); });
  document.addEventListener('keydown', function (e) {
    if (!state.note || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') showPage(state.cur - 1);
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') showPage(state.cur + 1);
  });
})();
