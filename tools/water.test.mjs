#!/usr/bin/env node
// Water (METHODOLOGY 16): the committed data, the generated tables, request
// and device accrual, the EIA hourly figure, and the order-of-magnitude check.
//
//   node tools/water.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readCsv, median, fuelFactors, intensity, tables, FUEL_ROWS } from './water-factors.mjs';
import { FUEL_WATER, intensityFromFuelMix } from '../api/grid.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const doc  = readFileSync(new URL('../METHODOLOGY.md', import.meta.url), 'utf8');
const gridSrc = readFileSync(new URL('../api/grid.js', import.meta.url), 'utf8');
// Not exported; read from source, as methodology.test.mjs does.
const FUEL_G = Function(`return (${gridSrc.match(/const FUEL_G = (\{[\s\S]*?\});/)[1]});`)();

let fails = 0;
function check(label, fn) {
  try { fn(); console.log(`pass  ${label}`); }
  catch (err) { fails++; console.log(`FAIL  ${label}\n      ${err.message}`); }
}
const near = (got, want, eps = 1e-9) => assert.ok(Math.abs(got - want) <= eps, `${got} differs from ${want}`);
const has = (re) => assert.ok(re.test(doc), `METHODOLOGY.md is missing ${re}`);
function fn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  let depth = 0;
  for (let i = html.indexOf(') {', start) + 2; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`function ${name} is unterminated`);
}
const block = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));

console.log('Larsen & Drews (2019) Appendix B transcription');
const ld = readCsv('data/larsen-drews-2019-appendix-b.csv');
check('219 values, each with journal page, PDF page and table row', () => {
  assert.equal(ld.length, 219);
  for (const r of ld) {
    assert.ok(['2056', '2057'].includes(r.journal_page), JSON.stringify(r));
    assert.ok(['13', '14'].includes(r.pdf_page));
    assert.ok(Number(r.table_row) >= 1 && Number(r.table_row) <= 56);
    assert.ok(Number.isFinite(Number(r.consumption_L_per_MWh)));
  }
});
check('hydro row is the four printed entries, median 17,000 L/MWh', () => {
  const h = ld.filter((r) => r.fuel === 'Hydro').map((r) => Number(r.consumption_L_per_MWh)).sort((a, b) => a - b);
  assert.deepEqual(h, [2700, 17000, 17000, 17034]);
  assert.equal(median(h), 17000);
});
check('tower medians are the documented factors', () => {
  const F = fuelFactors();
  const want = { Coal: 1.812, Gas: 0.738, 'Other Fossil': 1.8, Nuclear: 2.472, Bioenergy: 2,
                 Solar: 0.013, Wind: 0, 'Other Renewables': 6.05, Hydro: 17 };
  for (const [f, v] of Object.entries(want)) near(Math.round(F[f] * 1000) / 1000, v);
  // And the doc's factor table says the same.
  for (const [f, v] of Object.entries(want)) {
    has(new RegExp(`\\| ${f} \\|[^|]*\\| ${v.toFixed(3).replace('.', '\\.')} \\|`));
  }
});
check('every non-wind fuel is priced from at least one Appendix B entry', () => {
  for (const [fuel, picks] of Object.entries(FUEL_ROWS)) {
    if (!picks.length) { assert.equal(fuel, 'Wind'); continue; }
    const n = ld.filter((r) => picks.some(([f, t]) => r.fuel === f && (t === '*' || r.technology === t))).length;
    assert.ok(n > 0, fuel);
  }
});

console.log('\nMacknick et al. (2012) cross-check');
const mk = readCsv('data/macknick-2012-crosscheck.csv');
check('every row Susty prices from a tower, PV or hydro entry matches Macknick', () => {
  const used = [['Coal', 'Tower'], ['Gas CCGT', 'Tower'], ['Nuclear', 'Tower'], ['Biopower', 'Tower'],
                ['Solar PV', 'Solar PV'], ['Hydro', 'Hydro']];
  for (const [f, t] of used) {
    const row = mk.find((r) => r.ld_fuel === f && r.ld_technology === t);
    assert.ok(row, `${f}/${t} not cross-checked`);
    assert.equal(row.result, 'match', `${f}/${t}: ${row.result}`);
  }
});
check('the discrepancies are recorded and disclosed', () => {
  assert.equal(mk.filter((r) => r.result === 'MISMATCH').map((r) => r.ld_fuel).join(), 'Geothermal,Geothermal,Geothermal');
  assert.ok(mk.some((r) => r.result.startsWith('MISPLACED')));
  has(/nuclear \*\*pond\*\* median \(610 gal\/MWh = 2,309 L\/MWh\)/);
  has(/geothermal values attributed to Macknick/);
});

console.log('\nGenerated tables');
check('index.html and api/grid.js match the data (tools/water-factors.mjs --check)', () => {
  const t = tables();
  const WATER_GRIDS = Function(`return (${block('const WATER_GRIDS = {', 'const WATER_US_SUB').replace('const WATER_GRIDS = ', '').trim().replace(/;$/, '')});`)();
  for (const [k, v] of Object.entries(t.grids)) assert.deepEqual({ ...WATER_GRIDS[k] }, v, k);
  for (const [k, v] of Object.entries(t.eia)) assert.equal(FUEL_WATER[k], v, k);
});
check('every grid and subregion Susty offers has a water figure', () => {
  const GRIDS = Function(`return (${block('const GRIDS = {', '// No renewable-tariff option').replace('const GRIDS = ', '').trim().replace(/;$/, '')});`)();
  const US_SUB = Function(`return (${block('const US_SUB = {', '// WATER GRIDS START').replace('const US_SUB = ', '').trim().replace(/;$/, '')});`)();
  const t = tables();
  for (const k of Object.keys(GRIDS)) assert.ok(t.grids[k], `no water for ${k}`);
  for (const k of Object.keys(US_SUB)) assert.ok(t.subs[k], `no water for ${k}`);
});
check('every EIA fuel that prices carbon also prices water', () => {
  assert.deepEqual(Object.keys(FUEL_WATER).sort(), Object.keys(FUEL_G).sort());
});
check('EU comes from Ember\'s EU-27 aggregate, not the world', () => {
  const t = tables();
  const eu = readCsv('data/ember-2024-generation-mix.csv').find((r) => r.key === 'EU');
  assert.equal(eu.ember_id, 'EU');
  assert.notDeepEqual(t.grids.EU, t.grids.world);
});
check('hydro is kept apart: an all-hydro grid has zero off-site and 17 L/kWh hydro', () => {
  const w = intensity({ Hydro: 100 }, fuelFactors());
  near(w.offsite, 0); near(w.hydro, 17);
});

console.log('\nEIA hourly water');
check('intensityFromFuelMix returns water from the same hour, hydro apart', () => {
  const rows = [
    { period: '2026-10-10T05', fueltype: 'NG', value: 600 },
    { period: '2026-10-10T05', fueltype: 'WAT', value: 200 },
    { period: '2026-10-10T05', fueltype: 'WND', value: 200 },
    { period: '2026-10-10T05', fueltype: 'BAT', value: 50 },   // storage: excluded
  ];
  const hit = intensityFromFuelMix(rows, 5);
  near(hit.water.offsite, Math.round(600 * FUEL_WATER.NG / 1000 * 1000) / 1000);
  near(hit.water.hydro, Math.round(200 * 17 / 1000 * 1000) / 1000);
});

console.log('\nRequest and device accrual');
{
  const REQUEST_STATUS = Object.freeze({ COMPLETED: 'completed', INCOMPLETE: 'incomplete', FAILED: 'failed' });
  const MODEL = { whPerInputToken: 0.00005, whPerOutputToken: 0.0005, pue: 1.12, whPerExchange: 0.003,
                  gridGPerKwh: 400, serverGridGPerKwh: 307, inferenceHighFactor: 2.7, onsiteWueLPerKwh: 1.15,
                  serverWater: { offsite: 1.082, hydro: 0.918 }, gridWater: { offsite: 0.5, hydro: 3 } };
  const MODEL_ENERGY = { 'claude-sonnet-4-6': { factor: 1.00 } };
  const state = { model: 'claude-sonnet-4-6', requests: [] };
  const ctx = vm.createContext({ REQUEST_STATUS, MODEL, MODEL_ENERGY, state, Object, Error, Date, METHODOLOGY_VERSION: '2.1.0' });
  vm.runInContext(`${fn('modelEnergy')}\n${fn('recordRequest')}\nthis.record = recordRequest;`, ctx);

  check('HTTP failure: hosting water only, cooled at the same WUE and not ranged', () => {
    ctx.record(0, 0, { status: 'failed', model: null, stopReason: 'http_503' });
    const r = state.requests.at(-1);
    near(r.waterOnsiteMl, 0.003 * 1.15);
    near(r.waterOnsiteMlHigh, r.waterOnsiteMl);
    near(r.waterOffsiteMl, 0.003 * 1.082);
    near(r.waterHydroMl, 0.003 * 0.918);
    near(r.waterOffsiteMlHigh, r.waterOffsiteMl);
  });
  check('a request freezes on-site ((IT energy + hosting) x WUE), off-site and hydro, and their high ends', () => {
    ctx.record(831, 571, { status: 'completed', model: 'claude-sonnet-4-6', stopReason: 'end_turn' });
    const r = state.requests.at(-1);
    near(r.waterOnsiteMl, (r.chipWh / 1.12 + 0.003) * 1.15);
    near(r.waterOffsiteMl, r.wh * 1.082);
    near(r.waterHydroMl, r.wh * 0.918);
    near(r.waterOnsiteMlHigh, r.waterOnsiteMl + 1.7 * r.chipWh / 1.12 * 1.15);   // hosting not ranged
    near(r.waterOffsiteMlHigh, r.waterOffsiteMl + 1.7 * r.chipWh * 1.082);
    assert.equal(r.wueLPerKwh, 1.15);
    assert.equal(r.serverWaterOffsite, 1.082);
    MODEL.serverWater = { offsite: 9, hydro: 9 }; MODEL.onsiteWueLPerKwh = 9;
    assert.ok(Object.isFrozen(r));
    near(r.waterOffsiteMl, r.wh * 1.082);
  });
  check('the reader\'s grid plays no part in request water', () => {
    assert.doesNotMatch(fn('recordRequest'), /gridWater/);
  });
  check('device water accrues in clockSync at the reader\'s grid, beside carbon', () => {
    const body = fn('clockSync');
    assert.match(body, /state\.deviceWaterMl \+= wh \* MODEL\.gridWater\.offsite;/);
    assert.match(body, /state\.deviceHydroMl \+= wh \* MODEL\.gridWater\.hydro;/);
  });
  check('a grid change closes out device time before the water figure changes', () => {
    const body = fn('applyGrid');
    assert.ok(body.indexOf('clockSync();') < body.indexOf('MODEL.gridWater   = readerWater();'));
  });
  check('reader water: EIA hourly, then eGRID subregion, then country, then world', () => {
    const WATER_GRIDS = { world: 'W', US: 'US', FR: 'FR' }, WATER_US_SUB = { CAMX: 'CAMX' };
    const st = { live: null, grid: 'US', region: 'CAMX' };
    const c = vm.createContext({ state: st, WATER_GRIDS, WATER_US_SUB });
    vm.runInContext(`${fn('readerWater')}; this.rw = readerWater;`, c);
    assert.equal(c.rw(), 'CAMX');
    st.live = { water: 'EIA' }; assert.equal(c.rw(), 'EIA');
    st.live = { water: null }; st.region = ''; assert.equal(c.rw(), 'US');
    st.grid = 'FR'; assert.equal(c.rw(), 'FR');
    st.grid = 'XX'; assert.equal(c.rw(), 'W');
  });
}

console.log('\nOrder-of-magnitude check (not a validation)');
check('illustrative exchange on-site water sits between Google\'s narrow and comprehensive figures', () => {
  const chipWh = (831 * 0.05 + 571 * 0.5) / 1000 * 1.12 / 2;   // per exchange, as METHODOLOGY 4.3
  const itWh = chipWh / 1.12 + 0.003;                            // plus hosting, cooled the same way
  const onsite = itWh * 1.15;
  near(Math.round(onsite * 1000) / 1000, 0.192);
  assert.ok(onsite >= 0.12 && onsite <= 0.26, `${onsite} mL outside Google's 0.12-0.26 mL`);
  near(onsite / itWh, 1.15);                                     // implied WUE is Google's
  has(/is \*\*0\.192 mL\*\*/);
  has(/An order-of-magnitude check, \*\*not a validation\*\*/);
});

console.log('\nMethodology says what it should');
check('WUE, hydro factor and labels match code and doc', () => {
  const wue = Number(html.match(/onsiteWueLPerKwh: ([\d.]+),/)[1]);
  assert.equal(wue, 1.15);
  has(/\| Value \| \*\*1\.15 L\/kWh\*\* of IT energy, every tier \|/);
  has(/\*\*The three values near 17,000 likely share one origin\*\*/);
  has(/\*\*Pumped storage: UNVERIFIED per country\.\*\*/);
  has(/### 16\.6 Net direction of error/);
  has(/Water and energy err in \*\*opposite directions\*\*/);
  has(/for \*\*withdrawals only\*\*/);
  has(/ENTSO-E/);
});
check('the ledger shows hydro on its own row and says water is not in the carbon figure', () => {
  // "if all charged to power" is the overstatement, said in the label itself (§16.4).
  assert.match(html, /Plus hydro reservoirs, if all charged to power<\/td><td id="rWaterHydro">/);
  assert.match(html, /not counted in the carbon\./);
});

console.log(fails ? `\n${fails} failure(s)` : '\nAll good.');
process.exit(fails ? 1 : 0);
