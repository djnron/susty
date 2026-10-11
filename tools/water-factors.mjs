#!/usr/bin/env node
// Off-site water intensity (litres consumed per kWh generated) for every grid
// Susty offers, from committed data only, so every figure can be re-derived:
//
//   per-fuel factor   Larsen & Drews (2019) Appendix B, median across sources
//                     of the cooling-tower row (data/larsen-drews-2019-appendix-b.csv)
//   generation mix    Ember 2024 by country, EU-27 and world
//                     (data/ember-2024-generation-mix.csv); eGRID2023 Rev 2 by
//                     US subregion (data/egrid2023-rev2-subregion-mix.csv)
//
// Hydro is kept apart: reservoir evaporation is reported on its own row
// (METHODOLOGY 16.4), so each grid has two numbers, `offsite` (every fuel but
// hydro) and `hydro` (hydro share x the hydro factor).
//
//   node tools/water-factors.mjs                 # print the tables
//   node tools/water-factors.mjs --check         # exit 1 if index.html / api/grid.js are stale
//   node tools/water-factors.mjs --write         # rewrite the generated blocks in both
//   node tools/water-factors.mjs --ember FILE    # rebuild the Ember mix file from Ember's
//                                                # yearly long-format CSV (as used by ember-grids.mjs)
import { readFileSync, writeFileSync } from 'node:fs';

const at = (p) => new URL('../' + p, import.meta.url);
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

// RFC 4180 enough for these files: quoted fields may contain commas and "".
function parseLine(line) {
  const out = []; let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
export function readCsv(path) {
  const [head, ...rows] = readFileSync(at(path), 'utf8').trim().split('\n').map(parseLine);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  if (!n) throw new Error('median of nothing');
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

// Ember's nine fuels -> the Larsen & Drews row that prices them (decision D1:
// cooling tower; D2: all water, no freshwater share). Wind has no entries in
// Appendix B and is zero (Larsen & Drews Table 2 and text). Geothermal has no
// tower row, so Other Renewables (geothermal, tidal, wave) takes the median
// of every geothermal entry: the conservative choice, see METHODOLOGY 16.3.
export const FUEL_ROWS = {
  Coal:               [['Coal', 'Tower']],
  Gas:                [['Gas CCGT', 'Tower']],
  'Other Fossil':     [['Oil', 'Tower']],
  Nuclear:            [['Nuclear', 'Tower']],
  Bioenergy:          [['Biopower', 'Tower']],
  Solar:              [['Solar PV', 'Solar PV']],
  Wind:               [],
  'Other Renewables': [['Geothermal', '*']],
  Hydro:              [['Hydro', 'Hydro']],
};
export const FUELS = Object.keys(FUEL_ROWS);

export function fuelFactors() {
  const rows = readCsv('data/larsen-drews-2019-appendix-b.csv');
  const out = {};
  for (const [fuel, picks] of Object.entries(FUEL_ROWS)) {
    const vals = rows
      .filter((r) => picks.some(([f, t]) => r.fuel === f && (t === '*' || r.technology === t)))
      .map((r) => Number(r.consumption_L_per_MWh));
    out[fuel] = picks.length ? median(vals) / 1000 : 0;          // L/MWh -> L/kWh
  }
  return out;
}

// One grid's two numbers from generation by fuel (any unit; normalised here).
export function intensity(mix, F) {
  const total = FUELS.reduce((s, f) => s + (mix[f] || 0), 0);
  if (!(total > 0)) throw new Error('empty mix');
  let offsite = 0;
  for (const f of FUELS) if (f !== 'Hydro') offsite += (mix[f] || 0) * F[f];
  return { offsite: offsite / total, hydro: (mix.Hydro || 0) * F.Hydro / total };
}

// eGRID resource-mix columns -> Ember fuels. "Other unknown/purchased fuel"
// takes Bioenergy, the same declared assumption as EIA's OTH (api/grid.js).
const EGRID_FUEL = {
  coal: 'Coal', oil: 'Other Fossil', gas: 'Gas', other_fossil: 'Other Fossil', nuclear: 'Nuclear',
  hydro: 'Hydro', biomass: 'Bioenergy', wind: 'Wind', solar: 'Solar', geothermal: 'Other Renewables',
  other_unknown_purchased: 'Bioenergy',
};
// EIA-930 fuel types -> Ember fuels, for the hourly US water figure. OTH
// ("other") is mostly biomass, waste and miscellaneous thermal plant; priced
// as Bioenergy, a declared assumption. Storage stays excluded, as for carbon.
export const EIA_FUEL = {
  COL: 'Coal', NG: 'Gas', OIL: 'Other Fossil', OTH: 'Bioenergy', NUC: 'Nuclear', WAT: 'Hydro',
  GEO: 'Other Renewables', SUN: 'Solar', SNB: 'Solar', WND: 'Wind', WNB: 'Wind',
};

const r3 = (x) => Math.round(x * 1000) / 1000;

export function tables() {
  const F = fuelFactors();
  const grids = {};
  for (const row of readCsv('data/ember-2024-generation-mix.csv')) {
    const mix = Object.fromEntries(FUELS.map((f) => [f, Number(row[f])]));
    const w = intensity(mix, F);
    grids[row.key] = { offsite: r3(w.offsite), hydro: r3(w.hydro) };
  }
  const subs = {};
  for (const row of readCsv('data/egrid2023-rev2-subregion-mix.csv')) {
    const mix = {};
    for (const [col, fuel] of Object.entries(EGRID_FUEL)) mix[fuel] = (mix[fuel] || 0) + Number(row[col]);
    const w = intensity(mix, F);
    subs[row.subregion] = { offsite: r3(w.offsite), hydro: r3(w.hydro) };
  }
  const eia = Object.fromEntries(Object.entries(EIA_FUEL).map(([code, fuel]) => [code, r3(F[fuel])]));
  return { F, grids, subs, eia };
}

// ---------------------------------------------------------------------------
// Generated blocks.
function htmlBlock({ grids, subs }) {
  const line = (k, v) => `  ${JSON.stringify(k).replace(/"/g, "'")}: { offsite: ${v.offsite.toFixed(3)}, hydro: ${v.hydro.toFixed(3)} },`;
  return [
    '// WATER GRIDS START: generated by tools/water-factors.mjs from data/; do not edit by hand.',
    '// Litres consumed per kWh generated: offsite = every fuel but hydro, hydro = reservoir',
    '// evaporation if all charged to electricity. Larsen & Drews (2019) tower medians x',
    '// Ember 2024 (countries, EU-27, world) and eGRID2023 Rev 2 (US subregions).',
    'const WATER_GRIDS = {',
    ...Object.entries(grids).map(([k, v]) => line(k, v)),
    '};',
    'const WATER_US_SUB = {',
    ...Object.entries(subs).map(([k, v]) => line(k, v)),
    '};',
    '// WATER GRIDS END',
  ].join('\n');
}
function gridBlock({ eia }) {
  return [
    '// WATER FUELS START: generated by tools/water-factors.mjs from data/; do not edit by hand.',
    '// Litres consumed per kWh generated, per EIA-930 fuel (Larsen & Drews 2019 tower medians).',
    '// WAT is reservoir evaporation, kept on its own row; OTH is priced as bioenergy (assumption).',
    'export const FUEL_WATER = {',
    '  ' + Object.entries(eia).map(([k, v]) => `${k}: ${v}`).join(', ') + ',',
    '};',
    '// WATER FUELS END',
  ].join('\n');
}
const swap = (src, start, end, block, file) => {
  const re = new RegExp(`// ${start}[\\s\\S]*?// ${end}`);
  if (!re.test(src)) throw new Error(`${file}: generated block "${start}" not found`);
  return src.replace(re, block);
};

// ---------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const emberCsv = opt('--ember');
  if (emberCsv) {
    // Same identifiers as tools/ember-grids.mjs, plus the area names it uses.
    const src = readFileSync(new URL('./ember-grids.mjs', import.meta.url), 'utf8');
    const ids = Function(`return (${src.match(/const EMBER_ID = (\{[\s\S]*?\});/)[1]});`)();
    const year = opt('--year') || '2024';
    const lines = readFileSync(emberCsv, 'utf8').split('\n');
    const head = parseLine(lines[0]);
    const c = (n) => head.indexOf(n);
    const [AREA, ISO, YEAR, CAT, SUB, VAR, UNIT, VALUE] =
      ['Area', 'ISO 3 code', 'Year', 'Category', 'Subcategory', 'Variable', 'Unit', 'Value'].map(c);
    const got = new Map();
    for (const line of lines.slice(1)) {
      if (!line.includes('Electricity generation')) continue;
      const f = parseLine(line);
      if (f[YEAR] !== year || f[CAT] !== 'Electricity generation' || f[UNIT] !== 'TWh') continue;
      if (f[SUB] !== 'Fuel' && !(f[SUB] === 'Total' && f[VAR] === 'Total Generation')) continue;
      const id = f[ISO] || f[AREA];
      if (!got.has(id)) got.set(id, {});
      got.get(id)[f[VAR]] = f[VALUE];
    }
    const out = ['key,ember_id,' + FUELS.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(',')];
    const missing = [];
    // Ember omits a fuel a country does not generate with (no geothermal row
    // for the UK, say). An absent fuel counts as zero only if the fuels that
    // are present add up to Ember's own Total Generation, so a genuinely
    // incomplete record still fails.
    for (const [key, id] of Object.entries(ids)) {
      const m = got.get(id);
      const total = m && Number(m['Total Generation']);
      const sum = m ? FUELS.reduce((s, f) => s + Number(m[f] || 0), 0) : 0;
      if (!m || !(total > 0) || Math.abs(sum - total) > 0.005 * total) { missing.push(`${key} (${id})`); continue; }
      out.push([key, id.includes(' ') ? `"${id}"` : id, ...FUELS.map((f) => m[f] ? m[f] : '0')].join(','));
    }
    if (missing.length) { console.error(`No complete ${year} mix for: ${missing.join(', ')}`); process.exit(1); }
    writeFileSync(at('data/ember-2024-generation-mix.csv'), out.join('\n') + '\n');
    console.log(`data/ember-2024-generation-mix.csv: ${out.length - 1} areas, Ember ${year}.`);
  }

  const t = tables();
  console.log('Per-fuel factors, L/kWh:', Object.fromEntries(Object.entries(t.F).map(([k, v]) => [k, r3(v)])));
  const htmlPath = at('index.html'), gridPath = at('api/grid.js');
  const html = readFileSync(htmlPath, 'utf8'), grid = readFileSync(gridPath, 'utf8');
  const nextHtml = swap(html, 'WATER GRIDS START', 'WATER GRIDS END', htmlBlock(t), 'index.html');
  const nextGrid = swap(grid, 'WATER FUELS START', 'WATER FUELS END', gridBlock(t), 'api/grid.js');
  if (args.includes('--write')) {
    writeFileSync(htmlPath, nextHtml); writeFileSync(gridPath, nextGrid);
    console.log('index.html and api/grid.js updated.');
  } else if (args.includes('--check')) {
    const stale = [nextHtml !== html && 'index.html', nextGrid !== grid && 'api/grid.js'].filter(Boolean);
    if (stale.length) { console.error(`Stale water tables in ${stale.join(', ')}: run node tools/water-factors.mjs --write`); process.exit(1); }
    console.log('Water tables in index.html and api/grid.js match data/.');
  }
}
