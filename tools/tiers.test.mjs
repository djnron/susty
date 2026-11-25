#!/usr/bin/env node
// Tests the model-tier and thinking-level mapping in api/chat.js by importing
// the real module, not a copy of its tables.
//
//   node tools/tiers.test.mjs                          # default: all on
//   SUSTY_EXPENSIVE_TIERS=off node tools/tiers.test.mjs # medium/high gated
//   SUSTY_TIERS=off node tools/tiers.test.mjs           # everything collapsed
//   ANTHROPIC_MODEL=claude-sonnet-4-6 node tools/tiers.test.mjs  # an existing override
//
// The flags are read at module load, so each mode needs its own process. All
// of them run from `sh tools/test.sh`.

import { TIERS, DEFAULT_TIER, TIERS_ENABLED, EXPENSIVE_TIERS_ENABLED, resolveTier, minimalThinking, callAnthropic, LIMITS,
         THINKING_LEVELS, DEFAULT_THINKING, LEVEL_MAX_TOKENS, supportsLevel }
  from "../api/chat.js";
import { callGoogle } from "../api/providers/google.js";

let fails = 0;
const check = (label, cond) => {
  if (!cond) fails++;
  console.log(`${cond ? "pass" : "FAIL"}  ${label}`);
};
const mode = !TIERS_ENABLED ? "SUSTY_TIERS=off"
  : !EXPENSIVE_TIERS_ENABLED ? "SUSTY_EXPENSIVE_TIERS=off"
  : "all tiers enabled";
console.log(`mode: ${mode}\n`);

// The client is never trusted: anything unrecognised resolves to the default
// rather than erroring or reaching the API with a client-supplied model.
for (const bad of ["not-a-tier", "", null, undefined, 42, {}, "__proto__", "constructor"]) {
  const r = resolveTier(bad);
  check(`junk tier ${JSON.stringify(bad)} falls back to ${DEFAULT_TIER}`, r.key === DEFAULT_TIER);
}

check(`default tier is ${DEFAULT_TIER}`, DEFAULT_TIER === "sonnet");
// On Sonnet 5.5 omitting `thinking` means ON and `disabled` is a 400, so "does
// not think" means sending its off-mode, between_tools, at effort high or below.
const def = resolveTier(DEFAULT_TIER);
if (!process.env.ANTHROPIC_MODEL) {
  check("default tier is claude-sonnet-5-5", def.model === "claude-sonnet-5-5");
  check("default tier does not think: between_tools, no other thinking field",
    JSON.stringify(def.thinking) === JSON.stringify({ type: "between_tools" }));
  check("default tier's effort is one between_tools accepts", ["low", "medium", "high"].includes(def.effort));
  check("default tier keeps the standard reply ceiling", def.maxTokens === 1000);
} else {
  // An existing deployment's override (.env.example once suggested
  // claude-sonnet-4-6): the default tier must send that model's own settings,
  // or every default request would be a 400.
  const want = minimalThinking(process.env.ANTHROPIC_MODEL);
  check(`ANTHROPIC_MODEL=${process.env.ANTHROPIC_MODEL} drives the default tier`, def.model === process.env.ANTHROPIC_MODEL);
  check("...with that model's thinking settings",
    JSON.stringify(def.thinking) === JSON.stringify(want.thinking) && def.effort === want.effort);
  check("...and headroom only if that model still thinks",
    def.maxTokens === (want.thinks ? 2000 : 1000));
}

// Thinking settings follow the model, not the tier, because ANTHROPIC_MODEL
// can point the default tier anywhere and each model's off-switch is a 400 on
// some other model (Anthropic model-migration notes, checked 2026-11-25).
{
  const m = minimalThinking;
  check("Sonnet 5.5: between_tools", m("claude-sonnet-5-5").thinking?.type === "between_tools");
  check("Haiku 5.5: disabled", m("claude-haiku-5-5").thinking?.type === "disabled");
  check("Opus 5 and Sonnet 5: disabled", m("claude-opus-5").thinking?.type === "disabled" &&
    m("claude-sonnet-5").thinking?.type === "disabled");
  check("Opus 5.5: no thinking field (cannot be disabled), effort low, marked as thinking",
    m("claude-opus-5-5").thinking === undefined && m("claude-opus-5-5").effort === "low" && m("claude-opus-5-5").thinks);
  check("Fable 5.2: no thinking field, effort low", m("claude-fable-5-2").thinking === undefined && m("claude-fable-5-2").effort === "low");
  // Dated ids: Opus 5 and Sonnet 5 are matched to the end of the id, so a
  // dated id still gets `disabled` and neither swallows its 5.5 successor.
  check("dated Opus 5 / Sonnet 5 ids still get disabled",
    m("claude-opus-5-20260301").thinking?.type === "disabled" && m("claude-sonnet-5-20260601").thinking?.type === "disabled");
  check("a dated 5.5 id keeps its own setting",
    m("claude-sonnet-5-5-20261101").thinking?.type === "between_tools" && m("claude-opus-5-5-20261101").thinking === undefined);
  for (const old of ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-opus-4-8"]) {
    // Omitting `thinking` means off on 4.x, and Haiku 4.5 rejects `effort`.
    const r = m(old);
    check(`${old}: sends neither thinking nor effort`, r.thinking === undefined && r.effort === undefined && !r.thinks);
  }
  // `between_tools` on any model but Sonnet 5.5 is a 400; `disabled` on
  // Sonnet 5.5 or Opus 5.5 is a 400.
  const all = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5",
               "claude-fable-5-2", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-8"];
  check("between_tools is sent only to Sonnet 5.5",
    all.filter((id) => m(id).thinking?.type === "between_tools").join() === "claude-sonnet-5-5");
  check("disabled is never sent to Sonnet 5.5, Opus 5.5 or Fable",
    ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"].every((id) => m(id).thinking?.type !== "disabled"));
}

check(`levels are least, low, medium, high, starting at ${DEFAULT_THINKING}`,
  THINKING_LEVELS.join() === "least,low,medium,high" && DEFAULT_THINKING === "least");
// Which models take a level above least, independent of the environment.
check("Haiku 4.5 (budget only, rejects effort) and unknown models run only at least",
  !supportsLevel("anthropic", "claude-haiku-4-5", "low") && !supportsLevel("anthropic", "claude-something-new", "medium"));
check("every offered Claude model and the 4.6+ models take low/medium/high",
  ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-4-6", "claude-opus-4-8", "claude-fable-5-2"]
    .every((m) => ["low", "medium", "high"].every((lv) => supportsLevel("anthropic", m, lv))));

if (!TIERS_ENABLED) {
  // Everything collapses, including the cheap tiers and every level.
  for (const key of [...Object.keys(TIERS), "opus-thinking"]) {
    for (const lv of THINKING_LEVELS) {
      const r = resolveTier(key, lv);
      check(`${key} at ${lv} collapses to ${DEFAULT_TIER} at least`, r.key === DEFAULT_TIER && r.level === "least");
    }
  }
} else {
  const h = resolveTier("haiku");
  check("haiku maps to claude-haiku-5-5", h.model === "claude-haiku-5-5");
  // Omitting `thinking` means ON on Haiku 5.5; `disabled` is accepted at
  // effort high or below.
  check("haiku at least disables thinking explicitly, at an effort that allows it",
    h.level === "least" && h.thinking?.type === "disabled" && ["low", "medium", "high"].includes(h.effort));
  const o = resolveTier("opus");
  check("opus maps to claude-opus-5-5", o.model === "claude-opus-5-5");
  // Opus 5.5 cannot switch thinking off: `disabled` is a 400 at every effort.
  check("opus at least sends no thinking field (Opus 5.5 cannot disable it)", o.thinking === undefined);
  check("opus at least runs at effort low, the floor", o.effort === "low");
  check("opus at least leaves headroom for the thinking it cannot switch off", o.maxTokens > h.maxTokens);

  // The client is never trusted with the level either.
  for (const bad of ["max", "xhigh", "", null, 42, {}, "__proto__", "constructor", "LEAST"]) {
    check(`junk level ${JSON.stringify(bad)} runs at least`, resolveTier("opus", bad).level === "least");
  }
  check("no level asked for runs at least", resolveTier("opus").level === "least");

  // The expensive gate: medium and high cost real money on the deployment's
  // key; gated, they run at least on the tier asked for.
  for (const lv of ["medium", "high"]) {
    const r = resolveTier("opus", lv);
    if (EXPENSIVE_TIERS_ENABLED) check(`opus at ${lv} runs at ${lv}`, r.key === "opus" && r.level === lv);
    else check(`opus at ${lv} is gated to opus at least`, r.key === "opus" && r.level === "least" && r.effort === "low");
  }
  for (const lv of ["least", "low"]) {
    check(`haiku at ${lv} is unaffected by the expensive gate`, resolveTier("haiku", lv).level === lv);
  }
  // The retired extended-thinking tier is Opus at medium, gated as before.
  const alias = resolveTier("opus-thinking");
  if (EXPENSIVE_TIERS_ENABLED) {
    check("opus-thinking (pre-2.3.0) resolves to opus at medium, adaptive, 4,000",
      alias.key === "opus" && alias.level === "medium" && alias.thinking?.type === "adaptive" && alias.effort === "medium" && alias.maxTokens === 4000);
  } else {
    check("opus-thinking (pre-2.3.0) is gated to opus at least", alias.key === "opus" && alias.level === "least");
  }
  // Thinking counts against the ceiling, so it grows with the level.
  check("ceilings grow with the level: 2,000 / 4,000 / 8,000",
    LEVEL_MAX_TOKENS.low === 2000 && LEVEL_MAX_TOKENS.medium === 4000 && LEVEL_MAX_TOKENS.high === 8000);

  // Google is optional: a Gemini tier must fall back exactly like an
  // unconfigured tier does, never error, and never reach the network with no
  // key to send.
  delete process.env.GOOGLE_GEMINI_API_KEY;
  check("gemini-flash falls back with no Google key configured",
    resolveTier("gemini-flash").key === DEFAULT_TIER);
  check("gemini-flash-lite falls back with no Google key configured",
    resolveTier("gemini-flash-lite", "high").key === DEFAULT_TIER);

  process.env.GOOGLE_GEMINI_API_KEY = "test-key";
  const gf = resolveTier("gemini-flash");
  check("gemini-flash resolves once Google is configured", gf.key === "gemini-flash");
  check("gemini-flash maps to gemini-4-hydrogen", gf.model === "gemini-4-hydrogen");
  check("gemini-flash is tagged provider google", gf.provider === "google");
  // aistudio.google.com/docs/thinking, checked 2026-11-25: Gemini 4 cannot
  // disable thinking, Hydrogen defaults to "high" and rejects "minimal" with
  // an error, so "low" is its floor.
  check("gemini-flash at least sends Hydrogen's floor, low (minimal is an error)", gf.thinkingLevel === "low");
  check("gemini-flash-lite maps to gemini-3.5-flash-lite",
    resolveTier("gemini-flash-lite").model === "gemini-3.5-flash-lite");
  // Flash-Lite accepts "minimal", its own default and the lowest it offers.
  check("gemini-flash-lite at least thinks at minimal, its floor",
    resolveTier("gemini-flash-lite").thinkingLevel === "minimal");
  check("no level ever sends minimal to Hydrogen",
    THINKING_LEVELS.every((lv) => resolveTier("gemini-flash", lv).thinkingLevel !== "minimal"));
  // Gemini counts thinking against maxOutputTokens, so the cap leaves room
  // for it beyond the standard reply ceiling rather than being left off.
  for (const k of ["gemini-flash", "gemini-flash-lite"]) {
    const t = resolveTier(k);
    check(`${k} carries an output cap with thinking headroom`,
      Number.isInteger(t.maxTokens) && t.maxTokens > LIMITS.maxTokens);
  }

  // Anthropic tiers must be unaffected by Google's key either way.
  check("haiku still resolves with Google configured", resolveTier("haiku").key === "haiku");
  delete process.env.GOOGLE_GEMINI_API_KEY;

  if (process.env.ANTHROPIC_MODEL) {
    const m = process.env.ANTHROPIC_MODEL;
    const r = resolveTier("sonnet", "low");
    const want = { "claude-sonnet-4-6": "low", "claude-opus-5-5": "low", "claude-haiku-4-5": "least" }[m];
    if (want) check(`ANTHROPIC_MODEL=${m}: low runs at ${want}`, r.level === want);
  }
}

// The JSON each tier actually sends at each level, in the default deployment.
// Literal expectations, not derived from the code under test: a request the
// API rejects would otherwise ship silently.
if (TIERS_ENABLED && EXPENSIVE_TIERS_ENABLED && !process.env.ANTHROPIC_MODEL) {
  const adaptive = { type: "adaptive" };
  const claude = {
    haiku: { model: "claude-haiku-5-5", least: [1000, { type: "disabled" }, "low"] },
    sonnet: { model: "claude-sonnet-5-5", least: [1000, { type: "between_tools" }, "low"] },
    opus: { model: "claude-opus-5-5", least: [2000, undefined, "low"] },
  };
  const above = { low: [2000, adaptive, "low"], medium: [4000, adaptive, "medium"], high: [8000, adaptive, "high"] };
  const realFetch = globalThis.fetch;
  try {
    for (const [key, w] of Object.entries(claude)) {
      for (const [lv, [max, thinking, effort]] of Object.entries({ least: w.least, ...above })) {
        let body;
        globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return { ok: true }; };
        await callAnthropic([{ role: "user", content: "hi" }], resolveTier(key, lv));
        check(`${key} at ${lv} sends ${w.model}, max_tokens ${max}, thinking ${JSON.stringify(thinking) ?? "omitted"}, effort ${effort}`,
          body.model === w.model && body.max_tokens === max &&
          JSON.stringify(body.thinking) === JSON.stringify(thinking) &&
          body.output_config?.effort === effort && Object.keys(body.output_config).length === 1 &&
          !("temperature" in body) && body.thinking?.budget_tokens === undefined);
      }
    }
    process.env.GOOGLE_GEMINI_API_KEY = "test-key";
    const gemini = {
      "gemini-flash-lite": { model: "gemini-3.5-flash-lite", least: [2000, "minimal"], low: [2000, "low"], medium: [4000, "medium"], high: [8000, "high"] },
      "gemini-flash":      { model: "gemini-4-hydrogen",     least: [2000, "low"],     low: [2000, "low"], medium: [4000, "medium"], high: [8000, "high"] },
    };
    for (const [key, w] of Object.entries(gemini)) {
      for (const lv of THINKING_LEVELS) {
        let url, body;
        globalThis.fetch = async (u, init) => { url = u; body = JSON.parse(init.body); return { ok: true }; };
        await callGoogle([{ role: "user", content: "hi" }], resolveTier(key, lv), "system");
        const [max, level] = w[lv];
        check(`${key} at ${lv} sends ${w.model}, maxOutputTokens ${max}, thinkingLevel ${level}`,
          url.includes(`/models/${w.model}:streamGenerateContent`) && body.generationConfig.maxOutputTokens === max &&
          body.generationConfig.thinkingConfig.thinkingLevel === level);
      }
    }
    delete process.env.GOOGLE_GEMINI_API_KEY;
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(fails ? `\n${fails} failure(s)` : "\nAll good.");
process.exit(fails ? 1 : 0);
