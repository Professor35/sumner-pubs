// Sumner DSC stations robot.
// Reads the free IMO GMDSS Master Plan (GMDSS.1/Circ.22, 2018: the last edition published with its station tables),
// picks out the VHF, MF and HF DSC coast stations (with their remote sites) using the same reading rules the Sumner app uses, adds the
// administrations' own confirmations from stations-extra.json, and writes stations/dsc.json for the app.
//   node read-stations.mjs                 normal run
//   TEXT=1 node read-stations.mjs           also save the plain text (pubtext/gmdss-master-plan.txt), for tuning
//   LOCAL_PDF=file.pdf APP_FILE=index.html node read-stations.mjs   test without downloading

import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const UA = 'SumnerMarine-stations-robot/1.0 (+https://sumnermarine.com)';
const SRC = 'https://wwwcdn.imo.org/localresources/en/OurWork/Safety/Documents/Documents%20relevant%20to%20SAR/GMDSS.1-CIRC.22%20GMDSS%20Master%20Plan.pdf';
const say = (...a) => console.log(...a);

const appHtml = process.env.APP_FILE ? fs.readFileSync(process.env.APP_FILE, 'utf8') : await (await fetch(process.env.APP_URL || 'https://sumnermarine.com/', { headers: { 'User-Agent': UA } })).text();
const m = appHtml.match(/\/\*LOGIC-START\*\/([\s\S]*?)\/\*LOGIC-END\*\//);
if (!m) { console.error('Could not find the reading rules in the app.'); process.exit(1); }
const { dscExtract } = new Function(m[1] + '\nreturn { dscExtract };')();

let buf;
if (process.env.LOCAL_PDF) buf = fs.readFileSync(process.env.LOCAL_PDF);
else {
  const r = await fetch(SRC, { headers: { 'User-Agent': UA, 'Accept': 'application/pdf,*/*' } });
  if (!r.ok) { console.error('Master Plan download answered ' + r.status); process.exit(1); }
  buf = Buffer.from(await r.arrayBuffer());
}
if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { console.error('The Master Plan link did not return a PDF.'); process.exit(1); }

const task = getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }), doc = await task.promise, pages = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p), tc = await page.getTextContent();
  let s = '';
  for (const it of tc.items) if (it.str) s += it.str + (it.hasEOL ? '\n' : ' ');
  pages.push(s.replace(/\u0000/g, ''));
  page.cleanup();
}
await task.destroy();
if (process.env.TEXT) { fs.mkdirSync('pubtext', { recursive: true }); fs.writeFileSync('pubtext/gmdss-master-plan.txt', pages.map((t, i) => '=== page ' + (i + 1) + ' ===\n' + t).join('\n')); }

const stations = dscExtract(pages);
const extra = fs.existsSync('stations-extra.json') ? JSON.parse(fs.readFileSync('stations-extra.json', 'utf8')) : {};
const out = { built: new Date().toISOString(), sources: [{ name: 'IMO GMDSS Master Plan, GMDSS.1/Circ.22 (30 July 2018)', url: SRC, note: 'The last edition published with station tables. Stations may have changed since 2018.' }].concat(extra.sources || []), stations, confirm: extra.confirm || [], areas: extra.areas || [] };
fs.mkdirSync('stations', { recursive: true });
fs.writeFileSync('stations/dsc.json', JSON.stringify(out));
const by = {}; stations.forEach(s => { by[s.band] = (by[s.band] || 0) + 1; });
const countries = new Set(stations.map(s => s.country).filter(Boolean)).size;
const summary = pages.length + ' pages read, ' + stations.length + ' DSC station sites' + (countries ? ' from ' + countries + ' countries' : '') + ' (' + Object.entries(by).map(([k, v]) => v + ' ' + k).join(', ') + '), ' + (extra.confirm || []).length + ' confirmations added, ' + Math.round(fs.statSync('stations/dsc.json').size / 1024) + ' KB.';
say(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Sumner DSC stations robot\n\n' + summary + '\n');
