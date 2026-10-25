// Real-browser check of the viewer against App-exported fixtures.
// Run from the site root:
//   npx -y playwright@1.47.0 install chromium
//   PLAYWRIGHT_DIR=<dir with node_modules/playwright> node --test viewer/test/browser.test.mjs
// Optional: VIEWER_URL=http://localhost:8000/viewer/ (e.g. `python3 -m http.server`) instead of the
// built-in static server; APP_PNG_DIR=<dir with fixture-*-p<N>.png from IPSFFixtureExportTests> adds
// a pixel comparison with the App's own render; SHOT_DIR=<dir> saves screenshots.
// Skips (does not fail) when Playwright is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '../..');
const fixtures = path.join(here, 'fixtures');

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

/** In-page: ink-mask agreement between the viewer's flat render and the App PNG (same 2x scale). */
async function compareWithApp(page, index, pngPath) {
  const b64 = (await readFile(pngPath)).toString('base64');
  return page.evaluate(async ({ index, b64 }) => {
    const V = window.__inkelleViewer;
    const pg = V.state.note.pages[index];
    const ours = document.createElement('canvas');
    await V.renderFlat(index, ours, 2);
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const app = document.createElement('canvas');
    app.width = ours.width; app.height = ours.height;
    app.getContext('2d').drawImage(img, 0, 0, ours.width, ours.height);
    const CELL = 16;
    const cols = Math.ceil(ours.width / CELL), rows = Math.ceil(ours.height / CELL);
    function mask(c) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const m = new Uint8Array(cols * rows);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        // distance from paper #FDF8F0; template rules stay below the threshold
        if (Math.abs(d[i] - 253) + Math.abs(d[i + 1] - 248) + Math.abs(d[i + 2] - 240) > 120) m[((y / CELL) | 0) * cols + ((x / CELL) | 0)] = 1;
      }
      return m;
    }
    const a = mask(app), o = mask(ours);
    const near = (m, k) => {
      const x = k % cols, y = (k / cols) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows && m[yy * cols + xx]) return true;
      }
      return false;
    };
    let oN = 0, oHit = 0, aN = 0, aHit = 0;
    for (let k = 0; k < o.length; k++) {
      if (o[k]) { oN++; if (near(a, k)) oHit++; }
      if (a[k]) { aN++; if (near(o, k)) aHit++; }
    }
    return { size: [ours.width, ours.height], precision: oHit / oN, recall: aHit / aN, oursCells: oN, appCells: aN, template: pg.template };
  }, { index, b64 });
}

async function openFixture(browser, base, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1, locale: 'en-US' });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.setInputFiles('#file', path.join(fixtures, name));
  await page.waitForSelector('.stage[data-rendered="1"]');
  return { page, errors };
}

async function show(page, i) {
  await page.evaluate((i) => window.__inkelleViewer.showPage(i), i);
  await page.waitForSelector(`.stage[data-page="${i}"][data-rendered="1"]`);
}

/** Fraction of sampled canvas pixels (every 7th px on a grid) that differ from paper. */
function inkFraction(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.stage canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, ink = 0;
    for (let y = 0; y < c.height; y += 7) for (let x = 0; x < c.width; x += 7) {
      const i = (y * c.width + x) * 4; n++;
      if (Math.abs(d[i] - 253) + Math.abs(d[i + 1] - 248) + Math.abs(d[i + 2] - 240) > 120) ink++;
    }
    return ink / n;
  });
}

/** Canvas pixel at page coordinates (x, y). */
function pixelAt(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector('.stage canvas');
    const k = c.width / parseFloat(c.style.width);
    return Array.from(c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data);
  }, [x, y]);
}

const shotDir = process.env.SHOT_DIR;
const appDir = process.env.APP_PNG_DIR;

test('viewer renders real App fixtures in Chromium', { skip: !chromium && 'playwright not installed' }, async (t) => {
  const srv = process.env.VIEWER_URL ? null : await startServer();
  const base = process.env.VIEWER_URL || `http://127.0.0.1:${srv.address().port}/viewer/`;
  const browser = await chromium.launch();
  try {
    await t.test('ink note: 3 pages, ink, overlays, MathJax', async () => {
      const { page, errors } = await openFixture(browser, base, 'fixture-ink.inkelle');
      assert.equal(await page.locator('#thumbs button').count(), 3);
      assert.equal(await page.textContent('#pageLabel'), '1 / 3');
      const expect = [
        { template: 'lined', strokes: '7', shapes: '0', ink: [[296, 230 + 24 * Math.sin(9)], [270, 640]] },
        { template: 'cornell', strokes: '2', shapes: '3', ink: [[80, 180], [290, 610]] },
        { template: 'mizige', strokes: '3', shapes: '0', ink: [[183 - 22, 92]] },
      ];
      for (let i = 0; i < 3; i++) {
        await show(page, i);
        const st = await page.locator('.stage').evaluate((el) => ({ ...el.dataset }));
        assert.equal(st.template, expect[i].template);
        assert.equal(st.strokes, expect[i].strokes);
        assert.equal(st.shapes, expect[i].shapes);
        const frac = await inkFraction(page);
        assert.ok(frac > 0.001, `page ${i + 1} canvas looks blank (${frac})`);
        for (const [x, y] of expect[i].ink) {
          const px = await pixelAt(page, x, y);
          assert.ok(px[0] + px[1] + px[2] < 600, `page ${i + 1} expected ink at ${x},${y}, got ${px}`);
        }
        if (i === 0) {
          assert.match(await page.locator('.ov.text').textContent(), /文本框/);
          const box = await page.locator('.ov.img img').evaluate((im) => [im.naturalWidth > 0, im.clientWidth, im.clientHeight]);
          assert.deepEqual(box, [true, 160, 120]);
        }
        if (i === 1) assert.equal(await page.locator('.ov.tape').count(), 1);
        if (i === 2) {
          await page.waitForSelector('.ov.eq.typeset svg', { timeout: 20000 });
          assert.equal(await page.locator('.ov.link a').getAttribute('href'), 'https://inkelle.pages.dev');
        }
        if (shotDir) await page.locator('#pageBox').screenshot({ path: path.join(shotDir, `viewer-ink-p${i}.png`) });
        const png = appDir && path.join(appDir, `fixture-ink-p${i}.png`);
        if (png && existsSync(png)) {
          const cmp = await compareWithApp(page, i, png);
          console.log(`ink p${i}`, JSON.stringify(cmp));
          assert.ok(cmp.precision > 0.9, `page ${i + 1} viewer ink not where the App draws it: ${JSON.stringify(cmp)}`);
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
    });

    await t.test('PDF note: pdf.js background under ink', async () => {
      const { page, errors } = await openFixture(browser, base, 'fixture-pdf.inkelle');
      assert.equal(await page.locator('#thumbs button').count(), 2);
      assert.equal(await page.locator('#banner').isHidden(), true);
      for (let i = 0; i < 2; i++) {
        await show(page, i);
        const fill = await pixelAt(page, 170, 460); // PDF's coloured block (teal / orange)
        const tealOrOrange = i === 0 ? fill[2] > 150 && fill[0] < 100 : fill[0] > 200 && fill[2] < 100;
        assert.ok(tealOrOrange, `PDF page ${i + 1} background missing, got ${fill}`);
        const frame = await pixelAt(page, 36, 300); // PDF frame line
        assert.ok(frame[0] < 160, `PDF frame missing on page ${i + 1}, got ${frame}`);
        if (shotDir) await page.locator('#pageBox').screenshot({ path: path.join(shotDir, `viewer-pdf-p${i}.png`) });
        const png = appDir && path.join(appDir, `fixture-pdf-p${i}.png`);
        if (png && existsSync(png)) {
          const cmp = await compareWithApp(page, i, png);
          console.log(`pdf p${i}`, JSON.stringify(cmp));
          assert.ok(cmp.precision > 0.9 && cmp.recall > 0.9, `PDF page ${i + 1} differs from App: ${JSON.stringify(cmp)}`);
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
    });

    await t.test('all 25 paper templates draw', async () => {
      const page = await browser.newPage();
      await page.goto(base);
      const res = await page.evaluate(() => {
        const V = window.__inkelleViewer;
        return V.templates.map((name) => {
          const c = document.createElement('canvas'); c.width = 820; c.height = 1060;
          const ctx = c.getContext('2d');
          V.drawTemplate(ctx, name, 820, 1060);
          const d = ctx.getImageData(0, 0, 820, 1060).data;
          let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
          return [name, n];
        });
      });
      assert.equal(res.length, 25);
      for (const [name, n] of res) assert.ok(name === 'blank' ? n === 0 : n > 1000, `${name}: ${n}`);
      if (shotDir) {
        await page.evaluate(() => {
          const V = window.__inkelleViewer, wrap = document.createElement('div');
          wrap.id = 'sheet'; wrap.style.cssText = 'display:grid;grid-template-columns:repeat(5,164px);gap:4px;background:#999;padding:4px;width:max-content';
          V.templates.forEach((name) => {
            const c = document.createElement('canvas'); c.width = 820; c.height = 1060; c.style.width = '164px'; c.style.background = '#FDF8F0';
            V.drawTemplate(c.getContext('2d'), name, 820, 1060); wrap.appendChild(c);
          });
          document.body.prepend(wrap);
        });
        await page.locator('#sheet').screenshot({ path: path.join(shotDir, 'viewer-templates.png') });
      }
      await page.close();
    });
  } finally {
    await browser.close();
    if (srv) srv.close();
  }
});
