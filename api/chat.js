// Serverless proxy for the Anthropic API.
// Drop-in for Vercel (this file lives at /api/chat.js and needs no config).
// The API key stays here, on the server. It is never sent to the browser.

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
      stream: true,
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
