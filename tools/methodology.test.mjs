#!/usr/bin/env node
// METHODOLOGY.md states numbers that live in code. These checks read both and
// fail when they drift apart, so a constant cannot change without the method
// that explains it changing too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS, TIERS } from '../api/chat.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const grid = readFileSync(new URL('../api/grid.js', import.meta.url), 'utf8');
const doc  = readFileSync(new URL('../METHODOLOGY.md', import.meta.url), 'utf8');

let fails = 0;
// assert.match would print the whole document on failure; name the pattern only.
const has = (re, what = String(re)) => assert.ok(re.test(doc), `METHODOLOGY.md is missing ${what}`);
function check(label, fn) {
  try { fn(); console.log(`pass  ${label}`); }
  catch (err) { fails++; console.log(`FAIL  ${label}\n      ${err.message}`); }
}

// Pull a `const NAME = { ... };` object literal out of source and evaluate it.
function objectLiteral(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} not found`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      return Function(`return (${source.slice(source.indexOf('{', start), i + 1)});`)();
    }
  }
  throw new Error(`${name} is unterminated`);
}

const MODEL        = objectLiteral(html, 'MODEL');
const PANELS       = objectLiteral(html, 'PANELS');
const DEVICE_BASE  = objectLiteral(html, 'DEVICE_BASE');
const MODEL_ENERGY = objectLiteral(html, 'MODEL_ENERGY');
const GRIDS        = objectLiteral(html, 'GRIDS');
const US_SUB       = objectLiteral(html, 'US_SUB');
const FUEL_G       = objectLiteral(grid, 'FUEL_G');
const GRACE        = Number(html.match(/const GRACE = (\d+);/)[1]);
const SYSTEM_TOKENS = Number(html.match(/const SYSTEM_TOKENS = (\d+);/)[1]);

console.log('Core constants');
check('token coefficients match', () => {
  assert.equal(MODEL.whPerInputToken * 1000, 0.05);
  assert.equal(MODEL.whPerOutputToken * 1000, 0.5);
  has(/Input tokens \| 0\.05 mWh\/token/);
  has(/Output tokens \| 0\.5 mWh\/token/);
});
check(`high-bound factor ${MODEL.inferenceHighFactor} matches, in doc and in-page copy`, () => {
  has(new RegExp(`High-bound factor k \\| \\*\\*${MODEL.inferenceHighFactor}\\*\\*`));
  has(/\*\*0\.60 Wh\*\* \(IQR 0\.16–0\.60/);
  has(/### 4\.8 The high end of the range/);
  has(/\*\*Not a statistical interval\.\*\*/);
  assert.match(html, new RegExp(`${MODEL.inferenceHighFactor} times ours`), 'ledger note should quote the factor');
});
check('model comparison covers every model in MODEL_ENERGY except superseded Opus ids', () => {
  const start = html.indexOf('const COMPARE_MODELS = [');
  const ids = [...html.slice(start, html.indexOf('];', start)).matchAll(/\['([\w.-]+)'/g)].map(m => m[1]);
  const offered = Object.keys(MODEL_ENERGY).filter(k => !/claude-opus-4-[67]/.test(k));
  assert.deepEqual([...ids].sort(), [...offered].sort());
  has(/### 4\.9 The latest answer on other models/);
  has(/\*\*hypothetical\*\*/);
});
check('long-chat threshold is the output/input coefficient ratio, as documented', () => {
  const ratio = Math.round(MODEL.whPerOutputToken / MODEL.whPerInputToken);
  has(new RegExp(`input_tokens\\(j\\) >= ${ratio} x output_tokens\\(j\\)`));
  has(/\*\*Output includes thinking tokens\*\*/);
});
check(`PUE ${MODEL.pue} matches`, () => has(new RegExp(`PUE of ${MODEL.pue}\\*\\*`)));
check(`hosting ${MODEL.whPerExchange} Wh matches`, () =>
  has(new RegExp(`${MODEL.whPerExchange} Wh per request handled by Susty`)));
check(`grace window ${GRACE / 1000} s matches`, () =>
  has(new RegExp(`\\*\\*${GRACE / 1000}-second grace window\\*\\*`)));
check(`system-prompt allowance ${SYSTEM_TOKENS} tokens matches`, () =>
  has(new RegExp(`\\*\\*${SYSTEM_TOKENS} tokens\\*\\*`)));

console.log('\nGuardrails');
check('history, length, rate limits match api/chat.js', () => {
  has(new RegExp(`\\*\\*${LIMITS.maxMessages} messages\\*\\*`));
  has(new RegExp(`\\*\\*${LIMITS.maxChars.toLocaleString('en-US')} characters\\*\\*`));
  has(new RegExp(`\\*\\*${LIMITS.maxTokens.toLocaleString('en-US')} output tokens\\*\\*`));
  has(new RegExp(`\\*\\*${LIMITS.perWindow} requests per IP per ${LIMITS.windowMs / 60000} minutes\\.?\\*\\*`));
});
check('thinking-tier ceiling matches', () =>
  has(new RegExp(`${TIERS['opus-thinking'].maxTokens.toLocaleString('en-US')}-token ceiling`)));
check('Gemini output cap and thinking levels match', () => {
  const cap = TIERS['gemini-flash'].maxTokens;
  assert.equal(TIERS['gemini-flash-lite'].maxTokens, cap);
  has(new RegExp(`\\*\\*${cap.toLocaleString('en-US')} output tokens\\*\\* per Gemini reply`));
  has(new RegExp(`\\| \\*\\*Gemini 3\\.5 Flash-Lite\\*\\* \\(client default\\) \\|[^|]*\\| cannot be disabled; level \`${TIERS['gemini-flash-lite'].thinkingLevel}\``));
  has(new RegExp(`\\| Gemini 3\\.8 Flash \\|[^|]*\\| cannot be disabled; level \`${TIERS['gemini-flash'].thinkingLevel}\``));
});
check('client default tier is documented', () => {
  const tier = html.match(/tier: '([\w-]+)',\s+\/\/ what we asked for/)[1];
  assert.equal(tier, 'gemini-flash-lite');
  assert.match(html, /<option value="gemini-flash-lite" selected>Gemini 3\.5 Flash-Lite \(default\)<\/option>/);
});

console.log('\nModel factors');
const factorRows = {
  'claude-haiku-4-5':      /Claude Haiku 4\.5 \|[^|]*\| ([\d.]+) \|/,
  'claude-sonnet-4-6':     /Claude Sonnet 4\.6 \|[^|]*\| ([\d.]+) \|/,
  'claude-opus-4-8':       /Claude Opus 4\.6 \/ 4\.7 \/ 4\.8 \|[^|]*\| ([\d.]+) \|/,
  'gemini-3.8-flash':      /Gemini 3\.8 Flash \|[^|]*\| ([\d.]+) \|/,
  'gemini-3.5-flash-lite': /Gemini 3\.5 Flash-Lite \|[^|]*\| ([\d.]+) \|/,
};
for (const [id, re] of Object.entries(factorRows)) {
  check(`${id} factor matches`, () => {
    const m = doc.match(re);
    assert.ok(m, `row for ${id} not found`);
    assert.equal(Number(m[1]), MODEL_ENERGY[id].factor);
  });
}


console.log('\nDevice table');
const deviceRows = [
  ['Phone, OLED',            'phone',   'oledPhone'],
  ['Phone, LCD',             'phone',   'lcdPhone'],
  ['Tablet, OLED',           'tablet',  'oledTablet'],
  ['Tablet, LCD',            'tablet',  'lcdTablet'],
  ['Laptop, OLED',           'laptop',  'oledLaptop'],
  ['Laptop, LCD',            'laptop',  'lcdLaptop'],
  ['Desktop \\+ OLED monitor', 'monitor', 'oledMonitor'],
  ['Desktop \\+ LCD monitor',  'monitor', 'lcdMonitor'],
];
for (const [label, cls, panel] of deviceRows) {
  check(`${label.replace('\\', '')} whole-device watts match`, () => {
    const row = doc.match(new RegExp(`^\\| ${label} \\|([^\\n]+)$`, 'm'));
    assert.ok(row, 'row not found');
    const nums = row[1].match(/[\d.]+/g).map(Number);
    const light = DEVICE_BASE[cls] + PANELS[panel].light;
    const dark  = DEVICE_BASE[cls] + PANELS[panel].dark;
    const want = light === dark ? [light, PANELS[panel].light] : [light, dark, PANELS[panel].light, PANELS[panel].dark];
    assert.deepEqual(nums.map(n => n.toFixed(2)), want.map(n => n.toFixed(2)));
  });
}

console.log('\nGrid figures');
check('EIA fuel factors match', () => {
  const pairs = [['Coal', FUEL_G.COL], ['Natural gas', FUEL_G.NG], ['Petroleum', FUEL_G.OIL],
                 ['Other', FUEL_G.OTH], ['Geothermal', FUEL_G.GEO]];
  for (const [name, g] of pairs) {
    has(new RegExp(`\\| ${name} \\| ${g.toLocaleString('en-US')} \\|`), `${name} ${g}`);
  }
});
check('national range and stamp match the GRIDS table', () => {
  const ember = Object.entries(GRIDS).filter(([k]) => k !== 'world' && k !== 'EU');
  const lo = ember.reduce((a, b) => (b[1].g < a[1].g ? b : a));
  const hi = ember.reduce((a, b) => (b[1].g > a[1].g ? b : a));
  has(new RegExp(`from ${lo[1].name} \\(${lo[1].g}\\) to ${hi[1].name} \\(${hi[1].g}\\)`));
  const year = html.match(/Ember yearly electricity data, (\d{4}) values, retrieved \d{4}-\d{2}-\d{2} by tools\/ember-grids\.mjs/)[1];
  has(new RegExp(`Ember\\]\\([^)]+\\) ${year} national annual intensities`));
  assert.equal(MODEL.gridGPerKwh, GRIDS.world.g, 'MODEL.gridGPerKwh default should be the world average');
});
check('world, EU and US fallback match', () => {
  has(new RegExp(`world ${GRIDS.world.g}, EU ${GRIDS.EU.g}`));
  has(new RegExp(`Susty uses \\*\\*${GRIDS.US.g} g/kWh\\*\\*`));
});
check(`server grid ${MODEL.serverGridGPerKwh} g/kWh matches, with its source and basis caveat`, () => {
  has(new RegExp(`servers' grid of \\*\\*${MODEL.serverGridGPerKwh} g CO2e/kWh\\*\\*`));
  has(/basis not stated by source/);
  has(/watershed\.com\/blog\/ai-emissions-by-region/);
  assert.match(html, new RegExp(`about ${MODEL.serverGridGPerKwh} g CO₂e/kWh`), 'in-page methodology should quote the server grid');
});
check('no market-based renewable preset, and the document says so', () => {
  assert.ok(!('renew' in GRIDS), 'GRIDS still has a renewable preset');
  has(/### 6\.7 No renewable-tariff option/);
});
check('ledger labels the grid accounting basis', () => {
  assert.match(html, /\$\('rGrid'\)\.textContent\s*=\s*MODEL\.gridGPerKwh \+ ' g\/kWh, ' \+ gridBasis\(\)/);
  has(/The ledger names the basis in force/);
});
check('eGRID range matches the subregion table', () => {
  const vals = Object.values(US_SUB);
  has(new RegExp(`\\*\\*${Math.min(...vals)} g/kWh\\*\\* \\(upstate New York\\) to \\*\\*${Math.max(...vals)}\\*\\*`));
});

console.log('\nSource attribution');
check('ledger never credits NESO for a non-NESO live figure', () => {
  assert.match(html, /\/\^EIA\/\.test\(state\.live\.source/);
  assert.match(html, /\/\^NESO\/\.test\(state\.live\.source/);
  assert.doesNotMatch(html, /else if \(state\.live\)\s+parts\.push\(fill\(L\.sourceLive,\s*\{ source: src\('neso'\)/);
});
check('in-page methodology does not call NESO regional figures actuals', () =>
  assert.doesNotMatch(html, /Half-hourly actuals for 14/));
check('smartphone charge matches EPA arithmetic and the doc', () => {
  const wh = Number(html.match(/const PHONE_CHARGE_WH = (\d+);/)[1]);
  const epa = 28.446 - 22 * 0.411;                 // EPA: 19.404 Wh, published as 0.019 kWh
  assert.equal(wh, Math.round(epa));
  has(new RegExp(`\\| One smartphone charge \\| ${wh} Wh \\|`));
  assert.match(html, /totalWh \/ PHONE_CHARGE_WH/);
});
check('burger comparison is the sourced figure, in code and doc', () => {
  const g = Number(html.match(/const BURGER_G = (\d+);/)[1]);
  assert.equal(g, Math.round(113 * 33.3 / 100) * 100);
  has(new RegExp(`\\| A quarter-pound beef burger \\| ${g.toLocaleString('en-US')} \\|`));
  assert.match(html, /g \/ BURGER_G/);
  assert.doesNotMatch(html, /g \/ 3000/);
});
check('offset price matches and is the current average, not the target', () => {
  const usd = Number(html.match(/const OFFSET_USD_PER_TONNE = (\d+);/)[1]);
  has(new RegExp(`converts grams to money at \\*\\*\\$${usd} per tonne\\*\\*`));
  assert.doesNotMatch(html, /durable CDR market pricing/);
  assert.doesNotMatch(html, /roughly \$100 per tonne/);
});
check('coverage ratio is computed, not asserted', () => {
  assert.doesNotMatch(html, /each cover it thousands of times over/);
  assert.match(html, /Math\.floor\(SMALLEST_ACTION_G \/ g\)/);
});

console.log('\nDisclosed limitations');
check('says where the coefficients sit among published estimates', () => {
  has(/\*\*Where Susty sits: at the low end\.\*\*/);
  assert.match(html, /sit at the low end of published estimates/);
});
check('says the model factors omit GPU count', () => has(/\*\*What the factors leave out: GPU count\.\*\*/));
check('says there is no idle-capacity term', () => has(/### Idle and reserved capacity/));
check('lists data next steps', () => has(/## 15\. Next steps: data and specificity/));

console.log('\nVersion');
check('package.json, README, CHANGELOG, METHODOLOGY and the app carry the same version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(readme, new RegExp(`\\*\\*Version ${pkg.replace(/\./g, '\\.')}\\*\\*`));
  assert.equal(changelog.match(/^## (\d+\.\d+\.\d+)/m)[1], pkg, 'newest CHANGELOG entry');
  has(new RegExp(`\\*\\*Version:\\*\\* ${pkg.replace(/\./g, '\\.')},`));
  assert.equal(html.match(/const METHODOLOGY_VERSION = '([\d.]+)';/)[1], pkg, 'METHODOLOGY_VERSION in index.html');
});

console.log('\nLayout');
check('this conversation shows carbon, energy and water as labeled blocks, in that order', () => {
  const sect = html.slice(html.indexOf('<h3>This conversation</h3>'), html.indexOf('<div class="pick">'));
  const blocks = [...sect.matchAll(/<h4 class="block">(\w+)<\/h4>/g)].map((m) => m[1]);
  assert.deepEqual(blocks, ['Carbon', 'Energy', 'Water']);
  assert.ok(sect.indexOf('id="rWh"') > sect.indexOf('>Energy<') && sect.indexOf('id="rWaterOnsite"') > sect.indexOf('>Water<'));
  assert.doesNotMatch(html, /<h3>Water<\/h3>/, 'water is a block of this conversation, not its own section');
});
check('long text values and spanning notes may wrap on a narrow screen', () => {
  // "307 g/kWh, basis not stated by source" unwrapped pushed the ledger to
  // 429 px on a 360 px phone.
  assert.match(html, /#rModel, #rThinking, #rServerGrid \{ white-space: normal; \}/);
  assert.match(html, /\.rows td\[colspan\] \{ text-align: left; white-space: normal; \}/);
});
check('hidden pickers stay hidden despite .pick display: flex', () =>
  assert.match(html, /\.pick\[hidden\] \{ display: none; \}/));

console.log('\nWorked example (METHODOLOGY 3)');
{
  const WATER_GRIDS = objectLiteral(html, 'WATER_GRIDS');
  const WATER_US_SUB = objectLiteral(html, 'WATER_US_SUB');
  const PHONE_CHARGE_WH = Number(html.match(/const PHONE_CHARGE_WH = (\d+);/)[1]);
  const sect = doc.slice(doc.indexOf('### Worked example'), doc.indexOf('### Why longer chats'));
  const row = (label, value) => assert.ok(sect.includes(value),
    `worked example: ${label} should read ${value}`);
  const f = (n, d = 3) => n.toFixed(d);
  const factor = MODEL_ENERGY['claude-opus-4-8'].factor;
  const laptopW = DEVICE_BASE.laptop + PANELS.lcdLaptop.light;
  const chicago = US_SUB.RFCW;
  const inf = (1000 * MODEL.whPerInputToken + 5000 * MODEL.whPerOutputToken) * factor * MODEL.pue;
  const req = inf + MODEL.whPerExchange;
  const dev = (sec) => laptopW * sec / 3600;
  const sg = req * MODEL.serverGridGPerKwh / 1000;
  const g = (gridG, sec = 300) => sg + dev(sec) * gridG / 1000;
  const central = g(chicago);
  const us = WATER_GRIDS.US, rfcw = WATER_US_SUB.RFCW;
  check('inputs are the ones the table names', () => {
    assert.equal(factor, 1.33); assert.equal(laptopW, 10); assert.equal(chicago, 416);
    assert.equal(GRIDS.NO.g, 30); assert.equal(GRIDS.ZA.g, 718);
    assert.equal(MODEL.serverGridGPerKwh, 307); assert.equal(MODEL.inferenceHighFactor, 2.7);
    assert.match(html, /\['Illinois — northern \(Chicago\)','RFCW'\]/);
  });
  check('energy rows reproduce', () => {
    row('inference', `| ${f(inf)} Wh |`);
    row('device', `| ${f(dev(300))} Wh |`);
    row('inference share', `inference is ${Math.round(100 * inf / (req + dev(300)))}% of it`);
    row('electricity', `${f(req + dev(300))} Wh (${(100 * (req + dev(300)) / PHONE_CHARGE_WH).toFixed(1)}% of a ${PHONE_CHARGE_WH} Wh`);
  });
  check('carbon rows reproduce', () => {
    row('servers', `| ${f(sg)} g |`);
    row('device', `| ${f(dev(300) * chicago / 1000)} g |`);
    row('central', `**${f(central)} g CO2e**`);
    row('high end', `| ${f(central + (MODEL.inferenceHighFactor - 1) * inf * MODEL.serverGridGPerKwh / 1000)} g CO2e |`);
    row('grid span', `| ${f(g(GRIDS.NO.g))}–${f(g(GRIDS.ZA.g))} g CO2e |`);
    row('reading time', `from ${f(g(chicago, 60))} g to ${f(g(chicago, 600))} g`);
  });
  check('water rows reproduce', () => {
    row('on-site', `| ${f((inf / MODEL.pue + MODEL.whPerExchange) * MODEL.onsiteWueLPerKwh)} mL |`);
    row('power stations', `| ${f(req * us.offsite + dev(300) * rfcw.offsite)} mL |`);
    row('hydro', `| ${f(req * us.hydro + dev(300) * rfcw.hydro)} mL |`);
    row('US and RFCW factors', `× ${us.offsite} L/kWh (US) + 0.833 Wh × ${rfcw.offsite} L/kWh (RFCW)`);
  });
}
check('the answered comparison row says when it leaves out thinking', () => {
  assert.match(html, /latestCompleted\.thinkTok > 0 \? ' \(answered, excl\. thinking\)' : ' \(answered\)'/);
  has(/the mark says "excl\. thinking"/);
});

console.log(fails ? `\n${fails} failure(s)` : '\nAll good.');
process.exit(fails ? 1 : 0);
