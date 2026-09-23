# Susty Methodology

**Integrated methodology — completed-exchange functional unit**
**Status:** Candidate for release
**Date:** 22 September 2026

Susty estimates the **operational carbon footprint of an AI conversation**. It combines modeled AI inference energy, modeled service/hosting energy, and estimated end-user device energy during attended use, then applies grid carbon intensity.

This is an **operational estimate, not a full life-cycle assessment**. Training and embodied hardware emissions are excluded. Every material input is identified as measured, inferred/declared, or modeled.

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
- A failed request that produces no usable completed response does not increase the denominator.
- A partial, truncated, blocked, or cut-off response does not count as completed. Unknown or missing terminal state is treated conservatively as incomplete.
- Energy from incomplete or failed attempts should remain in the session numerator when it can be measured or reasonably modeled.
- If provider usage is unavailable for a failed attempt, the unobserved inference energy is a known limitation.

### Why exchange rather than token?

Tokens are an important workload measure, but they are not a complete functional unit for Susty's system boundary. The product also includes hosting and end-user device use, including reading time, which does not scale directly with token count.

Susty therefore uses:

- **Completed exchange** — primary functional unit.
- **Session total** — cumulative footprint of the measured conversation.
- **Input, output, and thinking tokens** — workload and diagnostic measures.
- **Attended time** — the activity basis for device energy.

This framing is informed by the Green Software Foundation's Software Carbon Intensity approach, which requires a consistent functional unit across the defined software boundary. The SCI for AI work suggests per-token units for consumer LLM services; Susty uses exchange as the primary unit because its boundary includes the user device and attended use. Susty is not presented as a formal SCI score because it currently excludes embodied emissions and does not use all SCI accounting requirements.

---

## 2. System boundary

### Included

1. **AI inference** associated with the prompt and model response.
2. **Data-center facility overhead** through a PUE multiplier.
3. **Hosting and network/service overhead** as a fixed modeled amount per request handled by the Susty service.
4. **End-user device electricity** during estimated attended time.
5. **Grid carbon intensity** used to convert electricity to operational CO2e.

### Excluded

- Model training.
- Embodied emissions from servers, accelerators, user devices, and network hardware.
- Home/office router and access-network electricity beyond the flat hosting/network assumption.
- Manufacturing and end-of-life impacts.
- Any inference energy that cannot be observed or estimated after an upstream failure.

The result should therefore be described as **estimated operational CO2e**, not total life-cycle emissions.

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

Token coefficients are in **mWh per token** before conversion to Wh.

### Device energy

For each attended interval `t`:

```text
device_Wh(t)
= device_watts x attended_hours(t)

device_gCO2e(t)
= device_Wh(t) x grid_intensity(t) / 1000
```

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

Before the first completed exchange, the functional-unit value is undefined and should be shown as `—`, not zero.

Because attended device energy can continue to accrue after a response, the average per completed exchange can increase while a user reads. It can also decrease when a new completed exchange increases the denominator. The **session total never decreases**.

---

## 4. AI inference

### Token measurement

Susty uses token counts reported by the model provider where available. Input and output usage are therefore measured at the API level rather than inferred from rendered text.

Where a provider exposes thinking/reasoning tokens, Susty includes them in the output workload without double-counting them if they are already a subset of reported output tokens.

If usage is unavailable, Susty falls back to an estimate based on text length and the system-prompt allowance. This fallback is less precise and should be identified as estimated.

### Energy-per-token coefficients

Susty currently uses:

| Term | Central value | Status |
|---|---:|---|
| Input tokens | 0.05 mWh/token | Susty modeling assumption |
| Output tokens | 0.5 mWh/token | Susty modeling assumption |

These values should **not** be attributed directly to Luccioni et al. The Luccioni study measures energy for 1,000 inferences across model/task classes; it does not publish these exact input/output per-token coefficients. The coefficients remain a central modeling assumption until Susty has a reproducible provider/model-specific calibration.

The tenfold difference between input and output means long generated responses generally dominate inference energy more than long prompts, although accumulated chat history can make later prompts progressively more expensive.

### Model factors

Susty applies relative model factors anchored on Claude Sonnet:

| Model/tier | Relative factor | Status |
|---|---:|---|
| Claude Haiku 4.5 | 0.52 | modeled from EcoLogits/ML.ENERGY relationship |
| Claude Sonnet 4.6 | 1.00 | anchor |
| Claude Opus 4.8 | 1.33 | modeled from EcoLogits/ML.ENERGY relationship |
| Gemini 3.5 Flash-Lite | 1.00 proxy | not calibrated |
| Gemini 3.8 Flash | 1.00 proxy | not calibrated |

Anthropic parameter counts are inferred rather than disclosed, so these factors are relative estimates, not direct measurements of provider energy use. Gemini tiers currently use the Sonnet anchor as a proxy and must be labeled **not calibrated**.

### Model routing

Susty can route requests across Anthropic and Google model tiers. The model reported in the ledger should be the model that actually answered, not merely the model requested by the client.

The product-facing default and the server fallback are separate concepts. A default should never be described as more efficient unless it has been validated as such.

---

## 5. PUE and service overhead

### PUE

Susty currently applies a **PUE of 1.12** to modeled AI inference energy.

This value is a **Susty hyperscale-data-center assumption**, not the Uptime Institute global average. Uptime reports a 2023 industry average PUE of **1.58** and a capacity-weighted figure of **1.47**. Large modern hyperscale facilities can operate below those averages, but Susty does not know which facility serves a given request.

PUE is therefore a material uncertainty and should be treated as a modeled parameter rather than a measured fact.

### Hosting and network

Susty currently models service/hosting/network activity at:

```text
0.003 Wh per request handled by Susty
```

This is a declared modeling assumption. It does not represent a direct measurement of Vercel, internet transit, or the user's local network.

For the completed-exchange method, an unsuccessful request still incurs this service term when the browser receives an HTTP response from Susty, even though it does not increase the completed-exchange denominator. A client-side fetch failure with no HTTP response is not recorded because the client cannot know whether the service was reached.

---

## 6. Grid carbon intensity

Electricity is converted to carbon using the best available grid source for the user's selected or inferred region.

### Great Britain

**NESO Carbon Intensity API** — half-hourly regional data.

### United States: hourly estimate

**EIA-930** generation by fuel type is converted to operational grid intensity using fuel-specific emissions factors.

The EIA feed is delayed, so Susty uses the latest available observation matching the current hour of day rather than presenting the newest published hour as live current conditions. This is an **hour-matched proxy**, not real-time grid data.

Interregional imports are not fully represented, which can bias import-heavy regions.

### United States: annual fallbacks

**EPA eGRID** subregion output rates are used when hourly EIA data is unavailable for a selected subregion.

When the user has selected the United States but no subregion, Susty currently uses **384 gCO2/kWh**, Ember's 2024 United States annual generation-intensity figure, as the national fallback.

### Other countries

**Ember** annual national electricity-intensity data provides the fallback for countries without a more granular supported source.

### Optional source

Electricity Maps can provide more current intensity where an appropriate API tier is configured.

### Renewable-tariff preset

The current interface also contains a user-selectable **30 gCO2/kWh renewable-tariff preset**. This value is retained for compatibility but is **not validated by this methodology**: its life-cycle versus operational accounting boundary is not aligned clearly enough with the other grid values. It should be sourced and normalized to the same boundary, or removed, before this methodology is treated as fully validated.

### Location

Susty begins with a privacy-preserving location guess from the browser's IANA time zone. It does not require geolocation permission or an IP-location lookup. Where supported, the user can refine the region manually.

### Server-grid approximation

Susty currently applies the selected grid intensity to both:

- the user's device; and
- the remote AI/service energy.

The device-side use is geographically plausible. The server-side use is a known approximation because the serving data center may be in another region with a different electricity mix. Until provider location and energy data are available, the ledger should disclose this explicitly.

---

## 7. End-user device

Susty includes the **whole end-user device**, not only the display.

Device power is modeled as a base device load plus a panel component. Panel type and theme matter because OLED power can vary with displayed content; LCD/backlit panels are treated as effectively theme-independent for this model.

Representative central values are:

| Configuration | Whole device | Panel component |
|---|---:|---:|
| Phone, OLED dark | 1.35 W | 0.45 W |
| Phone, LCD | 1.50 W | 0.60 W |
| Tablet, OLED dark | 4.62 W | 1.32 W |
| Tablet, LCD | 5.50 W | 2.20 W |
| Laptop, OLED dark | 8.40 W | 2.40 W |
| Laptop, LCD | 10.00 W | 4.00 W |
| Desktop + LCD monitor | 90.00 W | 22.0 W |

These are representative model values, not measurements of the visitor's actual device. The device class may be inferred from browser characteristics; panel type and user selection remain assumptions unless explicitly chosen by the user.

### Attended time

Susty estimates **attended time**, not literal screen-on time and not verified human attention.

The device clock runs while the page is visible and there has been relevant user activity within a **75-second grace window**. Activity includes keyboard, pointer, wheel, scroll, touch, or mouse events. A blur can stop accrual immediately where the browser emits it.

The grace window is intended to capture normal reading after the user's last interaction without charging indefinitely for a tab left open.

This is a duration-of-use allocation model. It is more appropriate to Susty's conversational experience than a transfer-volume-only web model, but it remains an estimate.

### Theme

Dark mode only changes the modeled device total when an emissive display such as OLED is selected. For a conventional backlit LCD, Susty assigns no material theme saving.

Brightness is not known and can have a larger effect than theme, so the theme adjustment should not be presented with false precision.

---

## 8. Reporting and ledger

The primary display should report:

```text
AVERAGE PER COMPLETED EXCHANGE
0.07 g CO2e / completed exchange

0.21 g session total · 3 completed exchanges
```

The ledger should retain the underlying evidence:

- completed exchanges;
- session total CO2e;
- AI inference energy;
- service/hosting energy;
- end-user device energy;
- input tokens;
- output tokens and thinking tokens where available;
- estimated attended time;
- grid intensity and source;
- actual model that answered;
- whether a model factor is calibrated or a proxy.

The per-exchange value must be labeled as a **session average**. It should never imply that every exchange had the same footprint.

Token-normalized carbon may be reported as a secondary diagnostic in the future, but it should not be presented as task effectiveness or answer quality.

---

## 9. Comparisons

Everyday comparisons are based on the **session total**, not the average per exchange.

Representative order-of-magnitude comparisons include driving, boiling water, showering, food, and air travel. Their purpose is to establish scale, not to claim exact equivalence.

Any statement such as "thousands of times larger" should be calculated dynamically from the current session total rather than hard-coded.

---

## 10. Data-quality labels

Susty should distinguish four classes of evidence:

| Class | Examples |
|---|---|
| **Measured** | provider token counts, returned model identity, browser event timing |
| **Derived** | EIA fuel-mix intensity, cumulative session arithmetic |
| **Inferred / declared** | device class, panel type, approximate region |
| **Modeled** | token-energy coefficients, model factors, PUE, hosting/network energy, device wattage |

A modeled number should not be described as directly measured. The interface should use precision appropriate to the uncertainty of the inputs.

---

## 11. Known limitations

The largest current uncertainties are:

1. **Absolute inference energy.** The input/output token coefficients are assumptions rather than provider-specific measurements.
2. **Model calibration.** Gemini tiers use a Sonnet proxy; Anthropic factors depend on inferred model architecture.
3. **PUE.** The actual facility serving a request is unknown.
4. **Server location.** The user's grid is used as a proxy for remote service energy.
5. **Device power.** Real power varies by hardware, brightness, battery state, workload, and background processes.
6. **Attended time.** Browser interaction is a proxy for attention, not a direct observation.
7. **Network energy.** The fixed service term is simplified and does not separately model access networks or routers.
8. **Incomplete requests.** Some upstream failures may consume inference energy that the client cannot observe.
9. **Embodied emissions and training.** Both are outside the current boundary.

The result should therefore be interpreted as a transparent **operational estimate**, useful for scale and comparison within its stated assumptions rather than as a precise life-cycle footprint.

---

## 12. Validation and change control

Susty's methodology should be versioned. A change to any of the following should trigger a methodology-version update and regression tests:

- functional-unit definition;
- completion rules;
- token-energy coefficients;
- model factors;
- PUE;
- hosting/network energy;
- device wattage or attended-time rule;
- grid source or conversion factors;
- system boundary.

Tests should verify at minimum:

```text
session total >= 0
completed exchanges >= 0

if completed exchanges == 0:
    average per exchange = undefined
else:
    average per exchange
    = session total / completed exchanges
```

They should also verify that failed or partial exchanges do not increase the denominator, that historical request records are not repriced after model/grid changes, and that device energy can continue to accrue without changing the completed-exchange count.

---

## Sources

- Green Software Foundation, **Software Carbon Intensity (SCI) Specification / ISO/IEC 21031:2024** — https://sci.greensoftware.foundation/
- Green Software Foundation, **SCI for AI specification** — https://github.com/Green-Software-Foundation/sci-ai/blob/main/SPEC.md
- Luccioni, Jernite & Strubell (2023), **Power Hungry Processing: Watts Driving the Cost of AI Deployment?** — https://arxiv.org/abs/2311.16863
- EcoLogits — https://ecologits.ai/
- ML.ENERGY leaderboard — https://ml.energy/
- Oviedo et al. (2026), frontier-model inference energy comparison — https://arxiv.org/abs/2509.20241
- Uptime Institute, **Large data centers are mostly more efficient, analysis confirms** — https://journal.uptimeinstitute.com/large-data-centers-are-mostly-more-efficient-analysis-confirms/
- NESO Carbon Intensity API — https://api.carbonintensity.org.uk/
- U.S. EIA Open Data / EIA-930 — https://www.eia.gov/opendata/
- U.S. EPA eGRID — https://www.epa.gov/egrid/summary-data
- Ember yearly electricity data — https://ember-energy.org/data/yearly-electricity-data/
- DIMPACT Methodology v1.0 — https://dimpact.org/downloadResourceFile?resource=2
- Sustainable Web Design Model v4 — https://sustainablewebdesign.org/estimating-digital-emissions/
- Dash & Hu (2021), **How much battery does dark mode save?** — https://dl.acm.org/doi/10.1145/3458864.3467682
- ITU-T L.1801 (2026), **Guidelines for assessing the environmental impact of artificial intelligence systems** — https://www.itu.int/rec/T-REC-L.1801
