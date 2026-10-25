/* Inkelle read-only web viewer. Everything runs in the browser; the file is never uploaded.
 * Rendering mirrors the App's ExportService / PaperTemplateGeometry / ShapeGeometry so a page
 * looks like the App's own PNG export: paper → ink → shapes → text → images → equations → tape → links. */
(function () {
  'use strict';
  var P = window.InkelleParse;

  var I18N = {
    zh: {
      home: '返回首页', heading: '在线查看器', lead: '把 .inkelle 文件拖到这里，或点击选择文件。', choose: '选择文件',
      privacy: '文件不离开你的设备：所有解析与渲染都在本机浏览器中完成，不会上传到任何服务器。',
      readonly: '只读预览：支持笔迹、全部纸张模板、PDF 背景、文本框、图片、图形、公式、胶带与链接。',
      fit: '适应宽度', openOther: '打开其他文件', pdf: '此页为 PDF 背景，但浏览器无法加载 PDF 渲染器；仅显示笔迹。',
      legacy: '此文件由旧版导出，无可渲染笔迹。', noPages: '此文件没有页面。', bad: '无法打开该文件：',
      warn: '部分页面笔迹损坏，已跳过：', page: '页', thumbOnly: '此页无矢量笔迹，显示导出时的缩略图。',
      pdfBad: 'PDF 背景无法解析，仅显示笔迹。',
    },
    en: {
      home: 'Home', heading: 'Online Viewer', lead: 'Drop a .inkelle file here, or click to choose one.', choose: 'Choose file',
      privacy: 'Your file never leaves your device: parsing and rendering happen entirely in this browser, with no upload to any server.',
      readonly: 'Read-only preview: ink, every paper template, PDF backgrounds, text boxes, images, shapes, equations, tape and links.',
      fit: 'Fit width', openOther: 'Open another file', pdf: 'This page has a PDF background, but the PDF renderer could not be loaded; only ink is shown.',
      legacy: 'This file was exported by an older version and has no renderable ink.', noPages: 'This file has no pages.', bad: 'Cannot open this file: ',
      warn: 'Some pages had damaged ink and were skipped: ', page: 'Page', thumbOnly: 'No vector ink on this page; showing the exported thumbnail.',
      pdfBad: 'The PDF background could not be parsed; only ink is shown.',
    },
  };
  var lang = /^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en';
  if (!navigator.language) lang = 'zh';
  var T = I18N[lang];
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = T[el.dataset.i18n]; });
  document.title = lang === 'zh' ? 'Inkelle 在线查看器' : 'Inkelle Viewer';

  var $ = function (id) { return document.getElementById(id); };
  var state = { note: null, cur: 0, zoom: 1, token: 0, pdfDoc: null, pdfError: false };

  // ExportService.pdfPaperColor / pdfRuleColor / defaultAccentCGColor / defaultInkCGColor.
  var PAPER = '#FDF8F0', RULE = { r: 214, g: 205, b: 184 }, ACCENT = { r: 74, g: 144, b: 217, a: 1 }, INK = { r: 26, g: 26, b: 26, a: 1 };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var rgba = function (c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (a == null ? c.a : a) + ')'; };

  // ---------- paper templates: a port of PaperTemplateGeometry (y-down page space) ----------
  // Each layer is { ops: [...], width, alpha, dash } (stroked once, so crossings never double-darken)
  // or { dots: [[x, y], ...], radius, alpha }.
  var Tpl = (function () {
    function Path() { this.ops = []; }
    Path.prototype.h = function (y, x0, x1) { this.ops.push(['L', x0, y, x1, y]); };
    Path.prototype.v = function (x, y0, y1) { this.ops.push(['L', x, y0, x, y1]); };
    Path.prototype.line = function (x0, y0, x1, y1) { this.ops.push(['L', x0, y0, x1, y1]); };
    Path.prototype.rect = function (x, y, w, h) { this.ops.push(['R', x, y, w, h]); };
    Path.prototype.rrect = function (x, y, w, h, r) { this.ops.push(['RR', x, y, w, h, r]); };
    Path.prototype.poly = function (pts) { this.ops.push(['P', pts]); };
    Path.prototype.rows = function (top, bottom, sp, x0, x1) { for (var y = top; y < bottom; y += sp) this.h(y, x0, x1); };
    var stroke = function (p, width, alpha, dash) { return { ops: p.ops, width: width, alpha: alpha, dash: dash || [] }; };
    var dots = function (pts, radius, alpha) { return { dots: pts, radius: radius, alpha: alpha }; };

    function ruled(w, h, sp) { var p = new Path(); p.rows(70, h - 70, sp, 60, w - 60); return [stroke(p, 0.5, 0.55)]; }
    function grid(w, h) {
      var v = new Path(), hz = new Path();
      for (var x = 30; x < w; x += 34) v.v(x, 0, h);
      hz.rows(30, h, 34, 0, w);
      return [stroke(v, 0.5, 0.38), stroke(hz, 0.5, 0.38)];
    }
    function dotted(w, h) {
      var pts = [];
      for (var x = 26; x < w; x += 30) for (var y = 26; y < h; y += 30) pts.push([x, y]);
      return [dots(pts, 1, 0.7)];
    }
    function millimeter(w, h) {
      var minor = 6, major = 30, mx = Math.max(Math.floor((w - 60) / major), 1), my = Math.max(Math.floor((h - 60) / major), 1);
      var x0 = (w - mx * major) / 2, y0 = (h - my * major) / 2, x1 = x0 + mx * major, y1 = y0 + my * major;
      var mn = new Path(), mj = new Path();
      for (var i = 0; i <= mx * 5; i++) (i % 5 === 0 ? mj : mn).v(x0 + i * minor, y0, y1);
      for (var j = 0; j <= my * 5; j++) (j % 5 === 0 ? mj : mn).h(y0 + j * minor, x0, x1);
      return [stroke(mn, 0.3, 0.25), stroke(mj, 0.6, 0.45)];
    }
    function isometricDots(w, h) {
      var step = 30, rowStep = step * Math.sqrt(3) / 2, pts = [], row = 0;
      for (var y = 26; y < h - 10; y += rowStep, row++) {
        for (var x = 26 + (row % 2 === 0 ? 0 : step / 2); x < w - 10; x += step) pts.push([x, y]);
      }
      return [dots(pts, 1, 0.7)];
    }
    function hexGrid(w, h) {
      var r = 18, hw = Math.sqrt(3) * r, p = new Path(), row = 0;
      for (var cy = 20 + r; cy + r <= h - 20; cy += r * 1.5, row++) {
        for (var cx = 20 + hw / 2 + (row % 2 === 0 ? 0 : hw / 2); cx + hw / 2 <= w - 20; cx += hw) {
          var pts = [];
          for (var k = 0; k < 6; k++) {
            var a = Math.PI / 3 * k - Math.PI / 2;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
          p.poly(pts);
        }
      }
      return [stroke(p, 0.5, 0.4)];
    }
    function cornell(w, h) {
      var margin = 40, cue = w * 0.3, header = 70, summary = 120;
      var f = new Path();
      f.h(header, margin, w - margin); f.v(cue, header, h - summary); f.h(h - summary, margin, w - margin);
      var r = new Path(); r.rows(header + 34, h - summary, 34, cue + 10, w - margin);
      return [stroke(f, 1, 0.55), stroke(r, 0.5, 0.3)];
    }
    function mistakeBook(w, h) {
      var margin = 40, top = 70, bottom = h - 40, body = bottom - top, s1 = top + body * 0.42, s2 = s1 + body * 0.2;
      var f = new Path(); [top, s1, s2, bottom].forEach(function (y) { f.h(y, margin, w - margin); });
      var tabs = new Path(), r = new Path();
      [[top, s1], [s1, s2], [s2, bottom]].forEach(function (seg) {
        tabs.rrect(margin, seg[0] + 10, 64, 22, 4);
        r.rows(seg[0] + 66, seg[1] - 8, 34, margin, w - margin);
      });
      return [stroke(f, 1, 0.55), stroke(tabs, 0.8, 0.5), stroke(r, 0.5, 0.3)];
    }
    function reviewColumns(w, h) {
      var margin = 40, top = 70, hb = top + 40, bottom = h - 40, inner = w - margin * 2;
      var f = new Path(); f.h(top, margin, w - margin); f.h(bottom, margin, w - margin);
      [0.28, 0.72].forEach(function (fr) { f.v(margin + inner * fr, top, bottom); });
      var hd = new Path(); hd.h(hb, margin, w - margin);
      var r = new Path(); r.rows(hb + 34, bottom, 34, margin, w - margin);
      return [stroke(f, 1, 0.55), stroke(hd, 0.8, 0.5), stroke(r, 0.5, 0.3)];
    }
    function storyboard(w, h) {
      var margin = 40, top = 70, colGap = 28, panelW = (w - margin * 2 - colGap) / 2, rowH = (h - top - 40) / 3;
      var frameH = Math.max(Math.min(panelW * 9 / 16, rowH - 72), 10), frameW = frameH * 16 / 9;
      var hd = new Path(); hd.h(top, margin, w - margin);
      var fr = new Path(), cap = new Path();
      for (var row = 0; row < 3; row++) for (var col = 0; col < 2; col++) {
        var panelX = margin + col * (panelW + colGap), x = panelX + (panelW - frameW) / 2, y = top + 20 + row * rowH;
        fr.rect(x, y, frameW, frameH);
        cap.h(y + frameH + 24, x, x + frameW); cap.h(y + frameH + 48, x, x + frameW);
      }
      return [stroke(hd, 1, 0.55), stroke(fr, 1, 0.55), stroke(cap, 0.5, 0.3)];
    }
    function swot(w, h) {
      var margin = 40, top = 70, ax = margin, ay = top + 20, aw = w - margin * 2, ah = h - top - 60;
      var hd = new Path(); hd.h(top, margin, w - margin);
      var f = new Path(); f.rect(ax, ay, aw, ah); f.v(ax + aw / 2, ay, ay + ah); f.h(ay + ah / 2, ax, ax + aw);
      var tabs = new Path(), r = new Path(), qw = aw / 2, qh = ah / 2;
      [[ax, ay], [ax + aw / 2, ay], [ax, ay + ah / 2], [ax + aw / 2, ay + ah / 2]].forEach(function (q) {
        tabs.rrect(q[0] + 12, q[1] + 12, 30, 30, 6);
        r.rows(q[1] + 76, q[1] + qh - 10, 34, q[0] + 12, q[0] + qw - 12);
      });
      return [stroke(hd, 1, 0.55), stroke(f, 1, 0.55), stroke(tabs, 0.8, 0.5), stroke(r, 0.5, 0.2)];
    }
    function characterGrid(w, h, diagonals) {
      var cell = 64, rowGap = 18, cols = Math.max(Math.floor((w - 80) / cell), 1), x0 = (w - cols * cell) / 2, x1 = x0 + cols * cell;
      var solid = new Path(), guides = new Path();
      for (var y = 60; y + cell <= h - 40; y += cell + rowGap) {
        solid.rect(x0, y, x1 - x0, cell);
        for (var c = 1; c < cols; c++) solid.v(x0 + c * cell, y, y + cell);
        guides.h(y + cell / 2, x0, x1);
        for (var k = 0; k < cols; k++) {
          var cx = x0 + k * cell;
          guides.v(cx + cell / 2, y, y + cell);
          if (diagonals) { guides.line(cx, y, cx + cell, y + cell); guides.line(cx + cell, y, cx, y + cell); }
        }
      }
      return [stroke(solid, 0.8, 0.6), stroke(guides, 0.5, 0.4, [4, 3])];
    }
    function englishFourLine(w, h) {
      var gap = 11, groupGap = 30, thin = new Path(), base = new Path();
      for (var y = 70; y + gap * 3 < h - 50; y += gap * 3 + groupGap) {
        for (var i = 0; i < 4; i++) (i === 2 ? base : thin).h(y + i * gap, 50, w - 50);
      }
      return [stroke(thin, 0.5, 0.45), stroke(base, 0.9, 0.7)];
    }
    function manuscriptVertical(w, h) {
      var cell = 30, gutter = 10, cols = Math.max(Math.floor((w - 100 + gutter) / (cell + gutter)), 1);
      var rowsCount = Math.max(Math.floor((h - 120) / cell), 1), totalW = cols * cell + (cols - 1) * gutter, totalH = rowsCount * cell;
      var x0 = (w - totalW) / 2, y0 = (h - totalH) / 2;
      var f = new Path(); f.rect(x0 - 8, y0 - 8, totalW + 16, totalH + 16);
      var cells = new Path();
      for (var c = 0; c < cols; c++) {
        var x = x0 + c * (cell + gutter);
        cells.rect(x, y0, cell, totalH);
        for (var r = 1; r < rowsCount; r++) cells.h(y0 + r * cell, x, x + cell);
      }
      return [stroke(f, 1, 0.55), stroke(cells, 0.5, 0.45)];
    }
    function staves(w, h, lines, lineSpacing, staffSpacing) {
      var marginX = 50, staffH = (lines - 1) * lineSpacing, staff = new Path(), bars = new Path();
      for (var top = 60; top + staffH < h - 40; top += staffH + staffSpacing) {
        for (var i = 0; i < lines; i++) staff.h(top + i * lineSpacing, marginX, w - marginX);
        bars.v(marginX, top, top + staffH); bars.v(w - marginX, top, top + staffH);
      }
      return [stroke(staff, 0.7, 0.6), stroke(bars, 1, 0.6)];
    }
    function todoList(w, h) {
      var marginX = 60, rowH = 40, box = 16, boxes = new Path(), lines = new Path();
      for (var y = 70; y + rowH < h - 40; y += rowH) {
        boxes.rrect(marginX, y + (rowH - box) / 2, box, box, 3);
        lines.h(y + rowH, marginX + box + 14, w - marginX);
      }
      return [stroke(boxes, 1, 0.5), stroke(lines, 0.5, 0.3)];
    }
    function weeklyPlanner(w, h) {
      var margin = 30, headerH = 50, columns = 7, colW = (w - margin * 2) / columns;
      var hd = new Path(); hd.h(headerH, margin, w - margin);
      var edges = new Path(), inner = new Path();
      for (var i = 0; i <= columns; i++) (i === 0 || i === columns ? edges : inner).v(margin + i * colW, 0, h);
      var r = new Path(); r.rows(headerH + 34, h - 20, 34, margin, w - margin);
      return [stroke(hd, 1, 0.5), stroke(edges, 0.8, 0.5), stroke(inner, 0.5, 0.5), stroke(r, 0.5, 0.2)];
    }
    function dailyPlanner(w, h) {
      var margin = 40, top = 90, bottom = h - 40, split = w * 0.62, timeX = margin + 56, hours = 16, rowH = (bottom - top) / hours;
      var f = new Path(); f.h(top, margin, w - margin); f.v(split, top, bottom);
      var hour = new Path(); hour.v(timeX, top, bottom);
      var half = new Path();
      for (var k = 1; k <= hours; k++) { hour.h(top + k * rowH, margin, split); half.h(top + (k - 0.5) * rowH, timeX, split); }
      var boxes = new Path(), todo = new Path();
      for (var y = top + 20; y + 40 < bottom; y += 40) { boxes.rrect(split + 20, y + 12, 14, 14, 3); todo.h(y + 40, split + 44, w - margin); }
      return [stroke(f, 1, 0.55), stroke(hour, 0.5, 0.45), stroke(half, 0.5, 0.25, [3, 3]), stroke(boxes, 1, 0.5), stroke(todo, 0.5, 0.3)];
    }
    function monthlyCalendar(w, h) {
      var margin = 30, top = 110, strip = 28, bottom = h - 30;
      var f = new Path(); f.rect(margin, top, w - margin * 2, bottom - top);
      var inner = new Path(); inner.h(top + strip, margin, w - margin);
      var colW = (w - margin * 2) / 7;
      for (var c = 1; c < 7; c++) inner.v(margin + c * colW, top, bottom);
      var rowH = (bottom - top - strip) / 6;
      for (var r = 1; r < 6; r++) inner.h(top + strip + r * rowH, margin, w - margin);
      return [stroke(f, 1, 0.55), stroke(inner, 0.5, 0.45)];
    }
    function yearlyCalendar(w, h) {
      var margin = 30, top = 80, gap = 18, blockW = (w - margin * 2 - gap * 2) / 3, blockH = (h - top - 30 - gap * 3) / 4;
      var titles = new Path(), grids = new Path();
      for (var row = 0; row < 4; row++) for (var col = 0; col < 3; col++) {
        var x = margin + col * (blockW + gap), y = top + row * (blockH + gap);
        titles.h(y + 20, x, x + blockW);
        var gridTop = y + 26, cellW = blockW / 7, cellH = (y + blockH - gridTop) / 6;
        grids.rect(x, gridTop, blockW, cellH * 6);
        for (var c = 1; c < 7; c++) grids.v(x + c * cellW, gridTop, gridTop + cellH * 6);
        for (var r = 1; r < 6; r++) grids.h(gridTop + r * cellH, x, x + blockW);
      }
      return [stroke(titles, 0.6, 0.5), stroke(grids, 0.4, 0.3)];
    }

    var TEMPLATES = {
      blank: function () { return []; },
      lined: function (w, h) { return ruled(w, h, 34); },
      narrowRuled: function (w, h) { return ruled(w, h, 26); },
      wideRuled: function (w, h) { return ruled(w, h, 44); },
      grid: grid, dotted: dotted, millimeter: millimeter, isometricDots: isometricDots, hexGrid: hexGrid,
      cornell: cornell,
      musicSheet: function (w, h) { return staves(w, h, 5, 12, 80); },
      guitarTab: function (w, h) { return staves(w, h, 6, 11, 60); },
      todoList: todoList, weeklyPlanner: weeklyPlanner,
      tianzige: function (w, h) { return characterGrid(w, h, false); },
      mizige: function (w, h) { return characterGrid(w, h, true); },
      englishFourLine: englishFourLine, manuscriptVertical: manuscriptVertical, dailyPlanner: dailyPlanner,
      monthlyCalendar: monthlyCalendar, yearlyCalendar: yearlyCalendar, mistakeBook: mistakeBook,
      reviewColumns: reviewColumns, storyboard: storyboard, swot: swot,
    };

    function roundRect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /** Draws template `name` into `ctx` (page space, y-down) with the App's rule color. */
    function draw(ctx, name, w, h) {
      var fn = TEMPLATES[name] || TEMPLATES.blank;
      if (!(w > 0 && h > 0)) return;
      var layers = fn(w, h);
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      layers.forEach(function (layer) {
        if (layer.dots) {
          ctx.fillStyle = rgba(RULE, layer.alpha);
          ctx.beginPath();
          layer.dots.forEach(function (p) { ctx.moveTo(p[0] + layer.radius, p[1]); ctx.arc(p[0], p[1], layer.radius, 0, Math.PI * 2); });
          ctx.fill();
          return;
        }
        ctx.strokeStyle = rgba(RULE, layer.alpha);
        ctx.lineWidth = layer.width;
        ctx.setLineDash(layer.dash);
        ctx.beginPath();
        layer.ops.forEach(function (op) {
          if (op[0] === 'L') { ctx.moveTo(op[1], op[2]); ctx.lineTo(op[3], op[4]); }
          else if (op[0] === 'R') ctx.rect(op[1], op[2], op[3], op[4]);
          else if (op[0] === 'RR') roundRect(ctx, op[1], op[2], op[3], op[4], op[5]);
          else if (op[0] === 'P') {
            op[1].forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
            ctx.closePath();
          }
        });
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.restore();
    }
    return { draw: draw, names: Object.keys(TEMPLATES), roundRect: roundRect };
  })();

  // ---------- strokes ----------
  var TRANSLUCENT = { marker: 1, pencil: 1, watercolor: 1, crayon: 1 };

  function pointWidth(s, p) {
    if (p.length > 6 && p[6] > 0) return p[6];
    var f = p.length > 2 ? p[2] : 1;
    return s.width * clamp(0.5 + 0.5 * f, 0.4, 1.8);
  }

  /** PencilKit interpolates control points as a uniform cubic B-spline with clamped (tripled)
   *  endpoints; returns its Bezier segments [[x0,y0,c1x,c1y,c2x,c2y,x1,y1, pointIndex], ...]. */
  function bsplineSegments(pts) {
    var n = pts.length, q = [pts[0], pts[0]].concat(pts, [pts[n - 1], pts[n - 1]]), segs = [];
    for (var i = 0; i + 3 < q.length; i++) {
      var a = q[i], b = q[i + 1], c = q[i + 2], d = q[i + 3];
      var x0 = (a[0] + 4 * b[0] + c[0]) / 6, y0 = (a[1] + 4 * b[1] + c[1]) / 6;
      var x1 = (b[0] + 4 * c[0] + d[0]) / 6, y1 = (b[1] + 4 * c[1] + d[1]) / 6;
      if (Math.abs(x0 - x1) < 1e-6 && Math.abs(y0 - y1) < 1e-6 && (b === c)) continue;
      segs.push([x0, y0, (2 * b[0] + c[0]) / 3, (2 * b[1] + c[1]) / 3, (b[0] + 2 * c[0]) / 3, (b[1] + 2 * c[1]) / 3, x1, y1,
        clamp(i - 1, 0, n - 1)]);
    }
    return segs;
  }

  // PencilKit nib width -> rendered width, measured on the App's PNG export of the IPSF fixture
  // (coverage-integrated perpendicular width / nominal IPSF width): marker 0.55, watercolor 1.6,
  // pencil 1.5. Crayon has no App sample yet and stays at 1.
  var STROKE_WIDTH_SCALE = { marker: 0.55, watercolor: 1.6, pencil: 1.5, crayon: 1 };
  var GRAIN = { pencil: 1, crayon: 1 };
  var TILE = 128;

  /** mulberry32: tiny seeded PRNG; the IPSF texture seed makes pencil/crayon grain deterministic. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Seeded grain tile: alpha = how much ink is knocked out of each device pixel. */
  function grainTile(tool, seed) {
    var rnd = mulberry32(seed), c = document.createElement('canvas');
    c.width = c.height = TILE;
    var g = c.getContext('2d'), img = g.createImageData(TILE, TILE), d = img.data;
    for (var i = 0; i < TILE * TILE; i++) {
      var r = rnd(), keep = tool === 'crayon' ? (r < 0.3 ? 0.1 : 0.8 + 0.2 * r) : 0.5 + 0.5 * r;
      d[i * 4 + 3] = Math.round((1 - keep) * 255);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** Offscreen layer (device pixels) covering the stroke's bounds; null when it is off-canvas. */
  function grainLayer(ctx, pts, w, seed) {
    var m = ctx.getTransform(), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(function (p) {
      var x = m.a * p[0] + m.c * p[1] + m.e, y = m.b * p[0] + m.d * p[1] + m.f;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    });
    var pad = w * Math.hypot(m.a, m.b) + 2;
    var bx = Math.max(0, Math.floor(x0 - pad)), by = Math.max(0, Math.floor(y0 - pad));
    var ex = Math.min(ctx.canvas.width, Math.ceil(x1 + pad)), ey = Math.min(ctx.canvas.height, Math.ceil(y1 + pad));
    if (ex <= bx || ey <= by) return null;
    var c = document.createElement('canvas');
    c.width = ex - bx; c.height = ey - by;
    var g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, -bx, -by);
    g.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    return { canvas: c, ctx: g, x: bx, y: by };
  }

  function applyGrain(ctx, layer, tool, seed) {
    var g = layer.ctx, pat = g.createPattern(grainTile(tool, seed || 1), 'repeat');
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = pat;
    g.translate(-layer.x, -layer.y);
    g.fillRect(layer.x, layer.y, layer.canvas.width, layer.canvas.height);
    g.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer.canvas, layer.x, layer.y);
    ctx.restore();
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
    var segs = pts.length > 1 ? bsplineSegments(pts) : [];

    if (TRANSLUCENT[tool]) {
      // Alphas tuned against the App's PNG export (ExportService draws PKDrawing.image).
      var alpha = col.a * clamp(avgOp, 0, 1);
      if (tool === 'marker') { if (col.a >= 0.99) alpha = 0.85 * avgOp; ctx.globalCompositeOperation = 'multiply'; }
      else if (tool === 'watercolor') { alpha *= 0.9; ctx.globalCompositeOperation = 'multiply'; }
      else if (GRAIN[tool]) alpha = col.a * clamp(avgOp, 0, 1); // grain below supplies the translucency
      else alpha *= 0.9;
      // PencilKit paints each nib at a multiple of its nominal width (STROKE_WIDTH_SCALE).
      var drawW = avgW * (STROKE_WIDTH_SCALE[tool] || 1);
      var paint = ctx, tmp = null, org = null;
      if (GRAIN[tool]) {
        tmp = grainLayer(ctx, pts, drawW, s.seed);
        if (tmp) { paint = tmp.ctx; org = tmp; }
      }
      paint.lineCap = 'round'; paint.lineJoin = 'round';
      paint.strokeStyle = rgba(col, alpha); paint.fillStyle = paint.strokeStyle;
      paint.lineWidth = drawW;
      if (!segs.length) { paint.beginPath(); paint.arc(pts[0][0], pts[0][1], drawW / 2, 0, 6.2832); paint.fill(); }
      else {
        paint.beginPath(); paint.moveTo(segs[0][0], segs[0][1]);
        segs.forEach(function (g) { paint.bezierCurveTo(g[2], g[3], g[4], g[5], g[6], g[7]); });
        paint.stroke();
      }
      if (org) applyGrain(ctx, org, tool, s.seed);
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
    if (!segs.length) {
      ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], width(0) / 2, 0, 6.2832); ctx.fill();
    } else {
      segs.forEach(function (g) {
        var k = g[8];
        ctx.lineWidth = (width(k) + width(Math.min(k + 1, pts.length - 1))) / 2;
        ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.bezierCurveTo(g[2], g[3], g[4], g[5], g[6], g[7]); ctx.stroke();
      });
    }
    ctx.restore();
  }

  // ---------- shapes: a port of ShapeGeometry ----------
  var ARROW_HEAD_FRACTION = 0.2, ARROW_HEAD_MAX = 24, ARROW_BARB_SPREAD = 0.5;
  var CLOSED = { rectangle: 1, roundedRectangle: 1, ellipse: 1, triangle: 1, polygon: 1 };

  function arrowPoints(from, to) {
    var vx = to[0] - from[0], vy = to[1] - from[1], len = Math.hypot(vx, vy);
    if (!(len > 0)) return [];
    var ux = vx / len, uy = vy / len, head = Math.min(len * ARROW_HEAD_FRACTION, ARROW_HEAD_MAX);
    var c = Math.cos(ARROW_BARB_SPREAD), s = Math.sin(ARROW_BARB_SPREAD);
    var left = [to[0] - head * (ux * c - uy * s), to[1] - head * (ux * s + uy * c)];
    var right = [to[0] - head * (ux * c + uy * s), to[1] - head * (-ux * s + uy * c)];
    return [from, to, left, to, right];
  }

  function shapePolyline(kind, v) {
    if (kind === 'line') return [v[0], v[1]];
    if (kind === 'arrow') return arrowPoints(v[0], v[1]);
    var fwd = arrowPoints(v[0], v[1]), back = arrowPoints(v[1], v[0]);
    if (fwd.length !== 5 || back.length !== 5) return [];
    return [back[2], back[1], back[4], back[1]].concat(fwd.slice(1));
  }

  /** Builds the unrotated outline into `ctx`'s current path; returns false when degenerate. */
  function shapePath(ctx, kind, v) {
    var min = { line: 2, arrow: 2, doubleArrow: 2, rectangle: 2, roundedRectangle: 2, ellipse: 2, triangle: 3, polygon: 3, curve: 4 }[kind] || 2;
    if (v.length < min) return false;
    if (kind === 'rectangle' || kind === 'roundedRectangle' || kind === 'ellipse') {
      var x = Math.min(v[0][0], v[1][0]), y = Math.min(v[0][1], v[1][1]), w = Math.abs(v[1][0] - v[0][0]), h = Math.abs(v[1][1] - v[0][1]);
      if (!(w > 0 && h > 0)) return false;
      if (kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (kind === 'rectangle') ctx.rect(x, y, w, h);
      else Tpl.roundRect(ctx, x, y, w, h, Math.min(Math.min(w, h) * 0.2, 24));
      return true;
    }
    if (kind === 'curve') {
      ctx.moveTo(v[0][0], v[0][1]); ctx.bezierCurveTo(v[1][0], v[1][1], v[2][0], v[2][1], v[3][0], v[3][1]);
      return true;
    }
    if (kind === 'triangle' || kind === 'polygon') {
      v.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath();
      return true;
    }
    var line = shapePolyline(kind, v);
    if (line.length < 2) return false;
    line.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
    return true;
  }

  function drawShape(ctx, sh) {
    var v = (sh.points || []).map(function (p) { return Array.isArray(p) ? p : [p.x, p.y]; });
    if (v.length < 2) return;
    var kind = sh.kindRaw, lw = sh.lineWidth > 0 ? sh.lineWidth : 3;
    ctx.save();
    if (sh.rotation) {
      // Rotation pivot is the bounding-box center of the editable vertices (ShapeGeometry.center).
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      v.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      ctx.translate(cx, cy); ctx.rotate(sh.rotation); ctx.translate(-cx, -cy);
    }
    ctx.beginPath();
    if (!shapePath(ctx, kind, v)) { ctx.restore(); return; }
    if (CLOSED[kind] && sh.fillHex) {
      var f = P.parseColor(sh.fillHex);
      ctx.fillStyle = rgba(f, clamp(sh.fillOpacity == null ? 1 : sh.fillOpacity, 0, 1));
      ctx.fill();
    }
    ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(P.parseColor(sh.strokeHex, INK));
    if (sh.dashRaw === 'dashed') ctx.setLineDash([lw * 3, lw * 2]);
    else if (sh.dashRaw === 'dotted') ctx.setLineDash([0, lw * 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ---------- PDF backgrounds (pdf.js, loaded on demand) ----------
  var pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./vendor/pdfjs/pdf.min.js').then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;
        return lib;
      });
    }
    return pdfjsPromise;
  }

  async function openPDF(note) {
    state.pdfDoc = null; state.pdfError = false;
    if (!note.pdf) return;
    try {
      var lib = await loadPdfjs();
      // Copy: pdf.js transfers the buffer to its worker.
      state.pdfDoc = await lib.getDocument({ data: note.pdf.slice(), isEvalSupported: false }).promise;
    } catch (e) {
      console.warn('PDF background unavailable:', e && e.message ? e.message : e);
      state.pdfError = true;
    }
  }

  function pdfPageFor(page) {
    var doc = state.pdfDoc;
    if (!doc || page.pdfPageIndex < 0 || page.pdfPageIndex >= doc.numPages) return null;
    return doc.getPage(page.pdfPageIndex + 1);
  }

  var pdfBitmaps = {};
  /** Renders PDF page `pdfPage` aspect-fit into the w x h page box (renderPDFPageBackground). */
  async function drawPdfBackground(ctx, pdfPage, w, h, res) {
    var vp1 = pdfPage.getViewport({ scale: 1 });
    var k = Math.min(w / vp1.width, h / vp1.height), dw = vp1.width * k, dh = vp1.height * k;
    var pxW = Math.max(1, Math.round(dw * res)), key = pdfPage.pageNumber + ':' + pxW;
    var bmp = pdfBitmaps[key];
    if (!bmp) {
      var off = document.createElement('canvas');
      var vp = pdfPage.getViewport({ scale: k * res });
      off.width = Math.max(1, Math.round(vp.width)); off.height = Math.max(1, Math.round(vp.height));
      var octx = off.getContext('2d');
      octx.fillStyle = PAPER; octx.fillRect(0, 0, off.width, off.height);
      // Transparent PDF page over the paper colour, as the App draws it (renderPDFPageBackground).
      await pdfPage.render({ canvasContext: octx, viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
      bmp = pdfBitmaps[key] = off;
    }
    ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  // ---------- page rendering ----------
  var bitmapCache = new WeakMap();
  function loadImage(img) {
    if (bitmapCache.has(img)) return bitmapCache.get(img);
    var p = createImageBitmap(new Blob([img.data], { type: img.mime })).catch(function () { return null; });
    bitmapCache.set(img, p);
    return p;
  }

  function imageSrc(img) {
    if (!img.__url) img.__url = URL.createObjectURL(new Blob([img.data], { type: img.mime }));
    return img.__url;
  }

  function tapeRect(ctx, t) {
    var base = t.colorHex ? P.parseColor(t.colorHex, ACCENT) : ACCENT;
    ctx.beginPath(); Tpl.roundRect(ctx, t.x, t.y, t.width, t.height, 4);
    if (t.isRevealed) {
      ctx.fillStyle = rgba(base, 0.18); ctx.fill();
      ctx.strokeStyle = rgba(base, 0.5); ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    } else { ctx.fillStyle = rgba(base, 1); ctx.fill(); }
  }

  /** Draws paper (template or PDF page), ink and shapes into `canvas` at `res` px per page unit.
   *  With `flat`, images and tape are rasterized too (thumbnails); the main stage shows them as DOM. */
  async function renderPage(note, page, canvas, res, token, flat) {
    var w = page.size.w, h = page.size.h;
    canvas.width = Math.max(1, Math.round(w * res)); canvas.height = Math.max(1, Math.round(h * res));
    var ctx = canvas.getContext('2d');
    ctx.scale(res, res);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
    var pdfPage = pdfPageFor(page);
    if (pdfPage) {
      try { await drawPdfBackground(ctx, await pdfPage, w, h, res); }
      catch (e) { console.warn('PDF page render failed:', e && e.message ? e.message : e); }
      if (token !== undefined && token !== state.token) return;
    } else {
      Tpl.draw(ctx, page.template, w, h);
    }
    if (!page.ipsf && page.thumbnail) {
      var tb = await createImageBitmap(new Blob([page.thumbnail], { type: 'image/png' })).catch(function () { return null; });
      if (tb) ctx.drawImage(tb, 0, 0, w, h);
    }
    if (page.ipsf) {
      // IPSF canvas may differ from the page box (e.g. PDF pages); keep the origin, scale uniformly if sizes disagree.
      ctx.save();
      var cw = page.ipsf.canvas.w, ch = page.ipsf.canvas.h;
      if (cw > 0 && ch > 0 && (Math.abs(cw - w) > 1 || Math.abs(ch - h) > 1)) ctx.scale(w / cw, h / ch);
      page.ipsf.strokes.forEach(function (s) { drawStroke(ctx, s); });
      ctx.restore();
    }
    page.shapes.forEach(function (sh) { drawShape(ctx, sh); });
    if (!flat) return;
    for (var i = 0; i < page.images.length; i++) {
      var ia = page.images[i], bmp = await loadImage(ia);
      if (token !== undefined && token !== state.token) return;
      if (!bmp) continue;
      ctx.save();
      ctx.translate(ia.x + ia.width / 2, ia.y + ia.height / 2);
      ctx.rotate((ia.rotation || 0) * Math.PI / 180);
      // aspect-fill, clipped to the frame (mirrors ImageOverlayView)
      var k = Math.max(ia.width / bmp.width, ia.height / bmp.height), dw = bmp.width * k, dh = bmp.height * k;
      ctx.beginPath(); ctx.rect(-ia.width / 2, -ia.height / 2, ia.width, ia.height); ctx.clip();
      ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    page.tapes.forEach(function (t) { tapeRect(ctx, t); });
  }

  // ---------- DOM overlays (z-order: text → image → equation → tape → link, as in ExportService) ----------
  function overlayEl(cls, box) {
    var el = document.createElement('div');
    el.className = 'ov ' + cls;
    el.style.left = box.x + 'px'; el.style.top = box.y + 'px';
    el.style.width = box.width + 'px'; el.style.height = box.height + 'px';
    return el;
  }

  var mathJaxPromise = null;
  function loadMathJax() {
    if (!mathJaxPromise) {
      mathJaxPromise = new Promise(function (resolve, reject) {
        window.MathJax = {
          tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']] },
          svg: { fontCache: 'local', scale: 1 },
          options: { enableMenu: false, enableAssistiveMml: false },
          startup: { typeset: false, ready: function () { window.MathJax.startup.defaultReady(); resolve(window.MathJax); } },
        };
        var s = document.createElement('script');
        s.src = 'vendor/mathjax-tex-svg.js'; s.async = true;
        s.onerror = function () { reject(new Error('MathJax failed to load')); };
        document.head.appendChild(s);
      });
    }
    return mathJaxPromise;
  }

  function typesetEquations(els) {
    if (!els.length) return;
    loadMathJax().then(function (MJ) {
      els.forEach(function (el) { el.textContent = '\\[' + el.dataset.latex + '\\]'; });
      return MJ.typesetPromise(els).then(function () { els.forEach(function (el) { el.classList.add('typeset'); }); });
    }).catch(function (e) {
      console.warn('Equation typesetting unavailable:', e && e.message ? e.message : e);
      els.forEach(function (el) { el.textContent = el.dataset.latex; });
    });
  }

  function buildOverlays(stage, page) {
    page.texts.forEach(function (t) {
      if (!t.text) return;
      var el = overlayEl('text', t);
      el.textContent = t.text;
      el.style.fontSize = t.fontSize + 'px';
      el.style.color = t.colorHex || '#000';
      var bold = t.fontWeight === 'bold' || t.fontWeight === 'semibold';
      el.style.fontWeight = bold ? '700' : t.fontWeight === 'light' ? '300' : '400';
      if (t.fontName) el.style.fontFamily = '"' + String(t.fontName).replace(/["\\]/g, '') + '", Helvetica, Arial, sans-serif';
      stage.appendChild(el);
    });
    page.images.forEach(function (ia) {
      var el = overlayEl('img', ia);
      el.style.transform = 'rotate(' + (ia.rotation || 0) + 'deg)';
      var im = document.createElement('img');
      im.alt = ''; im.draggable = false; im.src = imageSrc(ia);
      el.appendChild(im);
      stage.appendChild(el);
    });
    var eqs = [];
    page.equations.forEach(function (q) {
      var el = overlayEl('eq', q);
      var latex = String(q.latex || '').trim();
      if (!latex) return;
      el.dataset.latex = latex;
      el.textContent = latex; // monospace fallback until MathJax typesets it (EquationWebViewHelper fallback)
      stage.appendChild(el);
      eqs.push(el);
    });
    page.tapes.forEach(function (t) {
      var el = overlayEl('tape' + (t.isRevealed ? ' revealed' : ''), t);
      var base = t.colorHex ? P.parseColor(t.colorHex, ACCENT) : ACCENT;
      if (t.isRevealed) { el.style.background = rgba(base, 0.18); el.style.borderColor = rgba(base, 0.5); }
      else el.style.background = rgba(base, 1);
      stage.appendChild(el);
    });
    page.links.forEach(function (l) {
      var el = overlayEl('link', l);
      var url = l.externalURL && /^https?:\/\//i.test(l.externalURL) ? l.externalURL : null;
      var label = l.label || (url ? url : (lang === 'zh' ? '链接' : 'Link'));
      var glyph = document.createElement('span'); glyph.className = 'glyph'; glyph.textContent = '\u2197';
      el.appendChild(glyph);
      if (url) {
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = label;
        el.appendChild(a);
      } else {
        var sp = document.createElement('span'); sp.textContent = label; el.appendChild(sp);
      }
      stage.appendChild(el);
    });
    typesetEquations(eqs);
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
    stage.dataset.page = String(idx);
    stage.dataset.strokes = String(page.ipsf ? page.ipsf.strokes.length : 0);
    stage.dataset.shapes = String(page.shapes.length);
    stage.dataset.template = page.template;
    var tx = rot === 90 ? h * z + 'px, 0' : rot === 180 ? w * z + 'px, ' + h * z + 'px' : rot === 270 ? '0, ' + w * z + 'px' : '0, 0';
    stage.style.transform = 'translate(' + tx + ') rotate(' + rot + 'deg) scale(' + z + ')';
    var canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    stage.appendChild(canvas);
    box.appendChild(stage);
    buildOverlays(stage, page);
    $('pageLabel').textContent = (idx + 1) + ' / ' + note.pages.length;
    $('zoomLabel').textContent = Math.round(z * 100) + '%';
    var banner = $('banner');
    var isPdfPage = !!note.pdf && page.pdfPageIndex >= 0 && (!state.pdfDoc || page.pdfPageIndex < state.pdfDoc.numPages);
    if (!page.ipsf && page.thumbnail) { banner.hidden = false; banner.textContent = T.thumbOnly; }
    else if (note.legacyNoInk) { banner.hidden = false; banner.textContent = T.legacy; }
    else if (isPdfPage && state.pdfError) { banner.hidden = false; banner.textContent = T.pdfBad; }
    else if (isPdfPage && !state.pdfDoc) { banner.hidden = false; banner.textContent = T.pdf; }
    else if (note.warnings.length) { banner.hidden = false; banner.textContent = T.warn + note.warnings.join('; '); }
    else banner.hidden = true;
    document.querySelectorAll('#thumbs button').forEach(function (b, i) { b.classList.toggle('active', i === idx); });
    try {
      await renderPage(note, page, canvas, Math.min((window.devicePixelRatio || 1) * z, 4), token, false);
      if (token === state.token) stage.dataset.rendered = '1';
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
    for (var i = 0; i < note.pages.length; i++) {
      var pg = note.pages[i];
      try { await renderPage(note, pg, pg.__thumb, 120 / pg.size.w, undefined, true); } catch (e) { /* skip */ }
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
      pdfBitmaps = {};
      $('drop').hidden = true; $('viewer').hidden = false;
      $('noteTitle').textContent = note.title || file.name;
      await openPDF(note);
      if (note !== state.note) return;
      fitWidth();
      await showPage(0);
      buildThumbs(note);
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

  // Test hook (read-only): lets the browser test drive the viewer and read render state.
  window.__inkelleViewer = {
    state: state, showPage: showPage, drawStroke: drawStroke, strokeWidthScale: STROKE_WIDTH_SCALE, templates: Tpl.names, drawTemplate: Tpl.draw,
    renderFlat: function (i, canvas, res) { return renderPage(state.note, state.note.pages[i], canvas, res, undefined, true); },
  };
})();
