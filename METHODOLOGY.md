# Methodology

How susty answers questions, and how it works out what the answering cost.

Everything here is either measured, cited, or labelled as modelled. Where a
number is a guess, this document says so and says which direction it errs. The
product's argument depends on the arithmetic being checkable, so the
uncomfortable parts are written down rather than rounded away.

---

## 1. The chat

### Model and routing

| | |
|---|---|
| Model | `claude-sonnet-4-6`, overridable via `ANTHROPIC_MODEL` |
| Endpoint | `POST /api/chat` → `https://api.anthropic.com/v1/messages` |
| Transport | Server-sent events, streamed straight through the proxy |
| Key handling | Server-side only. Never reaches the browser. |

The browser talks only to our own `/api/chat`. The Anthropic key lives in the
serverless function's environment, so a reader can open dev tools and find
nothing worth having.

### The system prompt

Susty is instructed to lead with the action and then the number, attach
approximate figures so people can judge for themselves, and flag when a figure
is a rough estimate or varies by country. It is told to be honest about
magnitude — if something is a rounding error next to flying, driving, home
heating, diet and purchasing, it must say so and name the bigger lever instead.
It ranks suggestions rather than listing twelve, never moralises, asks one
clarifying question where the answer depends heavily on location or heating
type, and acknowledges cost and inconvenience. Replies are capped near 180
words.

The full text lives in [`api/chat.js`](api/chat.js) as `SYSTEM`.

### Guardrails

The endpoint is public the moment it deploys, so:

- **40 messages** of history forwarded, **4,000 characters** per message
- **1,000 tokens** maximum per reply
- **25 requests per IP per 10 minutes**

Rate-limit state is in-process, so it resets on a cold start and is not shared
between concurrent instances. It deters casual abuse; it is not a real quota.

The limiter checks before recording, so rejected attempts do not extend the
window — otherwise a client at the limit could never recover except by going
completely idle. When the map exceeds 5,000 addresses it evicts the oldest
slice rather than clearing, which would hand every tracked IP a fresh quota.

`clean()` accepts only what we intend to forward: role and string content,
nothing else from the request body. It also drops leading non-`user` turns,
because a 40-message window over an even-length history can open on an
assistant turn, which the Messages API rejects outright. Left unhandled that
bricked the conversation permanently at 20 exchanges, since the history only
grows.

### Streaming

Deltas are parsed from the SSE frames and rendered as they arrive. Three details
matter:

- Renders are coalesced to one per animation frame. Re-parsing the whole message
  on every token is quadratic in reply length.
- The reply is always flushed synchronously when the stream closes.
  `requestAnimationFrame` does not run in a hidden tab, so coalescing alone left
  anyone who switched away mid-reply looking at an empty bubble.
- Mid-stream `error` frames (an overloaded upstream, say) are handled
  explicitly. Partial text is kept and marked as cut off rather than stored as a
  complete reply.

If nothing usable arrives, the exchange is removed from both the transcript and
the history so the two stay in step, and the question is returned to the input
box.

---

## 2. The carbon calculation

### The formula

```
grams CO₂e = ( (tokens × energy per token) × PUE
              + exchanges × hosting
              + device watts × hours attended ) × grid intensity
```

### Constants

| Term | Value | Source |
|---|---|---|
| Energy, tokens sent | 0.05 mWh/token | Luccioni et al. 2023 |
| Energy, tokens written | 0.5 mWh/token | Luccioni et al. 2023 |
| Cooling and overhead (PUE) | ×1.12 | Uptime Institute 2023, global average |
| Hosting and network | 0.003 Wh per exchange | modelled |
| Model energy factor | ×1.00 for `claude-sonnet-4-6` | EcoLogits fitted to ML.ENERGY, see below |
| End-user device | see §4 | measured (laptop) / DIMPACT (phone, tablet, desktop) |
| Attended-time grace window | 75 s | reply length ÷ reading speed, see §4 |
| Grid intensity | see §3 | varies by source |

Token counts come from the API's own `usage` field, so the input to the model is
measured rather than estimated. Everything after that is modelled.

### The model factor

Per-token energy scales with a model's active parameter count, and susty had
been applying one coefficient to every model. The factors are relative,
anchored on `claude-sonnet-4-6` = 1.00:

| Model | Active params (est.) | Factor |
|---|---|---|
| `claude-haiku-4-5` | 10–35B, dense | **0.52** |
| `claude-sonnet-4-6` | 44–132B, MoE | **1.00** (anchor) |
| `claude-opus-4-6/7/8` | 67–200B, MoE | **1.33** |

Derived from [EcoLogits](https://ecologits.ai/)' energy function, itself fitted
to the measured [ML.ENERGY leaderboard](https://ml.energy/):

```
f(P_active, B) = 1.17e-6 · e^(-1.12e-2·B) · P_active + 4.05e-5   Wh per output token
```

evaluated at batch 32 on the midpoint of their active-parameter estimate.
`tools/clock.test.mjs` reproduces every published factor from that function, so
none of them is a typed-in number.

**Relative, not absolute, deliberately.** The absolute coefficients above are
Luccioni et al. and they hold up: a measured susty exchange comes to **0.186 Wh**,
inside the **0.16–0.60 Wh/query** IQR that [Oviedo et al.
(*Joule* 2026)](https://arxiv.org/abs/2509.20241) report for frontier models.
EcoLogits' own per-token figures look roughly 4× lower, but that is a scope
difference — theirs is GPU-only where susty's chain is full-stack — not a
disagreement. The test asserts that calibration so it cannot drift unnoticed.

**Two limits worth naming.** EcoLogits flags every Anthropic entry
`model-arch-not-released`: the parameter counts are inferred from benchmark
parity and pricing, not disclosed, so these are a spread rather than a
precision. And the 5-series is deliberately absent from the table — EcoLogits
has no architecture estimate for `claude-sonnet-5` or `claude-opus-5`, so a
factor for them would be invention. An unrecognised model falls back to the
anchor.

**The dominant term is not the model.** Oviedo et al. find that a
reasoning-length reply (~5,000 output tokens) raises per-query energy **~13×**
against a standard one. The whole spread between Haiku and Opus is 2.6×. So
output length, and therefore whether extended thinking is on, matters far more
than which model serves the request.

### Choosing a model

The ledger's **Answer with** picker offers six tiers, across two providers.
The client sends an opaque key and `api/chat.js` owns the only mapping to a
model, so a modified client cannot name an arbitrary model or switch
thinking on:

| Tier | Model | Thinking | Per-token |
|---|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` | off | ×0.52 |
| Sonnet 4.6 | `claude-sonnet-4-6` | off | ×1.00 (the anchor) |
| Opus 4.8 | `claude-opus-4-8` | off | ×1.33 |
| Opus 4.8, extended thinking | `claude-opus-4-8` | adaptive, effort `low` | ×1.33 **plus the thinking tokens** |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | forced on, level `low` | not yet calibrated — falls back to ×1.00 |
| **Gemini 3.8 Flash** (default) | `gemini-3.8-flash` | forced on, level `low` | not yet calibrated — falls back to ×1.00 |

**The default is a scaling decision, not a validated one.** Gemini became
the default when traffic grew suddenly, to spread load off the Anthropic
key rather than because an evaluation found it cheaper or more accurate.
Neither Gemini tier has a fitted EcoLogits factor, so both silently price
at the Sonnet anchor — a real number, just not a Gemini-specific one — and
the picker says "not yet calibrated" rather than showing a ×1.00 that
looks deliberate. Both Gemini tiers also cannot fully disable thinking
(verified against Google's docs): `low` is the floor, not the off that
`sonnet`/`haiku`/`opus` get by omitting the field, so every Gemini reply
carries some — sometimes substantial and variable — hidden reasoning cost
that a real per-model factor would need to account for. `DEFAULT_TIER` in
`api/chat.js` stays `sonnet` regardless: that constant is the fallback a
request degrades to if a tier is unrecognised, gated, or its provider
isn't configured, and it has to remain a provider that's always
guaranteed present, which is Anthropic. The client's own default (what a
fresh visitor's picker starts on) is the separate, product-facing choice
that actually moved to Gemini.

The per-token column understates the last row badly, which is why the ledger
reports thinking separately. **Thinking tokens are measured, not inferred:**
`usage.output_tokens_details.thinking_tokens` gives an exact count, and they are
a subset of `output_tokens`, so they are already billed at the output rate — the
row exists because it is the term that decides whether an exchange costs once or
several times over. At effort `low` a typical reply reasons for only 20–40
tokens; higher effort is where the 13× lives.

The tier is a request, not a setting. The server may collapse it, so the ledger
reports whichever model actually answered — read from the response's
`message.model`, not from what was asked for. Model ids are matched by longest
prefix because the API answers with dated ids: asking for `claude-haiku-4-5`
returns `claude-haiku-4-5-20251001`, and an exact lookup billed Haiku at the
Sonnet anchor.

Two off switches, both default-on:

| Variable | Effect |
|---|---|
| `SUSTY_EXPENSIVE_TIERS=off` | Drops the thinking tier; everything else stays |
| `SUSTY_TIERS=off` | Collapses every request to the default tier |

Worth knowing before this is public: a visitor on the thinking tier can raise
the cost of an exchange several times over, on the deployment's own API key,
against a rate limit that resets on cold start. `SUSTY_EXPENSIVE_TIERS=off` is
the lever.

Output tokens cost ten times input tokens per token, which is why a long reply
dominates a long question.

### Why longer chats cost more per turn

The whole history is re-sent on every request, so input tokens grow roughly
linearly with conversation length and each successive answer is more expensive
than the last. The ledger says this explicitly rather than letting the meter
look mysteriously superlinear.

### The estimate fallback

When `usage` is missing, tokens are estimated at 4 characters per token. Two
corrections apply:

- The estimate runs **before** the reply is appended to history. Otherwise it
  counts the model's own output as part of the request that produced it.
- A constant **275 tokens** is added for the system prompt, which is billed as
  input on every turn but never appears in the client's history. Measured
  against a live request: a 13-token question reported 278 input tokens.

The fallback still ignores the server's 40-message and 4,000-character
truncation, so it over-counts on long conversations. It is a fallback; the
measured path is the normal one.

### What the total excludes

- **Training.** This measures inference only. Amortised training cost per query
  is real and not counted here.
- **Your device's CPU, network, and router.** Only the display is modelled.
- **Embodied hardware manufacturing, on either side.** susty used to add a flat
  +15% to electricity for this; that treated manufacturing emissions as
  electricity, which they are not, and the multiplier has been removed rather
  than turned into a separate term. On the AI side, a defensible per-request
  share would need the accelerator that served the request, its manufacturing
  footprint, and this request's slice of its lifetime throughput — none of the
  three is knowable from outside the provider. On the device side, a real
  figure exists (manufacturers publish per-product lifecycle reports), but
  manufacturing is not marginal to one session the device was going to exist
  regardless, the amortisation basis (hours of use assumed over a lifetime)
  has no settled answer, and the result would likely dominate the page rather
  than refine it. Not counted, on either side.

### Offset costing

Grams are converted at roughly **$100 per tonne** for durable carbon removal
(Frontier 2024 State of Carbon Dioxide Removal). At conversation scale this
lands under a hundredth of a cent, which is the point: the comparison exists to
show proportion, not to sell offsets.

---

## 3. Grid carbon intensity

The single largest lever in the formula. susty uses the best available source
for the reader's region and states which one is in force.

### Tier 1 — Great Britain, genuinely live

[NESO Carbon Intensity API](https://api.carbonintensity.org.uk/). Open, no key,
no registration. Half-hourly actuals for 14 distribution regions. Nothing about
the visitor is sent with the request.

This is the best grid data available anywhere and it is free.

### Tier 2 — United States, hourly by region

[EIA-930](https://www.eia.gov/opendata/) hourly generation by fuel type, turned
into an intensity using EIA's own per-fuel figures. Requires a free
`EIA_API_KEY`.

**Two caveats, both material.**

EIA publishes hourly CO₂ only in bulk spreadsheets, not the API. So intensity is
**derived from the generation mix** rather than read off, using:

| Fuel | g/kWh | Basis |
|---|---|---|
| Coal | 1024 | EIA: 2,257 lb/MWh |
| Natural gas | 443 | EIA: 976 lb/MWh |
| Petroleum | 800 | 73.2 kg/MMBtu at ~10,800 Btu/kWh |
| Other | 600 | mixed bucket, uncertain |
| Geothermal | 40 | reservoir fluid vents dissolved CO₂ |
| Nuclear, hydro, wind, solar | 0 | operational emissions only |
| Solar/wind with battery | 0 | counted as the generation they are |
| Battery, pumped, other storage | excluded | time-shifted; counted when charged |

Storage is excluded deliberately. Pricing a discharged MWh at zero would credit
it as carbon-free while its charging energy stayed uncounted, discounting
storage twice.

The fuel list comes from the API's own `fueltype` facet, not from memory. EIA
split these categories further in 2024Q3, and an eight-fuel table silently
dropped geothermal and storage-paired renewables out of the denominator,
biasing California's reading high by about 3%.

Second caveat: **the feed runs about a day behind.** Taking EIA's newest
published hour therefore hands you the middle of last night. Measured at 2:23pm
Pacific, the newest hour reported California at 330 g/kWh while the grid was
actually near 169 — a 2× error, and further from the truth than the annual
average it was meant to improve on.

So susty matches the **hour of day** instead, using the most recent occurrence
of the current hour. The diurnal shape is strongly periodic:

```
California, one day, UTC hour → g/kWh
11:00 PT  161   solar peak
14:00 PT  169
20:00 PT  373   evening peak
23:00 PT  330
```

A 2.3× swing. The same hour a day earlier is a far better estimate of now than a
fresher reading from the opposite end of that curve. An hour is only accepted if
it reports a fuel count comparable to the best hour in the window, so a
half-published two-fuel snapshot is never presented as authoritative.

Interregional imports are ignored. Import-heavy regions carry the exporting
region's intensity in reality, so their true figure differs.

### Tier 3 — United States, annual by subregion

[EPA eGRID2023 Rev 2](https://www.epa.gov/egrid/summary-data) CO₂e output rates,
converted from lb/MWh. Used when no EIA key is configured.

Subregions run from **110 g/kWh** in upstate New York to **702** in Puerto Rico,
so the 384 national average describes almost nobody. Six states straddle two
subregions with a wide gap and are offered split — Pennsylvania's halves differ
by 1.5×, which is larger than most country-level differences.

The picker names geography the reader can identify rather than inferring from a
ZIP table, which would mean fabricating hundreds of mappings across boundaries
that do not follow postal lines.

### Tier 4 — everywhere else, national annual averages

2024 country figures, cross-checked against
[Ember's Global Electricity Review 2025](https://ember-energy.org/data/yearly-electricity-data/)
where both publish (China 555/560, Brazil 106/103, Japan 483/482 — all within
~1%). Range: Switzerland 30 → South Africa 713.

Annual means, so they miss both the daily swing and regional spread. The ledger
says so.

### Optional — Electricity Maps

Live intensity for any country via `ELECTRICITY_MAPS_TOKEN`. Not used by default:
their free tier returns only relative high/moderate/low signals, which a numeric
meter cannot consume. Absolute values need a paid plan.

### Locating the reader

Country is inferred from the IANA time zone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`). This was chosen over the
alternatives deliberately: Geolocation needs a permission prompt, and IP lookup
means handing a third party the visitor's address and adding a network request
with its own footprint — a poor trade for a product about measuring footprints.
Timezone is permissionless, instant, offline, and nothing leaves the browser.

Unlisted European zones fall back to the EU average; anything else to the world
average.

The ledger frames this as a deliberate tradeoff rather than a limitation,
because that is what it is: privacy is the *reason* the country starts as a
guess, so the note leads with it and treats the guess as a starting point the
reader can improve. The offer to narrow it down appears only where it is
actionable — a sub-picker exists for that country and has not been used yet — so
France stays quiet and picking a US state removes the prompt rather than
repeating it.

**One acknowledged approximation.** The same figure is applied to the reader's
screen, where it fits, and to the data centre, where it probably does not. Those
servers may sit in another country on a cleaner or dirtier grid, and there is no
way to see which from the browser.

---

## 4. Your device

Included in the total. The screen you are reading on is part of what the
conversation costs, so leaving it out would understate the answer — and by a
wide margin. Ten minutes on a backlit laptop is about 0.26 g, while a typical
exchange is nearer 0.03 g: the screen runs roughly nine times the AI.

It does mix a measured quantity (time) with a declared one (panel type), so the
picker always defaults to a backlit panel and the figure is shown on its own row
rather than buried in the sum.

Because screen time accrues whether or not anyone is typing, the meter drifts
upward while the page sits open. That is the honest behaviour: the tab really is
costing something. A 2-second tick keeps the meter current, without the pulse
animation, which is reserved for an actual exchange, and pauses entirely while
the tab is hidden.

**Boundary: the whole end-user device.** Every published framework counts the
device, not the screen alone; counting the panel only understated this row by
roughly 2–3×. The panel is a *component* of that figure rather than a line of
its own — it is what makes the theme move the number at all, but the ledger
reports one device row rather than itemising the screen inside it.

Whole-device power is `base + panel`, so the theme still moves the total:

| Configuration | Device | of which panel |
|---|---|---|
| Phone, OLED (dark) — **the default** | 1.35 W | 0.45 W |
| Phone, LCD | 1.50 W | 0.60 W |
| Tablet, OLED (dark) | 4.62 W | 1.32 W |
| Tablet, LCD | 5.50 W | 2.20 W |
| Laptop, OLED (dark) | 8.40 W | 2.40 W |
| Laptop, LCD | 10.00 W | 4.00 W |
| Desktop + monitor, LCD | 90.00 W | 22.0 W |

Calibrated on measurement rather than on the reporting frameworks. Kirkeby &
Lagermann measured **9–13 W typical** across ten participants, eight user flows
and four laptops (best fit 9.17 / 9.56 / 9.74 / 12.43 W), against the fixed
**15–22 W** that Digst and DIMPACT assume; they conclude the frameworks
overestimate and, critically for a running meter, that *the error scales with
task duration*. A 6 W non-panel base also sits inside the 4.88–6.53 W Energy
Star idle range reported for those same machines. Phone, tablet and desktop come from
[DIMPACT Methodology v1.0](https://dimpact.org/downloadResourceFile?resource=2)
(smartphone 1–2 W via the Carbon Trust white paper; tablet 5.5 W via the BBC
White Paper 2020; desktop + monitor 77–100 W). The measured range is for LCD
machines, so an OLED panel in dark mode sits below it by design.

**Tablets have their own class.** They were previously billed as laptops, at
10 W against DIMPACT's 5.5 W — a 1.8× overstatement and the largest single
error in the table. The panel takes the same ~40% share of the device total
that the phone and laptop rows use, and the OLED tablet keeps the laptop's
OLED-to-LCD ratio.

**Phones default to OLED.** Panel type is not detectable and never will be —
HDR support looked like a tell until it read `true` on a mini-LED laptop — so
the default is a prior, and on phones that prior is now firmly OLED: around 57%
of smartphone shipments, and every current iPhone. The previous LCD default
meant most mobile readers saw dark mode save nothing on a device where it
genuinely saves something. This is the one place in the document where a
default errs *downward* — by 11% for a reader who really is on an LCD phone —
and the picker is how they correct it. Laptops and monitors stay LCD, where
notebook OLED is still under 5% and monitors 2.1%.

Detection is a guess at the device *class* only, made once at load, and a
picker choice overrides it permanently. `guessDevice()` tests the short screen
edge, not the long one: comparing the long edge classified every modern phone
as a laptop (an iPhone 15 is 393×852) and billed it at 10 W instead of 1.35 W.
It also treats a Macintosh reporting touch points as an iPad, because iPadOS 13
and later identify as macOS for desktop-class browsing and the user agent alone
misses every modern iPad.

**Estimated: attended time, on a "duration of use" footing.** The row says `~`
because it is an estimate. The clock runs while susty is the visible tab *and*
there has been a keystroke, pointer move, wheel or scroll inside a **75-second
grace window**. An unbroken absence therefore costs 75 s and nothing more. A
`blur` stops it immediately where the browser sends one.

The grace window is the only parameter and it is anchored: a susty reply runs
roughly 150–350 words, and 200–250 words a minute puts reading it at 40–105 s
without touching anything.

This replaced a plain visibility gate, which could not see a covered window, a
closed lid, or a reader who had walked away: a session left in the foreground
billed the panel for a full hour and the screen reached ~89% of the headline
number, reporting that a tab was open rather than that a conversation happened.
The same 55m 52s now charges 75 s, about 2% of the wall clock. The row shows the
charged figure next to how long the page has simply been open.

**No attention decay, deliberately.** An earlier version of this weighted each
second by a decaying probability that the reader was still present. No published
model does that, and the decay constant was invented. DIMPACT allocates a device
to one service by the service's share of total device use duration (Eq. 19), and
that share — a binary in or out — is the nearest established practice.

**Why not the byte-based route.** The [Sustainable Web Design
Model v4](https://sustainablewebdesign.org/estimating-digital-emissions/) gives
the user-device segment 0.080 kWh/GB and no time term at all, deliberately, on
the reasoning that heavier pages drive more processing and longer engagement.
That is the mainstream for web carbon and it is a reasonable default for a page
you read and leave. It is a poor fit here: susty is a conversation you sit with,
its transfer is tiny, and dwell time is the thing being argued about.

`document.hasFocus()` is deliberately *not* a gate. It reads false in embedded
and second-monitor contexts where the page is genuinely being read, and gating
on it zeroed the row outright. The Idle Detection API would give a real signal
but needs a permission prompt and is Chrome-only — the same trade this project
already refused for Geolocation.

**Errors larger than this model.** Brightness is unknown, and the same study the
dark-mode figures come from finds brightness matters more than theme. Device
power is a single figure standing in for a population; the measurement paper's
own recommendation is that reporting models be periodically recalibrated, and
that service-category calibration beats hardware detail. Arithmetic is tested in
`tools/clock.test.mjs`.

**Declared:** panel type, from a picker. The browser cannot detect it. HDR
support looked like a plausible OLED signal until it returned `true` on a
mini-LED laptop.

| Panel | Light | Dark |
|---|---|---|
| Laptop, LCD | 4.00 W | 4.00 W |
| Desktop monitor, LCD | 22.0 W | 22.0 W |
| Phone, LCD | 0.60 W | 0.60 W |
| Phone, OLED | 0.55 W | 0.45 W |
| Laptop/tablet, OLED | 3.00 W | 2.40 W |
| Monitor/TV, OLED | 9.00 W | 7.20 W |

Device class *is* detectable, from `screen.width`/`height` plus the UA mobile
hint, so the picker pre-selects. It always pre-selects a **backlit** option, so
a first visit never claims a saving that may not exist.

### On dark mode

The OLED phone delta (0.10 W) is calibrated to sit inside the **3–9% of total
phone power** that Dash & Hu measured at the 30–50% brightness people actually
use ([MobiSys 2021](https://dl.acm.org/doi/10.1145/3458864.3467682)). The widely
quoted ~42% saving only holds at full brightness.

Three honest conclusions from that work:

1. **On a backlit panel, dark mode saves nothing.** One lamp burns at a constant
   rate; the crystals block more of it. Local dimming and mini-LED are a partial
   exception we do not try to quantify.
2. **Brightness beats theme.** Their data has 20% brightness in light mode
   drawing about as much as 50% in dark.
3. **Near-black versus pure black is under 1%.** A near-black already emits well
   under 1% of a white screen's light, so pure black wins only marginally.
   susty's dark theme is pure #000000, which is the floor, but the ledger claims
   no saving for that choice specifically: the figure it reports is the panel's
   dark-theme draw, and a near-black would have reported effectively the same.
   The theme is pure black because the design is a tonal inversion of a
   two-colour palette, not because of the reading below it.

Dark is now the **default** theme, so most readers see the dark figure unless
they switch. Note what that is worth in practice: on an LCD panel the saving is
zero and toggling the theme does not move the ledger at all. It moves only for
a reader who has told the picker they are on OLED — 0.60 W on an OLED laptop,
0.10 W on an OLED phone. That is the physics, not a modelling shortcut. That is the lower of the two on OLED and
identical on a backlit panel, which is the honest way round: the default should
not be the one that flatters the total. The picker and the row both name which
panel and which theme the figure assumes.

Laptop and monitor rows are extrapolated from the phone measurements by panel
area. Only phones were measured.

---

## 5. Comparisons

The ledger scales the total against everyday actions to establish proportion:

| Action | g CO₂e |
|---|---|
| Driving a gas car | 170 per km |
| Boiling water for tea | 20 per cup |
| Hot shower, 8 minutes | 500 |
| A beef burger | 3,000 |
| New York to LA, one seat | 250,000 |

These are order-of-magnitude figures. Their job is to show that the footprint of
asking is small next to the footprint of what you do with the answer — which is
the product's actual argument, not a disclaimer on it.

---

## 6. What the ledger tells the reader

The Notes section is the honest summary of everything above, in language that
does not assume a background in grid accounting. It is deliberately short: an
earlier version ran to seven sentences covering publication lag, derived-versus-
published intensity and interregional imports, all true and none of it read.
The detail lives in this document; the ledger keeps what someone needs to judge
the number.

Four paragraphs. The first, third and fourth are fixed:

> We do our best to make these calculations as accurate as possible. Some of it
> has to be estimated, so here's where the numbers come from and where we're
> guessing. The **full method** has all of it.

> The sum itself is simple: energy used × how dirty the electricity is. That
> includes the screen you're reading on, so the total creeps up while the page
> sits open, not just when you ask something. And longer chats cost more per
> answer, because we send the whole conversation back each time.

The second paragraph is assembled from the reader's actual situation, in three
parts: the privacy stance and where we think they are, an offer to narrow it
down where one is available, and the named data source with a link. For a US
reader who has picked a state and has an EIA key configured:

> As a quick note, because we care about your privacy, we don't ask your
> browser for your location or look up your address. We start by guessing your
> country from your computer's clock, which puts you in the United States. The
> electricity figure comes from the **US Energy Information Administration**,
> which tracks what's actually generating power each hour. The energy mix
> shifts through the day as solar comes and goes, but their data runs about a
> day behind, so we use the same hour from yesterday.

The third paragraph is fixed, and is the one place the ledger names something
it wants to know and cannot:

> One thing we don't know precisely, but would be great to find out: which
> specific servers are answering your questions, in a data center somewhere
> else, running on their own electricity. We've assumed they're close to you
> and on the same energy sources, which is an estimate. We'd love to know
> exactly which servers are doing the work and what that data center draws, but
> that isn't public information right now.

The source sentence swaps with the tier: NESO for Great Britain, the EPA for a
chosen US state without a live key, Ember for everywhere else.

Two rules this copy follows, both learned by getting them wrong:

- **No region names in shared copy.** An earlier draft said "a sunny California
  afternoon is roughly half as dirty as the evening rush" to every US reader,
  including in Wisconsin. The ratio was also California-specific: its solar-heavy
  grid roughly halves in the afternoon while coal-heavy regions barely move. Copy
  shared across regions describes the effect without naming one or quoting a
  figure that only holds in some.
- **Assumptions are labelled as assumptions.** The panel type is guessed from
  screen size and defaults to backlit, so the ledger never asserted it as fact.
  That note was later removed entirely: the picker names the panel and the row
  shows the number, so a paragraph explaining both was narrating the interface
  back at the reader.

## Sources

- Luccioni, Viguier & Ligozat 2023, *Power Hungry Processing: Watts Driving the Cost of AI Deployment* — [arXiv:2311.16433](https://arxiv.org/abs/2311.16433)
- Uptime Institute 2023 Global Data Center Survey — [PUE](https://uptimeinstitute.com/2023-data-center-industry-survey-results)
- Dash & Hu 2021, *How much battery does dark mode save?* MobiSys — [ACM](https://dl.acm.org/doi/10.1145/3458864.3467682)
- Kirkeby & Lagermann 2026, *Power Assumptions Matter: Evaluating End-user Laptop Energy Models for Sustainability Reporting of Browser-Based Web Services*, Roskilde University — [arXiv](https://arxiv.org/abs/2510.12566). The measured 9–13 W this row's laptop figure is built on, and the finding that constant-power error scales with session duration.
- DIMPACT Methodology v1.0, October 2022, University of Bristol / Carbon Trust — [PDF](https://dimpact.org/downloadResourceFile?resource=2). Device power values for phone and desktop, and Eq. 19, the share-of-duration allocation rule this row follows.
- Carbon Trust 2021, *Carbon impact of video streaming* — [PDF](https://www.carbontrust.com/sites/default/files/documents/resource/public/Carbon-impact-of-video-streaming.pdf). Origin of the 1–2 W smartphone figure, and the average-versus-marginal allocation discussion.
- Sustainable Web Design Model v4 — [method](https://sustainablewebdesign.org/estimating-digital-emissions/). The byte-based alternative (0.080 kWh/GB for the device segment) this project deliberately does not use, and why.
- ITU-T L.1801 (02/2026), *Guidelines for assessing the environmental impact of artificial intelligence systems* — [summary](https://www.itu.int/dms_pubrec/itu-t/rec/l/T-REC-L.1801-202602-I!!SUM-HTM-E.htm). LCA framework for AI systems, building on ITU-T L.1410. It prescribes no device coefficients; what it requires is a declared system boundary and a measurable functional unit. Only the free summary and scope were read — the normative clauses were not available.
- NESO Carbon Intensity API — [api.carbonintensity.org.uk](https://api.carbonintensity.org.uk/)
- EIA Open Data / EIA-930 — [eia.gov/opendata](https://www.eia.gov/opendata/)
- EIA, CO₂ per MWh by fuel and heat rates — [Today in Energy](https://www.eia.gov/todayinenergy/detail.php?id=48296)
- EPA eGRID2023 Rev 2 — [epa.gov/egrid](https://www.epa.gov/egrid/summary-data)
- Ember Global Electricity Review 2025 — [ember-energy.org](https://ember-energy.org/data/yearly-electricity-data/)
- Frontier 2024 State of Carbon Dioxide Removal — [frontierclimate.com](https://frontierclimate.com/writing/2024-state-of-cdr)
