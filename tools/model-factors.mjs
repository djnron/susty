#!/usr/bin/env node
// Model factors (METHODOLOGY 4.4) from committed data only, so every factor
// in index.html's MODEL_ENERGY can be re-derived rather than typed in:
//
//   architecture   EcoLogits model registry, refreshed 19 November 2026
//                  (data/ecologits-2026-11-19-models.csv; provenance in data/README.md)
//   energy         EcoLogits' GPU energy function, fitted to the ML.ENERGY
//                  leaderboard (ecologits/impacts/llm.py, unchanged in 0.11.3)
//
// Susty's factor uses only the per-GPU term, at batch 32 and the midpoint of
// EcoLogits' active-parameter range, relative to the Sonnet 4.6 anchor. The
// full model below (GPU count, server, provider PUE, batch 64) is printed for
// METHODOLOGY 4.4's comparison table only; it does not price anything.
//
//   node tools/model-factors.mjs           # print both tables
//   node tools/model-factors.mjs --check   # exit 1 if MODEL_ENERGY disagrees with the data
import { readFileSync } from 'node:fs';
import { readCsv } from './water-factors.mjs';

// EcoLogits 0.11.3, ecologits/impacts/llm.py.
export const GPU_ENERGY = { alpha: 1.1665273170451914e-06, beta: -0.011205921025579175, gamma: 4.052928146734005e-05 };
const LATENCY = { alpha: 0.0006785088094353663, beta: 0.0003119310311688259, gamma: 0.019473717579473387 };
const GPU_MEMORY_GB = 80, SERVER_GPUS = 8, SERVER_KW = 1.2, ECOLOGITS_BATCH = 64, QUANT_BITS = 16;
// EcoLogits' provider configuration (ecologits/tracers/utils.py).
const PROVIDER_PUE = { anthropic: [1.09, 1.14], google_genai: [1.09, 1.09] };

export const SUSTY_BATCH = 32;
export const ANCHOR = 'claude-sonnet-4-6';
export const DATA_FILE = 'data/ecologits-2026-11-19-models.csv';

// Susty's ids are the prefixes the API answers with; EcoLogits keys Haiku 4.5
// by its dated id.
export const REGISTRY_NAME = { 'claude-haiku-4-5': 'claude-haiku-4-5-20251001' };

/** Wh per output token on one GPU. */
export const gpuWhPerToken = (pActive, batch) =>
  GPU_ENERGY.alpha * Math.exp(GPU_ENERGY.beta * batch) * pActive + GPU_ENERGY.gamma;

export function registry() {
  return Object.fromEntries(readCsv(DATA_FILE).map((r) => [r.name, {
    ...r,
    total: r.total_b === '' ? null : Number(r.total_b),
    lo: Number(r.active_min_b), hi: Number(r.active_max_b),
    tps: r.tps === '' ? null : Number(r.tps), ttft: r.ttft_s === '' ? 0 : Number(r.ttft_s),
  }]));
}

export const midpoint = (m) => (m.lo + m.hi) / 2;

/** Every Susty factor, unrounded, keyed by Susty model id. */
export function factors(ids, reg = registry()) {
  const anchor = gpuWhPerToken(midpoint(reg[ANCHOR]), SUSTY_BATCH);
  return Object.fromEntries(ids.map((id) => {
    const m = reg[REGISTRY_NAME[id] || id];
    if (!m) throw new Error(`${id} is not in ${DATA_FILE}`);
    return [id, gpuWhPerToken(midpoint(m), SUSTY_BATCH) / anchor];
  }));
}

// EcoLogits' full model for one request, in Wh, at one end of the active range.
function fullRequestWh(m, outTokens, pActive, pue) {
  const total = m.architecture === 'moe' ? m.total : pActive;
  const need = Math.ceil(1.2 * total * QUANT_BITS / 8 / GPU_MEMORY_GB);
  const gpus = 2 ** Math.ceil(Math.log2(need));
  const perToken = m.tps ? 1 / m.tps : LATENCY.alpha * pActive + LATENCY.beta * ECOLOGITS_BATCH + LATENCY.gamma;
  const latency = outTokens * perToken + m.ttft;
  const serverWh = latency / 3600 * SERVER_KW * 1000 * (gpus / SERVER_GPUS) / ECOLOGITS_BATCH;
  return { wh: pue * (serverWh + gpus * outTokens * gpuWhPerToken(pActive, ECOLOGITS_BATCH)), gpus };
}

/** mWh per output token for a reply of `outTokens`, and the GPUs EcoLogits sizes for it, at
 *  the low and high end of its active-parameter range (a dense model's GPU count follows the
 *  range; an MoE model's follows its fixed total). */
export function fullModel(name, outTokens = 300, reg = registry()) {
  const m = reg[REGISTRY_NAME[name] || name];
  const [pueLo, pueHi] = PROVIDER_PUE[m.provider];
  const lo = fullRequestWh(m, outTokens, m.lo, pueLo), hi = fullRequestWh(m, outTokens, m.hi, pueHi);
  return { gpusLo: lo.gpus, gpusHi: hi.gpus, lo: lo.wh / outTokens * 1000, hi: hi.wh / outTokens * 1000 };
}

// Pull `const MODEL_ENERGY = { ... };` out of index.html and evaluate it.
export function modelEnergyFromHtml() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('const MODEL_ENERGY = {');
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return Function(`return (${html.slice(open, i + 1)});`)();
  }
  throw new Error('MODEL_ENERGY not found in index.html');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const table = modelEnergyFromHtml();
  const derived = factors(Object.keys(table));
  let stale = 0;
  console.log(`Susty factors: per-GPU term, batch ${SUSTY_BATCH}, midpoint active params, against ${ANCHOR}`);
  for (const [id, f] of Object.entries(derived)) {
    const m = registry()[REGISTRY_NAME[id] || id];
    const ok = table[id].factor === Math.round(f * 100) / 100;
    if (!ok) stale++;
    console.log(`${ok ? 'ok   ' : 'STALE'} ${id.padEnd(22)} ${String(midpoint(m)).padStart(7)}B active  ${f.toFixed(3)} -> ${table[id].factor.toFixed(2)}`);
  }
  console.log('\nEcoLogits full model, 300-token reply, mWh per output token (comparison only)');
  for (const id of Object.keys(table)) {
    const r = fullModel(id);
    const gpus = r.gpusLo === r.gpusHi ? String(r.gpusLo) : `${r.gpusLo}-${r.gpusHi}`;
    console.log(`      ${id.padEnd(22)} ${gpus.padStart(5)} GPUs  ${r.lo.toFixed(2)}-${r.hi.toFixed(2)}`);
  }
  if (process.argv.includes('--check') && stale) {
    console.error(`\n${stale} factor(s) disagree with ${DATA_FILE}`);
    process.exit(1);
  }
}
