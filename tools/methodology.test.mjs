#!/usr/bin/env node
// METHODOLOGY.md states numbers that live in code. These checks read both and
// fail when they drift apart, so a constant cannot change without the method
// that explains it changing too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The document describes the default deployment, so an ANTHROPIC_MODEL
// exported in the shell must not reach api/chat.js (it reads it at load).
delete process.env.ANTHROPIC_MODEL;
delete process.env.SUSTY_TIERS;
delete process.env.SUSTY_EXPENSIVE_TIERS;
const { LIMITS, TIERS, resolveTier, THINKING_LEVELS, LEVEL_MAX_TOKENS } = await import('../api/chat.js');
const { fullModel, registry } = await import('./model-factors.mjs');

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
check('model comparison covers exactly the models the picker offers, each with a factor', () => {
  const start = html.indexOf('const COMPARE_MODELS = [');
  const ids = [...html.slice(start, html.indexOf('];', start)).matchAll(/\['([\w.-]+)'/g)].map(m => m[1]);
  const offered = [...new Set(Object.values(TIERS).map(t => t.model))];
  assert.deepEqual([...ids].sort(), [...offered].sort());
  for (const id of ids) assert.ok(MODEL_ENERGY[id], `${id} has no factor`);
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
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
check('the tier table matches the models and factors', () => {
  const rows = [['Haiku 5.5', 'haiku', ''], ['Sonnet 5.5', 'sonnet', ' (overridable via `ANTHROPIC_MODEL`)'], ['Opus 5.5', 'opus', ''],
                ['**Gemini 3.5 Flash-Lite** (client default)', 'gemini-flash-lite', ''], ['Gemini 4 Hydrogen', 'gemini-flash', '']];
  for (const [label, key, note] of rows) {
    const m = TIERS[key].model;
    has(new RegExp('^' + reEsc(`| ${label} | \`${m}\`${note} | ×${MODEL_ENERGY[m].factor.toFixed(2)} |`) + '$', 'm'), `tier row ${key}`);
  }
});
check('the thinking-level table is exactly what the server sends and the picker labels', () => {
  const TIER_THINKING = objectLiteral(html, 'TIER_THINKING');
  const cols = ['haiku', 'sonnet', 'opus', 'gemini-flash-lite', 'gemini-flash'];
  const names = { least: '**Least** (where the picker starts)', low: 'Low', medium: 'Medium', high: 'High' };
  process.env.GOOGLE_GEMINI_API_KEY = 'doc-check';
  try {
    const opusLeast = resolveTier('opus', 'least').maxTokens;
    assert.equal(resolveTier('gemini-flash', 'least').maxTokens, opusLeast);
    for (const lv of THINKING_LEVELS) {
      const cells = cols.map((k) => {
        const r = resolveTier(k, lv);
        assert.equal(r.level, lv, `${k} at ${lv}`);
        const cell = r.provider === 'google' ? '`' + r.thinkingLevel + '`'
          : !r.thinking ? 'cannot be disabled; effort `' + r.effort + '`'
          : r.thinking.type === 'adaptive' ? 'adaptive, effort `' + r.effort + '`'
          : 'off (`' + r.thinking.type + '`), effort `' + r.effort + '`';
        return cell + (TIER_THINKING[k].default === lv ? ' ★' : '');
      });
      const ceiling = lv === 'least'
        ? `${LIMITS.maxTokens.toLocaleString('en-US')} tokens; ${opusLeast.toLocaleString('en-US')} for Opus and Gemini`
        : `${LEVEL_MAX_TOKENS[lv].toLocaleString('en-US')} tokens`;
      has(new RegExp('^' + reEsc(`| ${names[lv]} | ${cells.join(' | ')} | ${ceiling} |`) + '$', 'm'), `thinking row ${lv}`);
    }
  } finally {
    delete process.env.GOOGLE_GEMINI_API_KEY;
  }
});
check('the picker offers the levels the server accepts, starting at least', () => {
  assert.deepEqual(Function(`return ${html.match(/const THINKING_LEVELS = (\[[^\]]+\]);/)[1]}`)(), THINKING_LEVELS);
  assert.match(html, /const THINKING_START = 'least';/);
  has(/\*\*Where the picker starts: Least\.\*\*/);
});
check('ceilings and switches in 4.6 and 4.5 match api/chat.js', () => {
  const [lo, md, hi] = ['low', 'medium', 'high'].map((l) => LEVEL_MAX_TOKENS[l].toLocaleString('en-US'));
  has(new RegExp(reEsc(`maximum per Anthropic reply at Least (${resolveTier('opus', 'least').maxTokens.toLocaleString('en-US')} on Opus, which cannot switch thinking off), and ${lo}, ${md} and ${hi} at Low, Medium and High`)));
  process.env.GOOGLE_GEMINI_API_KEY = 'doc-check';
  const g = resolveTier('gemini-flash', 'least').maxTokens.toLocaleString('en-US');
  delete process.env.GOOGLE_GEMINI_API_KEY;
  has(new RegExp(reEsc(`**${g} output tokens** per Gemini reply at Least and Low, ${md} at Medium and ${hi} at High`)));
  has(/\| `SUSTY_EXPENSIVE_TIERS=off` \| Medium and High run at Least; every tier and the other levels stay \|/);
  has(/\| `SUSTY_TIERS=off` \| Collapses every request to the default tier at Least \|/);
});
check('the client expects each tier to answer with that tier\'s model', () => {
  const EXPECTED_MODEL = objectLiteral(html, 'EXPECTED_MODEL');
  for (const [key, tier] of Object.entries(TIERS)) assert.equal(EXPECTED_MODEL[key], tier.model, key);
});
check('picker labels quote the factor ratios against the Sonnet tier', () => {
  const sonnet = MODEL_ENERGY[TIERS.sonnet.model].factor;
  const haiku = MODEL_ENERGY[TIERS.haiku.model].factor / sonnet;
  const opus = MODEL_ENERGY[TIERS.opus.model].factor / sonnet;
  assert.match(html, /<option value="haiku">Haiku 5\.5, two-thirds the energy<\/option>/);
  assert.ok(haiku > 0.62 && haiku < 0.71, `Haiku/Sonnet is ${haiku.toFixed(3)}, not about two-thirds`);
  assert.match(html, /<option value="opus">Opus 5\.5, 1\.7×, always thinks<\/option>/);
  assert.equal(opus.toFixed(1), '1.7');
  has(new RegExp(`Haiku 5\\.5 is about two-thirds of it \\(${MODEL_ENERGY[TIERS.haiku.model].factor} / ${sonnet}\\), Opus 5\\.5 about 1\\.7 times \\(${MODEL_ENERGY[TIERS.opus.model].factor} / ${sonnet}\\)`));
});
check('client default tier is documented', () => {
  const tier = html.match(/tier: '([\w-]+)',\s+\/\/ what we asked for/)[1];
  assert.equal(tier, 'gemini-flash-lite');
  assert.match(html, /<option value="gemini-flash-lite" selected>Gemini 3\.5 Flash-Lite \(default\)<\/option>/);
});

console.log('\nModel factors');
const factorRows = {
  'claude-haiku-5-5':      /\| Claude Haiku 5\.5 \|[^|]*\| ([\d.]+) \| derived/,
  'claude-sonnet-5-5':     /\| Claude Sonnet 5\.5 \|[^|]*\| ([\d.]+) \| derived/,
  'claude-opus-5-5':       /\| Claude Opus 5\.5 \|[^|]*\| ([\d.]+) \| derived/,
  'gemini-3.5-flash-lite': /\| Gemini 3\.5 Flash-Lite \|[^|]*\| ([\d.]+) \| derived/,
  'gemini-4-hydrogen':     /\| Gemini 4 Hydrogen \|[^|]*\| ([\d.]+) \| derived/,
  'claude-sonnet-4-6':     /\| Claude Sonnet 4\.6 \|[^|]*\| ([\d.]+) \| anchor/,
};
for (const [id, re] of Object.entries(factorRows)) {
  check(`${id} factor matches`, () => {
    const m = doc.match(re);
    assert.ok(m, `row for ${id} not found`);
    assert.equal(Number(m[1]), MODEL_ENERGY[id].factor);
  });
}


check('the 4.4 full-model table reproduces from tools/model-factors.mjs', () => {
  const rows = {
    'Claude Haiku 5.5': 'claude-haiku-5-5', 'Gemini 4 Hydrogen': 'gemini-4-hydrogen',
    'Claude Sonnet 5.5': 'claude-sonnet-5-5', 'Gemini 3.5 Flash-Lite': 'gemini-3.5-flash-lite',
    'Claude Sonnet 4.6 \\(anchor\\)': 'claude-sonnet-4-6', 'Claude Opus 5.5': 'claude-opus-5-5',
  };
  for (const [label, id] of Object.entries(rows)) {
    const r = fullModel(id);
    has(new RegExp(`\\| ${label} \\| ${MODEL_ENERGY[id].factor.toFixed(2)} \\| ${r.lo.toFixed(2)}–${r.hi.toFixed(2)} \\|`), `full-model row for ${id}`);
  }
});
check('the 4.3 power-per-reply figures reproduce from the factors and registry throughputs', () => {
  const reg = registry();
  for (const [id, name] of [['claude-haiku-5-5', 'Haiku 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-opus-5-5', 'Opus 5.5'],
                            ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'], ['gemini-4-hydrogen', 'Gemini 4 Hydrogen']]) {
    const j = MODEL_ENERGY[id].factor * MODEL.whPerOutputToken * 1000 * MODEL.pue * 3.6;
    const w = Math.round(j * reg[id].tps);
    has(new RegExp(`${w} W for ${name.replace(/\./g, '\\.')} \\(${j.toFixed(2)}`), `${name}: ${w} W from ${j.toFixed(2)} J/token`);
  }
});

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
  const sect = html.slice(html.indexOf('>This conversation</h3>'), html.indexOf('<div class="pick">'));
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
  const factor = MODEL_ENERGY['claude-opus-5-5'].factor;
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
    assert.equal(factor, 1.34); assert.equal(laptopW, 10); assert.equal(chicago, 416);
    has(/Inputs: Claude Opus 5\.5 \(×1\.34, §4\.4\)/);
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
check('the water total adds on-site and power stations and leaves hydro out', () => {
  assert.match(html, /\$\('rWaterTotal'\)\.textContent\s*= ml\(wt\.onsite \+ wt\.offsite, wt\.onsiteHigh \+ wt\.offsiteHigh\)/);
  const water = html.slice(html.indexOf('>Water</h4>'), html.indexOf('id="noteWater"'));
  assert.ok(water.indexOf('id="rWaterTotal"') > water.indexOf('id="rWaterOffsite"') &&
            water.indexOf('id="rWaterHydro"') > water.indexOf('id="rWaterTotal"'), 'hydro sits below the total');
  has(/"Water, this chat" adds on-site cooling and power stations excluding hydro/);
});
check('the answered comparison row says when it leaves out thinking', () => {
  assert.match(html, /latestCompleted\.thinkTok > 0 \? ' \(answered, excl\. thinking\)' : ' \(answered\)'/);
  has(/the mark says "excl\. thinking"/);
});

console.log(fails ? `\n${fails} failure(s)` : '\nAll good.');
process.exit(fails ? 1 : 0);
