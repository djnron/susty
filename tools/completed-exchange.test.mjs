#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  callGoogle,
  normalizeGoogleFinishReason,
  pipeGoogleAsAnthropicSSE,
} from '../api/providers/google.js';
import { TIERS } from '../api/chat.js';

let fails = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`pass  ${label}`);
  } catch (err) {
    fails++;
    console.log(`FAIL  ${label}`);
    console.log(`      ${err.message}`);
  }
}

function near(got, want, eps = 1e-12) {
  assert.ok(Math.abs(got - want) <= eps, `${got} differs from ${want}`);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const methodology = readFileSync(new URL('../METHODOLOGY.md', import.meta.url), 'utf8');

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  const bodyMarker = source.indexOf(') {', start);
  assert.notEqual(bodyMarker, -1, `function ${name} body not found`);
  const brace = bodyMarker + 2;
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} is unterminated`);
}

console.log('Completed exchange classification');
{
  const REQUEST_STATUS = Object.freeze({
    COMPLETED: 'completed',
    INCOMPLETE: 'incomplete',
    FAILED: 'failed',
  });
  const context = vm.createContext({ REQUEST_STATUS });
  vm.runInContext(`${extractNamedFunction(html, 'requestStatus')}; this.requestStatus = requestStatus;`, context);
  const classify = context.requestStatus;

  check('Anthropic end_turn + message_stop -> completed', () => {
    assert.equal(classify({ fullText: 'ok', streamError: null, sawMessageStop: true, stopReason: 'end_turn' }), 'completed');
  });
  check('Anthropic max_tokens -> incomplete', () => {
    assert.equal(classify({ fullText: 'cut', streamError: null, sawMessageStop: true, stopReason: 'max_tokens' }), 'incomplete');
  });
  check('stream error after text -> incomplete', () => {
    assert.equal(classify({ fullText: 'partial', streamError: 'network', sawMessageStop: false, stopReason: null }), 'incomplete');
  });
  check('stream ends without message_stop -> incomplete', () => {
    assert.equal(classify({ fullText: 'partial', streamError: null, sawMessageStop: false, stopReason: 'end_turn' }), 'incomplete');
  });
  check('empty response -> failed', () => {
    assert.equal(classify({ fullText: '', streamError: null, sawMessageStop: true, stopReason: 'end_turn' }), 'failed');
  });
}

console.log('\nFunctional-unit arithmetic');
{
  const perExchange = (total, statuses) => {
    const n = statuses.filter((s) => s === 'completed').length;
    return n ? total / n : null;
  };
  check('zero completed exchanges -> undefined/null', () => assert.equal(perExchange(0.01, ['failed']), null));
  check('one completed exchange', () => near(perExchange(0.12, ['completed']), 0.12));
  check('three completed exchanges', () => near(perExchange(0.21, ['completed', 'completed', 'completed']), 0.07));
  check('incomplete work stays in numerator, not denominator', () => near(perExchange(0.18, ['completed', 'incomplete']), 0.18));
  check('production denominator derives from completed request records', () => {
    assert.match(html, /r\.status === REQUEST_STATUS\.COMPLETED \? 1 : 0/);
    assert.match(html, /return n > 0 \? grams\(\) \/ n : null/);
  });
  check('production recordRequest requires an explicit valid status', () => {
    assert.match(html, /recordRequest requires a valid status/);
  });
}

console.log('\nProduction recordRequest');
{
  const REQUEST_STATUS = Object.freeze({ COMPLETED: 'completed', INCOMPLETE: 'incomplete', FAILED: 'failed' });
  const MODEL = { whPerInputToken: 0.00005, whPerOutputToken: 0.0005, pue: 1.12, whPerExchange: 0.003, gridGPerKwh: 400, serverGridGPerKwh: 307, inferenceHighFactor: 2.7 };
  const MODEL_ENERGY = { 'claude-sonnet-4-6': { factor: 1.00 }, 'claude-opus-4-8': { factor: 1.33 } };
  const state = { model: 'claude-sonnet-4-6', requests: [] };
  const context = vm.createContext({ REQUEST_STATUS, MODEL, MODEL_ENERGY, state, Object, Error });
  vm.runInContext(
    `${extractNamedFunction(html, 'modelEnergy')}\n${extractNamedFunction(html, 'recordRequest')}\n` +
    'this.recordRequest = recordRequest;',
    context,
  );
  const record = context.recordRequest;

  check('HTTP failure keeps hosting only, invents no inference', () => {
    record(0, 0, { status: 'failed', model: null, stopReason: 'http_503' });
    const r = state.requests.at(-1);
    assert.equal(r.status, 'failed');
    assert.equal(r.chipWh, 0);
    near(r.hostingWh, 0.003);
    // Hosting is server-side, so it is priced on the servers' grid, not the
    // reader's 400.
    near(r.grams, 0.003 * 307 / 1000);
  });
  check('record is priced with the responding model factor', () => {
    record(1000, 100, { status: 'completed', model: 'claude-opus-4-8-20260101', stopReason: 'end_turn' });
    near(state.requests.at(-1).factor, 1.33);
  });
  check('request is priced on the servers\' grid, not the reader\'s', () => {
    const r = state.requests.at(-1);
    assert.equal(r.serverGridGPerKwh, 307);
    near(r.grams, r.wh * 307 / 1000);
    assert.ok(!('gridGPerKwh' in r), 'record should not carry the reader grid');
  });
  check('records are frozen and keep their server grid after later changes', () => {
    const r = state.requests.at(-1);
    const before = r.grams;
    MODEL.gridGPerKwh = 50;          // reader changes country
    MODEL.serverGridGPerKwh = 999;   // and, hypothetically, the server assumption
    assert.ok(Object.isFrozen(r));
    assert.equal(r.serverGridGPerKwh, 307);
    assert.equal(r.grams, before);
  });
  check('HTTP failure has no range: high end equals central', () => {
    const r = state.requests[0];
    assert.equal(r.chipWh, 0);
    near(r.gramsHigh, r.grams);
  });
  check('high end scales inference only, at the frozen factor', () => {
    const r = state.requests[1];
    assert.equal(r.highFactor, 2.7);
    near(r.gramsHigh, r.grams + 1.7 * r.chipWh * 307 / 1000);
    assert.ok(r.gramsHigh > r.grams);
    // Hosting is not ranged: removing it leaves the same increment.
    near(r.gramsHigh - r.grams, (r.wh - r.hostingWh) * 1.7 * 307 / 1000);
  });
  check('high end is frozen against a later factor change', () => {
    const r = state.requests[1];
    const before = r.gramsHigh;
    MODEL.inferenceHighFactor = 9;
    assert.equal(r.gramsHigh, before);
    assert.equal(r.highFactor, 2.7);
    MODEL.inferenceHighFactor = 2.7;
  });
  check('a reader-grid change alone does not move new request pricing', () => {
    MODEL.serverGridGPerKwh = 307;
    MODEL.gridGPerKwh = 50;
    record(1000, 100, { status: 'completed', model: 'claude-sonnet-4-6', stopReason: 'end_turn' });
    const a = state.requests.at(-1).grams;
    MODEL.gridGPerKwh = 900;
    record(1000, 100, { status: 'completed', model: 'claude-sonnet-4-6', stopReason: 'end_turn' });
    near(state.requests.at(-1).grams, a);
  });
  check('missing or unknown status is rejected', () => {
    assert.throws(() => record(1, 1, {}), /valid status/);
    assert.throws(() => record(1, 1, { status: 'done' }), /valid status/);
  });
}

console.log('\nDevice time is closed out before a pricing input changes');
for (const [label, marker] of [
  ['grid', 'function applyGrid() {'],
  ['device', "$('screen').addEventListener('change', e => {"],
  ['theme', 'function applyTheme(next) {'],
]) {
  check(`${label} change syncs the clock before switching`, () => {
    const at = html.indexOf(marker);
    assert.notEqual(at, -1, `${marker} not found`);
    const body = html.slice(at + marker.length, at + marker.length + 400);
    const firstStatement = body.replace(/^\s*(\/\/[^\n]*\n\s*)*/, '');
    assert.match(firstStatement, /^clockSync\(\);/);
  });
}

console.log('\nLong-chat notice');
{
  const REQUEST_STATUS = Object.freeze({ COMPLETED: 'completed', INCOMPLETE: 'incomplete', FAILED: 'failed' });
  const MODEL = { whPerInputToken: 0.00005, whPerOutputToken: 0.0005 };
  const context = vm.createContext({ REQUEST_STATUS, MODEL, Math });
  vm.runInContext(`${extractNamedFunction(html, 'freshChatNudge')}; this.nudge = freshChatNudge;`, context);
  const nudge = context.nudge;
  const rec = (inTok, outTok, status = 'completed') => ({ inTok, outTok, status });
  const first = rec(300, 250);

  check('fires at exactly input = 10 x output on a later completed answer', () => {
    const r = nudge([first, rec(2500, 250)], false);
    assert.deepEqual({ ...r }, { firstIn: 300, lastIn: 2500, ratio: 10 });
  });
  check('does not fire one token below the threshold', () => {
    assert.equal(nudge([first, rec(2499, 250)], false), null);
  });
  check('thinking counts as output: a long reasoning reply pushes the threshold out', () => {
    // 250 visible + 750 thinking = 1000 output tokens: 2500 input is not enough.
    assert.equal(nudge([first, rec(2500, 1000)], false), null);
    assert.ok(nudge([first, rec(10000, 1000)], false));
  });
  check('never on the first completed answer, even with a tiny reply', () => {
    assert.equal(nudge([rec(300, 20)], false), null);
    assert.equal(nudge([rec(300, 20, 'failed'), rec(300, 20)], false), null);
  });
  check('only straight after a completed answer, not after a cut-off one', () => {
    assert.equal(nudge([first, rec(2500, 250), rec(2800, 100, 'incomplete')], false), null);
  });
  check('only once: the caller\'s flag suppresses it', () => {
    assert.equal(nudge([first, rec(2500, 250)], true), null);
  });
  check('first figure comes from the first completed answer, not a failed attempt', () => {
    const r = nudge([rec(0, 0, 'failed'), first, rec(3000, 200)], false);
    assert.equal(r.firstIn, 300);
  });
  check('send() sets the once-per-session flag when it shows the notice', () => {
    assert.match(html, /const nudge = freshChatNudge\(state\.requests, state\.freshChatNudged\);\s+if \(nudge\) \{\s+state\.freshChatNudged = true;/);
  });
  check('records carry raw token counts, thinking included in output', () => {
    const body = extractNamedFunction(html, 'recordRequest');
    assert.match(body, /inTok, outTok, thinkTok,/);
    assert.equal((html.match(/thinkTok: thinkingTokens/g) || []).length, 2);
  });
}

console.log('\nThe latest answer on other models');
{
  const MODEL = { whPerInputToken: 0.00005, whPerOutputToken: 0.0005, pue: 1.12 };
  const MODEL_ENERGY = {
    'claude-haiku-4-5': { factor: 0.52 }, 'claude-sonnet-4-6': { factor: 1.00 },
    'claude-opus-4-8': { factor: 1.33 }, 'gemini-3.5-flash-lite': { factor: 0.85 },
    'gemini-3.8-flash': { factor: 1.36 },
  };
  const constStart = html.indexOf('const COMPARE_MODELS = [');
  const constEnd = html.indexOf('];', constStart) + 2;
  const context = vm.createContext({ MODEL, MODEL_ENERGY, Math });
  vm.runInContext(
    html.slice(constStart, constEnd) + '\n' + extractNamedFunction(html, 'modelComparison') +
    '\nthis.compare = modelComparison;', context);
  const rec = Object.freeze({ inTok: 2000, outTok: 900, thinkTok: 400, model: 'gemini-3.5-flash-lite',
    serverGridGPerKwh: 307, status: 'completed' });
  // Copied into this realm: arrays built inside the vm context have a
  // different Array prototype, which deepStrictEqual rejects.
  const local = (v) => JSON.parse(JSON.stringify(v));
  const rows = local(context.compare(rec));

  check('every offered model has a row, each with its factor', () => {
    assert.deepEqual(rows.map(r => r.id), Object.keys(MODEL_ENERGY));
    for (const r of rows) assert.equal(r.factor, MODEL_ENERGY[r.id].factor);
  });
  check('rows reproduce from factor x frozen tokens, thinking left out, at the frozen server grid', () => {
    for (const r of rows) {
      const wh = (2000 * 0.05 + 500 * 0.5) / 1000 * r.factor * 1.12;
      near(r.wh, wh, 1e-12);
      near(r.grams, wh * 307 / 1000, 1e-12);
    }
  });
  check('the model that answered is marked, by longest prefix of a dated id', () => {
    assert.deepEqual(rows.filter(r => r.answered).map(r => r.id), ['gemini-3.5-flash-lite']);
    const dated = local(context.compare({ ...rec, model: 'claude-haiku-4-5-20251001' }));
    assert.deepEqual(dated.filter(r => r.answered).map(r => r.id), ['claude-haiku-4-5']);
  });
  check('hypothetical only: nothing is written to the request records', () => {
    assert.doesNotMatch(extractNamedFunction(html, 'modelComparison'), /state\.|recordRequest/);
  });
  check('the ledger labels it hypothetical and states the caveats', () => {
    assert.match(html, /id="compareNote" hidden>Hypothetical\./);
    for (const re of [/Thinking tokens are left out/, /understate the gap between small and large/, /count tokens differently/, /Says nothing about which answer would have been better/]) {
      assert.match(html, re);
    }
  });
}

console.log('\nTwo grids: servers for requests, reader for device time');
check('recordRequest prices on MODEL.serverGridGPerKwh', () => {
  const body = extractNamedFunction(html, 'recordRequest');
  assert.match(body, /MODEL\.serverGridGPerKwh/);
  assert.doesNotMatch(body, /MODEL\.gridGPerKwh/);
});
check('clockSync prices device time on the reader grid, MODEL.gridGPerKwh', () => {
  const body = extractNamedFunction(html, 'clockSync');
  assert.match(body, /state\.deviceG\s*\+=\s*wh \* MODEL\.gridGPerKwh/);
  assert.doesNotMatch(body, /serverGridGPerKwh/);
});
check('ledger shows both grids, the server one with its basis caveat', () => {
  assert.match(html, /id="rServerGrid"/);
  assert.match(html, /MODEL\.serverGridGPerKwh \+ ' g\/kWh, basis not stated by source'/);
});

console.log('\nMeter and ledger contract');
check('headline is the running total, which only goes up', () => {
  assert.match(html, /id="meterRead">0\.00<\/span>/);
  assert.match(html, /grams CO₂e so far/);
  assert.match(html, /<span class="meter-hint">including your device<\/span>/);
  assert.match(html, /function paintMeter\(pulse = true\) \{\s+const target = grams\(\);/);
});
check('under the headline: the number of answers; the average is in the ledger', () => {
  assert.match(html, /<span id="meterNote">No answers yet<\/span><span class="meter-cta">Click\/tap above to learn more<\/span>/);
  assert.match(html, /completed === 0 \? 'No answers yet'/);
  assert.match(html, /<td>Average per answer<\/td><td id="rPerExchange">/);
  assert.match(html, /id="rTotal">0\.00 g CO₂e/);
});
check('the range is on the ledger total only; meter and average stay central', () => {
  assert.match(html, /const lo = fmt\(g\), hi = fmt\(gramsHigh\(\)\);/);
  assert.match(html, /\$\('rTotal'\)\.textContent = \(lo === hi \? lo : lo \+ '–' \+ hi\) \+ ' g CO₂e';/);
  assert.match(html, /return n > 0 \? grams\(\) \/ n : null/);
  assert.doesNotMatch(extractNamedFunction(html, 'paintMeter'), /gramsHigh/);
  assert.match(html, /id="rRangeNote">[^<]*not a statistical margin of error/);
});
check('units are never forced to capitals (g would read as G, giga)', () => {
  assert.match(html, /\.meter-unit \{ white-space: normal; text-transform: none; \}/);
});
check('latest model comes from completed frozen records', () => {
  assert.match(html, /find\(r => r\.status === REQUEST_STATUS\.COMPLETED && r\.model\)/);
});
check('completed exchange pulse is conditional on completed status', () => {
  assert.match(html, /repaintAccounting\(status === REQUEST_STATUS\.COMPLETED\)/);
});

console.log('\nMethodology / experience alignment');
check('token coefficients are labeled as Susty assumptions', () => {
  assert.match(html, /Energy per token \(modelled assumption\)/);
  assert.match(methodology, /0\.05 mWh\/token \| Susty modeling assumption/);
  assert.doesNotMatch(html, /2311\.16433/);
});
check('PUE 1.12 is not presented as the Uptime global average', () => {
  assert.match(html, /1\.12 as a hyperscale-data-centre assumption/);
  assert.match(methodology, /not the Uptime Institute global average/);
});
check('device/time language matches the implemented boundary', () => {
  assert.match(html, /Whole-device power and attended time/);
  assert.doesNotMatch(html, /Screen-on time is genuinely measured/);
  assert.match(methodology, /whole end-user device/);
  assert.match(methodology, /estimated attended time/i);
});
check('methodology defines explicit provider completion', () => {
  assert.match(methodology, /explicit normal provider completion/);
  assert.match(methodology, /message_stop/);
  assert.match(methodology, /finishReason = STOP/);
});

console.log('\nGemini finish-reason normalization');
check('STOP -> end_turn', () => assert.equal(normalizeGoogleFinishReason('STOP'), 'end_turn'));
check('MAX_TOKENS -> max_tokens', () => assert.equal(normalizeGoogleFinishReason('MAX_TOKENS'), 'max_tokens'));
check('SAFETY -> google_safety', () => assert.equal(normalizeGoogleFinishReason('SAFETY'), 'google_safety'));
check('missing finish reason stays unknown', () => assert.equal(normalizeGoogleFinishReason(null), null));

async function translatedEvents(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const written = [];
  const res = { write(value) { written.push(value); } };
  await pipeGoogleAsAnthropicSSE({ body }, res, { model: 'gemini-test' });
  return written
    .flatMap((block) => block.split('\n'))
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

async function asyncCheck(label, fn) {
  try {
    await fn();
    console.log(`pass  ${label}`);
  } catch (err) {
    fails++;
    console.log(`FAIL  ${label}`);
    console.log(`      ${err.message}`);
  }
}

const stopChunk = `data: ${JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2 },
})}\n\n`;

await asyncCheck('Gemini STOP emits end_turn and message_stop', async () => {
  const events = await translatedEvents([stopChunk]);
  const delta = events.find((e) => e.type === 'message_delta');
  assert.equal(delta.delta.stop_reason, 'end_turn');
  assert.equal(delta.usage.output_tokens, 6);
  assert.equal(delta.usage.output_tokens_details.thinking_tokens, 2);
  assert.ok(events.some((e) => e.type === 'message_stop'));
});

const maxChunk = `data: ${JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'MAX_TOKENS' }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
})}\n\n`;

await asyncCheck('Gemini MAX_TOKENS emits max_tokens terminal state', async () => {
  const events = await translatedEvents([maxChunk]);
  const delta = events.find((e) => e.type === 'message_delta');
  assert.equal(delta.delta.stop_reason, 'max_tokens');
  assert.ok(events.some((e) => e.type === 'message_stop'));
});

const noFinishChunk = `data: ${JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'hello' }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
})}\n\n`;

await asyncCheck('Gemini missing finishReason does not synthesize message_stop', async () => {
  const events = await translatedEvents([noFinishChunk]);
  const delta = events.find((e) => e.type === 'message_delta');
  assert.deepEqual(delta.delta, {});
  assert.ok(!events.some((e) => e.type === 'message_stop'));
});

await asyncCheck('Gemini terminal event is kept when final SSE line has no newline', async () => {
  const raw = `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
  })}`;
  const events = await translatedEvents([raw]);
  assert.equal(events.find((e) => e.type === 'message_delta')?.delta?.stop_reason, 'end_turn');
  assert.ok(events.some((e) => e.type === 'message_stop'));
});

console.log('\nGemini request');
for (const key of ['gemini-flash', 'gemini-flash-lite']) {
  await asyncCheck(`${key} sends its output cap and thinking level`, async () => {
    const realFetch = globalThis.fetch;
    let sent;
    globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return { ok: true }; };
    try {
      await callGoogle([{ role: 'user', content: 'hi' }], TIERS[key], 'system');
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(sent.generationConfig.maxOutputTokens, TIERS[key].maxTokens);
    assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel, TIERS[key].thinkingLevel);
  });
}

console.log(fails ? `\n${fails} failure(s)` : '\nAll good.');
process.exit(fails ? 1 : 0);
