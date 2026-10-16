// Sumner warnings robot.
// NGA's public warnings feed stopped updating in May 2024, so this robot reads the NAVAREA coordinators' own lists
// of warnings in force (see warn-sources.json) and writes warnings/<source>.json plus warnings/index.json for the app.
// Each list is a web page laid out differently; the robot uses one general reader (find "NAVAREA XI 1234/26",
// take the text up to the next one). A source counts as working only when it gives full warning texts.
//   node read-warnings.mjs              normal run
//   RAW=1 node read-warnings.mjs        also save each page as text in warnraw/, for tuning the reader
//   ONLY=navarea-1,navarea-11 ...       just these sources

import fs from 'node:fs';

const UA = 'Mozilla/5.0 (compatible; SumnerMarine-warnings-robot/1.0; +https://sumnermarine.com)';
const cfg = JSON.parse(fs.readFileSync('warn-sources.json', 'utf8'));
const only = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const RAW = !!process.env.RAW;
const say = (...a) => console.log(...a);

// the app's own reading rules (positions, shapes, types) so the robot and the app agree
const appHtml = process.env.APP_FILE ? fs.readFileSync(process.env.APP_FILE, 'utf8') : await (await fetch(process.env.APP_URL || 'https://sumnermarine.com/', { headers: { 'User-Agent': UA } })).text();
const m = appHtml.match(/\/\*LOGIC-START\*\/([\s\S]*?)\/\*LOGIC-END\*\//);
if (!m) { console.error('Could not find the reading rules in the app.'); process.exit(1); }
const L = new Function(m[1] + '\nreturn { warnPts, warnShape, warnCategory };')();

const ROMAN = 'XXI|XX|XIX|XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I';
const HEAD = new RegExp('NAVAREA\\s+(' + ROMAN + ')\\s*(?:No\\.?\\s*)?(\\d{1,4})\\s*/\\s*(\\d{2,4})', 'g');
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function htmlText(h) {
  return String(h)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6]|pre|table|section|article)>/gi, '\n').replace(/<td[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (x, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (x, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
// "091745Z OCT 26", "091745 UTC OCT 2026" -> ms
function dtg(t) {
  const r = /\b(\d{2})(\d{2})(\d{2})\s*(?:Z|UTC)\s+([A-Z]{3})[A-Z]*\s+(\d{2,4})\b/i.exec(t);
  if (!r || MON[r[4].toUpperCase()] === undefined) return null;
  let y = Number(r[5]); if (y < 100) y += 2000;
  const ms = Date.UTC(y, MON[r[4].toUpperCase()], Number(r[1]), Number(r[2]), Number(r[3]));
  return isFinite(ms) && ms < Date.now() + 400 * 864e5 ? ms : null;
}
// Split page text into warnings by their "NAVAREA <area> <number>/<year>" headings; keep the longest text per number.
function readPage(text, wantArea) {
  const heads = []; let h;
  HEAD.lastIndex = 0;
  while ((h = HEAD.exec(text))) heads.push({ at: h.index, area: h[1], num: Number(h[2]), year: Number(h[3]) < 100 ? 2000 + Number(h[3]) : Number(h[3]), len: h[0].length });
  const best = {};
  // a heading right after "CANCEL", "SEE" or "REF" is a mention of another warning, not the start of one
  const real = heads.filter(x => !/\b(CANCEL(?:LED|S)?|SEE|REF(?:ERENCE)?|AND|ALSO)\W*$/i.test(text.slice(Math.max(0, x.at - 24), x.at)));
  real.forEach((x, i) => {
    const end = i + 1 < real.length ? real[i + 1].at : Math.min(text.length, x.at + 4000);
    let body = text.slice(x.at + x.len, Math.min(end, x.at + 4000)).replace(/\s+/g, ' ').trim();
    body = body.split(/\b(?:Privacy and cookies|Crown copyright|Showing results \d|Cookie (?:policy|settings)|Skip to main content)\b|©|&copy;/i)[0].trim();
    if (body.length < 40) return;                      // a number in a list, not a warning text
    if (body.length < 200 && /\bNAVAREA\b/i.test(body) && !L.warnPts(body).length) return;   // a list label ("Aids to Navigation - NAVAREA XVIII - Arctic")
    if (/^(CANCEL|IN FORCE)/i.test(body) && body.length < 120) return;
    const key = x.area + ' ' + x.num + '/' + x.year;
    if (wantArea && x.area !== wantArea && !(wantArea === 'XVII' && x.area === 'XVIII')) return;
    if (!best[key] || best[key].text.length < body.length) best[key] = { id: key, title: 'NAVAREA ' + key, text: body.slice(0, 3000) };
  });
  return Object.values(best).map(w => {
    const pts = L.warnPts(w.text), since = dtg(w.text), cx = /CANCEL THIS (?:MSG|MESSAGE)\s+(.{6,40})/i.exec(w.text), until = cx ? dtg(cx[1]) : null;
    return { id: w.id, title: w.title, text: w.text, issued: since ? new Date(since).toISOString() : '', until: until ? new Date(until).toISOString() : '', pts: pts.map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]), shape: L.warnShape(w.text, pts), cat: L.warnCategory({ title: w.title, text: w.text }) };
  });
}
// NGA's daily in-force list: the numbers still in force ("283/26").
function readInforce(text) {
  const asOf = /IN FORCE AS OF\s+(\d{6}Z\s+[A-Z]{3}(?:\s+\d{2,4})?)/i.exec(text), nums = new Set();
  let r; const re = /\b(\d{1,4})\/(\d{2})\b/g;
  while ((r = re.exec(text))) nums.add(Number(r[1]) + '/' + (2000 + Number(r[2])));
  return { asOf: asOf ? asOf[1] : '', inForce: [...nums] };
}
async function get(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json,text/plain,*/*', 'Accept-Language': 'en' }, signal: ctl.signal, redirect: 'follow' });
    const body = await r.text();
    return { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '', url: r.url, body };
  } catch (e) { return { ok: false, status: 0, type: '', url, body: '', err: String(e && e.message || e) }; }
  finally { clearTimeout(t); }
}

fs.mkdirSync('warnings', { recursive: true });
if (RAW) fs.mkdirSync('warnraw', { recursive: true });
const index = { built: new Date().toISOString(), note: 'Warnings in force read from each coordinator\'s own website. Check the source before relying on them.', sources: [] };
const rows = [];
for (const s of cfg.sources) {
  if (only.length && !only.includes(s.id)) continue;
  const res = await get(s.url);
  const isJson = /json/i.test(res.type) || /^\s*[\[{]/.test(res.body);
  const text = isJson ? res.body.replace(/\\n/g, '\n').replace(/\\"/g, '"') : htmlText(res.body);
  if (RAW) {
    fs.writeFileSync('warnraw/' + s.id + '.txt', ['URL: ' + s.url, 'Final URL: ' + res.url, 'HTTP: ' + res.status + ' ' + (res.err || ''), 'Type: ' + res.type, 'Bytes: ' + res.body.length, '', text.slice(0, 1500000)].join('\n'));
    // every link, frame and script on the page, so the reader can be pointed at the page that holds the list
    const links = new Set();
    const abs = u => { try { return new URL(u.replace(/&amp;/g, '&'), res.url || s.url).href; } catch (e) { return u; } };
    for (const a of res.body.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) links.add(htmlText(a[2]).replace(/\s+/g, ' ').slice(0, 80) + ' | ' + abs(a[1]));
    for (const f of res.body.matchAll(/<(iframe|frame|script|form)\b[^>]*(?:src|action)=["']([^"']+)["']/gi)) links.add('[' + f[1].toLowerCase() + '] | ' + abs(f[2]));
    for (const j of res.body.matchAll(/["'`]((?:https?:\/\/|\/)[^"'`\s]*(?:api|json|ajax|navarea|warning|aviso|radioaviso|keiho|msi)[^"'`\s]*)["'`]/gi)) links.add('[in page code] | ' + abs(j[1]));
    fs.writeFileSync('warnraw/' + s.id + '.links.txt', [...links].slice(0, 800).join('\n'));
  }
  const entry = { id: s.id, area: s.area, name: s.name, url: s.url, kind: s.kind, http: res.status, bytes: res.body.length, fetched: new Date().toISOString() };
  if (s.kind === 'page') {
    const ws = res.ok ? readPage(text, s.area) : [];
    entry.count = ws.length; entry.status = !res.ok ? (s.note ? 'blocks robots' : 'unreachable') : ws.length ? 'ok' : 'no warnings read';
    if (ws.length) fs.writeFileSync('warnings/' + s.id + '.json', JSON.stringify({ source: s.name, url: s.url, area: s.area, fetched: entry.fetched, warnings: ws }));
  } else if (s.kind === 'inforce') {
    const inf = res.ok ? readInforce(text) : { asOf: '', inForce: [] };
    entry.count = inf.inForce.length; entry.asOf = inf.asOf; entry.status = !res.ok ? 'unreachable' : inf.inForce.length ? 'ok' : 'no numbers read';
    if (inf.inForce.length) fs.writeFileSync('warnings/' + s.id + '.json', JSON.stringify({ source: s.name, url: s.url, area: s.area, fetched: entry.fetched, asOf: inf.asOf, inForce: inf.inForce }));
  } else if (s.kind === 'raw') {
    entry.count = 0; entry.status = res.ok ? 'saved' : 'unreachable';
    if (res.ok) fs.writeFileSync('warnings/' + s.id + '.txt', res.body.slice(0, 400000));
  } else if (s.kind === 'discover') {
    // which scripts the site loads, and the data addresses inside them, so the reader can be pointed at the right one
    const scripts = [...res.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(x => new URL(x[1], res.url || s.url).href).slice(0, 20), paths = new Set();
    for (const src of scripts) { const js = await get(src); for (const p of js.body.matchAll(/["'`]([A-Za-z0-9_\-\/.:?=&{}$]*(?:api|json|ajax|cgi|aviso|navarea|avurnav|radioaviso|warning|\.txt|\.xml)[A-Za-z0-9_\-\/.:?=&{}$]*)["'`]/gi)) if (p[1].length > 3 && p[1].length < 200) paths.add(p[1]); }
    for (const p of res.body.matchAll(/["'`]([A-Za-z0-9_\-\/.:?=&{}$]*(?:api|json|ajax|cgi|aviso|navarea|avurnav|radioaviso|warning|\.txt|\.xml)[A-Za-z0-9_\-\/.:?=&{}$]*)["'`]/gi)) if (p[1].length > 3 && p[1].length < 200) paths.add(p[1]);
    entry.count = paths.size; entry.status = paths.size ? 'ok' : 'nothing found'; entry.scripts = scripts.length;
    fs.writeFileSync('warnings/' + s.id + '-paths.json', JSON.stringify({ scripts, paths: [...paths].sort() }, null, 1));
  }
  index.sources.push(entry);
  rows.push('| ' + s.id + ' | ' + (s.area || '-') + ' | ' + res.status + ' | ' + entry.status + ' | ' + (entry.count || 0) + ' |');
  say(s.id.padEnd(16), String(res.status).padEnd(4), entry.status, entry.count || 0);
}
// keep sources from earlier runs that were not read this time
if (only.length && fs.existsSync('warnings/index.json')) {
  try { const old = JSON.parse(fs.readFileSync('warnings/index.json', 'utf8')); (old.sources || []).forEach(o => { if (!index.sources.some(n => n.id === o.id)) index.sources.push(o); }); } catch (e) { /* fresh */ }
}
fs.writeFileSync('warnings/index.json', JSON.stringify(index, null, 1));
const okN = index.sources.filter(x => x.status === 'ok' && x.kind === 'page').length;
const summary = '## Sumner warnings robot\n\n' + okN + ' coordinator lists read with full texts.\n\n| Source | Area | HTTP | Result | Count |\n|---|---|---|---|---|\n' + rows.join('\n') + '\n';
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
say(okN + ' coordinator lists read with full texts.');
