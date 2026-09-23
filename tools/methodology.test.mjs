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
  assert.match(html, /<option value="gemini-flash-lite" selected>Gemini 3\.5 Flash-Lite, the default/);
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
check('world, EU and US fallback match', () => {
  has(new RegExp(`world ${GRIDS.world.g}, EU ${GRIDS.EU.g}`));
  has(new RegExp(`Susty uses \\*\\*${GRIDS.US.g} g/kWh\\*\\*`));
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
check('offset price is not presented as a market price', () =>
  assert.doesNotMatch(html, /durable CDR market pricing/));

console.log(fails ? `\n${fails} failure(s)` : '\nAll good.');
process.exit(fails ? 1 : 0);
