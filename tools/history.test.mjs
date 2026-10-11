#!/usr/bin/env node
// History on this device (METHODOLOGY 8.1): device segments, storage that
// may fail, the size cap, totals from frozen values, and the export.
//
//   node tools/history.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const doc  = readFileSync(new URL('../METHODOLOGY.md', import.meta.url), 'utf8');
const pkg  = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

let fails = 0;
function check(label, fn) {
  try { fn(); console.log(`pass  ${label}`); }
  catch (err) { fails++; console.log(`FAIL  ${label}\n      ${err.message}`); }
}
const near = (got, want, eps = 1e-12) => assert.ok(Math.abs(got - want) <= eps, `${got} differs from ${want}`);
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
// The history block, from its first constant to the end of paintHistory().
const histStart = html.indexOf("const HISTORY_KEY = 'susty-history-v1';");
const histEnd = html.indexOf(fn('paintHistory')) + fn('paintHistory').length;
const HIST = html.slice(histStart, histEnd);

function sandbox(extra = {}) {
  const ctx = {
    state: { requests: [], deviceSegments: [], historyPaused: false, grid: 'GB', region: '', screen: 'lcdLaptop',
             deviceWh: 0, deviceG: 0, deviceWaterMl: 0, deviceHydroMl: 0 },
    MODEL: { gridGPerKwh: 200, gridWater: { offsite: 1, hydro: 0.5 } },
    METHODOLOGY_VERSION: '2.1.0', Date, JSON, Math, Object, Array, Set, String, Number,
    themeNow: 'dark', watts: 10,
    ...extra,
  };
  ctx.theme = () => ctx.themeNow;
  ctx.deviceWattsNow = () => ctx.watts;
  ctx.window = { localStorage: ctx.storage };
  vm.createContext(ctx);
  vm.runInContext(HIST + '\nthis.peek = () => ({ historyOthers, historyAvailable });', ctx);
  return ctx;
}
function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
           removeItem: (k) => m.delete(k), map: m };
}
const rec = (t, grams, status = 'completed', extra = {}) =>
  ({ t, v: '2.1.0', grams, gramsHigh: grams * 2, status, model: 'gemini-3.5-flash-lite', inTok: 300, outTok: 200,
     thinkTok: 10, factor: 0.85, wh: 0.1, serverGridGPerKwh: 307, waterOnsiteMl: 0.1, waterOffsiteMl: 0.2,
     waterHydroMl: 0.1, ...extra });

console.log('Version');
check('METHODOLOGY_VERSION in index.html matches package.json', () => {
  assert.equal(html.match(/const METHODOLOGY_VERSION = '([\d.]+)';/)[1], pkg);
});
check('every request record is stamped with its time and methodology version', () => {
  assert.match(fn('recordRequest'), /t: Date\.now\(\), v: METHODOLOGY_VERSION/);
});

console.log('\nDevice segments');
check('a change to grid, screen, theme, wattage or water starts a new segment', () => {
  const c = sandbox();
  const a = c.deviceSegment(); assert.equal(c.deviceSegment(), a, 'same settings, same segment');
  c.state.grid = 'FR'; const b = c.deviceSegment(); assert.notEqual(b, a);
  c.themeNow = 'light'; assert.notEqual(c.deviceSegment(), b);
  c.watts = 1.35; c.deviceSegment();
  c.MODEL.gridWater = { offsite: 2, hydro: 1 }; c.deviceSegment();
  assert.equal(c.state.deviceSegments.length, 5);
  for (const s of c.state.deviceSegments) assert.equal(s.v, '2.1.0');
});
check('clockSync fills the segment with exactly what it adds to the totals', () => {
  // Drive the real clockSync with injectable time.
  const c = sandbox({ performance: { now: () => c.now }, now: 0, GRACE: 75000, lastSlice: 0, lastActivity: 0,
                      wasOn: true, attendedMs: 0, openMs: 0, onScreen: () => true });
  vm.runInContext(fn('clockSync') + '\nthis.clockSync = clockSync;', c);
  for (const [step, change] of [[2000, null], [2000, () => { c.state.grid = 'FR'; c.MODEL.gridGPerKwh = 40; }],
                                [2000, () => { c.watts = 8.4; }], [2000, null], [2000, () => { c.themeNow = 'light'; }]]) {
    c.clockSync();                       // close out at the old values first, as the page does
    if (change) change();
    c.now += step; c.lastActivity = c.now;
  }
  c.clockSync();
  const sum = (k) => c.state.deviceSegments.reduce((s, d) => s + d[k], 0);
  near(sum('wh'), c.state.deviceWh); near(sum('g'), c.state.deviceG);
  near(sum('waterMl'), c.state.deviceWaterMl); near(sum('hydroMl'), c.state.deviceHydroMl);
  assert.equal(c.state.deviceSegments.length, 4);
  assert.deepEqual(c.state.deviceSegments.map((d) => d.gridGPerKwh), [200, 40, 40, 40]);
});

console.log('\nStorage');
check('a visit with no question is not saved', () => {
  const st = memoryStorage(); const c = sandbox({ storage: st });
  assert.equal(c.saveHistory(st), false); assert.equal(st.map.size, 0);
});
check('a chat is saved with its frozen records, and another tab\'s chats are kept', () => {
  const other = { id: 'other-tab', startedAt: 1, v: '2.1.0', requests: [rec(1, 0.5)], device: [] };
  const st = memoryStorage({ 'susty-history-v1': JSON.stringify({ v: 1, sessions: [other] }) });
  const c = sandbox({ storage: st });
  c.state.requests.push(Object.freeze(rec(Date.now(), 0.123)));
  assert.equal(c.saveHistory(st), true);
  const saved = JSON.parse(st.map.get('susty-history-v1')).sessions;
  assert.deepEqual(saved.map((s) => s.id).slice(0, 1), ['other-tab']);
  assert.equal(saved[1].requests[0].grams, 0.123);
  assert.equal(saved[1].v, '2.1.0');
});
check('storage that throws is survived: nothing thrown, history marked unavailable', () => {
  const bad = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  const c = sandbox({ storage: bad });
  c.state.requests.push(rec(Date.now(), 0.1));
  assert.equal(c.saveHistory(bad), false);
  assert.equal(c.peek().historyAvailable, false);
});
check('past the cap, the oldest chats go first and this chat is kept', () => {
  const old = (i) => ({ id: 'old' + i, startedAt: i, v: '2.0.9', requests: [rec(i, 1)], device: [], pad: 'x'.repeat(400) });
  const st = memoryStorage({ 'susty-history-v1': JSON.stringify({ v: 1, sessions: [old(1), old(2), old(3)] }) });
  const c = sandbox({ storage: st });
  c.state.requests.push(rec(Date.now(), 0.2));
  c.saveHistory(st, 1700);
  const ids = JSON.parse(st.map.get('susty-history-v1')).sessions.map((s) => s.id);
  assert.ok(!ids.includes('old1'), ids.join());
  assert.equal(ids.at(-1).includes('old'), false, 'current chat must survive');
});
check('after "clear history" this chat is not saved', () => {
  const st = memoryStorage(); const c = sandbox({ storage: st });
  c.state.requests.push(rec(Date.now(), 0.1)); c.state.historyPaused = true;
  assert.equal(c.saveHistory(st), false); assert.equal(st.map.size, 0);
});
check('every storage access in the page is wrapped', () => {
  assert.match(html, /try \{ historyOthers = readStoredSessions\(window\.localStorage\)/);
  assert.match(html, /try \{ window\.localStorage\.removeItem\(HISTORY_KEY\); \} catch \{\}/);
  assert.match(fn('saveHistory'), /try \{[\s\S]*storage\.setItem[\s\S]*\} catch \{/);
});

console.log('\nTotals and export: frozen values, never repriced');
check('today, last 7 days and all, from stored values; answers count completed only', () => {
  const c = sandbox();
  const now = new Date(2026, 9, 11, 15).getTime(), day = 864e5;
  const sessions = [
    { id: 'a', v: '2.0.9', requests: [rec(now - 30 * day, 1, 'completed', { v: '2.0.9' })], device: [] },
    { id: 'b', v: '2.1.0', requests: [rec(now - 2 * day, 2), rec(now - 2 * day, 0.5, 'failed')],
      device: [{ v: '2.1.0', start: now - 1000, g: 0.25, waterMl: 0.1, wh: 0.1 }] },
    { id: 'c', v: '2.1.0', requests: [rec(now - 3600e3, 4)], device: [] },
  ];
  const t = c.historyTotals(sessions, now);
  near(t.today.g, 4.25); assert.equal(t.today.answers, 1);
  near(t.week.g, 6.75); assert.equal(t.week.answers, 2);
  near(t.all.g, 7.75); assert.equal(t.all.answers, 3);
  assert.deepEqual([...t.versions], ['2.0.9', '2.1.0']);
});
check('totals and export read stored figures only, never the current model or grid', () => {
  for (const name of ['historyTotals', 'historyCsv']) assert.doesNotMatch(fn(name), /MODEL\./, name);
});
check('CSV: one row per record and segment, methodology version on every row', () => {
  const c = sandbox();
  const csv = c.historyCsv([{ id: 's1', v: '2.1.0',
    requests: [rec(Date.UTC(2026, 9, 11), 0.1234, 'completed', { model: 'odd,"model"' }), rec(1, 0.5, 'completed', { v: '2.0.9' })],
    device: [{ v: '2.1.0', start: 2, wh: 0.05, gridGPerKwh: 40, g: 0.002, waterMl: 0.03, hydroMl: 0.1,
               grid: 'US', region: 'CAMX', screen: 'oledPhone', theme: 'dark', attendedMs: 75000 }] }]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('methodology_version,session_id,kind,time_utc'));
  assert.ok(lines[1].startsWith('2.1.0,s1,request,2026-10-11T00:00:00.000Z,completed,"odd,""model"""'));
  assert.ok(lines[2].startsWith('2.0.9,s1,request,'), 'older entries keep their own version');
  assert.ok(lines[3].startsWith('2.1.0,s1,device,'));
  assert.ok(lines[1].includes(',0.1234,0.2468,'), 'frozen grams copied as stored');
  assert.ok(lines[3].endsWith(',US/CAMX,oledPhone,dark,75'));
});

console.log('\nMethodology says what it should');
check('§8.1 describes history, storage and the never-reprice rule', () => {
  for (const re of [/### 8\.1 History on this device/, /never repriced/i, /nothing leaves the browser/i]) {
    assert.ok(re.test(doc), `METHODOLOGY.md is missing ${re}`);
  }
});

console.log(fails ? `\n${fails} failure(s)` : '\nAll good.');
process.exit(fails ? 1 : 0);
