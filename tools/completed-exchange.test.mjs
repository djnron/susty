#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  normalizeGoogleFinishReason,
  pipeGoogleAsAnthropicSSE,
} from '../api/providers/google.js';

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

console.log('\nMeter and ledger contract');
check('primary meter is per completed exchange and starts undefined', () => {
  assert.match(html, /id="meterRead">—<\/span>/);
  assert.match(html, /g CO₂e \/ completed exchange/);
  assert.match(html, /session average/);
});
check('session total remains visible', () => {
  assert.match(html, /id="meterNote">0\.00 g CO₂e session total · 0 completed exchanges/);
  assert.match(html, /id="rTotal">0\.00 g CO₂e/);
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

console.log(fails ? `\n${fails} failure(s)` : '\nAll good.');
process.exit(fails ? 1 : 0);
