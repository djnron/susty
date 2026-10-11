# susty

A sustainability chatbot that estimates the operational carbon, and separately the water, of its own conversation. The meter shows the running total for the conversation, and the number of answers beneath it. The average per answer (g CO2e per completed exchange, the functional unit) is in the ledger.

**Version 2.1.0** (11 October 2026). What changed, and when: [CHANGELOG.md](CHANGELOG.md). Releases are meant to be tagged in git (`v2.1.0`); as of 11 October 2026 no tags have been pushed to GitHub, so a past version is recovered from its release commit.

No build step, no framework, no dependencies.

```
index.html            the whole front end: markup, CSS custom properties, inline JS
api/chat.js           serverless proxy that holds the API key
api/grid.js           live grid carbon intensity, with static fallbacks
api/feedback.js       deploys, but nothing calls it yet — see Known gaps
server.js             plain Node server, same logic, for local dev or a VPS
og.png, favicon.png,
apple-touch-icon.png  share card and icons, generated — see Tools
tools/                dev-only: not uploaded to Vercel (.vercelignore)
data/                 source data behind the water figures, with provenance (also not uploaded)
```

- [METHODOLOGY.md](METHODOLOGY.md) — every constant, source, and acknowledged
  approximation behind the carbon figures and the chat
- [PRODUCT.md](PRODUCT.md) — users, positioning, brand commitments, principles

## Get a key

From <https://console.anthropic.com> → API Keys. It starts `sk-ant-`. It goes on the server, never in `index.html`.

## Run it locally

Node 20.6 or newer, which reads `.env` natively so the key never lands in your
shell history.

```bash
cp .env.example .env      # then fill in the keys
node --env-file=.env server.js
```

Open <http://localhost:3000>. `EIA_API_KEY` is optional — without it, US grid
readings fall back to eGRID annual averages instead of hourly ones.

## Put it on a real URL

### Vercel

`api/*.js` is already in the layout Vercel expects, but **two config files are
load-bearing and deleting either one takes the site down**:

- **`.vercelignore` must exclude `server.js`.** Vercel's Node runtime
  auto-detects a root-level `server.js` as the application entrypoint and
  demands a default export that is a function or a server. This one calls
  `server.listen()` itself, so detection finds nothing it can use and every
  request to `/` dies with `FUNCTION_INVOCATION_FAILED`.
- **`vercel.json` sets `"framework": null`.** Removing `server.js` alone leaves
  that runtime selected with nothing to run, and the build then fails with
  `No entrypoint found`. The override says explicitly that there is no
  framework: this is a static `index.html` plus the functions under `api/`.

Both were learned the hard way. Don't tidy them away.

```bash
npm i -g vercel
vercel                                    # follow the prompts
vercel env add ANTHROPIC_API_KEY          # paste the key, choose Production
vercel --prod
```

Or push to GitHub and import it at vercel.com — then add `ANTHROPIC_API_KEY`
under Settings → Environment Variables and redeploy. Environment variables are
baked in at build time, so **after adding one you must redeploy** or the running
deployment will not see it.

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
| Model tiers offered in the ledger | `TIERS` in `api/chat.js` |
| What a fresh visitor's picker starts on | `tier:` in the `state` object in `index.html` |
| The fallback a request degrades to if a tier is unrecognised, gated, or its provider is unconfigured — must stay a provider that's always configured | `DEFAULT_TIER` in `api/chat.js` |
| Anthropic's own default tier's model | `ANTHROPIC_MODEL` env var, or `TIERS.sonnet` in `api/chat.js`, defaults to `claude-sonnet-4-6` |
| Carbon coefficients | `MODEL` object near the top of the inline script in `index.html` |
| Water tables | never by hand: edit `data/`, then `node tools/water-factors.mjs --write` |
| Device power and panel types | `DEVICE_BASE` and `PANELS` in `index.html` |
| How long attention is assumed to last | `GRACE` in `index.html` |
| Comparisons and offset copy | `paintLedger()` in `index.html`, and the `.offset` block in the markup |
| Ledger location copy | the `COPY` object in `index.html`, editable at `/copy` in local dev |
| Colours, type, spacing | the CSS custom properties at the top of `index.html` |
| Starter questions | `CHIPS` array in `index.html` |
| Share card and icons | `tools/brand/*.svg`, then `sh tools/make-brand-assets.sh` |

Anything touching colour or the carbon model has a check to run — see Tools.

## Tools

Dev-only. `tools/` is in `.vercelignore`, so none of it is uploaded.

```bash
sh tools/test.sh               # everything below, in one go — run before pushing

node tools/contrast.mjs        # every colour pair against its WCAG threshold
node tools/clock.test.mjs      # attended-time clock, device table, model factors
node tools/tiers.test.mjs      # model-tier mapping and its off switches
node tools/water.test.mjs      # water: transcription, cross-check, tables, accrual
node tools/water-factors.mjs --check   # water tables match data/ (--write to regenerate)
sh tools/make-brand-assets.sh  # regenerate og.png, favicon.png, apple-touch-icon.png
```

`tools/copy-editor.html` is served at <http://localhost:3000/copy> by
`server.js`, for editing the ledger's location copy in place.

The rule behind `contrast.mjs`: compute contrast, never assert it. An earlier
version of this project claimed `#16A34A` passed 4.5:1 on white. It is 3.3:1.
New colour pairs go in the checker with their threshold before they go in the
stylesheet.

## About the carbon figures

They are estimates, and the page says so. Provider token counts are measured where available; energy, device power, location, and some grid values are modeled, inferred, or derived.

```
grams CO2e = ( (tokens × energy per token) × cooling
             + handled requests × hosting ) × servers' grid intensity
           + ( device watts × hours attended ) × your grid intensity

g CO2e / completed exchange
= session g CO2e / completed exchanges
```

The absolute token coefficients (0.05 mWh per input token and 0.5 mWh per
output token) and PUE 1.12 are Susty modeling assumptions, not direct
measurements from the cited literature. They are deliberately easy to change
as better provider/model measurements become available. The world grid
fallback is 471 g/kWh (Ember 2024).
Your grid is user-selectable because it alone swings the device term more than
tenfold. The servers' grid is a fixed, sourced assumption: US data centres,
capacity-weighted, about 307 g CO2e/kWh (Watershed, September 2026), whose
accounting basis the source does not state.

The device term counts the whole end-user device, not just its screen, which is
how every published framework counts it — and only for the time the reader was
actually there. It is calibrated on measured figures rather than on the
reporting frameworks' assumed ones. §7 of METHODOLOGY has the sourcing, the
approaches it rejects, and the errors larger than the model itself.

## Known gaps

Declared rather than fixed, and all in METHODOLOGY:

- **Training cost is not counted.** Inference only.
- **Brightness is unknown**, and the study the dark-mode figures come from
  finds brightness matters more than panel technology.
- **Panel type cannot be detected**, so the picker's default is a prior —
  phones default to OLED, everything else to LCD.
- **The servers' location is assumed, not known.** Inference and hosting are
  priced on a US data-centre grid (307 g CO2e/kWh, Watershed); neither
  provider discloses which facility answered (METHODOLOGY §6.9).
- **Grid sources mix two accounting bases.** Ember's national figures are
  life-cycle; NESO, EIA and eGRID are operational. The ledger names which one
  applies; converting them to one basis would add error (METHODOLOGY §6.1).
- **Energy per token is at the low end of published estimates**, and the
  model multipliers leave out how many GPUs a model needs, so they likely
  understate large models and overstate small ones. Both stay as they are
  until they can be calibrated against provider data (METHODOLOGY §4.3–4.4, §15).
  The ledger therefore shows the chat as a range: the high end puts AI energy
  at the upper quartile of Oviedo et al.'s estimates, about 2.7× Susty's
  (METHODOLOGY §4.8). It is one published scenario, not a statistical interval.
- **Gemini always thinks.** Thinking cannot be switched off on Gemini 3, so
  every Gemini reply carries some reasoning tokens. They are measured and
  priced; the default, Flash-Lite, runs at the lowest level Google offers.
- **History is browser-local.** Saved chats live in one browser's storage and
  are gone if it is cleared; nothing is sent anywhere (METHODOLOGY §8.1).
- **Water figures err high** (cooling towers everywhere, all water, a proxy WUE),
  while the energy they multiply errs low (METHODOLOGY §16.6). Hydro reservoir
  evaporation is shown on its own row because its allocation is contested.
- **Rate limiting is in-memory**, so it resets on cold start. It deters casual
  abuse; it is not a quota.
- **`api/feedback.js` is not wired up.** The client opens a `mailto:` link
  instead, which fails silently where no mail client is configured.
- **The extended-thinking tier costs real money on your key.** A visitor can
  pick it and raise an exchange several times over, against a rate limit that
  resets on cold start. Set `SUSTY_EXPENSIVE_TIERS=off` to drop it from the
  menu, or `SUSTY_TIERS=off` to collapse every request to the default.

The ledger keeps both the normalized functional unit and the cumulative session total visible. Everyday comparisons continue to use the session total, not the per-exchange average.
