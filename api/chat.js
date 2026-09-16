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
// Carbon, from METHODOLOGY §2: haiku ×0.52, sonnet ×1.00, opus ×1.33 per token.
// But extended thinking is the term that matters — Oviedo et al. put a
// reasoning-length reply at ~13× a standard one, so `opus-thinking` is roughly
// an order of magnitude, not a third more.
//
// Every tier now carries a `provider`, because `resolveTier` uses it to check
// that provider's key is actually configured before handing the tier out —
// see providerConfigured() below. gemini-flash and gemini-flash-lite have no
// entry yet in index.html's MODEL_ENERGY table: EcoLogits has no fitted
// factor for either verified here, so both fall back to the Sonnet anchor
// rather than a guessed multiplier, same policy as any unrecognised model.
//
// Gemini 3 Flash and Flash-Lite cannot fully disable thinking (verified
// against ai.google.dev/gemini-api/docs/generate-content/thinking on
// 2026-09-15) — "low" is the lowest level documented as valid, not the
// true-off susty's other tiers get by simply omitting the field.
export const TIERS = {
  haiku: {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    maxTokens: LIMITS.maxTokens,
  },
  sonnet: {
    provider: "anthropic",
    // ANTHROPIC_MODEL still overrides the default tier, so existing
    // deployments keep working; it deliberately does not override the others.
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    maxTokens: LIMITS.maxTokens,
  },
  opus: {
    provider: "anthropic",
    // Omitting `thinking` means off on 4.8. On the 5-series it means ON, so a
    // 5-series tier added here must disable it explicitly.
    model: "claude-opus-4-8",
    maxTokens: LIMITS.maxTokens,
  },
  "opus-thinking": {
    provider: "anthropic",
    model: "claude-opus-4-8",
    maxTokens: 4000,
    // Adaptive is the only on-mode from 4.7 onward — `budget_tokens` is
    // removed and returns a 400.
    thinking: { type: "adaptive" },
    effort: "low",
    expensive: true,
  },
  "gemini-flash-lite": {
    provider: "google",
    model: "gemini-3.5-flash-lite",
    thinkingLevel: "low",
  },
  "gemini-flash": {
    provider: "google",
    model: "gemini-3.8-flash",
    thinkingLevel: "low",
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
  if (tier.thinking) {
    body.thinking = tier.thinking;
    body.output_config = { effort: tier.effort };
  }
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
