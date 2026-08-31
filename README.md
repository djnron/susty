# Tare

A sustainability chatbot that keeps a running count of the carbon its own conversation costs. Click the counter to see the arithmetic and what to do about it.

No build step, no framework, no dependencies. Three files do the work.

```
index.html      the whole front end
api/chat.js     serverless proxy that holds the API key
server.js       plain Node server, same logic, for local or VPS hosting
```

## Get a key

From <https://console.anthropic.com> → API Keys. It starts `sk-ant-`. It goes on the server, never in `index.html`.

## Run it locally

Node 18 or newer.

```bash
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

Open <http://localhost:3000>.

## Put it on a real URL

### Vercel (easiest)

`api/chat.js` is already in the layout Vercel expects, so there's nothing to configure.

```bash
npm i -g vercel
vercel                                    # follow the prompts
vercel env add ANTHROPIC_API_KEY          # paste the key, choose Production
vercel --prod
```

Or push the folder to GitHub and import it at vercel.com — then add `ANTHROPIC_API_KEY` under Settings → Environment Variables and redeploy.

### Netlify

Move `api/chat.js` to `netlify/functions/chat.js` and add a `netlify.toml`:

```toml
[[redirects]]
  from = "/api/chat"
  to = "/.netlify/functions/chat"
  status = 200
```

Set `ANTHROPIC_API_KEY` under Site settings → Environment variables.

### Render, Railway, Fly, or your own box

These run `server.js` directly.

- Build command: none
- Start command: `npm start`
- Environment variable: `ANTHROPIC_API_KEY`

## Before you make the URL public

The endpoint spends your money, so treat it accordingly.

- **Set a spend cap** in the Anthropic console. This is the one that actually protects you.
- **Rate limiting** is included at 25 requests per IP per 10 minutes, in `api/chat.js` → `LIMITS`. It's in-memory, which is fine for `server.js` but leaky on serverless, where each cold start forgets everything. If the page gets real traffic, move it to Upstash Redis or your host's built-in limiter.
- **Message and length caps** are in the same object. The proxy rebuilds the request from scratch rather than forwarding whatever the browser sent, so a modified client can't change the model, the system prompt, or `max_tokens`.
- **Watch the logs** for a week after launch.

## Changing things

| What | Where |
|---|---|
| The bot's personality and rules | `SYSTEM` at the top of `api/chat.js` |
| Model | `ANTHROPIC_MODEL` env var, defaults to `claude-sonnet-4-6` |
| Carbon coefficients | `MODEL` object in `index.html`, near the bottom |
| Comparisons and offset copy | `paintLedger()` in `index.html`, and the `.offset` block in the markup |
| Colours and type | the CSS variables at the top of `index.html` |
| Starter questions | `CHIPS` array in `index.html` |

## About the carbon figures

They are estimates, and the page says so. Token counts are real — the API reports them and the meter uses them. Everything after that is modelled:

```
grams CO2e = (tokens × energy per token) × cooling × hardware × grid intensity
```

Per-query energy use isn't published by any lab, and public estimates vary by more than an order of magnitude. The defaults here (0.05 mWh per input token, 0.5 mWh per output token, PUE 1.12, +15% embodied hardware, 480 g/kWh) sit in the middle of that range and are deliberately easy to change. The grid intensity is user-selectable in the panel because it alone swings the answer more than tenfold.

The ledger is built to make the conversation's footprint feel small on purpose. A long chat costs a fraction of a penny to offset; the actions discussed in it are worth thousands of times more. That comparison is the point of the feature.
