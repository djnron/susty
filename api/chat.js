// Serverless proxy for the Anthropic API.
// Drop-in for Vercel (this file lives at /api/chat.js and needs no config).
// The API key stays here, on the server. It is never sent to the browser.

export const SYSTEM = `You are Tare, a sustainability advisor. You give practical, specific recommendations for living and working more sustainably.

How you answer:
- Lead with the action, then the number. Attach approximate figures (kg CO2e, kWh, litres, currency) so people can judge for themselves. Say when a figure is a rough estimate or varies by country.
- Be honest about magnitude. If something is a rounding error next to the big levers — flying, driving, home heating, diet, and what you buy — say so plainly and name the bigger lever instead.
- Rank your suggestions. Three well-chosen actions beat a list of twelve.
- Never moralise, guilt-trip, or use eco-marketing language. Assume the person is capable and busy.
- Where the answer depends heavily on where someone lives or how they heat their home, ask one short clarifying question rather than guessing.
- Acknowledge trade-offs, including cost and inconvenience.

Keep replies under about 180 words. Short paragraphs, bullets only when listing options.`;

// Guardrails, because this endpoint is public the moment you deploy it.
export const LIMITS = {
  maxMessages: 40,      // conversation length
  maxChars: 4000,       // per message
  maxTokens: 1000,      // response length
  windowMs: 10 * 60_000,
  perWindow: 25,        // requests per IP per window
};

const hits = new Map(); // in-memory, so it resets on cold start — see README

export function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < LIMITS.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMITS.perWindow;
}

// Accept only what we intend to forward. Never pass the client's body through whole.
export function clean(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const trimmed = messages.slice(-LIMITS.maxMessages);
  const out = [];
  for (const m of trimmed) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string" || !m.content.trim()) return null;
    out.push({ role: m.role, content: m.content.slice(0, LIMITS.maxChars) });
  }
  if (out[out.length - 1].role !== "user") return null;
  return out;
}

export async function callAnthropic(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: LIMITS.maxTokens,
      system: SYSTEM,
      messages,
    }),
  });
  return res;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Send a POST request." });
  }
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

  try {
    const upstream = await callAnthropic(messages);
    const data = await upstream.json();

    if (!upstream.ok) {
      console.error("Anthropic error", upstream.status, data);
      return res
        .status(upstream.status)
        .json({ error: data?.error?.message || "The model provider rejected the request." });
    }

    // Pass content and usage straight through; usage is what drives the carbon meter.
    return res.status(200).json({ content: data.content, usage: data.usage });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Could not reach the model provider." });
  }
}
