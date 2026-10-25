// Run from the site root: node --test viewer/test/parse.test.mjs
// Fixtures in ./fixtures are real packages exported by the App (InkelleTests/IPSFFixtureExportTests:
// NoteShareService.exportNote → directory package zipped with ZipArchiveWriter).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const fflate = require('../vendor/fflate.min.js');
const P = require('../inkelle-parse.js');

const load = (name) => new Uint8Array(readFileSync(new URL('./fixtures/' + name, import.meta.url)));
const INK = load('fixture-ink.inkelle');
const PDF = load('fixture-pdf.inkelle');
const enc = (o) => fflate.strToU8(JSON.stringify(o));

/** Rewrites the real ink fixture: `edit(files)` mutates the unzipped entry map. */
function variant(edit) {
  const files = fflate.unzipSync(INK);
  edit(files);
  return fflate.zipSync(files);
}

test('real ink note: v5 manifest, 3 pages, templates, IPSF strokes', () => {
  const note = P.parseInkelle(INK, fflate);
  assert.equal(note.version, 5);
  assert.equal(note.title, 'Inkelle Web Viewer Fixture');
  assert.equal(note.pdf, null);
  assert.deepEqual(note.warnings, []);
  assert.equal(note.hasRenderableInk, true);
  assert.equal(note.legacyNoInk, false);
  assert.deepEqual(note.pages.map((p) => p.template), ['lined', 'cornell', 'mizige']);
  assert.deepEqual(note.pages.map((p) => p.size), [{ w: 820, h: 1060 }, { w: 820, h: 1060 }, { w: 750, h: 1060 }]);
  assert.deepEqual(note.pages.map((p) => p.ipsf.strokes.length), [7, 2, 3]);
  note.pages.forEach((p) => assert.deepEqual([p.ipsf.canvas.w, p.ipsf.canvas.h], [p.size.w, p.size.h]));

  const strokes = note.pages[0].ipsf.strokes;
  assert.deepEqual(strokes.map((s) => s.tool), ['pen', 'marker', 'pencil', 'fountainPen', 'pen', 'watercolor', 'pen']);
  assert.equal(strokes[1].color, '#FFD933FF');
  assert.equal(strokes[1].width, 18);
  assert.equal(strokes[6].transform.length, 6);
  assert.ok(strokes[0].points[0].length >= 9);
  assert.deepEqual(strokes[0].points[0].slice(0, 2), [80, 230]);
});

test('real ink note: overlays', () => {
  const [p0, p1, p2] = P.parseInkelle(INK, fflate).pages;
  assert.match(p0.texts[0].text, /文本框/);
  assert.equal(p0.texts[0].fontWeight, 'bold');
  assert.equal(p0.images.length, 1);
  assert.equal(p0.images[0].mime, 'image/png');
  assert.equal(p0.images[0].rotation, 12);
  assert.deepEqual(p1.shapes.map((s) => s.kindRaw), ['ellipse', 'arrow', 'rectangle']);
  assert.equal(p1.shapes[0].rotation, 0.4);
  assert.equal(p1.shapes[2].dashRaw, 'dashed');
  assert.equal(p1.tapes.length, 1);
  assert.equal(p1.tapes[0].isRevealed, false);
  assert.match(p2.equations[0].latex, /\\frac\{1\}\{3\}/);
  assert.equal(p2.links[0].externalURL, 'https://inkelle.pages.dev');
});

test('real PDF note: document.pdf and authored page size', () => {
  const note = P.parseInkelle(PDF, fflate);
  assert.equal(note.version, 5);
  assert.equal(note.manifest.contentType, 'pdf');
  assert.ok(note.pdf && fflate.strFromU8(note.pdf.subarray(0, 5)) === '%PDF-');
  assert.deepEqual(note.pages.map((p) => p.pdfPageIndex), [0, 1]);
  assert.deepEqual(note.pages.map((p) => p.size), [{ w: 612, h: 792 }, { w: 612, h: 792 }]);
  assert.deepEqual(note.pages.map((p) => p.ipsf.strokes.length), [2, 1]);
});

test('zlib-wrapped IPSF is accepted too', () => {
  const zip = variant((files) => {
    for (const k of Object.keys(files)) {
      if (k.endsWith('.ink.ipsf.json.z')) files[k] = fflate.zlibSync(fflate.inflateSync(files[k]));
    }
  });
  assert.deepEqual(P.parseInkelle(zip, fflate).pages.map((p) => p.ipsf.strokes.length), [7, 2, 3]);
});

test('package nested under a root folder', () => {
  const zip = variant((files) => {
    for (const k of Object.keys(files)) { files['My Note.inkelle/' + k] = files[k]; delete files[k]; }
  });
  const note = P.parseInkelle(zip, fflate);
  assert.equal(note.pages[0].ipsf.strokes.length, 7);
  assert.equal(note.pages[0].images.length, 1);
});

test('v4 package without IPSF is flagged legacy', () => {
  const zip = variant((files) => {
    const m = JSON.parse(fflate.strFromU8(files['note.json']));
    files['note.json'] = enc({ ...m, version: 4 });
    const pages = JSON.parse(fflate.strFromU8(files['pages.json']));
    files['pages.json'] = enc(pages.map(({ ipsfFileName, ...rest }) => rest));
    for (const k of Object.keys(files)) if (k.endsWith('.ink.ipsf.json.z')) delete files[k];
  });
  const note = P.parseInkelle(zip, fflate);
  assert.equal(note.version, 4);
  assert.equal(note.pages[0].ipsf, null);
  assert.equal(note.hasRenderableInk, false);
  assert.equal(note.legacyNoInk, true);
});

test('corrupt IPSF becomes a warning, not a failure', () => {
  const zip = variant((files) => {
    const k = Object.keys(files).find((n) => n.endsWith('.ink.ipsf.json.z'));
    files[k] = new Uint8Array([9, 9, 9, 9]);
  });
  const note = P.parseInkelle(zip, fflate);
  assert.equal(note.pages.filter((p) => p.ipsf === null).length, 1);
  assert.equal(note.warnings.length, 1);
});

test('page size: authored, paper, landscape', () => {
  assert.deepEqual(P.pageSize({ authoredWidth: 595, authoredHeight: 842 }), { w: 595, h: 842 });
  assert.deepEqual(P.pageSize({ paperSizeRaw: 'a4' }), { w: 750, h: 1060 });
  assert.deepEqual(P.pageSize({ paperSizeRaw: 'letter', isLandscape: true }), { w: 1060, h: 819 });
  assert.deepEqual(P.pageSize({}), { w: 820, h: 1060 });
});

test('rejects bad inputs', () => {
  assert.throws(() => P.parseInkelle(new Uint8Array([1, 2, 3]), fflate), /zip/);
  assert.throws(() => P.parseInkelle(fflate.zipSync({ 'x.txt': new Uint8Array(1) }), fflate), /note\.json/);
  assert.throws(() => P.parseIPSF(enc({ ipsf: 2, canvas: { w: 1, h: 1 }, strokes: [] })), /version/);
  assert.throws(() => P.parseIPSF(enc({ ipsf: 1, canvas: { w: 1, h: 1 },
    strokes: [{ id: 'a', width: 1, points: [[1]] }] })), /Malformed/);
});

test('parseColor', () => {
  assert.deepEqual(P.parseColor('#1E6FD980'), { r: 30, g: 111, b: 217, a: 128 / 255 });
  assert.deepEqual(P.parseColor('#FF0000'), { r: 255, g: 0, b: 0, a: 1 });
});
