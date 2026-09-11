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
}

console.log(fails ? `\n${fails} failure(s)` : "\nAll good.");
process.exit(fails ? 1 : 0);
