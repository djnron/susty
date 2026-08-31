// Plain Node server — no dependencies, no build step.
// Serves index.html and handles /api/chat using the same logic as the
// serverless function, so local and hosted behave identically.
//
//   ANTHROPIC_API_KEY=sk-ant-... node server.js
//   → http://localhost:3000

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clean, rateLimited, callAnthropic } from "./api/chat.js";

const root = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Resolves to null if the body is oversized or the stream fails, so the caller
// can answer properly. Destroying the socket here would leave the client with
// an aborted connection and no error to show.
function readBody(req, cap = 200_000) {
  return new Promise((resolve) => {
    let data = "";
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      data += c;
      if (data.length > cap) { over = true; data = ""; }
    });
    req.on("end", () => resolve(over ? null : data));
    req.on("error", () => resolve(null));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/chat") {
    if (req.method !== "POST") return json(res, 405, { error: "Send a POST request." });
    if (!process.env.ANTHROPIC_API_KEY) {
      return json(res, 500, { error: "ANTHROPIC_API_KEY is not set on the server." });
    }

    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
               req.socket.remoteAddress || "unknown";
    if (rateLimited(ip)) return json(res, 429, { error: "Too many requests. Wait a few minutes." });

    const raw = await readBody(req);
    if (raw === null) return json(res, 413, { error: "That request was too large." });

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: "The request body wasn't valid JSON." });
    }

    const messages = clean(parsed?.messages);
    if (!messages) return json(res, 400, { error: "The conversation was malformed." });

    try {
      const upstream = await callAnthropic(messages);
      const data = await upstream.json();
      if (!upstream.ok) {
        console.error("Anthropic error", upstream.status, data);
        return json(res, upstream.status, {
          error: data?.error?.message || "The model provider rejected the request.",
        });
      }
      return json(res, 200, { content: data.content, usage: data.usage });
    } catch (err) {
      console.error(err);
      return json(res, 502, { error: "Could not reach the model provider." });
    }
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      const html = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch {
      res.writeHead(500);
      return res.end("index.html is missing.");
    }
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("Warning: ANTHROPIC_API_KEY isn't set. The page will load but every reply will fail.");
  }
  console.log(`Tare is running at http://localhost:${PORT}`);
});
