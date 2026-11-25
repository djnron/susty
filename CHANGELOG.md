# Changelog

Versions follow [semantic versioning](https://semver.org/) loosely: a **major**
version changes how the carbon figure is defined or what the meter shows; a
**minor** version changes a number or a source; a **patch** fixes a bug or
wording. The methodology carries the same version number as the product.
Releases are tagged in git (`v2.1.0`, `v2.0.0`), so any version can be
redeployed. 1.0.0 predates tagging and is identified by its commit below.

## 2.2.0 — 25 November 2026

A minor version: models, factors and sources change; the system boundary,
the functional unit and the absolute token coefficients do not.

### Models

- **Claude tiers move to the 5.5 models.** Haiku 4.5 → Haiku 5.5 (×0.52,
  unchanged), Sonnet 4.6 → Sonnet 5.5 (×0.79, was ×1.00), Opus 4.8 →
  Opus 5.5 (×1.34, was ×1.33). Per token, the default Anthropic tier now
  prices 21% lower, because EcoLogits sizes Sonnet 5.5 smaller. Per answer
  that mostly cancels: Haiku 5.5 and Sonnet 5.5 count about 30% more tokens
  for the same text, so the same answer costs about the same on Sonnet 5.5
  and about 1.3× more on Haiku 5.5. An independent estimate (CLEER) also puts
  Sonnet 5 above Sonnet 4.6, not below (METHODOLOGY §4.4).
- **The Gemini Flash tier moves to Gemini 4 Hydrogen** (×0.66, was ×1.36 on
  3.8 Flash), Google's named upgrade from 3.8 Flash, at thinking level `low`
  (it rejects `minimal`). Its size estimate is the least certain in the table.
- **Gemini 3.5 Flash-Lite stays the client default.** It is still Google's
  lowest-cost model, with no shutdown date and no Gemini 4 successor, and it
  is the only Gemini tier that can think at `minimal`.
- **Opus now always thinks a little.** Opus 5.5 cannot switch thinking off,
  so the plain Opus tier runs at effort `low` with a 2,000-token ceiling, and
  its thinking tokens are measured and priced as Gemini's are. The thinking
  tier runs at effort `medium`.
- **Thinking settings follow the model, not the tier.** The Claude models do
  not share one off-switch (`between_tools` exists only on Sonnet 5.5,
  `disabled` is rejected by Sonnet 5.5 and Opus 5.5, Haiku 4.5 rejects
  `effort`), so `ANTHROPIC_MODEL` (including the `claude-sonnet-4-6` that
  `.env.example` used to suggest) still works.
- **`SUSTY_EXPENSIVE_TIERS=off` still drops only the extended-thinking tier.**
  The plain Opus tier now thinks a little, within its 2,000-token ceiling: at
  most 1.6× what the Opus 4.8 tier could spend. `SUSTY_TIERS=off` removes it.
- Tier keys are unchanged, so a returning visitor's picker choice carries over.

### Numbers and sources

- **Factors come from committed data.** EcoLogits' registry of 19 November
  2026 is extracted to `data/ecologits-2026-11-19-models.csv`, and
  `tools/model-factors.mjs --check` fails if `MODEL_ENERGY` disagrees with it.
  The anchor stays Sonnet 4.6.
- **Absolute coefficients re-checked and kept.** No provider has published a
  per-query or per-token figure since mid-2025. Measured 2026 hardware data
  (ML.ENERGY v3, SemiAnalysis InferenceX), CLEER and a meta-analysis
  (TokWatt) sit around Susty's level, and measured prefill and decode energy
  is consistent with the 10:1 split at moderate load. What they question is
  the spread between models: measured energy shows active parameters alone
  missing the cost of holding a large model's weights, and CLEER spreads
  Haiku to Opus 23× against Susty's 2.6×.
- **Corrected:** Google's 0.10 Wh is a narrower method, not the accelerator
  share of its 0.24 Wh median (that is 0.14 Wh). The power-draw cross-check no
  longer says Susty's coefficients are low; at current throughputs it lands
  inside or above its reference range. "No Susty tier runs on Azure" is
  withdrawn: Anthropic had already agreed to buy Azure capacity. The old
  "2–4.5× higher" comparison set whole-query figures against Susty's output
  coefficient alone; on one basis it is 1.4–3.3×.
- The §3 worked example uses Opus 5.5: 1.522 g CO₂e central, 3.520 g high end.

### Methodology

- §4.3 re-check with the 2026 evidence; §4.4 factor table, the limits of each
  new size estimate, and measured evidence on scaling; §4.5 tiers, thinking
  settings and the client-default rationale; §14 rows for everything checked
  for 2.2.0; §15 and the source list updated.

## 2.1.3 — 11 October 2026

A patch: no figure the app computes changes.

- **Water total.** The ledger adds "Water, this chat": cooling at the data
  centre plus power stations. Hydro reservoirs stay on their own row below
  it, outside the total, because charging all reservoir evaporation to power
  overstates (§16.4).
- **Ledger layout.** Carbon, Energy and Water are gold chips again. In the
  Energy block, inference, hosting and the device are one level, with the two
  chip-energy rows under inference and thinking under tokens written; labels
  are shorter ("Answered by", "Your laptop, 3s in use of 3s open").

## 2.1.2 — 11 October 2026

A patch: no figure the app computes changes.

- **A heavier, US worked example.** The §3 example is now one long-thinking
  answer from Claude Opus 4.8 (1,000 in / 5,000 out, Oviedo et al.'s
  reasoning-length query) read for 5 minutes on a laptop in Chicago (eGRID
  RFCW, 416 g/kWh): 4.635 Wh, 82% of it inference; 1.514 g CO₂e, high end
  3.496 g. It replaces the short Flash-Lite answer read in the UK, where the
  laptop outweighed the AI. The test recomputes every row.

## 2.1.1 — 11 October 2026

A patch: no figure the app computes changes.

- **Worked example in the methodology.** The example the deck and the
  plain-language summary quote (Gemini 3.5 Flash-Lite, 1,000 in / 300 out, a
  laptop for 90 s in the UK: 0.114 g CO₂e, high end 0.213 g) is now in §3 with
  its arithmetic, and `tools/methodology.test.mjs` recomputes every row from
  the app's constants.
- **Model comparison wording.** When the latest answer included thinking, its
  row reads "(answered, excl. thinking)", because like every row it leaves
  thinking out and so sits below that answer's inference energy in the
  Energy block.

## 2.1.0 — 11 October 2026

A minor version, not a major one: the system boundary and the functional unit
(g CO₂e per completed exchange) are unchanged and the meter still shows the
running total; what changes is an input (the grid the servers are priced on)
and what the ledger reports beside it.

### Numbers and sources

- **The servers have their own grid.** AI inference and hosting are priced on
  an assumed US data-centre grid, 307 g CO₂e/kWh (Watershed, capacity-weighted,
  September 2026), labeled "basis not stated by source". The reader's grid now
  prices device time only. Server carbon rises for readers on clean grids
  (France 40 → 307 g/kWh) and falls for readers on carbon-intensive ones.
- **The ledger shows a range.** "This chat so far" runs from Susty's estimate to
  a high end with AI energy at Oviedo et al.'s upper quartile, ×2.7 on
  inference only. Not a statistical interval; the meter stays central.
- **Water**, as a separate indicator: cooling at the data centre (Google's
  1.15 L/kWh, on inference and on hosting), power stations excluding hydro (Larsen & Drews 2019 tower
  medians × Ember 2024, eGRID2023 or EIA hourly mixes), and hydro reservoir
  evaporation on its own row. Not part of the carbon figure.
- **Burger comparison sourced**: a quarter-pound patty at Poore & Nemecek's
  dairy-herd beef figure, 3,800 g (was 3,000 g, untraced).

### What the ledger shows

- The latest answer priced on each offered model, labeled hypothetical.
- The session's electricity as a share of a smartphone charge (EPA, 19 Wh).
- History on this device: today, last 7 days and all saved, with CSV/JSON
  export and a clear control. Stored only in the browser; entries keep the
  figures and methodology version they were priced under and are never
  repriced.
- A one-time notice suggesting a fresh chat once re-sending the conversation
  costs more energy than writing the answer.

### Methodology

- New §4.8 (range), §4.9 (model comparison), §6.9 (servers' grid), §8.1
  (history) and §16 (water, with the net direction of error: water errs high,
  the energy it multiplies errs low). §12 limitations and §14 verification log
  updated; ENTSO-E hourly generation listed as v2.2 future work.
- Source data for water is committed in `data/` with provenance, including a
  twice-transcribed copy of Larsen & Drews' Appendix B and a cross-check
  against Macknick et al. (2012); `tools/water-factors.mjs` regenerates the
  tables and the tests fail if they drift.

## 2.0.0 — 23 September 2026

### What the meter shows

- The headline is the running total for the conversation, **"grams CO₂e so
  far, including your device"**, with the number of answers beneath it and a
  prompt to open the ledger. It only ever goes up.
- The functional unit is now **g CO₂e per completed exchange**: one question
  plus one answer that the provider signals finished normally. Its value, the
  average per answer, is in the ledger. Cut-off, blocked or failed attempts
  stay in the total but are not counted as answers.
- Units are no longer forced into capitals ("G" read as giga).

### Numbers and sources

- Gemini is priced from EcoLogits like the Claude models: 3.8 Flash ×1.36,
  3.5 Flash-Lite ×0.85 (previously both ×1.00).
- Gemini 3.5 Flash-Lite is the default model, at its lowest thinking level;
  Gemini replies are capped at 2,000 output tokens including thinking.
- Offset cost uses the 2024 average price of durable carbon removal,
  $320/tonne (previously a $100 target price).
- National grid figures regenerated from Ember 2024 by `tools/ember-grids.mjs`
  (22 of 43 had drifted; world average 473 → 471 g/kWh).
- The renewable-tariff grid option is removed (unsourced and market-based).
- The ledger labels each grid figure operational or life-cycle.

### Fixes

- The ledger credited the UK grid operator for US and Electricity Maps figures.
- Changing grid, device or theme re-priced the last second or two of device time.
- An empty "Narrow it down" picker showed for countries without regions.

### Methodology

- METHODOLOGY.md verified against primary sources; corrected citations and
  restored detail the rewrite had dropped. It now states that Susty's energy
  per token sits at the low end of published estimates, that the model factors
  omit GPU count, and that there is no idle-capacity term, with the data
  needed to calibrate each (§15). Tests fail if the document and the code
  disagree on a number.

## 1.0.0

The version live before 23 September 2026 (commit `b1df3e2`; not tagged):
headline "g CO₂e, this chat's carbon", Gemini 3.8 Flash default priced at the
Sonnet anchor, $100/tonne offset price.
