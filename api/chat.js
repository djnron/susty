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
// a model, so a modified client cannot name an arbitrary model or switch
// extended thinking on. Same posture as rebuilding the request from scratch.
//
// maxTokens is per tier because thinking tokens count against it: a thinking
// tier on the standard 1000 ceiling would spend its budget reasoning and get
// the answer truncated.
//
// Carbon, from METHODOLOGY §4.4 (factors against the Sonnet 4.6 anchor):
// haiku ×0.52, sonnet ×0.79, opus ×1.34 per token. But thinking is the term
// that matters — Oviedo et al. put a reasoning-length reply at ~13× a
// standard one, so `opus-thinking` is roughly an order of magnitude, not a
// half more.
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
// Neither Gemini tier can disable thinking. Each runs at the lowest level
// its model accepts (aistudio.google.com/docs/thinking, checked 2026-11-25):
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

// A Claude tier that asks `model` for as little thinking as it allows, with
// headroom in the ceiling when that still means some thinking.
function minimalTier(model) {
  const m = minimalThinking(model);
  return {
    provider: "anthropic",
    model,
    maxTokens: m.thinks ? ALWAYS_THINKS_MAX_TOKENS : LIMITS.maxTokens,
    ...(m.thinking && { thinking: m.thinking }),
    ...(m.effort && { effort: m.effort }),
  };
}

export const TIERS = {
  haiku: minimalTier("claude-haiku-5-5"),
  // ANTHROPIC_MODEL still overrides the default tier, so existing deployments
  // keep working; it deliberately does not override the others. The thinking
  // settings follow whichever model that is.
  sonnet: minimalTier(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"),
  // Opus 5.5 cannot switch thinking off: omitting `thinking` runs adaptive,
  // and `disabled` is a 400 at every effort. It runs at `low`, with a 2,000
  // ceiling, and its thinking tokens are measured and priced as output, as
  // Gemini's are. Not gated by SUSTY_EXPENSIVE_TIERS: at most 2,000 output
  // tokens at Opus 5.5's $20 per million is 1.6x what the Opus 4.8 tier could
  // spend (1,000 at $25), not the several-fold of the extended-thinking tier.
  opus: minimalTier("claude-opus-5-5"),
  "opus-thinking": {
    provider: "anthropic",
    model: "claude-opus-5-5",
    maxTokens: 4000,
    // Adaptive is the only on-mode from 4.7 onward — `budget_tokens` is
    // removed and returns a 400. `medium` is Opus 5.5's own default effort;
    // `low` is now what the plain Opus tier runs at.
    thinking: { type: "adaptive" },
    effort: "medium",
    expensive: true,
  },
  "gemini-flash-lite": {
    provider: "google",
    model: "gemini-3.5-flash-lite",
    thinkingLevel: "minimal",
    maxTokens: ALWAYS_THINKS_MAX_TOKENS,
  },
  "gemini-flash": {
    provider: "google",
    model: "gemini-4-hydrogen",
    thinkingLevel: "low",
    maxTokens: ALWAYS_THINKS_MAX_TOKENS,
  },
};
export const DEFAULT_TIER = "sonnet";

// Two off switches, both default-on so nothing has to be set to work:
//   SUSTY_TIERS=off            collapses every request to the default tier
//   SUSTY_EXPENSIVE_TIERS=off  keeps the thinking tier off the menu
// Either way the client is not trusted: an unknown, disabled or expensive-but-
// disabled key silently resolves to the default rather than erroring, and the
// ledger reports whichever model actually answered.
export const TIERS_ENABLED = process.env.SUSTY_TIERS !== "off";
export const EXPENSIVE_TIERS_ENABLED = process.env.SUSTY_EXPENSIVE_TIERS !== "off";

// Anthropic is required and checked once, at the top of handler()/server.js,
// before resolveTier is ever consulted — this is not the place to re-litigate
// that, and re-checking it here made every Anthropic tier fall back in any
// process that has not itself set ANTHROPIC_API_KEY (tools/tiers.test.mjs,
// notably). Every other provider is optional, gated here instead: a tier
// for one resolves to the default rather than erroring when its key isn't
// set — the same graceful-fallback posture as the expensive-tier gate below.
function providerConfigured(provider) {
  if (provider === "anthropic") return true;
  if (provider === "google") return Boolean(process.env.GOOGLE_GEMINI_API_KEY);
  return false;
}

export function resolveTier(key) {
  const fallback = { key: DEFAULT_TIER, ...TIERS[DEFAULT_TIER] };
  if (!TIERS_ENABLED) return fallback;
  // Object.hasOwn, not a bare lookup: TIERS["__proto__"] and
  // TIERS["constructor"] resolve to inherited Object.prototype members, which
  // are truthy, so a crafted key slipped past a `!tier` guard and built a
  // request with model: undefined. Found by tools/tiers.test.mjs.
  if (typeof key !== "string" || !Object.hasOwn(TIERS, key)) return fallback;
  const tier = TIERS[key];
  if (tier.expensive && !EXPENSIVE_TIERS_ENABLED) return fallback;
  if (!providerConfigured(tier.provider)) return fallback;
  return { key, ...tier };
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

export async function callAnthropic(messages, tierKey) {
  const tier = resolveTier(tierKey);
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

  const tier = resolveTier(req.body?.tier);

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
      res.flushHeaders();

      await pipeGoogleAsAnthropicSSE(upstream, res, tier);
      return res.end();
    }

    const upstream = await callAnthropic(messages, tier.key);

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
