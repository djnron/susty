#!/usr/bin/env node
// Tests the model-tier mapping in api/chat.js by importing the real module,
// not a copy of its tables.
//
//   node tools/tiers.test.mjs                          # default: all tiers on
//   SUSTY_EXPENSIVE_TIERS=off node tools/tiers.test.mjs # thinking tier gated
//   SUSTY_TIERS=off node tools/tiers.test.mjs           # everything collapsed
//
// The flags are read at module load, so each mode needs its own process. All
// three run from `sh tools/test.sh`.

import { TIERS, DEFAULT_TIER, TIERS_ENABLED, EXPENSIVE_TIERS_ENABLED, resolveTier }
  from "../api/chat.js";

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
check("default tier does not think", !resolveTier(DEFAULT_TIER).thinking);

if (!TIERS_ENABLED) {
  // Everything collapses, including the cheap tiers.
  for (const key of Object.keys(TIERS)) {
    check(`${key} collapses to ${DEFAULT_TIER}`, resolveTier(key).key === DEFAULT_TIER);
  }
} else {
  check("haiku maps to claude-haiku-4-5", resolveTier("haiku").model === "claude-haiku-4-5");
  check("opus maps to claude-opus-4-8", resolveTier("opus").model === "claude-opus-4-8");
  check("opus does NOT think (omitting it means off on 4.8)", !resolveTier("opus").thinking);

  const t = resolveTier("opus-thinking");
  if (EXPENSIVE_TIERS_ENABLED) {
    check("opus-thinking is available", t.key === "opus-thinking");
    check("opus-thinking uses adaptive thinking", t.thinking?.type === "adaptive");
    // budget_tokens is removed from 4.7 onward and returns a 400.
    check("opus-thinking sends no budget_tokens", t.thinking?.budget_tokens === undefined);
    check("opus-thinking sets an effort level", typeof t.effort === "string");
    // Thinking tokens count against max_tokens, so the standard ceiling would
    // spend the budget reasoning and truncate the answer.
    check("opus-thinking raises max_tokens above the default",
      t.maxTokens > resolveTier(DEFAULT_TIER).maxTokens);
  } else {
    check("opus-thinking is gated to the default tier", t.key === DEFAULT_TIER);
    check("...and carries no thinking config", !t.thinking);
  }

  // Cheap tiers must stay available when only the expensive one is gated.
  check("haiku unaffected by the expensive gate", resolveTier("haiku").key === "haiku");

  // Google is optional: a Gemini tier must fall back exactly like an
  // unconfigured expensive tier does, never error, and never reach the
  // network with no key to send.
  delete process.env.GOOGLE_GEMINI_API_KEY;
  check("gemini-flash falls back with no Google key configured",
    resolveTier("gemini-flash").key === DEFAULT_TIER);
  check("gemini-flash-lite falls back with no Google key configured",
    resolveTier("gemini-flash-lite").key === DEFAULT_TIER);

  process.env.GOOGLE_GEMINI_API_KEY = "test-key";
  const gf = resolveTier("gemini-flash");
  check("gemini-flash resolves once Google is configured", gf.key === "gemini-flash");
  check("gemini-flash maps to gemini-3.8-flash", gf.model === "gemini-3.8-flash");
  check("gemini-flash is tagged provider google", gf.provider === "google");
  // Verified against ai.google.dev/gemini-api/docs/generate-content/thinking:
  // Gemini 3 Flash/Flash-Lite cannot fully disable thinking, so unlike the
  // Anthropic tiers this can never omit the field entirely.
  check("gemini-flash cannot go to true thinking-off", gf.thinkingLevel === "low");
  check("gemini-flash-lite maps to gemini-3.5-flash-lite",
    resolveTier("gemini-flash-lite").model === "gemini-3.5-flash-lite");

  // Anthropic tiers must be unaffected by Google's key either way.
  check("haiku still resolves with Google configured", resolveTier("haiku").key === "haiku");
  delete process.env.GOOGLE_GEMINI_API_KEY;
}

console.log(fails ? `\n${fails} failure(s)` : "\nAll good.");
process.exit(fails ? 1 : 0);
