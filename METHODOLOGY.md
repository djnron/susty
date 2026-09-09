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
grams CO₂e = ( (tokens × energy per token) × PUE × (1 + embodied)
              + exchanges × hosting ) × grid intensity
```

### Constants

| Term | Value | Source |
|---|---|---|
| Energy, tokens sent | 0.05 mWh/token | Luccioni et al. 2023 |
| Energy, tokens written | 0.5 mWh/token | Luccioni et al. 2023 |
| Cooling and overhead (PUE) | ×1.12 | Uptime Institute 2023, global average |
| Embodied hardware | +15% | Patterson et al. 2021 |
| Hosting and network | 0.003 Wh per exchange | modelled |
| Grid intensity | see §3 | varies by source |

Token counts come from the API's own `usage` field, so the input to the model is
measured rather than estimated. Everything after that is modelled.

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

- **Your screen.** Listed separately for scale, never added in (§4).
- **Training.** This measures inference only. Amortised training cost per query
  is real and not counted here.
- **Your device's CPU, network, and router.** Only the display is modelled.

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

**One acknowledged approximation.** The same figure is applied to the reader's
screen, where it fits, and to the data centre, where it probably does not. Those
servers may sit in another country on a cleaner or dirtier grid, and there is no
way to see which from the browser.

---

## 4. Your screen

Reported for scale and **not added to the total**, because it mixes a measured
quantity with a declared one and would degrade the number the product's
credibility rests on.

**Measured:** screen-on time, via the Page Visibility API. The clock pauses when
the tab is not visible. (It cannot detect a covered window or a closed lid —
inherent to the API.)

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
   under 1% of a white screen's light. susty's dark theme uses near-black for
   legibility, not for the meter.

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

## Sources

- Luccioni, Viguier & Ligozat 2023, *Power Hungry Processing: Watts Driving the Cost of AI Deployment* — [arXiv:2311.16433](https://arxiv.org/abs/2311.16433)
- Patterson et al. 2021, *Carbon Emissions and Large Neural Network Training* — [arXiv:2104.10350](https://arxiv.org/abs/2104.10350)
- Uptime Institute 2023 Global Data Center Survey — [PUE](https://uptimeinstitute.com/2023-data-center-industry-survey-results)
- Dash & Hu 2021, *How much battery does dark mode save?* MobiSys — [ACM](https://dl.acm.org/doi/10.1145/3458864.3467682)
- NESO Carbon Intensity API — [api.carbonintensity.org.uk](https://api.carbonintensity.org.uk/)
- EIA Open Data / EIA-930 — [eia.gov/opendata](https://www.eia.gov/opendata/)
- EIA, CO₂ per MWh by fuel and heat rates — [Today in Energy](https://www.eia.gov/todayinenergy/detail.php?id=48296)
- EPA eGRID2023 Rev 2 — [epa.gov/egrid](https://www.epa.gov/egrid/summary-data)
- Ember Global Electricity Review 2025 — [ember-energy.org](https://ember-energy.org/data/yearly-electricity-data/)
- Frontier 2024 State of Carbon Dioxide Removal — [frontierclimate.com](https://frontierclimate.com/writing/2024-state-of-cdr)
