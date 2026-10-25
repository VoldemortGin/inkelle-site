// Pixel-level check of every paper template against the App's own render.
// Fixtures: viewer/test/fixtures/templates/<template>.png, written by the App's
// InkelleTests/TemplatePNGExportTests (820x1060 page, light paper, 2x -> 1640x2120):
//   TEST_RUNNER_INKELLE_TEMPLATE_OUT=<dir> xcodebuild test-without-building ... -only-testing:InkelleTests/TemplatePNGExportTests
// Run from the site root (same Playwright setup as browser.test.mjs):
//   PLAYWRIGHT_DIR=<dir with node_modules/playwright> node --test viewer/test/template-pixels.test.mjs
// REPORT=1 prints the per-template table; DIFF_DIR=<dir> saves viewer/diff PNGs for failing templates.
// Skips (does not fail) when Playwright is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '../..');
const fixtures = path.join(here, 'fixtures', 'templates');

let chromium = null;
try {
  const base = process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'x.js') : import.meta.url;
  ({ chromium } = createRequire(base)('playwright'));
} catch { /* not installed */ }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function startServer() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(siteRoot, p);
      if (!file.startsWith(siteRoot)) { res.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
      } catch { res.writeHead(404).end(); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Residuals are App darkness minus contrast-scaled web darkness (see compare). A pixel is a "hard" mismatch when it differs by more than TOL in some channel AND no pixel in the
// other image's 3x3 neighbourhood matches it within TOL (absorbs sub-pixel anti-aliasing shifts).
const TOL = Number(process.env.TOL || 6);
const MAX_HARD_FRACTION = 0.0005; // of all pixels
const MAX_RAW_FRACTION = 0.005;  // pixels over TOL even after the 3x3 shift allowance would be reported, not fatal below this
const MIN_CONTRAST = 0.6, MAX_CONTRAST = 1.1; // fitted App/web line-darkness ratio (CoreGraphics draws thin lines ~20% lighter)

const W = 820, H = 1060, RES = 2;

const compare = ({ name, b64, W, H, RES, TOL, appPaper }) => (async () => {
  const V = window.__inkelleViewer;
  const ours = document.createElement('canvas'); ours.width = W * RES; ours.height = H * RES;
  const octx = ours.getContext('2d');
  octx.scale(RES, RES); octx.fillStyle = '#FDF8F0'; octx.fillRect(0, 0, W, H);
  V.drawTemplate(octx, name, W, H);
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const app = document.createElement('canvas'); app.width = ours.width; app.height = ours.height;
  app.getContext('2d').drawImage(img, 0, 0);
  const w = ours.width, h = ours.height, n = w * h;
  const rawA = app.getContext('2d').getImageData(0, 0, w, h).data, rawO = octx.getImageData(0, 0, w, h).data;
  // Darkness below each side's own paper, per channel (the App's bitmap context lands #FDF8F0 at ~(254,249,243)).
  const paperO = [253, 248, 240];
  const da = new Float32Array(n * 3), dO = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { da[i * 3 + c] = appPaper[c] - rawA[i * 4 + c]; dO[i * 3 + c] = paperO[c] - rawO[i * 4 + c]; }
  // Thin CoreGraphics strokes come out lighter than Skia's (same geometry, ~20% less coverage): fit one
  // contrast scale s per template (least squares) so only geometry / position / colour-hue errors remain.
  let num = 0, den = 0;
  for (let k = 0; k < da.length; k++) { num += da[k] * dO[k]; den += dO[k] * dO[k]; }
  const s = den ? num / den : 1;
  const res = (p, q, i, j) => { // max channel |p[i] - s q[j]| with p = App, q = ours
    return Math.max(Math.abs(p[i] - s * q[j]), Math.abs(p[i + 1] - s * q[j + 1]), Math.abs(p[i + 2] - s * q[j + 2]));
  };
  const nearOk = (appSide, x, y) => { // some 3x3 neighbour matches within TOL (absorbs sub-pixel shifts)
    const i = (y * w + x) * 3;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = (yy * w + xx) * 3;
      if ((appSide ? res(da, dO, i, j) : res(da, dO, j, i)) <= TOL) return true;
    }
    return false;
  };
  let rawN = 0, hard = 0, maxDiff = 0;
  const diff = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const d = res(da, dO, i * 3, i * 3);
    if (d > maxDiff) maxDiff = d;
    diff[i * 4 + 3] = 255;
    if (d > TOL) {
      rawN++;
      if (!nearOk(true, x, y) && !nearOk(false, x, y)) { hard++; diff[i * 4] = 255; } else { diff[i * 4] = 120; diff[i * 4 + 1] = 120; }
    } else { diff[i * 4] = diff[i * 4 + 1] = diff[i * 4 + 2] = 255 - Math.min(255, d * 8); }
  }
  const dc = document.createElement('canvas'); dc.width = w; dc.height = h;
  dc.getContext('2d').putImageData(new ImageData(diff, w, h), 0, 0);
  return { name, rawFraction: rawN / n, hardFraction: hard / n, maxDiff: Math.round(maxDiff * 10) / 10, scale: s,
    diffPng: hard ? dc.toDataURL('image/png').split(',')[1] : null,
    oursPng: hard ? ours.toDataURL('image/png').split(',')[1] : null };
})();

test('every paper template matches the App render', { skip: !chromium && 'playwright not installed' }, async () => {
  const srv = process.env.VIEWER_URL ? null : await startServer();
  const base = process.env.VIEWER_URL || `http://127.0.0.1:${srv.address().port}/viewer/`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    const names = await page.evaluate(() => window.__inkelleViewer.templates);
    assert.equal(names.length, 25);
    const rows = [];
    // the App's own paper colour, read from the blank template
    const appPaper = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }, (await readFile(path.join(fixtures, 'blank.png'))).toString('base64'));
    for (const name of names) {
      const b64 = (await readFile(path.join(fixtures, name + '.png'))).toString('base64');
      rows.push(await page.evaluate(compare, { name, b64, W, H, RES, TOL, appPaper }));
    }
    if (process.env.REPORT) {
      console.log('template              hard%     raw%   maxDiff  contrast');
      for (const r of rows) console.log(`${r.name.padEnd(20)} ${(r.hardFraction * 100).toFixed(4).padStart(8)} ${(r.rawFraction * 100).toFixed(4).padStart(8)} ${String(r.maxDiff).padStart(7)} ${r.scale.toFixed(3).padStart(8)}`);
    }
    if (process.env.DIFF_DIR) {
      await mkdir(process.env.DIFF_DIR, { recursive: true });
      for (const r of rows) if (r.diffPng) {
        await writeFile(path.join(process.env.DIFF_DIR, r.name + '.diff.png'), Buffer.from(r.diffPng, 'base64'));
        await writeFile(path.join(process.env.DIFF_DIR, r.name + '.web.png'), Buffer.from(r.oursPng, 'base64'));
      }
    }
    for (const r of rows) {
      assert.ok(r.hardFraction <= MAX_HARD_FRACTION, `${r.name}: ${(r.hardFraction * 100).toFixed(4)}% hard-mismatch pixels (max diff ${r.maxDiff})`);
      assert.ok(r.rawFraction <= MAX_RAW_FRACTION, `${r.name}: ${(r.rawFraction * 100).toFixed(3)}% pixels differ beyond tolerance`);
      if (r.name !== 'blank') assert.ok(r.scale >= MIN_CONTRAST && r.scale <= MAX_CONTRAST, `${r.name}: contrast scale ${r.scale.toFixed(3)} (web vs App)`);
    }
  } finally {
    await browser.close();
    if (srv) srv.close();
  }
});
