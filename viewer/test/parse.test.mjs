// Run from the site root: node --test viewer/test/parse.test.mjs
// No real .inkelle exists in the repos, so the fixture is built here following
// NoteShareService.exportNote (note.json + pages.json + pages/<id>.ink.ipsf.json.z).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fflate = require('../vendor/fflate.min.js');
const P = require('../inkelle-parse.js');

const enc = (o) => fflate.strToU8(JSON.stringify(o));
const PAGE = '11111111-2222-3333-4444-555555555555';

const ipsf = {
  ipsf: 1,
  canvas: { w: 820, h: 1060 },
  strokes: [
    { id: '1:1:pen', tool: 'pen', color: '#1E6FD9FF', width: 2.75, created: 1, seed: 1,
      points: [[10, 10, 1, 0, 1.5, 0, 2.5, 2.5, 1], [50, 60, 2, 0, 1.5, 10, 3, 3, 1], [90, 40]] },
    { id: '2:2:marker', tool: 'marker', color: '#FFEB3B80', width: 12, created: 2,
      transform: [1, 0, 0, 1, 5, 5], points: [[0, 0], [100, 0]] },
  ],
};

function buildPackage({ version = 5, withIpsf = true, prefix = '', raw = true, extraPage = {} } = {}) {
  const files = {};
  files[prefix + 'note.json'] = enc({
    version, title: 'Fixture', contentType: 'handwritten', createdAt: '2026-10-24T00:00:00Z',
    updatedAt: '2026-10-24T00:00:00Z', isFavorite: false, pageCount: 1,
  });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  files[prefix + 'pages.json'] = enc([{
    pageIndex: 0, templateRaw: 'lined', pdfPageIndex: 0, hasDrawing: true, hasThumbnail: false,
    textAnnotations: [{ text: 'hi', x: 1, y: 2, width: 100, height: 30, fontSize: 16, fontWeight: 'bold', colorHex: '#112233' }],
    imageAnnotations: [{ x: 0, y: 0, width: 50, height: 50, rotation: 0, fileName: PAGE + '_img_0.dat' }],
    shapeAnnotations: [{ kindRaw: 'triangle', points: [[0, 0], [10, 10], [0, 10]], strokeHex: '#000000',
      fillOpacity: 0.5, lineWidth: 2, rotation: 0, zIndex: 1 }],
    ...(withIpsf ? { ipsfFileName: PAGE + '.ink.ipsf.json.z' } : {}),
    ...extraPage,
  }]);
  files[prefix + 'images/' + PAGE + '_img_0.dat'] = png;
  if (withIpsf) {
    // NSData .zlib == raw deflate
    files[prefix + 'pages/' + PAGE + '.ink.ipsf.json.z'] = raw ? fflate.deflateSync(enc(ipsf)) : fflate.zlibSync(enc(ipsf));
  }
  return fflate.zipSync(files);
}

test('v5 package: manifest, page, ipsf strokes', () => {
  const note = P.parseInkelle(buildPackage(), fflate);
  assert.equal(note.version, 5);
  assert.equal(note.title, 'Fixture');
  assert.equal(note.pages.length, 1);
  const pg = note.pages[0];
  assert.equal(pg.template, 'lined');
  assert.deepEqual(pg.size, { w: 820, h: 1060 });
  assert.equal(pg.ipsf.strokes.length, 2);
  assert.equal(pg.ipsf.strokes[0].points.length, 3);
  assert.equal(pg.texts[0].text, 'hi');
  assert.equal(pg.images[0].mime, 'image/png');
  assert.equal(pg.shapes[0].kindRaw, 'triangle');
  assert.equal(note.hasRenderableInk, true);
  assert.equal(note.legacyNoInk, false);
});

test('zlib-wrapped IPSF is accepted too', () => {
  const note = P.parseInkelle(buildPackage({ raw: false }), fflate);
  assert.equal(note.pages[0].ipsf.strokes.length, 2);
});

test('package nested under a root folder', () => {
  const note = P.parseInkelle(buildPackage({ prefix: 'My Note.inkelle/' }), fflate);
  assert.equal(note.pages[0].ipsf.strokes.length, 2);
  assert.equal(note.pages[0].images.length, 1);
});

test('v4 package without IPSF is flagged legacy', () => {
  const note = P.parseInkelle(buildPackage({ version: 4, withIpsf: false }), fflate);
  assert.equal(note.version, 4);
  assert.equal(note.pages[0].ipsf, null);
  assert.equal(note.hasRenderableInk, false);
  assert.equal(note.legacyNoInk, true);
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

test('corrupt IPSF becomes a warning, not a failure', () => {
  const files = fflate.unzipSync(buildPackage());
  files['pages/' + PAGE + '.ink.ipsf.json.z'] = new Uint8Array([9, 9, 9, 9]);
  const note = P.parseInkelle(fflate.zipSync(files), fflate);
  assert.equal(note.pages[0].ipsf, null);
  assert.equal(note.warnings.length, 1);
});

test('parseColor', () => {
  assert.deepEqual(P.parseColor('#1E6FD980'), { r: 30, g: 111, b: 217, a: 128 / 255 });
  assert.deepEqual(P.parseColor('#FF0000'), { r: 255, g: 0, b: 0, a: 1 });
});
