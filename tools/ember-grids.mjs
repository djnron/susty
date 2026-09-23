#!/usr/bin/env node
// Refreshes the national figures in index.html's GRIDS table from Ember's
// yearly electricity data, so every country comes from one release and one
// year instead of drifting apart as values are edited by hand.
//
//   node tools/ember-grids.mjs                 # download, print what would change
//   node tools/ember-grids.mjs --write         # ...and rewrite index.html
//   node tools/ember-grids.mjs --csv FILE      # use a local copy of the CSV
//   node tools/ember-grids.mjs --year 2025     # a different data year
//
// Ember's intensities are life-cycle (IPCC AR5 factors); see METHODOLOGY §6.1.
// The US national value is refreshed too, but US subregions come from eGRID
// and are not touched here.
import { readFileSync, writeFileSync } from 'node:fs';

const CSV_URL = 'https://storage.googleapis.com/emb-prod-bkt-publicdata/public-downloads/yearly_full_release_long_format.csv';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const year = opt('--year') || '2024';
const write = args.includes('--write');

// GRIDS key -> Ember identifier (ISO 3 code, or Area name for aggregates).
const EMBER_ID = {
  world: 'World', EU: 'EU',
  AR: 'ARG', AU: 'AUS', AT: 'AUT', BE: 'BEL', BR: 'BRA', CA: 'CAN', CN: 'CHN',
  DK: 'DNK', EG: 'EGY', FI: 'FIN', FR: 'FRA', DE: 'DEU', GR: 'GRC', IN: 'IND',
  ID: 'IDN', IE: 'IRL', IT: 'ITA', JP: 'JPN', MY: 'MYS', MX: 'MEX', NL: 'NLD',
  NZ: 'NZL', NG: 'NGA', NO: 'NOR', PH: 'PHL', PL: 'POL', PT: 'PRT', RU: 'RUS',
  SA: 'SAU', SG: 'SGP', ZA: 'ZAF', KR: 'KOR', ES: 'ESP', SE: 'SWE', CH: 'CHE',
  TH: 'THA', TR: 'TUR', AE: 'ARE', GB: 'GBR', US: 'USA', VN: 'VNM',
};

// RFC 4180 enough for Ember: quoted fields may contain commas.
function parseLine(line) {
  const out = [];
  let cur = '', quoted = false;
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

const csvPath = opt('--csv');
const csv = csvPath ? readFileSync(csvPath, 'utf8') : await (await fetch(CSV_URL)).text();
const lines = csv.split('\n');
const head = parseLine(lines[0]);
const col = (name) => { const i = head.indexOf(name); if (i === -1) throw new Error(`no column ${name}`); return i; };
const [AREA, ISO, YEAR, VAR, VALUE] = ['Area', 'ISO 3 code', 'Year', 'Variable', 'Value'].map(col);

const ember = new Map();
for (const line of lines.slice(1)) {
  if (!line.includes('CO2 intensity')) continue;
  const f = parseLine(line);
  if (f[VAR] !== 'CO2 intensity' || f[YEAR] !== year || f[VALUE] === '') continue;
  ember.set(f[ISO] || f[AREA], Number(f[VALUE]));
}

const htmlUrl = new URL('../index.html', import.meta.url);
let html = readFileSync(htmlUrl, 'utf8');
const missing = [];
let changed = 0;
for (const [key, id] of Object.entries(EMBER_ID)) {
  const value = ember.get(id);
  if (value === undefined) { missing.push(`${key} (${id})`); continue; }
  const g = Math.round(value);
  const re = new RegExp(`(\\n  ${key}:\\s+\\{ name: '[^']+',\\s+g:\\s*)(\\d+)( \\})`);
  const m = html.match(re);
  if (!m) throw new Error(`GRIDS entry for ${key} not found in index.html`);
  if (Number(m[2]) !== g) {
    console.log(`${key.padEnd(5)} ${m[2].padStart(4)} -> ${String(g).padStart(4)}`);
    changed++;
  }
  // Keep the column alignment the table was written with.
  html = html.replace(re, (_, pre, old, post) => pre.slice(0, pre.length - (String(g).length - old.length)) + g + post);
}

const stamp = `// Ember yearly electricity data, ${year} values, retrieved ${new Date().toISOString().slice(0, 10)} by tools/ember-grids.mjs.`;
html = html.replace(/\/\/ Ember yearly electricity data, \d{4} values, retrieved \d{4}-\d{2}-\d{2} by tools\/ember-grids\.mjs\./, stamp);

if (missing.length) {
  console.error(`No ${year} value for: ${missing.join(', ')}. Nothing written; pick a year every country has.`);
  process.exit(1);
}
console.log(changed ? `${changed} value(s) differ from Ember ${year}.` : `All values match Ember ${year}.`);
if (write) {
  writeFileSync(htmlUrl, html);
  console.log('index.html updated.');
}
