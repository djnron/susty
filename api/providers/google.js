// First-party Gemini API (generativelanguage.googleapis.com), not Vertex.
//
// Gemini's raw stream shape has nothing in common with Anthropic's, so
// rather than teach the browser a second wire format for one extra
// provider, this translates Gemini's stream into the same event shape
// index.html already parses (message_start / content_block_delta /
// message_delta / message_stop). A real normalized contract can replace this translation
// once a third provider makes one worth having.
//
// Verified against ai.google.dev/api/generate-content and
// ai.google.dev/gemini-api/docs/generate-content/thinking on 2026-09-15:
//   - streamGenerateContent, ?alt=sse, auth via the x-goog-api-key header
//   - candidatesTokenCount EXCLUDES thoughtsTokenCount — totalTokenCount is
//     documented as "prompt + thoughts + response candidates", i.e. additive.
//     Do not add thoughtsTokenCount into the output count again downstream.
//   - Gemini 3 Flash and Flash-Lite cannot fully disable thinking. Each tier
//     sends the lowest level its model accepts: "low" for gemini-3.8-flash,
//     "minimal" for gemini-3.5-flash-lite (re-checked 2026-09-23).
//   - maxOutputTokens includes thought tokens and is a hard cutoff; hitting it
//     ends the stream with finishReason MAX_TOKENS, which the client records
//     as an incomplete attempt.

export async function callGoogle(messages, tier, system) {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
  };
  const generationConfig = {};
  if (tier.maxTokens) generationConfig.maxOutputTokens = tier.maxTokens;
  if (tier.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: tier.thinkingLevel };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(tier.model)}` +
    `:streamGenerateContent?alt=sse`;

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": process.env.GOOGLE_GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
}

// Normalize Gemini terminal reasons into the small Anthropic-shaped contract
// the browser already understands. A missing reason is deliberately left null:
// end-of-stream alone is not proof that generation completed normally.
export function normalizeGoogleFinishReason(reason) {
  if (reason === "STOP") return "end_turn";
  if (reason === "MAX_TOKENS") return "max_tokens";
  return reason ? `google_${String(reason).toLowerCase()}` : null;
}

// Reads Gemini's SSE stream and re-emits it as Anthropic-shaped SSE lines,
// writing straight to `res` the same way the Anthropic path already does.
//
// message_start goes out twice: once immediately with the model name, so the
// ledger's "answered by" label updates as soon as generation starts, and
// once at the end with the real prompt token count, which Gemini only
// reports once a chunk carries usage. Sending it twice is harmless — the
// browser overwrites inputTokens each time and the last value wins.
export async function pipeGoogleAsAnthropicSSE(upstream, res, tier) {
  const write = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);

  write({ type: "message_start", message: { model: tier.model, usage: { input_tokens: 0 } } });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let usage = null;
  let finishReason = null;

  const handleLine = (line) => {
    if (!line.startsWith("data: ")) return;
    const chunk = line.slice(6).trim();
    if (!chunk) return;
    let evt;
    try {
      evt = JSON.parse(chunk);
    } catch {
      return;
    }

    const text = (evt.candidates || [])
      .flatMap((c) => c.content?.parts || [])
      .map((p) => p.text || "")
      .join("");
    if (text) write({ type: "content_block_delta", delta: { type: "text_delta", text } });

    const candidate = evt.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (evt.usageMetadata) usage = evt.usageMetadata;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) handleLine(line);
  }
  buf += decoder.decode();
  if (buf.trim()) handleLine(buf);

  const stopReason = normalizeGoogleFinishReason(finishReason);

  if (usage) {
    write({
      type: "message_start",
      message: { usage: { input_tokens: usage.promptTokenCount || 0 } },
    });
    // Anthropic's output_tokens is INCLUSIVE of thinking_tokens (thinking is
    // a decomposition of it, per api/chat.js's own comment on this). Gemini's
    // usageMetadata is the opposite: candidatesTokenCount EXCLUDES
    // thoughtsTokenCount — totalTokenCount is documented as prompt + thoughts
    // + candidates, additive. Sending candidatesTokenCount alone as
    // output_tokens silently discarded the thinking tokens from the carbon
    // total instead of double-counting them — caught by a live smoke test
    // where a one-sentence reply reported 486 thinking tokens against 35
    // visible ones, ~93% of the real total, priced as zero. Summed here so
    // the client sees the same inclusive relationship Anthropic sends.
    const candidates = usage.candidatesTokenCount || 0;
    const thinking = usage.thoughtsTokenCount || 0;
    write({
      type: "message_delta",
      delta: stopReason ? { stop_reason: stopReason } : {},
      usage: {
        output_tokens: candidates + thinking,
        output_tokens_details: { thinking_tokens: thinking },
      },
    });
  } else if (stopReason) {
    write({ type: "message_delta", delta: { stop_reason: stopReason } });
  }

  if (stopReason) {
    write({ type: "message_stop" });
  }
}
