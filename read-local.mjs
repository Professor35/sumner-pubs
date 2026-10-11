// Sumner local notices robot.
// Fetches the US Coast Guard's Local Notice to Mariners data (navcen.uscg.gov), keeps what is in force,
// and writes it as small files per 5-degree square into local/, so the app only fetches the squares a route passes.
//   node read-local.mjs                 normal run
//   LOCAL_DIR=folder node read-local.mjs  test with saved .geojson files instead of downloading

import fs from 'node:fs';
import path from 'node:path';

const UA = 'SumnerMarine-local-notices-robot/1.0 (+https://sumnermarine.com)';
const BASE = 'https://navcen.uscg.gov/sites/default/files/msi/';
const OUT = 'local';
// The kinds that matter for passage planning, with the label the app shows.
const KINDS = { hazNav: 'Hazard to navigation', marCon: 'Marine construction', safeZone: 'Safety or security zone', navalAct: 'Naval activity', marEvent: 'Marine event', msib: 'Coast Guard safety bulletin', spaceOps: 'Space launch area', misc: 'Notice', discFedAid: 'Aid to navigation out of order', tmpChange: 'Temporary change to an aid' };
const CODES = { 'LT EXT': 'light extinguished', 'LT UNLIT': 'light unlit', 'OFF STA': 'off station', 'MISSING': 'missing', 'STRUCT DEST': 'structure destroyed', 'STRUCT DMGD': 'structure damaged', 'STRUCT MISSING': 'structure missing', 'STRUCT MISS': 'structure missing', 'HAZ NAV': 'hazard to navigation', 'TRLB': 'temporarily replaced by a lighted buoy', 'TRLT': 'temporarily replaced by a light', 'TRUB': 'temporarily replaced by an unlighted buoy', 'TRDB': 'temporarily replaced by a daybeacon', 'DMGD': 'damaged', 'SINKING': 'sinking', 'SUNK': 'sunk', 'LT IMCH': 'light improper characteristic', 'IMCH': 'improper characteristic', 'RACON INOP': 'racon not working', 'SIG INOP': 'sound signal not working', 'AIS INOP': 'AIS not working', 'LT RED VIS': 'light reduced visibility', 'DAYMK MISSING': 'daymark missing', 'DAYMK DMGD': 'daymark damaged', 'LEANING': 'leaning', 'DISCONTINUED': 'discontinued', 'WRONG COLOR': 'wrong colour', 'OBSCURED': 'obscured' };
const say = (...a) => console.log(...a);
const now = Date.now();

function kindOf(name) { const base = name.replace(/(Line|Poly|Cor)?_\d+$/, ''); return KINDS[base] ? base : null; }
function words(code) {
  return String(code || '').split('/').map(c => c.trim()).filter(Boolean).map(c => CODES[c] || c.toLowerCase()).join(', ');
}
const r5 = v => Math.round(v * 1e5) / 1e5;
function thin(list, max) { if (list.length <= max) return list; const step = list.length / max, out = []; for (let i = 0; i < max; i++) out.push(list[Math.floor(i * step)]); out.push(list[list.length - 1]); return out; }
// GeoJSON geometry -> { g: 'p' | 'l' | 'a', c: [[lat, lon], ...] }
function geom(gm) {
  if (!gm || !gm.coordinates) return null;
  const ll = q => [r5(q[1]), r5(q[0])], c = gm.coordinates;
  if (gm.type === 'Point') return { g: 'p', c: [ll(c)] };
  if (gm.type === 'MultiPoint') return { g: 'p', c: thin(c.map(ll), 60) };
  if (gm.type === 'LineString') return { g: 'l', c: thin(c.map(ll), 200) };
  if (gm.type === 'MultiLineString') return { g: 'l', c: thin(c.flat().map(ll), 200) };
  if (gm.type === 'Polygon') return { g: 'a', c: thin(c[0].map(ll), 200) };
  if (gm.type === 'MultiPolygon') return { g: 'a', c: thin(c.map(p => p[0]).sort((a, b) => b.length - a.length)[0].map(ll), 200) };
  return null;
}

// 1. Which files exist today (the number of parts changes), read from the Coast Guard's own page.
let names;
if (process.env.LOCAL_DIR) names = fs.readdirSync(process.env.LOCAL_DIR).filter(f => f.endsWith('.geojson')).map(f => f.replace(/\.geojson$/, ''));
else {
  const page = await (await fetch('https://navcen.uscg.gov/msi', { headers: { 'User-Agent': UA } })).text();
  names = [...new Set([...page.matchAll(/msi\/([A-Za-z]+(?:_\d+)?)\.geojson/g)].map(m => m[1]))];
}
names = names.filter(n => kindOf(n) && !/Cor_\d+$/.test(n));
say('Files to read: ' + names.length);
if (!names.length) { console.error('No Coast Guard files found. The page layout may have changed.'); process.exit(1); }

const items = [], counts = {}, failed = [];
for (const n of names) {
  try {
    const txt = process.env.LOCAL_DIR ? fs.readFileSync(path.join(process.env.LOCAL_DIR, n + '.geojson'), 'utf8') : await (await fetch(BASE + n + '.geojson', { headers: { 'User-Agent': UA } })).text();
    if (!/^\s*\{/.test(txt)) { say(n + ': not published today, skipped.'); continue; }
    const j = JSON.parse(txt), kind = kindOf(n);
    for (const f of j.features || []) {
      const p = f.properties || {}, g = geom(f.geometry);
      if (!g) continue;
      let it;
      if (kind === 'discFedAid') {
        it = { id: 'aid' + (p.LNM_UID || p.AID_NUMBER), k: kind, t: String(p.NAME || 'Aid to navigation'), w: String(p.WATERWAY_NAME || ''), b: p.CREATE_DATE || null, e: null,
          d: (words(p.DISCREP_STATUS) ? words(p.DISCREP_STATUS).replace(/^./, s => s.toUpperCase()) + '.' : '') + (p.LLNR ? ' Light List number ' + p.LLNR + '.' : '') + (p.BNM_NUM ? ' Broadcast Notice ' + p.BNM_NUM + '.' : '') + (p.ASSIGNED_LATITUDE ? ' Assigned position ' + p.ASSIGNED_LATITUDE + ' ' + p.ASSIGNED_LONGITUDE + '.' : ''), ...g };
      } else {
        if (p.END_DATE && p.END_DATE < now) continue;
        it = { id: 'msi' + (p.MSI_UID || p.ESRI_OID), k: kind, t: String(p.TYPE || p.SUB_CATEGORY || KINDS[kind]), w: String(p.WATERWAY_NAME || ''), b: p.BEGIN_DATE || null, e: p.END_DATE || null, d: String(p.DESCRIPTION || '').replace(/\r/g, '').replace(/^\s*[A-Za-z ]+(\/[^\n/]+){2,}\s*/, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 900), ...g };
      }
      items.push(it); counts[kind] = (counts[kind] || 0) + 1;
    }
  } catch (e) { failed.push(n + ': ' + (e && e.message || e)); }
}

// 2. Split into 5-degree squares.
const cells = {};
for (const it of items) {
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
  for (const q of it.c) { la0 = Math.min(la0, q[0]); la1 = Math.max(la1, q[0]); lo0 = Math.min(lo0, q[1]); lo1 = Math.max(lo1, q[1]); }
  const keys = [];
  for (let a = Math.floor(la0 / 5) * 5; a <= la1; a += 5) for (let o = Math.floor(lo0 / 5) * 5; o <= lo1; o += 5) keys.push(a + '_' + o);
  for (const k of keys.slice(0, 40)) (cells[k] = cells[k] || []).push(it);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = { built: new Date().toISOString(), source: 'US Coast Guard Navigation Center, Local Notice to Mariners data (navcen.uscg.gov/msi)', kinds: KINDS, cells: {} };
for (const [k, list] of Object.entries(cells)) { fs.writeFileSync(path.join(OUT, k + '.json'), JSON.stringify(list)); index.cells[k] = list.length; }
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
const kb = Math.round(fs.readdirSync(OUT).reduce((t, f) => t + fs.statSync(path.join(OUT, f)).size, 0) / 1024);
const summary = items.length + ' notices in force in ' + Object.keys(cells).length + ' squares, ' + kb + ' KB in total. ' + Object.entries(counts).map(([k, v]) => v + ' ' + KINDS[k].toLowerCase()).join(', ') + '.' + (failed.length ? ' Failed: ' + failed.join('; ') : '');
say(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Sumner local notices robot\n\n' + summary + '\n');
