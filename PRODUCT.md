# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People curious about the sustainability of everyday decisions — diet, travel, home energy, consumer choices. They arrive without a strong prior commitment to sustainability; they want a direct, honest answer to a specific question. [Primary audience inferred from starter chips, copy tone, and topic breadth; not confirmed in interview.]

## Product Purpose

susty is a sustainability chatbot that gives specific, number-backed answers to everyday sustainability questions and keeps a live count of the carbon cost of the conversation itself. The meter is not a disclaimer — it is the product's central argument: even the most honest environmental advice tool has a footprint, and naming it is what makes the advice trustworthy.

## Positioning

The only sustainability chatbot that measures its own environmental cost in real time, shows the arithmetic openly, and then puts that cost in proportion to the actions it recommends. Transparency is the product, not a feature.

## Operating Context

Single-session, single-page. No login, no history, no account. The user arrives, asks a question or taps a chip, reads the reply, and may open the carbon ledger to see the methodology. The feedback link goes to a personal email. [Scope inferred as personal/exploratory from project structure and feedback routing; not confirmed.]

## Capabilities and Constraints

- Claude-powered chat via Vercel serverless proxy; API key server-side only
- Live carbon accounting: token counts from the API, energy modelled from published coefficients
- Grid intensity is user-selectable (world average to hydro/wind)
- No build step, no dependencies, no database, no auth
- Rate-limited at 25 requests per IP per 10 minutes (in-memory; leaky on cold starts)
- Feedback via mailto; no stored submissions
- Model: claude-sonnet-4-6 (configurable via env)

## Brand Commitments

- Name: **susty** (lowercase, no tagline required)
- Voice: direct, specific, non-preachy; "tiny ways to make the world a little less bad"
- Palette is brutalist and closed: black #000000, white #FFFFFF, grey for
  dividers (#3A3A3A dark / #C9C9C9 light), hot red #FF2D2D for the meter, hot
  green #2DFF6B for the Ask button and the recommendations block, system yellow #FFE600 for inline
  annotation only, and link blue. The three accent blocks do not invert with
  the theme and all carry black text
- **Dark is the default theme**, light is the alternate. It is the base palette
  rather than an override, so the page renders dark with no JS. It is also the
  lowest-drawing option on OLED, which is the one theme claim this product can
  make without hedging
- Type is Helvetica Bold all-caps for display, system monospace for body and
  captions, Times New Roman italic for footnotes and source glosses. No
  webfont: nothing is downloaded, which is a claim the ledger can make honestly.
  This replaces the earlier Plus Jakarta Sans commitment, and the earlier green
  accent (#22C55E) and orange meter (#EA580C)
- The meter and ledger are non-negotiable product surfaces — they are not optional UI

## Evidence on Hand

- Carbon coefficients: Luccioni et al. 2023, Uptime Institute 2023, Patterson et al. 2021, IEA CO₂ 2023, Frontier 2024 State of CDR
- No testimonials, case studies, or usage data on hand

## Product Principles

1. **Honesty before comfort.** The product quantifies its own cost. It never hides inconvenient numbers.
2. **Specific beats vague.** Real figures, even imperfect ones, are more useful than qualitative encouragement.
3. **Proportion matters.** The meter exists to show how small the AI's footprint is next to the actions it helps with — not to make users feel guilty.
4. **Zero friction.** No account, no setup, no build step. The chat is the product.
5. **Small surface, high craft.** One page, done well, beats a feature list done adequately.

## Accessibility & Inclusion

Reduced-motion respected via `prefers-reduced-motion`. Focus management on drawer open/close. No specific WCAG target confirmed.
