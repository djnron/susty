// Serverless proxy for the Anthropic API.
// Drop-in for Vercel (this file lives at /api/chat.js and needs no config).
// The API key stays here, on the server. It is never sent to the browser.

import { callGoogle, pipeGoogleAsAnthropicSSE } from "./providers/google.js";

export const SYSTEM = `You are Susty, a sustainability advisor. Your job is to find tiny ways to make the world a little less bad — practical, specific, honest.

How you answer:
- Lead with the action, then the number. Attach approximate figures (kg CO2e, kWh, litres, dollars) so people can judge for themselves. Flag when a figure is a rough estimate or varies by country.
- Be honest about magnitude. If something is a rounding error next to the big levers — flying, driving, home heating, diet, and what you buy — say so plainly and name the bigger lever instead.
- Rank your suggestions. Three well-chosen actions beat a list of twelve.
- Never moralise, guilt-trip, or use eco-marketing language. Assume the person is capable and busy.
- Where the answer depends heavily on where someone lives or how they heat their home, ask one short clarifying question rather than guessing.
- Acknowledge trade-offs, including cost and inconvenience. Be direct about when something isn't worth the effort.

Keep replies under about 180 words. Short paragraphs, bullets only when listing options.`;

// Guardrails, because this endpoint is public the moment you deploy it.
export const LIMITS = {
  maxMessages: 40,      // conversation length
  maxChars: 4000,       // per message
  maxTokens: 1000,      // response length
  windowMs: 10 * 60_000,
  perWindow: 25,        // requests per IP per window
};

// Model tiers. The client sends an opaque key and *only* this map turns it into
// a model, so a modified client cannot name an arbitrary model or ask for
// more thinking than a level allows. Same posture as rebuilding the request
// from scratch.
//
// maxTokens depends on the thinking level because thinking tokens count
// against it: thinking on the standard 1000 ceiling would spend the budget
// reasoning and get the answer truncated.
//
// Carbon, from METHODOLOGY §4.4 (factors against the Sonnet 4.6 anchor):
// haiku ×0.52, sonnet ×0.79, opus ×1.34 per token. But thinking is the term
// that matters — Oviedo et al. put a reasoning-length reply at ~13× a
// standard one, so the thinking level can move a reply far more than the
// choice of model.
//
// The 5.5 models do not share one thinking switch (checked against
// Anthropic's model-migration notes, November 2026), so each tier sends what
// its own model needs for as little thinking as it allows — see
// minimalThinking() below. Omitting `thinking` means ON for all three.
//   claude-haiku-5-5   `disabled` is accepted at effort high or below
//   claude-sonnet-5-5  `disabled` is a 400; `between_tools` is its off-mode,
//                      effort high or below, and only this model accepts it
//   claude-opus-5-5    thinking cannot be switched off at any effort; `low`
//                      is the floor, so the plain Opus tier thinks a little
//                      and its ceiling leaves room for that, as Gemini's does
//
// Every tier now carries a `provider`, because `resolveTier` uses it to check
// that provider's key is actually configured before handing the tier out —
// see providerConfigured() below. Both Gemini tiers have factors in
// index.html's MODEL_ENERGY table, derived from EcoLogits' architecture
// estimates the same way as the Claude ones (flash ×0.66, flash-lite ×0.85).
//
// Neither Gemini tier can disable thinking. At `least` each runs at the
// lowest level its model accepts (aistudio.google.com/docs/thinking, checked 2026-11-25):
//   gemini-4-hydrogen      low/medium/high/xhigh, default high, and it
//                          rejects "minimal" with an error, so "low". Google
//                          names it the upgrade from gemini-3.8-flash.
//   gemini-3.5-flash-lite  minimal/low/medium/high, default "minimal". Still
//                          Google's lowest-cost model: there is no Gemini 4
//                          Flash-Lite, and 3.5 Flash-Lite has no shutdown date.
//
// Thinking counts against the output ceiling on every model that always
// thinks: Gemini's maxOutputTokens is "including thought tokens" and a hard
// cutoff, and Anthropic counts thinking toward max_tokens. So those tiers get
// the standard reply ceiling plus the same again as headroom for thinking; a
// cap of 1000 alone could stop a reply mid-thought. The ledger still prices
// every thinking token the provider reports.
const ALWAYS_THINKS_MAX_TOKENS = 2 * LIMITS.maxTokens;

// As little thinking as a given Claude model allows, and the effort to send
// with it. Keyed on the model id, not the tier, because ANTHROPIC_MODEL can
// point the default tier at any model (.env.example used to suggest
// claude-sonnet-4-6), and the models do not share one off-switch:
// `between_tools` exists only on Sonnet 5.5, `disabled` is rejected there and
// on Opus 5.5, and `effort` is rejected by Haiku 4.5. Effort `low` is the
// lowest of the five levels (low, medium, high, xhigh, max), and the level
// Anthropic suggests starting chat at.
export function minimalThinking(model) {
  // Sonnet 5.5: `disabled` returns a 400; `between_tools` is the off-mode.
  if (/^claude-sonnet-5-5/.test(model)) return { thinking: { type: "between_tools" }, effort: "low", thinks: false };
  // Haiku 5.5, Opus 5 and Sonnet 5: on by default, `disabled` accepted at
  // effort high or below. Opus 5 and Sonnet 5 are matched to the end of the
  // id (bare or dated), so neither swallows its 5.5 successor.
  if (/^claude-(haiku-5-5|opus-5(?=$|-\d{8}$)|sonnet-5(?=$|-\d{8}$))/.test(model)) {
    return { thinking: { type: "disabled" }, effort: "low", thinks: false };
  }
  // Opus 5.5 and the Fable/Mythos line: thinking cannot be switched off.
  // Effort `low` keeps it short; omitting `thinking` runs adaptive.
  if (/^claude-(opus-5-5|fable|mythos)/.test(model)) return { effort: "low", thinks: true };
  // The 4.x models: omitting `thinking` means off, and Haiku 4.5 rejects
  // `effort`, so send neither. An unknown newer model also lands here and
  // may think by default; the ledger prices whatever thinking it reports.
  return { thinks: false };
}

// Thinking levels. The reader picks one beside the model. Like the tier, the
// client sends only an opaque name and only this file turns it into request
// settings, so a modified client cannot ask for `max` or a bigger ceiling.
//   least   as little thinking as the model allows (minimalThinking above)
//   low     adaptive thinking at effort `low`  (Gemini: thinkingLevel "low")
//   medium  effort `medium`                    (Gemini: "medium")
//   high    effort `high`                      (Gemini: "high")
// `xhigh` and `max` are left out: on replies asked to stay near 180 words
// they mostly add cost, and they are the dearest on the deployment's key.
export const THINKING_LEVELS = ["least", "low", "medium", "high"];
export const DEFAULT_THINKING = "least";
// Gated by SUSTY_EXPENSIVE_TIERS, which until 2.3.0 gated the separate
// extended-thinking tier that `medium` on Opus replaces.
export const EXPENSIVE_LEVELS = ["medium", "high"];
// Thinking counts against the output ceiling, so the ceiling grows with the
// level. Worst case: `high` on Opus 5.5, 8,000 tokens x $20 per million =
// $0.16 a reply.
export const LEVEL_MAX_TOKENS = { low: 2000, medium: 4000, high: 8000 };

// Claude models that take adaptive thinking with an effort level (Anthropic's
// thinking and effort docs). Haiku 4.5 takes only a token budget and rejects
// `effort`, and an unknown model is not guessed at, so both run at `least`
// whatever is asked for.
const ADAPTIVE_EFFORT = /^claude-(haiku-5-5|sonnet-5|opus-5|opus-4-[678]|sonnet-4-6|fable|mythos)/;

// Each Gemini model's thinkingLevel for each Susty level
// (aistudio.google.com/docs/thinking, checked 2026-11-25). Hydrogen rejects
// "minimal", so its `least` is "low".
const GEMINI_LEVELS = {
  "gemini-3.5-flash-lite": { least: "minimal", low: "low", medium: "medium", high: "high" },
  "gemini-4-hydrogen":     { least: "low",     low: "low", medium: "medium", high: "high" },
};

export function supportsLevel(provider, model, level) {
  if (level === DEFAULT_THINKING) return true;
  if (provider === "google") return Boolean(GEMINI_LEVELS[model]?.[level]);
  return ADAPTIVE_EFFORT.test(model);
}

// What one model sends at one level. Callers check supportsLevel() first.
export function levelSettings(provider, model, level) {
  if (provider === "google") {
    return {
      level,
      thinkingLevel: (GEMINI_LEVELS[model] || {})[level],
      maxTokens: level === DEFAULT_THINKING ? ALWAYS_THINKS_MAX_TOKENS : LEVEL_MAX_TOKENS[level],
    };
  }
  if (level === DEFAULT_THINKING) {
    const m = minimalThinking(model);
    return {
      level,
      maxTokens: m.thinks ? ALWAYS_THINKS_MAX_TOKENS : LIMITS.maxTokens,
      ...(m.thinking && { thinking: m.thinking }),
      ...(m.effort && { effort: m.effort }),
    };
  }
  return { level, thinking: { type: "adaptive" }, effort: level, maxTokens: LEVEL_MAX_TOKENS[level] };
}

export const TIERS = {
  haiku: { provider: "anthropic", model: "claude-haiku-5-5" },
  // ANTHROPIC_MODEL still overrides the default tier, so existing deployments
  // keep working; it deliberately does not override the others. The thinking
  // settings follow whichever model that is.
  sonnet: { provider: "anthropic", model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5" },
  // Opus 5.5 cannot switch thinking off: at `least` it runs at effort `low`
  // with a 2,000 ceiling, and its thinking tokens are priced as output.
  opus: { provider: "anthropic", model: "claude-opus-5-5" },
  "gemini-flash-lite": { provider: "google", model: "gemini-3.5-flash-lite" },
  "gemini-flash": { provider: "google", model: "gemini-4-hydrogen" },
};
export const DEFAULT_TIER = "sonnet";
// Keys a page loaded before 2.3.0 may still send, or a visitor may have saved:
// the extended-thinking tier is now Opus at `medium`. Gated, it runs as Opus
// at `least` (before 2.3.0 it fell back to the default tier).
export const TIER_ALIASES = { "opus-thinking": { tier: "opus", level: "medium" } };

// Two off switches, both default-on so nothing has to be set to work:
//   SUSTY_TIERS=off            collapses every request to the default tier
//                              at the least thinking
//   SUSTY_EXPENSIVE_TIERS=off  drops the `medium` and `high` thinking levels
// Either way the client is not trusted: an unknown, disabled or expensive-but-
// disabled choice silently resolves to the default rather than erroring, the
// response says which level ran (X-Susty-Thinking), and the ledger reports
// whichever model actually answered.
export const TIERS_ENABLED = process.env.SUSTY_TIERS !== "off";
export const EXPENSIVE_TIERS_ENABLED = process.env.SUSTY_EXPENSIVE_TIERS !== "off";

// Anthropic is required and checked once, at the top of handler()/server.js,
// before resolveTier is ever consulted — this is not the place to re-litigate
// that, and re-checking it here made every Anthropic tier fall back in any
// process that has not itself set ANTHROPIC_API_KEY (tools/tiers.test.mjs,
// notably). Every other provider is optional, gated here instead: a tier
// for one resolves to the default rather than erroring when its key isn't
// set — the same graceful-fallback posture as the expensive-level gate below.
function providerConfigured(provider) {
  if (provider === "anthropic") return true;
  if (provider === "google") return Boolean(process.env.GOOGLE_GEMINI_API_KEY);
  return false;
}

// The tier and thinking level a request actually gets. A tier that cannot be
// used falls back to the default tier at the least thinking; a level that is
// unknown, gated or unsupported by the model falls back to `least` on the
// tier asked for.
export function resolveTier(key, level) {
  if (typeof key === "string" && Object.hasOwn(TIER_ALIASES, key)) {
    if (level === undefined) level = TIER_ALIASES[key].level;
    key = TIER_ALIASES[key].tier;
  }
  const build = (k, lv) => ({ key: k, ...TIERS[k], ...levelSettings(TIERS[k].provider, TIERS[k].model, lv) });
  const fallback = build(DEFAULT_TIER, DEFAULT_THINKING);
  if (!TIERS_ENABLED) return fallback;
  // Object.hasOwn, not a bare lookup: TIERS["__proto__"] and
  // TIERS["constructor"] resolve to inherited Object.prototype members, which
  // are truthy, so a crafted key slipped past a `!tier` guard and built a
  // request with model: undefined. Found by tools/tiers.test.mjs.
  if (typeof key !== "string" || !Object.hasOwn(TIERS, key)) return fallback;
  const tier = TIERS[key];
  if (!providerConfigured(tier.provider)) return fallback;
  let lv = typeof level === "string" && THINKING_LEVELS.includes(level) ? level : DEFAULT_THINKING;
  if (EXPENSIVE_LEVELS.includes(lv) && !EXPENSIVE_TIERS_ENABLED) lv = DEFAULT_THINKING;
  if (!supportsLevel(tier.provider, tier.model, lv)) lv = DEFAULT_THINKING;
  return build(key, lv);
}

const hits = new Map(); // in-memory, so it resets on cold start — see README

export function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < LIMITS.windowMs);
  // Check before recording. Counting rejected attempts kept pushing the window
  // forward, so a client at the limit could never recover except by going
  // fully idle for the whole window.
  if (recent.length >= LIMITS.perWindow) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Evict the oldest slice rather than clearing the map, which would hand every
  // tracked IP a fresh quota the moment the 5000th one showed up.
  if (hits.size > 5000) {
    for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k);
  }
  return false;
}

// Accept only what we intend to forward. Never pass the client's body through whole.
export function clean(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const trimmed = messages.slice(-LIMITS.maxMessages);
  // A completed history is even-length, so an odd-length window can open on an
  // assistant turn. The Messages API rejects that outright, and because the
  // history only grows, every later send would fail too — the chat would brick
  // itself permanently at 20 exchanges. Drop leading non-user turns.
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  if (trimmed.length === 0) return null;
  const out = [];
  for (const m of trimmed) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string" || !m.content.trim()) return null;
    out.push({ role: m.role, content: m.content.slice(0, LIMITS.maxChars) });
  }
  if (out[out.length - 1].role !== "user") return null;
  return out;
}

// `tier` is what resolveTier() returned, level settings included.
export async function callAnthropic(messages, tier) {
  const body = {
    model: tier.model,
    max_tokens: tier.maxTokens,
    system: SYSTEM,
    messages,
    stream: true,
  };
  // Independent: Opus 5.5 sends effort with no `thinking` field, and the 4.x
  // default (if ANTHROPIC_MODEL points at one) sends neither.
  if (tier.thinking) body.thinking = tier.thinking;
  if (tier.effort) body.output_config = { effort: tier.effort };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  return res;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Send a POST request." });
  }
  // Anthropic is the one required provider — susty has always needed this
  // key, and the default tier is always Anthropic. Every other provider is
  // optional and gated inside resolveTier() instead, which falls back rather
  // than erroring when its key is missing.
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Wait a few minutes." });
  }

  const messages = clean(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: "The conversation was malformed." });
  }

  const tier = resolveTier(req.body?.tier, req.body?.thinking);

  try {
    if (tier.provider === "google") {
      const upstream = await callGoogle(messages, tier, SYSTEM);

      if (!upstream.ok) {
        const data = await upstream.json().catch(() => ({}));
        console.error("Gemini error", upstream.status, data);
        return res
          .status(upstream.status)
          .json({ error: data?.error?.message || "The model provider rejected the request." });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Susty-Thinking", tier.level);
      res.flushHeaders();

      await pipeGoogleAsAnthropicSSE(upstream, res, tier);
      return res.end();
    }

    const upstream = await callAnthropic(messages, tier);

    if (!upstream.ok) {
      const data = await upstream.json().catch(() => ({}));
      console.error("Anthropic error", upstream.status, data);
      return res
        .status(upstream.status)
        .json({ error: data?.error?.message || "The model provider rejected the request." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Susty-Thinking", tier.level);
    res.flushHeaders();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      return res.status(502).json({ error: "Could not reach the model provider." });
    }
    res.end();
  }
}
