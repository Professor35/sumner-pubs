// Sumner publications robot.
// Downloads the free official books listed in books.json, reads their text, picks out the
// passage-planning entries with the same code the Sumner app uses, and writes one small
// data file per book into pubdata/. Runs on GitHub Actions; nothing here needs a key.
//
//   ONLY=nga147,nga148 node read-books.mjs      read just those books
//   node read-books.mjs                         read every book that has a link
//   APP_FILE=index.html LOCAL=nga131=/path/Pub131.pdf node read-books.mjs   test without downloading

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const APP_URL = process.env.APP_URL || 'https://sumnermarine.com/';
const OUT = 'pubdata';
const UA = 'SumnerMarine-publications-robot/1.0 (+https://sumnermarine.com)';
const only = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const local = Object.fromEntries((process.env.LOCAL || '').split(',').filter(Boolean).map(s => s.split('=')));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const log = [];
const say = (...a) => { console.log(...a); };

// 1. The reading rules come from the app itself, so the robot and the app never disagree.
const appHtml = process.env.APP_FILE ? fs.readFileSync(process.env.APP_FILE, 'utf8') : await (await fetch(APP_URL, { headers: { 'User-Agent': UA } })).text();
const m = appHtml.match(/\/\*LOGIC-START\*\/([\s\S]*?)\/\*LOGIC-END\*\//);
if (!m) { console.error('Could not find the reading rules in the app at ' + APP_URL); process.exit(1); }
const rules = sha(m[1]).slice(0, 12);
const { pubExtract, PUBCAT } = new Function(m[1] + '\nreturn { pubExtract, PUBCAT };')();

const books = JSON.parse(fs.readFileSync('books.json', 'utf8')).books;
fs.mkdirSync(OUT, { recursive: true });
const indexPath = path.join(OUT, 'index.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { books: {} };

async function pagesOf(buf) {
  const task = getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }), doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p), tc = await page.getTextContent();
    let s = '';
    for (const it of tc.items) if (it.str) s += it.str + (it.hasEOL ? '\n' : ' ');   // same joining as the app
    pages.push(s.replace(/\u0000/g, ''));
    page.cleanup();
  }
  await task.destroy();
  return pages;
}

for (const b of books) {
  if (only.length && !only.includes(b.id)) continue;
  const cat = PUBCAT.find(c => c.id === b.id);
  const name = cat ? cat.pub + ' ' + cat.title : b.id;
  try {
    let buf;
    if (local[b.id]) buf = fs.readFileSync(local[b.id]);
    else {
      if (!b.url) { log.push([b.id, name, 'SKIPPED', 'no download link set in books.json']); continue; }
      const r = await fetch(b.url, { headers: { 'User-Agent': UA, 'Accept': 'application/pdf,*/*' }, redirect: 'follow' });
      if (!r.ok) throw new Error('download answered ' + r.status);
      buf = Buffer.from(await r.arrayBuffer());
    }
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('the link did not return a PDF (' + buf.length + ' bytes, starts "' + buf.subarray(0, 40).toString('latin1').replace(/\s+/g, ' ') + '")');
    const fileSha = sha(buf), old = index.books[b.id];
    if (old && old.sha === fileSha && old.rules === rules && fs.existsSync(path.join(OUT, b.id + '.json'))) { log.push([b.id, name, 'UNCHANGED', old.items + ' entries, ' + (old.edition || 'edition not found')]); continue; }
    const pages = await pagesOf(buf);
    const chars = pages.reduce((t, s) => t + s.length, 0);
    if (chars < pages.length * 20) throw new Error('no text found, it looks like scanned pages');
    const items = pubExtract(pages);
    const front = pages.slice(0, 4).join(' ');
    const ed = (/\b(20\d\d)\b[^.]{0,40}\bEDITION\b/i.exec(front) || /\bEDITION\b[^.]{0,40}\b(20\d\d)\b/i.exec(front) || /\b(20\d\d)\b/.exec(front) || [])[1] || '';
    const built = new Date().toISOString();
    const data = { id: b.id, pub: cat ? cat.pub : b.id, title: cat ? cat.title : '', publisher: cat ? cat.src : '', edition: ed, pages: pages.length, source: b.url || 'local file', sha: fileSha, rules, built, items };
    fs.writeFileSync(path.join(OUT, b.id + '.json'), JSON.stringify(data));
    index.books[b.id] = { edition: ed, pages: pages.length, items: items.length, sha: fileSha, rules, built, mb: +(buf.length / 1048576).toFixed(1) };
    const kinds = {}; items.forEach(i => { kinds[i.kind] = (kinds[i.kind] || 0) + 1; });
    log.push([b.id, name, 'READ', pages.length + ' pages, ' + items.length + ' entries (' + Object.entries(kinds).map(([k, v]) => v + ' ' + k).join(', ') + '), edition ' + (ed || 'not found') + ', ' + index.books[b.id].mb + ' MB']);
  } catch (e) {
    log.push([b.id, name, 'FAILED', String(e && e.message || e)]);
  }
  say(log[log.length - 1].join(' | '));
}

index.built = new Date().toISOString();
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
const table = '| Book | Result | Detail |\n|---|---|---|\n' + log.map(l => '| ' + l[1] + ' (' + l[0] + ') | ' + l[2] + ' | ' + l[3].replace(/\|/g, '/') + ' |').join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Sumner publications robot\n\n' + table + '\n');
say('\n' + log.filter(l => l[2] === 'READ').length + ' read, ' + log.filter(l => l[2] === 'UNCHANGED').length + ' unchanged, ' + log.filter(l => l[2] === 'FAILED').length + ' failed, ' + log.filter(l => l[2] === 'SKIPPED').length + ' skipped.');
