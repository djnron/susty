// Plain Node server — no dependencies, no build step.
// Serves index.html and handles /api/chat using the same logic as the
// serverless function, so local and hosted behave identically.
//
//   ANTHROPIC_API_KEY=sk-ant-... node server.js
//   → http://localhost:3000

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clean, rateLimited, callAnthropic, resolveTier, SYSTEM } from "./api/chat.js";
import { callGoogle, pipeGoogleAsAnthropicSSE } from "./api/providers/google.js";
import { fromGB, fromEIA, fromElectricityMaps } from "./api/grid.js";

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
    // Without this, each TCP chunk is decoded independently and any multi-byte
    // character split across a boundary turns into replacement characters —
    // silently, since the mangled text is still valid JSON.
    req.setEncoding("utf8");
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

/* --------------------------------------------------------------------------
   Copy editing (dev only).

   Each field is located by a unique anchor rather than a line number, so the
   file can move around underneath it. A save refuses rather than guesses if an
   anchor is missing or matches more than once — silently editing the wrong
   string would be worse than failing.
-------------------------------------------------------------------------- */

// id -> { open, close }. The text between them is the editable value.
// Anchored on the element id, never on the copy itself: anchoring on opening
// words meant rewriting the first sentence made the field unfindable.
const COPY_FIELDS = {
  "note.intro":      { open: '<p class="note" id="noteIntro">', close: "</p>" },
  "note.dataCenter": { open: '<p class="note" id="noteDataCenter">', close: "</p>" },
  "note.sum":        { open: '<p class="note" id="noteSum">', close: "</p>" },
};

// Fields inside the COPY object are double-quoted JS strings keyed by name.
const COPY_OBJECT_KEYS = [
  "privacy", "guessed", "guessedRegion", "picked", "pickedRegion", "world", "refine", "worldPick",
  "sourceHourly", "sourceLive", "usNationalAverage", "sourceAnnualUS", "sourceAnnual",
];

function copyObjectRe(key) {
  // key: "..."  — double-quoted, so an apostrophe in the copy needs no escaping
  return new RegExp('(\\b' + key + ':\\s*")((?:[^"\\\\]|\\\\.)*)(")');
}

export function readCopy(src) {
  const out = {};
  for (const [id, f] of Object.entries(COPY_FIELDS)) {
    const i = src.indexOf(f.open);
    if (i === -1) continue;
    const from = i + (f.keepOpen ? f.keepOpen.length : f.open.length);
    const to = src.indexOf(f.close, from);
    if (to === -1) continue;
    out[id] = src.slice(from, to);
  }
  for (const key of COPY_OBJECT_KEYS) {
    const m = src.match(copyObjectRe(key));
    if (m) out["location." + key] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  for (const m of src.matchAll(/(\w+):\s*\{ name: '([^']*)',\s*url: '([^']*)' \}/g)) {
    out["sources." + m[1]] = m[2];
  }
  return out;
}

export function writeCopy(src, id, value) {
  if (COPY_FIELDS[id]) {
    const f = COPY_FIELDS[id];
    const hits = src.split(f.open).length - 1;
    if (hits !== 1) throw new Error(`"${id}" matched ${hits} times; not editing`);
    const i = src.indexOf(f.open);
    const from = i + (f.keepOpen ? f.keepOpen.length : f.open.length);
    const to = src.indexOf(f.close, from);
    return src.slice(0, from) + value + src.slice(to);
  }
  if (id.startsWith("location.")) {
    const key = id.slice("location.".length);
    if (!COPY_OBJECT_KEYS.includes(key)) throw new Error(`Unknown field "${id}"`);
    const re = copyObjectRe(key);
    if (!re.test(src)) throw new Error(`"${id}" not found`);
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");
    return src.replace(re, (_, a, __, c) => a + escaped + c);
  }
  if (id.startsWith("sources.")) {
    const key = id.slice("sources.".length);
    const re = new RegExp("(\\b" + key + ":\\s*\\{ name: ')([^']*)(')");
    if (!re.test(src)) throw new Error(`"${id}" not found`);
    if (value.includes("'")) throw new Error("Source names cannot contain an apostrophe");
    return src.replace(re, (_, a, __, c) => a + value + c);
  }
  throw new Error(`Unknown field "${id}"`);
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

    const tier = resolveTier(parsed?.tier);

    try {
      if (tier.provider === "google") {
        const upstream = await callGoogle(messages, tier, SYSTEM);
        if (!upstream.ok) {
          const data = await upstream.json().catch(() => ({}));
          console.error("Gemini error", upstream.status, data);
          return json(res, upstream.status, {
            error: data?.error?.message || "The model provider rejected the request.",
          });
        }
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-accel-buffering": "no",
        });
        await pipeGoogleAsAnthropicSSE(upstream, res, tier);
        return res.end();
      }

      const upstream = await callAnthropic(messages, tier.key);
      if (!upstream.ok) {
        const data = await upstream.json().catch(() => ({}));
        console.error("Anthropic error", upstream.status, data);
        return json(res, upstream.status, {
          error: data?.error?.message || "The model provider rejected the request.",
        });
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      });
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      return res.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) return json(res, 502, { error: "Could not reach the model provider." });
      res.end();
    }
  }

  if (url.pathname === "/api/grid") {
    const country = (url.searchParams.get("country") || "").toUpperCase();
    const region = url.searchParams.get("region") || "";
    const zone = url.searchParams.get("zone") || "";
    try {
      let out = null;
      if (country === "GB") out = await fromGB(region);
      if (!out && country === "US") out = await fromEIA(region);
      if (!out) out = await fromElectricityMaps(zone || country);   // match api/grid.js
      return json(res, 200, out || { live: false });
    } catch (err) {
      console.error("grid lookup failed", err);
      return json(res, 200, { live: false });
    }
  }

  // --- Copy editor. Local development only: this route lives in server.js and
  // not in api/, so it is never deployed. It reads and rewrites string literals
  // in index.html in place.
  if (url.pathname === "/copy") {
    try {
      const html = await readFile(join(root, "tools/copy-editor.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch {
      res.writeHead(500);
      return res.end("tools/copy-editor.html is missing.");
    }
  }

  if (url.pathname === "/api/copy") {
    const file = join(root, "index.html");
    if (req.method === "GET") {
      try {
        return json(res, 200, { copy: readCopy(await readFile(file, "utf8")) });
      } catch (err) {
        return json(res, 500, { error: String(err.message || err) });
      }
    }
    if (req.method === "POST") {
      const raw = await readBody(req);
      let edits;
      try { edits = JSON.parse(raw || "{}").edits || {}; }
      catch { return json(res, 400, { error: "Bad JSON." }); }
      try {
        let src = await readFile(file, "utf8");
        let written = 0;
        for (const [id, value] of Object.entries(edits)) {
          src = writeCopy(src, id, value);   // throws if the anchor is not unique
          written++;
        }
        await writeFile(file, src);
        return json(res, 200, { written });
      } catch (err) {
        return json(res, 400, { error: String(err.message || err) });
      }
    }
    return json(res, 405, { error: "GET or POST." });
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

  // The brand PNGs. Vercel serves everything at the root statically, so these
  // need no route in production; without them here the favicon and the share
  // card 404 in local dev and look broken for no real reason.
  if (req.method === "GET" && /^\/(favicon|apple-touch-icon|og)\.png$/.test(url.pathname)) {
    try {
      const png = await readFile(join(root, url.pathname.slice(1)));
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
      return res.end(png);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found. Run: sh tools/make-brand-assets.sh");
    }
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("Warning: ANTHROPIC_API_KEY isn't set. The page will load but every reply will fail.");
  }
  console.log(`susty is running at http://localhost:${PORT}`);
});
