# Changelog

Versions follow [semantic versioning](https://semver.org/) loosely: a **major**
version changes how the carbon figure is defined or what the meter shows; a
**minor** version changes a number or a source; a **patch** fixes a bug or
wording. The methodology carries the same version number as the product.
Each release is tagged in git (`v2.0.0`), so any version can be redeployed.

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
