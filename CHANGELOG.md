# Changelog

Versions follow [semantic versioning](https://semver.org/) loosely: a **major**
version changes how the carbon figure is defined or what the meter shows; a
**minor** version changes a number or a source; a **patch** fixes a bug or
wording. The methodology carries the same version number as the product.
Releases are meant to be tagged in git (`v2.1.0`) so any version can be
redeployed; as of 11 October 2026 no tags have been pushed to GitHub.

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

The version live before 23 September 2026 (tag `v1.0.0`, commit `b1df3e2`):
headline "g CO₂e, this chat's carbon", Gemini 3.8 Flash default priced at the
Sonnet anchor, $100/tonne offset price.
