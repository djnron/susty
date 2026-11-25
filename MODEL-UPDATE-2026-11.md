# Susty model update, November 2026: research summary

**Status:** the research behind Susty 2.2.0, 25 November 2026, on branch
`update/2026-11-models`. Since 2.3.0 the separate extended-thinking tier
below is a Thinking picker level (Opus at Medium); see METHODOLOGY §4.5. Since 2.4.0 Opus 5.5 at Medium is also the default, and the picker
labels every other model by how much less energy per token it uses than Opus. Every number here is also in
[METHODOLOGY.md](METHODOLOGY.md), where the tests check it against the code;
if the two ever disagree, METHODOLOGY wins. `sh tools/test.sh` passes. The
app has not been tried against the live APIs: no keys were available.

---

## 1. What replaces what

| Tier key | Was | Now | Per-token factor | Thinking now sent |
|---|---|---|---:|---|
| `haiku` | `claude-haiku-4-5` | [`claude-haiku-5-5`](https://platform.claude.com/docs/en/models/haiku-5-5/overview) | 0.52 → **0.52** | `disabled`, effort `low` |
| `sonnet` (server fallback) | `claude-sonnet-4-6` | [`claude-sonnet-5-5`](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) | 1.00 → **0.79** | `between_tools`, effort `low` |
| `opus` | `claude-opus-4-8` | [`claude-opus-5-5`](https://platform.claude.com/docs/en/models/opus-5-5/overview) | 1.33 → **1.34** | none sent (cannot be disabled), effort `low`, 2,000-token ceiling |
| `opus-thinking` | `claude-opus-4-8`, effort `low` | `claude-opus-5-5` | 1.33 → **1.34** | adaptive, effort `medium`, 4,000-token ceiling |
| `gemini-flash-lite` (client default until 2.4.0, now Opus 5.5 at Medium) | `gemini-3.5-flash-lite` | **unchanged** | 0.85 | level `minimal` |
| `gemini-flash` | `gemini-3.8-flash` | [`gemini-4-hydrogen`](https://deepmind.google/models/model-cards/gemini-4-hydrogen/) | 1.36 → **0.66** | level `low` (it rejects `minimal`) |

Factors are against the **Sonnet 4.6 anchor**, which stays the reference for
Susty's absolute coefficients even though it is no longer offered.
Re-anchoring on Sonnet 5.5 would silently raise every model's energy by 27%.

**What a typical answer costs now, before thinking:**

- **Sonnet 5.5**: 21% less per token than Sonnet 4.6. But it counts about 30%
  more tokens for the same text, so the same answer costs about the same
  (0.79 × 1.3 ≈ 1.02).
- **Haiku 5.5**: same per-token factor, but the same text costs about 1.3×
  what it did on Haiku 4.5, for the same tokenizer reason.
- **Opus 5.5**: per-token energy is up 1% (same tokenizer as Opus 4.8). Every
  answer now carries some thinking tokens, which Susty measures and prices.
- **Gemini 4 Hydrogen**: half of 3.8 Flash's factor. Its size estimate is the
  least certain in the table (§4).

---

## 2. Why these models

**Claude.** These are Anthropic's current Haiku, Sonnet and Opus. The 4.x
models are still served, and Susty still prices them in case an
`ANTHROPIC_MODEL` override points at one. Claude Fable 5.2 is not offered as
a tier: it would be the most energy-intensive option ($8 / $40 per million
tokens, factor 1.91), billed to the deployment's own key.

The 5.5 models do not share one thinking switch, and omitting `thinking`
means *on* for all three:

- Haiku 5.5 accepts `disabled` at effort `high` or below.
- Sonnet 5.5 rejects `disabled`; its off-mode is `between_tools`, which only
  it accepts.
- Opus 5.5 cannot switch thinking off at all.

So `api/chat.js` picks the setting from the model id (`minimalThinking()`),
not the tier. That keeps `ANTHROPIC_MODEL=claude-sonnet-4-6` working, as
`.env.example` used to suggest. Sending `between_tools` there would be a 400.

**Gemini.** Google's [model chooser](https://aistudio.google.com/docs/choosing-a-model)
names Gemini 4 Hydrogen (GA 12 November 2026) as the upgrade from
3.8 Flash. There is no Gemini 4 Flash-Lite: 3.5 Flash-Lite is still Google's
"lowest-cost" model, with no shutdown date. A "Gemini 4 Helium" is rumoured
but has no model id. Neither tier can switch thinking off
([thinking docs](https://aistudio.google.com/docs/thinking)).

**Why Flash-Lite stayed the default until 2.4.0** even though Hydrogen's
per-token factor is lower. Since 2.4.0 the default is Claude Opus 5.5 at
Medium, the owner's choice; see METHODOLOGY §4.5. The reasons it held until then:

- It is the only Gemini tier that can think at `minimal`.
- EcoLogits' full model, which counts the GPUs needed to hold the weights,
  puts it lowest of the two.
- Hydrogen's size estimate is uncertain.
- Its output price is a third of Hydrogen's ($2.50 against $7.50 per million
  tokens).

---

## 3. Where the factors come from

Unchanged method:

- **Formula.** EcoLogits' per-GPU energy function, fitted to the
  [ML.ENERGY leaderboard](https://ml.energy/leaderboard/), evaluated at
  batch 32 and the midpoint of EcoLogits' active-parameter estimate.
- **Architectures.** EcoLogits' registry of 19 November 2026 (commit
  `8bc6848`), now committed as `data/ecologits-2026-11-19-models.csv`.
- **Check.** `node tools/model-factors.mjs --check` regenerates every factor
  and fails if `index.html` disagrees.

| Model | EcoLogits estimate (not disclosed by the provider) | Factor |
|---|---|---:|
| Claude Haiku 5.5 | dense, 10–35B | 0.52 |
| Claude Sonnet 5.5 | MoE, 293B total, 29–88B active | 0.79 |
| Claude Opus 5.5 | MoE, 670B total, 70–200B active | 1.34 |
| Gemini 3.5 Flash-Lite | dense, 30–105B | 0.85 |
| Gemini 4 Hydrogen | MoE, 187.5B total, 18.75–62.5B active | 0.66 |
| Claude Sonnet 4.6 (anchor) | MoE, 440B total, 44–132B active | 1.00 |

---

## 4. What the research found

Three research passes and one independent review. METHODOLOGY §4.3–4.4 and
§14 have the detail and the sources.

**No provider has published a new energy figure since mid-2025.** Google's
2026 Environmental Report repeats its May 2025 median (0.24 Wh per Gemini
Apps prompt). OpenAI's 0.34 Wh is unchanged. Anthropic has never published
an energy, emissions or water figure; its
[data-centre page](https://www.anthropic.com/policy/infrastructure) promises
site metrics, says its data centres "require little to no water", and says
much of its new power is natural gas.

**So Susty's base coefficients stay** (0.05 / 0.5 mWh per input / output
token, PUE 1.12, high end ×2.7). The 2026 evidence brackets them rather than
displacing them:

| Source | What it says | Against Susty |
|---|---|---|
| ML.ENERGY leaderboard v3 (measured, B200) | 0.2–0.8 mWh per output token, GPU only, for large open MoE models at 64–256 concurrent requests | Susty's 0.5 mWh is inside |
| [CLEER](https://github.com/sustainableaigroup/CLEER) (Sustainable AI Group, Sept 2026, estimate) | 0.20 Wh for a one-question Sonnet 4.6 exchange, whole facility | Susty: 0.22 Wh for the anchor |
| [TokWatt](https://arxiv.org/abs/2610.39846) (Oct 2026, meta-analysis of 134 estimates) | 0.34 Wh for a short chat answer, range 0.16–0.99 | Susty near the bottom |
| SemiAnalysis InferenceX (measured, disaggregated serving) | output : input energy 8–13 : 1 at moderate load, 3–7 : 1 at very high load | Susty's 10:1 is inside the moderate range |

**What the evidence questions is the spread between models.**

- **CLEER's estimates are far more spread out than Susty's.** They run 23×
  from Haiku 4.5 to Opus 4.8 (0.023 to 0.532 Wh), against Susty's 2.6×.
- **Measured energy depends on more than active parameters.** On ML.ENERGY,
  MoE models use 6–9× the energy per token of a dense 32B model with similar
  active parameters. Scaling on active parameters alone, as Susty does,
  misses the cost of holding the weights.
- **Neither parameter count predicts the ratio.** Between two MoE models the
  measured gap was smaller than either count implies.

So Susty still likely understates large models and overstates small ones.
Fixing that is a method change (GPU-count-aware scaling), listed in
METHODOLOGY §15, not done here.

**CLEER and EcoLogits disagree on direction for Sonnet 5.** CLEER puts it
17% *above* Sonnet 4.6; EcoLogits sizes it 21% *below*. CLEER has no estimate
for any 5.5 model. Susty follows EcoLogits for consistency and says the sign
is uncertain.

---

## 5. Corrections to Susty's existing text

- **Google's 0.10 Wh** is a narrower measurement method. It is not the
  accelerator share of the 0.24 Wh median, which is 0.14 Wh (Google 2025,
  Table 1).
- **The power-draw cross-check** no longer suggests Susty's coefficients are
  low. At current throughputs they imply 162–354 W per reply, inside or above
  the 125–250 W reference.
- **The "2–4.5× higher" comparison** set whole-query figures against Susty's
  output coefficient alone. On a like-for-like basis the gap is 1.4–3.3×.
- **"No Susty tier runs on Azure"** was out of date: Anthropic agreed to buy
  Azure capacity in November 2025.

---

## 6. Independent review

A separate reviewer re-derived every number and checked the code without
seeing my reasoning.

**Confirmed correct:**

- every factor, ratio and worked-example row;
- the power figures and the full-model table (its own implementation matched
  to every printed digit);
- every request body each tier sends, including under `ANTHROPIC_MODEL`
  overrides.

**Found and fixed:**

- **An overreaching claim.** I had written that energy "tracks total
  parameters"; the measurements don't show that, as §4 now says.
- **The tokenizer offset** was missing from the "21% lower" headline.
- **A GPU count** for Flash-Lite was wrong.
- **The tests failed** when `ANTHROPIC_MODEL` was exported in the shell.
- **Dated Opus 5 / Sonnet 5 ids** were not matched.
- **Stale text** in §4.8.
- **Unused `thinks` flags** in the factor table.
- **A mixed basis** in the §4.3 comparison.
- **Missing tests**, now added: the JSON each tier actually sends, the
  client's expected models, the picker ratios, the full-model table and the
  power figures.

---

## 7. Not done, and worth doing next

- **A live smoke test with real keys.** Check that each tier's request is
  accepted, and how many thinking tokens Opus 5.5 spends at effort `low`, to
  confirm its 2,000-token ceiling is enough.
- **GPU-count-aware model scaling** (METHODOLOGY §15): the largest known error
  in the per-model figures.
- **Re-measure the 275-token system-prompt allowance** on the 5.5 models'
  tokenizer (fallback path only).
- **Move the Gemini adapter to Google's Interactions API** if
  `generateContent` gets a shutdown date; it is labelled legacy, with none
  yet.

---

## Sources

- Anthropic: [models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), [effort](https://platform.claude.com/docs/en/build-with-claude/effort), [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [data-centre commitments](https://www.anthropic.com/policy/infrastructure)
- Google: [choosing a model](https://aistudio.google.com/docs/choosing-a-model), [thinking](https://aistudio.google.com/docs/thinking), [deprecations](https://aistudio.google.com/docs/deprecations), [what's new in Gemini 4 Hydrogen](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen), [Gemini 4 Hydrogen model card](https://deepmind.google/models/model-cards/gemini-4-hydrogen/), [2026 Environmental Report](https://sustainability.google/files/google-2026-environmental-report.pdf), [Measuring the environmental impact of delivering AI at Google scale](https://arxiv.org/abs/2508.15734)
- EcoLogits: [model registry](https://github.com/mlco2/ecologits/blob/main/ecologits/data/models.json), [energy function](https://github.com/mlco2/ecologits/blob/main/ecologits/impacts/llm.py), [proprietary-model method](https://ecologits.ai/latest/methodology/proprietary_models/)
- Measurements and estimates: [ML.ENERGY leaderboard](https://ml.energy/leaderboard/), [SemiAnalysis InferenceX](https://inferencex.semianalysis.com/), [CLEER](https://github.com/sustainableaigroup/CLEER), [TokWatt](https://arxiv.org/abs/2610.39846), [Oviedo et al., Joule 2026](https://arxiv.org/abs/2509.20241)
