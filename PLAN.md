# PLAN: SG Tax Optimizer

Overhauled from a full household finance planner to a single-purpose tool:
**optimize CPF MA/SA top-ups and SRS contributions for a household, priced
against the tax on eventual SRS withdrawals.**

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | Tax optimizer only. Budgeting, CPF projections, property, Monte Carlo, CPF LIFE all removed |
| 2 | Household | Self + optional spouse; shared reliefs (QCR) auto-allocated to the higher-bracket spouse |
| 3 | Levers | CPF cash top-up relief ($8k self + $8k family) and SRS ($15,300 SC/PR, $35,700 foreigner), per member per YA |
| 4 | SRS honesty | Every SRS recommendation is net of withdrawal tax: at-retirement 10-year drawdown (50% taxable) and early withdrawal (5% penalty + 100% taxable) |
| 5 | Stack | Next.js + Tailwind, local-only, localStorage persistence, no chart library |
| 6 | Rules | IRAS tables as static versioned data in `lib/engine/rules-data.ts`; Budget announcements = new rows |

## Architecture

```
app/
  page.tsx        # shell
  optimizer.tsx   # client: form state (localStorage), engine call, summary cards
  report.tsx      # client: per-member CFP cost-benefit report + override sliders
lib/
  format.ts       # SGD display/parsing (dollars)
  use-persisted.ts# localStorage-backed useState
  lib/engine/
    money.ts      # rounding helpers
    config.ts     # zod schemas + types for tax/SRS/relief rule tables
    rules-data.ts # seeded IRAS figures (YAs 2025/2026, SRS 2025-2027)
    tax/          # brackets, relief library, per-member + household compute,
                  # shared-relief water-filling optimizer
    srs/          # drawdown.ts (10-yr water-fill) + scenarios.ts (projection,
                  # at-retirement vs early-withdrawal)
    optimizer.ts  # the product: household recommendations + CFP report
```

## Engine economics

- **Top-ups**: never taxed again → recommend up to caps, bounded by taxable
  dollars above the 0% bracket and $80k relief-cap room.
- **SRS**: recommend argmax over contributions of
  `yearsContributing × savingsThisYear(c) − (withdrawalTax(c) − withdrawalTax(0))`;
  objective is concave → $100 grid lands on the optimal kink. Existing
  balance's withdrawal tax is sunk and excluded.
- **Verdict**: marginal bracket ≥ 7% and positive net lifetime benefit →
  "Worth it"; below 7% → "Conditional" (lock-in vs thin saving); 0% → "Not
  worth it".

## Known simplifications

- WMCR modeled in the fixed-dollar scheme only (children born on/after
  1 Jan 2024); parent relief modeled as living-apart; no disability variants
  in the UI (engine supports them).
- Lifetime savings assume constant income until retirement.
- Drawdown starts in January of the withdrawal year. Retirement income splits
  into earned (part-time; auto-netted with the age-banded earned income
  relief, $8,000 at 60+) and non-earned (rental etc.), plus an optional
  flat "other reliefs" figure; the drawdown taxes withdrawals on the net base.
- The one-off YA rebate (e.g. YA 2025) is included in displayed savings but
  ignored in marginal analysis.
