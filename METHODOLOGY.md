# Susty Methodology

**Integrated methodology — completed-exchange functional unit**
**Status:** Candidate for release — no open methodology decisions (see [Decisions taken](#decisions-taken-on-23-september-2026)); calibration work is listed in [§15](#15-next-steps-data-and-specificity)
**Date:** 23 September 2026
**Verified:** sources and code re-checked on 23 September 2026 (see [§14 Verification log](#14-verification-log))

Susty estimates the **operational carbon footprint of an AI conversation**. It combines modeled AI inference energy, modeled service/hosting energy, and estimated end-user device energy during attended use, then applies grid carbon intensity.

This is an **operational estimate, not a full life-cycle assessment**. Training and embodied hardware emissions are excluded. Every material input is identified as measured, derived, inferred/declared, or modeled. Where a number is a guess, this document says so and, where known, which direction it errs. The product's argument depends on the arithmetic being checkable, so the uncomfortable parts are written down rather than rounded away.

---

## Decisions taken on 23 September 2026

The verification pass (see [§14](#14-verification-log)) found places where the product's numbers or labels were not accurate. Each was decided and changed:

1. **Grid accounting basis.** Sources are not converted to one basis, because a conversion adds error (§6.1). The ledger now labels every grid figure operational or life-cycle.
2. **Renewable-tariff preset removed.** It was unsourced and market-based inside a location-based model (§6.7).
3. **Gemini priced from EcoLogits.** ×1.36 for Gemini 3.8 Flash and ×0.85 for Gemini 3.5 Flash-Lite, replacing the ×1.00 proxy; Flash-Lite is the client default and runs at its minimal thinking level; Gemini replies are capped (§4.4–4.6).
4. **Offset price is today's price.** About $320 per tonne, the 2024 average for durable removal, replacing a $100 target price (§10).
5. **National grid figures refreshed** from one Ember release and data year by a committed script (§6.5).

---

## 1. Functional unit

Susty's primary functional unit is **one completed exchange**.

> A completed exchange is one user prompt and the corresponding model response that reaches an explicit normal provider completion and is committed to the conversation.

The primary reported value is a **session average**:

```text
g CO2e per completed exchange
= total operational session emissions / completed exchanges
```

This is not the measured footprint of a specific individual exchange. Device energy accrues across the session while the user is estimated to be attending to Susty, so the cleanest way to put all components on one functional unit is to normalize the total session footprint by the number of completed exchanges.

### Completion rules

- A response counts as completed only when Susty receives the provider's normal terminal signal. For the current adapters, Anthropic must end with `message_stop` and `stop_reason = end_turn`; Gemini `finishReason = STOP` is normalized to the same state.
- Anthropic `max_tokens`, `refusal`, any other stop reason, a mid-stream `error` event, or a stream that closes without `message_stop` is **incomplete**.
- Gemini `MAX_TOKENS`, safety/block reasons, an unknown reason, or a missing `finishReason` is **not completed**. End of stream alone is never taken as proof of completion.
- A request that produces no usable text is **failed**.
- Energy from incomplete or failed attempts remains in the session numerator when it can be measured or reasonably modeled. It never increases the denominator.
- If provider usage is unavailable for a failed attempt, the unobserved inference energy is a known limitation.

Each request record carries one of three explicit statuses — `completed`, `incomplete`, `failed` — and the denominator is derived only from records whose status is `completed`.

### Why exchange rather than token?

Tokens are an important workload measure, but they are not a complete functional unit for Susty's system boundary. The product also includes hosting and end-user device use, including reading time, which does not scale directly with token count.

Susty therefore uses:

- **Completed exchange** — primary functional unit.
- **Session total** — cumulative footprint of the measured conversation.
- **Input, output, and thinking tokens** — workload and diagnostic measures.
- **Attended time** — the activity basis for device energy.

This framing is informed by the Green Software Foundation's Software Carbon Intensity approach, which requires a consistent functional unit across the defined software boundary. The SCI for AI specification suggests "per token" as the consumer functional unit for LLMs; Susty uses exchange as the primary unit because its boundary includes the user device and attended use, and SCI for AI requires the chosen unit and its rationale to be stated, which this section does. Susty is not presented as a formal SCI score because it excludes embodied emissions and does not implement all SCI accounting requirements. ITU-T L.1801 (02/2026) likewise requires a declared system boundary and a measurable functional unit; it prescribes no device or token coefficients.

---

## 2. System boundary

### Included

1. **AI inference** associated with the prompt and model response.
2. **Data-center facility overhead** through a PUE multiplier.
3. **Hosting and network/service overhead** as a fixed modeled amount per request handled by the Susty service.
4. **End-user device electricity** — the whole device, not only its display — during estimated attended time.
5. **Grid carbon intensity** used to convert electricity to CO2e.

### Excluded

- **Model training.** Amortised training cost per query is real and not counted.
- **Embodied emissions** from servers, accelerators, user devices, and network hardware. Susty once added a flat +15% to electricity for this; that treated manufacturing emissions as electricity, which they are not, and the multiplier was removed rather than turned into a separate term. On the AI side, a defensible per-request share would need the accelerator that served the request, its manufacturing footprint, and this request's slice of its lifetime throughput — none knowable from outside the provider. On the device side, per-product lifecycle reports exist, but manufacturing is not marginal to one session on a device that exists regardless, the amortisation basis has no settled answer, and the result would likely dominate rather than refine the figure.
- Home/office router and access-network electricity beyond the flat hosting/network assumption.
- Manufacturing and end-of-life impacts.
- Any inference energy that cannot be observed or estimated after an upstream failure.

The result should therefore be described as **estimated operational CO2e**, not total life-cycle emissions — with the caveat in [§6.1](#61-accounting-basis) that some grid inputs are themselves life-cycle intensities.

---

## 3. Carbon calculation

Susty calculates request-level server emissions and session-level device emissions, then combines them.

### AI request energy

For request `j`:

```text
inference_Wh(j)
= ((input_tokens x 0.05) + (output_tokens x 0.5)) / 1000
  x model_factor
  x PUE

service_Wh(j)
= 0.003 Wh

request_gCO2e(j)
= (inference_Wh(j) + service_Wh(j))
  x grid_intensity(j) / 1000
```

Token coefficients are in **mWh per token** before conversion to Wh. Each request is priced once, at the model factor and grid intensity in effect when it is recorded, and the record is then frozen. Changing model, grid, device, panel, or theme later never reprices it.

### Device energy

For each attended interval `t`:

```text
device_Wh(t)
= device_watts(t) x attended_hours(t)

device_gCO2e(t)
= device_Wh(t) x grid_intensity(t) / 1000
```

Each slice is priced at the wattage and grid in effect during that slice. Before a grid, device or theme change takes effect, the elapsed slice is closed out at the old values, so time already spent is never billed at a rate set after it.

### Session total

```text
session_gCO2e
= sum(request_gCO2e)
  + sum(device_gCO2e)
```

### Functional-unit result

```text
average_gCO2e_per_completed_exchange
= session_gCO2e / completed_exchanges
```

Before the first completed exchange, the functional-unit value is undefined and is shown as `—`, not zero.

Because attended device energy can continue to accrue after a response, the average per completed exchange can increase while a user reads. It can also decrease when a new completed exchange increases the denominator. The **session total never decreases**.

### Why longer chats cost more per turn

The whole conversation history is re-sent on every request, so input tokens grow roughly linearly with conversation length and each successive answer costs more than the last. The ledger says so rather than letting the total look mysteriously superlinear.

---

## 4. AI inference

### 4.1 Token measurement

Susty uses token counts reported by the model provider where available: Anthropic's `usage.input_tokens` (on `message_start`) and `usage.output_tokens` (on the final `message_delta`); Gemini's `usageMetadata`.

Thinking/reasoning tokens are **measured**, not inferred:

- Anthropic reports `usage.output_tokens_details.thinking_tokens`, a subset of `output_tokens`, on the final `message_delta`. They are already billed at the output rate; the ledger shows them separately for transparency.
- Gemini's `candidatesTokenCount` **excludes** `thoughtsTokenCount` (Google documents the total as prompt + thoughts + candidates). The adapter sums the two before passing them on, so both providers reach the browser with the same inclusive relationship. Sending `candidatesTokenCount` alone had silently priced Gemini's reasoning at zero.

### 4.2 The estimate fallback

When usage is missing, tokens are estimated at **4 characters per token**, with two corrections:

- The estimate runs **before** the reply is appended to history, so the model's own output is not counted as part of the request that produced it.
- A constant **275 tokens** is added for the system prompt, which is billed as input on every turn but never appears in the client's history. (Measured against a live request: a 13-token question reported 278 input tokens.)

The fallback ignores the server's 40-message and 4,000-character truncation, so it over-counts on long conversations. It is a fallback; the measured path is the normal one. The ledger does not currently mark a turn whose tokens were estimated — a known gap.

### 4.3 Energy-per-token coefficients

| Term | Central value | Status |
|---|---:|---|
| Input tokens | 0.05 mWh/token | Susty modeling assumption |
| Output tokens | 0.5 mWh/token | Susty modeling assumption |

These values must **not** be attributed to Luccioni et al. That study measures energy per **1,000 inferences** across model and task classes (text generation averaged about 0.047 kWh per 1,000 inferences on the open models tested); it publishes no input/output per-token coefficients. The coefficients remain a central modeling assumption until Susty has a reproducible provider/model-specific calibration.

**Order-of-magnitude check, not a calibration.** An illustrative Susty exchange (831 input and 571 output tokens across two turns, at PUE 1.12 plus hosting) comes to **0.186 Wh per exchange**. Oviedo et al. (*Joule*, 2026) estimate a median **0.31 Wh per query (IQR 0.16–0.60)** for frontier-scale models (>200B parameters) on H100 nodes, for a standard query with a median of 300 output tokens. Susty's figure falls inside that range. `tools/clock.test.mjs` asserts this so the coefficients cannot drift out of it unnoticed.

**Where Susty sits: at the low end.** Susty's inference energy for a comparable query is at the low end of published estimates, not the middle. Provider disclosures are per query, without token counts, so they cannot yet be turned into per-token coefficients; scopes also differ (idle capacity, host systems, batch size, hardware). The comparison is indicative:

| Source | Scope | Wh per query | Implied per output token |
|---|---|---:|---:|
| Google (2025), median Gemini Apps text prompt | Measured in production; accelerators, host, idle capacity, PUE | 0.24 (0.10 accelerators only) | not disclosed |
| OpenAI (2025), average ChatGPT query, as cited by Oviedo et al. | Disclosed; method unpublished | 0.34 | not disclosed |
| Oviedo et al. (2026), >200B parameters on H100, 300 median output tokens | Bottom-up model, PUE 1.05–1.40 | 0.31 (IQR 0.16–0.60) | ≈ 1.0 mWh, all-in |
| EcoLogits 0.11 full model, Sonnet 4.6, 300 output tokens | GPU count, server, PUE, batch 64 | 0.46–0.75 | 1.5–2.5 mWh |
| **Susty**, Sonnet 4.6, 1,000 input / 300 output tokens | Coefficient model, PUE 1.12 | **0.22** | **0.56 mWh** |

On these references the absolute coefficient could plausibly be about 2–4.5× higher for a Sonnet-class model. Susty keeps its values until they can be calibrated against provider data (§15), rather than swapping one unverified number for another.

**Cross-check as average power draw.** Energy per token × generation speed gives the data-centre power attributed to one active reply. Susty's coefficients (including PUE) imply about 62 W for Haiku 4.5 (1.05 J/token × 59 tokens/s), 67 W for Sonnet 4.6 (2.02 × 33) and 93 W for Gemini 3.5 Flash-Lite (1.71 × 54), using EcoLogits' measured throughputs. An 8×H100 node (10.2 kW maximum, 0.7 utilisation, PUE 1.12) shared by 32–64 concurrent requests implies 125–250 W per request. Susty's figures falling below that range is consistent with its coefficients being on the low side, or with an assumption of heavier batching than 64.

The tenfold difference between input and output means long generated responses generally dominate inference energy, although accumulated chat history makes later prompts progressively more expensive.

**Reply length matters more than model choice.** Oviedo et al. find that a reasoning-length query (median 5,000 output tokens, ~15× a standard query) raises median energy about **13×**, to 3.91 Wh (IQR 2.15–7.05). The entire spread between Haiku and Opus in the factor table below is about 2.6× (20× or more on EcoLogits' full model; §4.4). Whether extended thinking is on, and how long the reply runs, decides far more than which model serves it.

### 4.4 Model factors

Per-token energy scales with a model's active parameter count. Susty applies relative factors anchored on `claude-sonnet-4-6` = 1.00, derived from [EcoLogits](https://ecologits.ai/)' GPU energy function, which EcoLogits fitted to the measured [ML.ENERGY leaderboard](https://ml.energy/):

```text
f(P_active, B) = 1.1665e-6 · e^(-0.011206·B) · P_active + 4.0529e-5   Wh per output token
```

`P_active` is in billions of parameters, evaluated at the midpoint of EcoLogits' active-parameter range. Susty evaluates at batch size **B = 32**; EcoLogits' own default is 64, which would narrow the spread (Haiku 0.59, Opus 1.29). `tools/clock.test.mjs` reproduces every published factor from this function, so none of them is a typed-in number.

| Model/tier | Active params (EcoLogits est.) | Relative factor | Status |
|---|---|---:|---|
| Claude Haiku 4.5 | 10–35B, dense | 0.52 | derived from EcoLogits/ML.ENERGY |
| Claude Sonnet 4.6 | 44–132B, MoE | 1.00 | anchor |
| Claude Opus 4.6 / 4.7 / 4.8 | 67–200B, MoE | 1.33 | derived from EcoLogits/ML.ENERGY |
| Gemini 3.5 Flash-Lite | 30–105B, dense | 0.85 | derived from EcoLogits/ML.ENERGY |
| Gemini 3.8 Flash | 75–200B, MoE | 1.36 | derived from EcoLogits/ML.ENERGY |

**Limits.** EcoLogits flags every Anthropic and Google entry `model-arch-not-released`: parameter counts are inferred, not disclosed, so these factors are a spread rather than a precision. The Gemini factors are derived exactly as the Claude ones are; until 23 September 2026 both Gemini tiers were priced at the Sonnet anchor as an uncalibrated proxy, which understated Gemini 3.8 Flash by about a quarter. The factor covers per-token energy only: Gemini's thinking tokens are counted separately (§4.1) and priced as output. The 5-series Claude models are deliberately absent; an unrecognised model falls back to the anchor.

**What the factors leave out: GPU count.** The factors use only EcoLogits' per-GPU energy term. EcoLogits' full model also multiplies by the number of GPUs needed to hold the model in memory (1.2 × total parameters × 2 bytes over 80 GB GPUs, rounded up to a power of two), and adds non-GPU server power, provider PUE and batch 64. Because GPU count follows **total** parameters, the full model separates small and large models far more:

| Model | Susty factor | EcoLogits full model, mWh per output token (300 tokens) |
|---|---:|---:|
| Claude Haiku 4.5 | 0.52 | 0.07–0.19 |
| Gemini 3.5 Flash-Lite | 0.85 | 0.09–0.53 |
| Claude Sonnet 4.6 | 1.00 | 1.52–2.51 |
| Claude Opus 4.8 | 1.33 | 3.50–6.43 |
| Gemini 3.8 Flash | 1.36 | 3.66–6.14 |

On the full model the Haiku-to-Opus spread is 20× or more, against Susty's 2.6×. Susty's factors therefore likely **understate large models and overstate small ones**, and Flash-Lite's modeled saving against Sonnet (15% per token) is likely understated. The full model is not adopted wholesale because it also appears to overstate some serving: for Gemini 3.8 Flash it gives 1.1–1.8 Wh per 300-token reply, while Google's measured median for a Gemini Apps prompt is 0.24 Wh, a gap consistent with GPU-based sizing misrepresenting TPU serving. Calibrating against provider data is the next step (§15). Model ids are matched by longest prefix because the API answers with dated ids (`claude-haiku-4-5` returns `claude-haiku-4-5-20251001`); an exact lookup once billed Haiku at the Sonnet anchor.

### 4.5 Model routing and tiers

The ledger's model picker offers six tiers across two providers. The client sends an opaque key and `api/chat.js` owns the only mapping to a model, so a modified client cannot name an arbitrary model or switch thinking on.

| Tier | Model | Thinking | Per-token factor |
|---|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` | off | ×0.52 |
| Sonnet 4.6 | `claude-sonnet-4-6` (overridable via `ANTHROPIC_MODEL`) | off | ×1.00 (anchor) |
| Opus 4.8 | `claude-opus-4-8` | off | ×1.33 |
| Opus 4.8, extended thinking | `claude-opus-4-8` | adaptive, effort `low`, 4,000-token ceiling | ×1.33 **plus the thinking tokens** |
| **Gemini 3.5 Flash-Lite** (client default) | `gemini-3.5-flash-lite` | cannot be disabled; level `minimal` | ×0.85 **plus the thinking tokens** |
| Gemini 3.8 Flash | `gemini-3.8-flash` | cannot be disabled; level `low` | ×1.36 **plus the thinking tokens** |

**The client default is Gemini 3.5 Flash-Lite.** A Gemini tier became the default to spread load off the Anthropic key. Flash-Lite is the default because it has the lowest modeled per-token energy of the Gemini tiers (×0.85) and runs at the lowest thinking level Google offers for it. That is a modeled comparison, not a measured one, and it says nothing about answer quality; the picker labels it simply "Gemini 3.5 Flash-Lite (default)" rather than calling it efficient; its factor is shown in the ledger's model row.

Gemini 3 models cannot switch thinking off. Each tier runs at the lowest level its model accepts: `minimal` for Flash-Lite (also Google's default for that model) and `low` for Flash, which does not offer `minimal`. Until 23 September 2026 Flash-Lite ran at `low`, above its floor. Thinking tokens are measured through `thoughtsTokenCount` and priced as output.

**Server fallback is a separate concept.** `DEFAULT_TIER` in `api/chat.js` stays `sonnet`: it is what a request degrades to if a tier is unrecognised, gated, or its provider is not configured, and it must be a provider that is always present. The tier is a request, not a setting — the ledger reports the model that actually answered (from the response's `message.model`), not the one asked for.

Two server switches, both default-on:

| Variable | Effect |
|---|---|
| `SUSTY_EXPENSIVE_TIERS=off` | Drops the thinking tier; everything else stays |
| `SUSTY_TIERS=off` | Collapses every request to the default tier |

A visitor on the thinking tier can raise the cost of an exchange several times over, on the deployment's own key, against a rate limit that resets on cold start. `SUSTY_EXPENSIVE_TIERS=off` is the lever.

### 4.6 Guardrails

The endpoint is public, so:

- **40 messages** of history forwarded, **4,000 characters** per message.
- **1,000 output tokens** maximum per Anthropic reply (4,000 on the thinking tier, because thinking counts against the ceiling).
- **2,000 output tokens** per Gemini reply. Gemini counts thinking tokens against `maxOutputTokens` and enforces it as a hard cutoff, so the cap is the standard reply ceiling plus the same again as thinking headroom. A reply that hits it ends with `MAX_TOKENS` and is recorded as incomplete.
- **25 requests per IP per 10 minutes.** Rate-limit state is in-process: it resets on a cold start and is not shared between instances. It deters casual abuse; it is not a quota. The limiter checks before recording, so rejected attempts do not extend the window, and when the map exceeds 5,000 addresses it evicts the oldest 1,000 rather than clearing.

`clean()` forwards only role and string content. It also drops leading non-`user` turns, because a 40-message window over an even-length history can open on an assistant turn, which the Messages API rejects.

### 4.7 Streaming

Deltas are rendered as they arrive, coalesced to one render per animation frame, and flushed synchronously when the stream closes (`requestAnimationFrame` does not run in a hidden tab). Partial text from an interrupted or truncated reply is kept on screen and recorded as **incomplete** rather than stored as a complete reply. If nothing usable arrives, the exchange is removed from both transcript and history, and the question is returned to the input box.

---

## 5. PUE and service overhead

### PUE

Susty applies a **PUE of 1.12** to modeled AI inference energy.

This value is a **Susty hyperscale-data-center assumption**, not the Uptime Institute global average. Uptime reports a 2023 industry average PUE of **1.58** (per site) and a capacity-weighted figure of **1.47**. Large modern hyperscale facilities operate below those averages; Oviedo et al. model AI data-center PUE as a distribution with P5–P95 of 1.05–1.40, "consistent with hyperscaler public reports", and 1.12 sits inside that range. Susty does not know which facility serves a given request.

PUE is therefore a material uncertainty and is treated as a modeled parameter rather than a measured fact.

### Idle and reserved capacity

Susty has no explicit term for idle capacity that providers keep available for reliability and low latency, or for host-system energy beyond what the per-token coefficient implicitly covers. Google reports these as material: its median Gemini Apps prompt is 0.10 Wh on active accelerators alone and 0.24 Wh once host systems, idle machines and data-centre overhead are included.

### Hosting and network

```text
0.003 Wh per request handled by Susty
```

This is a declared modeling assumption covering the serverless function and network round trip. It does not represent a direct measurement of Vercel, internet transit, or the user's local network.

An unsuccessful request still incurs this service term when the browser receives an HTTP response from Susty, even though it does not increase the completed-exchange denominator. A client-side fetch failure with no HTTP response is not recorded because the client cannot know whether the service was reached.

---

## 6. Grid carbon intensity

The single largest lever in the formula. Electricity is converted to carbon using the best available source for the user's selected or inferred region, and the ledger names the source in force.

### 6.1 Accounting basis

The sources do **not** share one accounting boundary:

| Source | Used for | Basis |
|---|---|---|
| NESO Carbon Intensity API | Great Britain, national and 14 regions | Operational (direct combustion; biomass 120, wind/solar/nuclear/hydro 0 g/kWh) |
| EIA-930 fuel mix × Susty fuel factors | US regions, hourly | Operational (direct combustion) |
| EPA eGRID2023 Rev 2 | US subregions, annual | Operational (CO2e output emission rates) |
| Ember yearly data | All other countries, EU, world, US national fallback | **Life-cycle** (IPCC AR5 Annex III factors, including supply chain and upstream methane) |
| Electricity Maps (optional) | Any zone, when configured | **Life-cycle** (the API's default `emissionFactorType`) |

**The ledger names the basis in force.** The grid-intensity row reads, for example, `384 g/kWh, life-cycle` or `212 g/kWh, operational`, and the source note says in plain words which one applies.

**Why the figures are not converted to one basis.** Ember applies the same global life-cycle factor per fuel to every country (coal 820, gas 490, other fossil 700, wind 11 g CO2e/kWh), not each country's actual plant efficiency. So an Ember figure is not simply "operational plus a margin": it can be higher or lower than an operational figure for the same grid. For the US, Ember's 2024 figure is **384 g/kWh** against eGRID2023's operational **350 g/kWh** (770.9 lb/MWh). Recomputing Ember's generation mix with Susty's operational fuel factors moved countries by −76% to +20% (Sweden 35 → 8, South Africa 718 → 861), which would add a new error rather than remove one. A single source publishing both bases for every zone with one method — Electricity Maps' paid tier, for example — is the clean fix, and remains future work. Against the other uncertainties in the model, chiefly the absolute token-energy coefficients, the basis difference is secondary; it is disclosed rather than hidden.

### 6.2 Great Britain — NESO

[NESO Carbon Intensity API](https://api.carbonintensity.org.uk/). Open, no key, no registration; nothing about the visitor is sent.

- **National:** uses the published `actual` for the current half hour, falling back to `forecast`.
- **Regional (14 DNO regions):** the regional endpoints publish **only a forecast** for the current half hour, not an actual. Regional GB figures are therefore NESO's current-period forecast, not a measured reading.

### 6.3 United States — hourly, derived from EIA-930

[EIA-930](https://www.eia.gov/opendata/) hourly generation by fuel type, turned into an intensity with per-fuel factors. Requires a free `EIA_API_KEY`. EIA publishes hourly CO2 only in bulk spreadsheets, not the API, so intensity is **derived from the generation mix**:

| Fuel | g/kWh | Basis |
|---|---:|---|
| Coal | 1,024 | EIA: 2,257 lb/MWh |
| Natural gas | 443 | EIA: 976 lb/MWh |
| Petroleum | 800 | ~73–74 kg CO2/MMBtu at ~10,800 Btu/kWh |
| Other | 600 | mixed bucket, uncertain |
| Geothermal | 40 | reservoir fluid vents dissolved CO2; literature average ~45 |
| Nuclear, hydro, wind, solar | 0 | operational emissions only |
| Solar/wind with storage attached | 0 | counted as the generation they are |
| Battery, pumped, other storage | excluded | time-shifted; counted when charged |

Storage is excluded deliberately: pricing a discharged MWh at zero would credit it as carbon-free while its charging energy stayed uncounted. The fuel list follows the API's own `fueltype` facet; an older eight-fuel table silently dropped geothermal and storage-paired renewables and biased California high by about 3%.

**The feed runs roughly 15 hours to a day behind.** The newest published hour is therefore usually the middle of last night. Measured once in California, the newest hour read 330 g/kWh while the grid was near 169 — a 2× error. Susty instead uses the **most recent occurrence of the current hour of day**, because the diurnal shape is strongly periodic. This is an **hour-matched proxy**, not real-time data. If no matching hour is available it uses the most recent complete hour and says so. An hour is only accepted if it reports a fuel count comparable to the best hour in the window (at least 3, and at least 70% of the best), so a half-published snapshot is never presented as authoritative.

Interregional imports are ignored, which biases import-heavy regions. Hawaii, Alaska and Puerto Rico are absent from EIA-930 and stay on eGRID.

### 6.4 United States — annual, by eGRID subregion

[EPA eGRID2023 Rev 2](https://www.epa.gov/egrid/summary-data) subregion total output CO2e rates, converted from lb/MWh (× 0.453592). Used when hourly EIA data is unavailable. Subregions run from **110 g/kWh** (upstate New York) to **702** (Puerto Rico). States that straddle subregions with a wide gap are offered split — Hawaii, Illinois, Michigan, Montana, New York (three ways), Pennsylvania, Texas (three ways) and Wisconsin. The picker names geography the reader can identify rather than inferring from a ZIP table, which would mean fabricating hundreds of mappings across boundaries that do not follow postal lines.

When the United States is selected with no subregion, Susty uses **384 g/kWh**, Ember's 2024 US figure — a life-cycle intensity, see [§6.1](#61-accounting-basis).

### 6.5 Other countries — Ember

[Ember](https://ember-energy.org/data/yearly-electricity-data/) 2024 national annual intensities, from Norway (30) to South Africa (718); world 471, EU 212. Annual means miss both the daily swing and regional spread, and the ledger says so.

Every national value, the EU and world averages, and the US national fallback come from **one Ember release and one data year**, regenerated by `tools/ember-grids.mjs`, which records the year and retrieval date in `index.html`. The table had drifted: values had been entered by hand over time, and after Ember's revisions six were 4–17 g/kWh off. The script refuses a year that any listed country lacks; 2025 data exists but is missing Indonesia, Saudi Arabia and the United Arab Emirates, so Susty stays on 2024 until it is complete.

### 6.6 Optional — Electricity Maps

Live intensity for any zone via `ELECTRICITY_MAPS_TOKEN`. Not used by default: absolute values need a paid plan. When it supplies a figure, the ledger credits Electricity Maps and labels the figure life-cycle, the API's default basis.

### 6.7 No renewable-tariff option

Susty offered a "Renewable tariff (hydro or wind)" preset at 30 g CO2/kWh until 23 September 2026. It was removed because:

- it had no recorded source;
- a tariff is a contractual (market-based) instrument, while every other figure in Susty is location-based — the electricity the local grid physically supplies to the reader's device and, by approximation, the servers;
- choosing it let a reader remove most of the footprint by picking a label.

Susty is a location-based estimate. A reader on a renewable tariff still draws from the same grid; the tariff changes who is paid for which generation, not what their device runs on. A visitor who had the preset saved falls back to their time-zone guess.

### 6.8 Location

Country is inferred from the browser's IANA time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Geolocation needs a permission prompt; IP lookup hands a third party the visitor's address and adds a network request with its own footprint. The time zone is permissionless, instant, offline, and nothing leaves the browser. Unlisted European zones fall back to the EU average; anything else to the world average. The user can refine the country, and a region where a sub-picker exists.

### 6.9 Server-grid approximation

Susty applies the selected grid intensity to both the user's device and the remote AI/service energy. The device-side use is geographically plausible. The server-side use is a known approximation: the serving data center may be in another region on a different mix, and there is no way to see which from the browser. The ledger discloses this explicitly.

---

## 7. End-user device

Susty includes the **whole end-user device**, not only the display. Every published framework counts the device rather than the screen alone; counting only the panel understated this row by roughly 2–3×. The device row can easily exceed the AI inference itself over a long reading session, which is why it is shown on its own row rather than buried in the sum.

### 7.1 Device power

Device power is modeled as a non-panel base load plus a panel component. The panel is what lets theme move the number; it is a component of the device figure, not an addition to it.

| Configuration | Whole device | Panel (light / dark) |
|---|---:|---:|
| Phone, OLED | 1.45 / **1.35 W** | 0.55 / 0.45 W |
| Phone, LCD | 1.50 W | 0.60 W |
| Tablet, OLED | 4.95 / 4.62 W | 1.65 / 1.32 W |
| Tablet, LCD | 5.50 W | 2.20 W |
| Laptop, OLED | 9.00 / 8.40 W | 3.00 / 2.40 W |
| Laptop, LCD | 10.00 W | 4.00 W |
| Desktop + OLED monitor | 77.00 / 75.20 W | 9.00 / 7.20 W |
| Desktop + LCD monitor | 90.00 W | 22.0 W |

**Calibrated on measurement where it exists.** Kirkeby & Lagermann (SAC '26) measured typical laptop power of **9–13 W** during realistic browsing (best-fit 9.17–12.43 W across four laptops and ten participants), against the fixed **15–22 W** that the Digst and DIMPACT reporting models assume. They conclude the frameworks overestimate, and that the error **scales with task duration** — exactly the failure mode a running meter would accumulate. The laptop base of 6 W sits inside the 4.88–6.53 W Energy Star idle range of the same machines.

Phone, tablet and desktop come from [DIMPACT Methodology v1.0](https://dimpact.org/downloadResourceFile?resource=2), Table 6: smartphone 1–2 W (Carbon Trust white paper, lower bound), tablet 5.5 W (BBC White Paper 372, 2020), desktop & monitor 77–100 W. The panel takes about 40% of the LCD device total in the phone, tablet and laptop rows; the OLED tablet keeps the laptop's OLED-to-LCD ratio. Tablets were once billed as laptops (10 W against DIMPACT's 5.5 W), a 1.8× overstatement.

These are representative model values, not measurements of the visitor's device.

### 7.2 Detecting the device

Device **class** is detectable; panel type and brightness are not. `guessDevice()` tests the screen's **short** edge (testing the long edge classified every modern phone as a laptop — an iPhone 15 is 393×852), treats a Macintosh reporting touch points as an iPad (iPadOS 13+ identifies as macOS), and only guesses a desktop monitor when the long edge is ≥ 2,200 px, since 1920×1080 is the most common laptop panel. A picker choice overrides the guess permanently.

Panel type is a **declared prior**. HDR support looked like an OLED signal until it read `true` on a mini-LED laptop. Phones default to **OLED** — about 63% of smartphones shipped in Q1 2025 had OLED displays (Omdia), and every current iPhone does. That default errs downward by about 11% for a reader genuinely on an LCD phone, who can correct it in the picker. Tablets, laptops and monitors default to **LCD**, where OLED remains a small share.

### 7.3 Attended time

Susty estimates **attended time**, not literal screen-on time and not verified human attention.

The device clock runs while Susty is the visible tab **and** there has been a keystroke, pointer, wheel, scroll, touch or mouse event within a **75-second grace window**. An unbroken absence therefore costs 75 seconds and no more. A `blur` stops accrual immediately where the browser emits one; a hidden tab accrues nothing. A 2-second heartbeat keeps the total current and is what actually stops the clock when a reader walks away.

- **The grace window is the only parameter, and it is anchored:** a Susty reply runs roughly 150–350 words, and at 200–250 words a minute reading it takes 40–105 seconds without touching anything.
- **Why:** a plain visibility gate billed a tab left in the foreground for a full hour (55 min 52 s open, one exchange, charged 3,352 s). The same session now charges 75 s, about 2% of the wall clock. The ledger shows the charged time next to how long the page has simply been open.
- **No attention decay.** An earlier version weighted each second by an invented decaying probability of presence. No published model does that. DIMPACT estimates end-user device energy as mean device power × duration of service use (Equation 16); a binary in-or-out allocation is the nearest established practice.
- **Not byte-based.** The Sustainable Web Design Model v4 gives the device segment an energy-per-GB figure and no time term, on the reasoning that heavier pages drive more engagement. That suits a page you read and leave; it fits poorly here, where transfer is tiny and dwell time is the thing being measured.
- `document.hasFocus()` is deliberately **not** a gate: it reads false in embedded and second-monitor contexts where the page is genuinely being read. The Idle Detection API would give a real signal but needs a permission prompt and is Chromium-only.

This is a duration-of-use allocation model. It remains an estimate.

### 7.4 Theme

Dark mode only changes the modeled device total when an emissive display such as OLED is selected. On a backlit LCD, one lamp burns at a constant rate regardless of content, so Susty assigns no theme saving; local dimming and mini-LED are a real exception it does not try to quantify.

The OLED phone delta (0.10 W) is calibrated to sit inside the **3–9%** of total phone power that Dash & Hu (MobiSys 2021) measured for switching to dark mode at the 30–50% brightness people typically use. The widely quoted ~40% saving holds only at 100% brightness (39–47%). Laptop and monitor OLED rows scale the phone ratio by panel area and are extrapolation — only phones were measured.

**Brightness beats theme**, and brightness is unknown: in Dash & Hu's data, light mode at low brightness can draw about as much as dark mode at higher brightness. The theme adjustment should not be presented with false precision.

Absent a stored choice, the theme defaults to **dark on phones and tablets** and **light on laptops and monitors**. On an LCD, which is the default for laptops and monitors, this makes no difference to the figure.

---

## 8. Reporting and ledger

On screen, a completed exchange is called an **answer**; the ledger and this document define it. The primary display reports:

```text
0.07  grams CO2e per answer
      AVERAGE FOR THIS CHAT

0.21 g so far · 3 answers
```

Before the first answer the headline shows no figure and reads "grams CO2e per answer — shown after your first answer", and the note reads "0.02 g so far, including your screen · no answers yet": the total is already non-zero because device time accrues from the first moment of attended use. With exactly one answer the average equals the total and the two rise together; from the second answer the average falls below the total. Units are never set in forced capitals, where "g" would read as "G" (giga).

The ledger opens with:

- average per answer;
- answers (completed exchanges);
- session total;
- cut-off or failed attempts, which are in the total but not counted as answers (only when there are any);
- the model for the latest answer (the model that actually produced the most recent completed exchange; an interrupted later attempt does not replace it);
- thinking tokens for the session.

Below that it keeps the underlying evidence: tokens sent and written back, chip energy for each, inference energy after PUE, hosting and network energy, device energy with attended and open time, total electricity attributed to the session, the current grid intensity with its accounting basis (operational or life-cycle) and its named source. The ledger's model row shows the responding model's factor (for example `gemini-3.5-flash-lite ×0.85`).

The per-exchange value is always labeled a **session average**. It never implies that every exchange had the same footprint. Raw ledger rows are not normalized per exchange.

Token-normalized carbon may be reported as a secondary diagnostic in the future, but should not be presented as task effectiveness or answer quality.

**Copy rules learned the hard way.** Copy shared across regions names no region and quotes no region-specific ratio (a "sunny California afternoon" line once went to every US reader). The source sentence always credits the provider that actually supplied the figure — NESO, EIA, EPA, Ember, or Electricity Maps. Assumptions are labeled as assumptions.

---

## 9. Comparisons

Everyday comparisons are based on the **session total**, not the average per exchange. So are "this chat has cost…" language, the session summary, and any recommendation referring to the whole conversation.

| Action | g CO2e | Evidence |
|---|---:|---|
| Driving a gasoline car | 170 per km | Typical of a European petrol car; a typical US passenger vehicle is ~250 g/km (EPA, ~400 g/mile) |
| Boiling water for tea | 20 per cup | Order of magnitude; not traced to a primary source |
| Hot shower, 8 minutes | 500 | Order of magnitude; varies strongly with water heating; not traced to a primary source |
| A beef burger | 3,000 | Order of magnitude; not traced to a primary source |
| New York to Los Angeles, one economy seat | 250,000 | Consistent with published one-way estimates of ~250–310 kg CO2 |

These are order-of-magnitude figures. Their job is to show that the footprint of asking is small next to the footprint of acting on the answer — which is the product's argument, not a disclaimer on it. Any statement such as "thousands of times larger" should be calculated from the current session total rather than hard-coded.

---

## 10. Offset costing

The ledger converts grams to money at **$320 per tonne**, the weighted-average price of durable carbon removal sold in 2024 (CDR.fyi; down from about $490 in 2023). It shows proportion, not an offer to sell offsets. At conversation scale the cost lands under a hundredth of a cent.

Until 23 September 2026 the ledger used $100 per tonne and attributed it to Frontier's market pricing. $100 is the US DOE Carbon Negative Shot's long-run *target* for durable removal, not a price paid today, so the old figure understated the current cost about 3×. The price is reviewed when a new annual average is published.

The note beneath it compares the session with three everyday actions. The claim of how many times over they cover the conversation is **computed** from the session total and the smallest action (one cold wash, about 200 g), not asserted: a long session with a lot of reading time can reach grams, where "thousands of times over" would stop being true.

---

## 11. Data-quality labels

| Class | Examples |
|---|---|
| **Measured** | provider token counts (including thinking tokens), returned model identity, browser event timing, NESO national actual intensity |
| **Derived** | EIA fuel-mix intensity, eGRID unit conversion, model factors from the EcoLogits function, cumulative session arithmetic |
| **Forecast** | NESO regional intensity for the current half hour |
| **Inferred / declared** | device class, panel type, approximate region |
| **Modeled** | token-energy coefficients, PUE, hosting/network energy, device wattage |

A modeled number is never described as directly measured. The interface uses precision appropriate to the uncertainty of its inputs.

---

## 12. Known limitations

1. **Absolute inference energy.** The input/output token coefficients are assumptions, not provider-specific measurements, and sit at the low end of published per-query estimates (§4.3). The fixed 10:1 output-to-input ratio is not separately calibrated.
2. **Model calibration.** Anthropic and Google architectures are inferred by EcoLogits, not disclosed. The factors omit GPU count, so they compress the spread between small and large models (§4.4).
3. **Idle and host overhead.** No explicit term for idle reserved capacity (§5).
4. **PUE.** The actual facility serving a request is unknown.
5. **Server location.** The user's grid is used as a proxy for remote service energy.
6. **Grid accounting basis.** Ember and Electricity Maps (life-cycle) and eGRID/EIA/NESO (operational) are mixed. The ledger labels which applies; see §6.1.
7. **Regional GB figures are forecasts.** NESO publishes only forecasts at regional level.
8. **Device power.** Real power varies by hardware, brightness, battery state, workload, and background processes.
9. **Attended time.** Browser interaction is a proxy for attention, not a direct observation.
10. **Network energy.** The fixed service term is simplified and does not separately model access networks or routers.
11. **Incomplete requests.** Some upstream failures may consume inference energy that the client cannot observe.
12. **Estimated turns are not flagged.** When provider usage is missing, the ledger does not mark the estimate.
13. **Embodied emissions and training.** Both are outside the current boundary.

The result should be interpreted as a transparent **operational estimate**, useful for scale and comparison within its stated assumptions rather than as a precise life-cycle footprint.

---

## 13. Validation and change control

This methodology is versioned. A change to any of the following triggers a methodology-version update and regression tests:

- functional-unit definition;
- completion rules;
- token-energy coefficients;
- model factors;
- PUE;
- hosting/network energy;
- device wattage or attended-time rule;
- grid source, conversion factors, or accounting basis;
- system boundary.

`sh tools/test.sh` verifies, among other things:

```text
session total >= 0
completed exchanges >= 0

if completed exchanges == 0:
    average per exchange = undefined
else:
    average per exchange
    = session total / completed exchanges
```

It also verifies that failed or partial exchanges do not increase the denominator; that an HTTP failure records only the hosting term; that historical request records are frozen and not repriced after model/grid changes; that the device clock is closed out before a grid, device or theme change; that device energy can accrue without changing the completed-exchange count; that every model factor reproduces from the EcoLogits function; that the device table matches its published ranges; and that the illustrative exchange stays inside Oviedo et al.'s IQR.

---

## 14. Verification log

Re-checked on **23 September 2026** against primary sources where reachable.

| Claim | Result | How checked |
|---|---|---|
| Oviedo et al.: 0.31 Wh median, IQR 0.16–0.60; 13× to 3.91 Wh at 5,000 output tokens; 300-token standard query; PUE P5–P95 1.05–1.40 | Confirmed | Full text (arXiv 2509.20241) |
| Luccioni, Jernite & Strubell: measures per 1,000 inferences; no per-token coefficients | Confirmed; previous citation (arXiv 2311.16433, "Luccioni, Viguier & Ligozat") pointed at an unrelated paper and wrong authors | Full text (arXiv 2311.16863) |
| Uptime: 1.58 average, 1.47 capacity-weighted | Confirmed | Uptime Institute publications |
| Kirkeby & Lagermann: 9–13 W typical; 9.17–12.43 W fits; 15–22 W framework values; duration-proportional error; Energy Star idle 4.88–6.53 W | Confirmed | Full text (arXiv 2510.12566) |
| DIMPACT: phone 1–2 W, tablet 5.5 W, desktop + monitor 77–100 W | Confirmed | DIMPACT v1.0, Table 6 |
| DIMPACT "Eq. 19" as the duration-of-use rule | **Corrected** — Eq. 19 is standby allocation; device use energy is Eq. 16 | DIMPACT v1.0 |
| Dash & Hu: 3–9% at 30–50% brightness; 39–47% at 100% | Confirmed | Purdue release of the MobiSys 2021 paper |
| EcoLogits function constants | Confirmed exactly; EcoLogits default batch is 64, Susty uses 32 | EcoLogits source code |
| EcoLogits has no Gemini architecture estimates | **Outdated** — both Gemini models now have entries; factors adopted (×1.36, ×0.85) | EcoLogits `models.json` |
| "`low` is the lowest Gemini thinking level" | **Corrected** for Flash-Lite, which supports and defaults to `minimal`; true for 3.8 Flash | Google Gemini thinking docs |
| Gemini `maxOutputTokens` includes thinking | Confirmed — "including thought tokens", hard cutoff | Google Gemini thinking docs |
| eGRID2023 Rev 2 subregion values | All 27 confirmed (NYLI, SRMW, SRVC within ±1 g/kWh of rounding) | EPA summary tables, Rev 2 |
| Ember national values | Had drifted: 22 of 43 differed from current Ember 2024 data, six by 4–17 g/kWh (PH 612→629, NG 508→496, NZ 120→112, ZA 713→718, CH 30→35, PL 612→608). **All regenerated** from Ember 2024 by `tools/ember-grids.mjs` | Ember yearly dataset |
| Ember basis | Life-cycle (IPCC AR5 factors) | Ember methodology |
| NESO regional `actual` | **Corrected** — regional endpoints publish forecast only | NESO API definitions and live API |
| EIA coal 2,257 / gas 976 lb/MWh | Confirmed | EIA |
| Anthropic `output_tokens_details.thinking_tokens` | Confirmed | Anthropic API documentation |
| SCI for AI suggests per-token consumer unit for LLMs | Confirmed | GSF SCI-AI specification |
| OLED phone share "~57%" | **Updated** to ~63% (Q1 2025; 57% was Q1 2024) | Omdia via OLED-Info |
| Offset at "$100/t for durable removal (Frontier 2024)" | **Corrected** — $100/t is a target; ledger now uses the 2024 average, $320/t | CDR.fyi 2024 review; US DOE |
| "These three actions each cover it thousands of times over" | **Not always true**; now computed from the session total | Code |
| Offset actions: cold wash ~200 g/load, thermostat −2°F ~300 kg/yr, one beef meal a week swapped ~200 kg/yr | Order of magnitude; not traced to a primary source | — |
| Comparisons: tea, shower, burger | Not traced to a primary source | — |
| Google median Gemini Apps text prompt: 0.24 Wh comprehensive, 0.10 Wh accelerators only | Confirmed | Google 2025, arXiv 2508.15734 |
| OpenAI average ChatGPT query 0.34 Wh | Confirmed as cited by Oviedo et al.; OpenAI's method unpublished | Oviedo et al. 2026 |
| EcoLogits full-model energy per request (Haiku, Sonnet, Opus, Gemini Flash-Lite and Flash; 300 output tokens) | Computed with EcoLogits 0.11.1 and its current model registry | EcoLogits source |
| Susty factors include GPU count | **No** — per-GPU term only; disclosed in §4.4 | EcoLogits source |
| Renewable tariff 30 g/kWh | No source found; **preset removed** | — |
| Ember factors | Coal 820, gas 490, other fossil 700, wind 11 g/kWh, global | Ember methodology |
| Electricity Maps default basis | Life-cycle (`emissionFactorType` default) | Electricity Maps API reference |
| 275-token system-prompt allowance | Carried from the original measurement; not re-measured | — |

---

## 15. Next steps: data and specificity

In priority order. None of these changes numbers until the data exists; each should come with the version update described in §13.

| Gap | Data needed | Candidate source | Expected effect |
|---|---|---|---|
| Absolute energy per token | Per-model energy per input and output token, or per-query energy with token counts | Provider disclosures (Google's 2025 method; a request to Anthropic); ML.ENERGY measurements | Replaces the largest assumption; likely raises estimates |
| Input/output split | Measured prefill vs decode energy per token at production batch sizes | ML.ENERGY; serving-framework benchmarks; Oviedo et al.'s simulation code | Replaces the fixed 10:1 ratio |
| Model scaling | GPU-count-aware, hardware-specific (TPU vs GPU) scaling with batch and utilisation assumptions | EcoLogits full model, reconciled to provider disclosures | Wider, better-grounded spread between models |
| Idle and host overhead | Share of idle reserved capacity and host energy | Google 2025 (0.10 → 0.24 Wh) | Adds a documented term |
| Uncertainty | A distribution for each parameter, propagated by Monte Carlo | Oviedo et al.'s approach | Ranges instead of single figures |
| Device power | Measured whole-device power during Susty-type sessions on phone, tablet and laptop | Lab measurement following Kirkeby & Lagermann | Validates the 1.35–10 W values |
| Attended time | Distribution of reading and idle time per exchange | Aggregated, privacy-preserving interaction statistics | Validates the 75-second grace window |
| Grid | One source with both bases, hourly for every region; serving-region intensity; marginal-emissions sensitivity | Electricity Maps (direct and life-cycle); provider region disclosure | Consistent basis; correct grid for the server share |
| Service and network | Measured function energy and bytes per exchange | Hosting telemetry; network energy-per-GB literature | Sources the 0.003 Wh term |
| Outside the boundary | Embodied emissions per request, and water, as separate lines | EcoLogits embodied model; Mistral Large 2 life-cycle analysis; Google 2025 (water) | A fuller picture without changing the operational figure |

---

## Sources

- Green Software Foundation, **Software Carbon Intensity (SCI) Specification / ISO/IEC 21031:2024** — https://sci.greensoftware.foundation/
- Green Software Foundation, **SCI for AI specification** — https://github.com/Green-Software-Foundation/sci-ai/blob/main/SPEC.md
- ITU-T L.1801 (02/2026), **Guidelines for assessing the environmental impact of artificial intelligence systems** — https://www.itu.int/rec/T-REC-L.1801
- Luccioni, Jernite & Strubell (2024), **Power Hungry Processing: Watts Driving the Cost of AI Deployment?**, FAccT '24 — https://arxiv.org/abs/2311.16863
- Oviedo et al. (2026), **Energy use of AI inference, efficiency pathways, and test-time scaling**, *Joule* — https://arxiv.org/abs/2509.20241
- Google (2025), **Measuring the environmental impact of delivering AI at Google scale** — https://arxiv.org/abs/2508.15734
- Mistral AI (2025), **Life-cycle analysis of Mistral Large 2** (cited in §15 as a candidate source for embodied impacts)
- EcoLogits — https://ecologits.ai/ (energy function and model estimates: https://github.com/genai-impact/ecologits)
- ML.ENERGY leaderboard — https://ml.energy/
- Uptime Institute, **Large data centers are mostly more efficient, analysis confirms** — https://journal.uptimeinstitute.com/large-data-centers-are-mostly-more-efficient-analysis-confirms/
- Anthropic, **Streaming messages** and **Extended thinking** — https://docs.anthropic.com/en/api/messages-streaming
- Google, **Gemini API: thinking** — https://ai.google.dev/gemini-api/docs/thinking
- NESO Carbon Intensity API — https://api.carbonintensity.org.uk/ (API definitions: https://github.com/carbon-intensity/api-definitions)
- U.S. EIA Open Data / EIA-930 — https://www.eia.gov/opendata/
- U.S. EIA, CO2 per MWh by fuel — https://www.eia.gov/todayinenergy/detail.php?id=48296
- U.S. EPA eGRID2023 Rev 2 summary tables — https://www.epa.gov/egrid/summary-data
- Ember yearly electricity data — https://ember-energy.org/data/yearly-electricity-data/
- Kirkeby & Lagermann (2026), **Power Assumptions Matter: Evaluating End-user Laptop Energy Models for Sustainability Reporting of Browser-Based Web Services**, SAC '26 — https://arxiv.org/abs/2510.12566
- DIMPACT Methodology v1.0 (October 2022) — https://dimpact.org/downloadResourceFile?resource=2
- Carbon Trust (2021), **Carbon impact of video streaming** — https://www.carbontrust.com/sites/default/files/documents/resource/public/Carbon-impact-of-video-streaming.pdf
- Dash & Hu (2021), **How much battery does dark mode save?**, MobiSys '21 — https://dl.acm.org/doi/10.1145/3458864.3467682
- Sustainable Web Design Model v4 — https://sustainablewebdesign.org/estimating-digital-emissions/
- Omdia via OLED-Info, **OLED smartphone display penetration** — https://www.oled-info.com/omdia-oled-smartphone-display-penetration-exceed-60-2025
- CDR.fyi, **Durable CDR Market 2024: Year in Review** — https://www.cdr.fyi/blog/2024-year-in-review
- U.S. DOE, **Carbon Negative Shot Strategy** (target: under $100 per net tonne CO2e, durably stored) — https://www.energy.gov/fecm/carbon-negative-shot-strategy
