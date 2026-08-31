# Kaya: SG Tax Optimizer

Singapore household tax optimizer, scoped to two levers: **CPF cash top-ups**
(MA/SA/RA, "RSTU") and **SRS contributions**, with the SRS decision priced
against the tax you'll actually pay on withdrawal, not just the tax saved
today.

Per member (self + optional spouse), the app computes:

1. **Immediate tax alpha**: baseline vs optimized chargeable income under the
   IRAS progressive brackets, the $80k relief cap enforced, savings split by
   lever (top-up vs SRS), and the effective return per SRS dollar.
2. **At-retirement drawdown**: the SRS balance projected from the current
   balance + level annual contributions at the expected return, then withdrawn
   over the 10-year penalty-free window (50% taxable, spread to fill the
   lowest brackets) starting at the later of the statutory retirement age (63)
   and the planned retirement age. Reports the total withdrawal tax and the
   effective tax rate on withdrawals.
3. **Early withdrawal (worst case)**: 5% penalty on the full balance plus
   100% of it stacked on that year's chargeable income.
4. **Net lifetime benefit & verdict**: lifetime savings (constant-income
   assumption) minus withdrawal tax, with a Worth it / Conditional / Not
   worth it verdict (below the 7% marginal bracket the lock-in is thin; at 0%
   there is no benefit).

Household features: spouse-shareable reliefs (QCR) are auto-allocated to the
higher-marginal-rate spouse; recommendations are per-member (SRS caps and CPF
top-up caps are individual).

## Recommendations

- **CPF top-ups** (never taxed again): fill the $8k self cap, then the $8k
  family cap, bounded by the taxable dollars above the 0% bracket and the
  relief-cap room.
- **SRS**: the contribution maximizing [lifetime tax savings − attributable
  withdrawal tax] (the tax on an existing balance is sunk and excluded).
  Grid-searched at $100 steps; the objective is concave so this lands on the
  optimal bracket kink.

## Stack

- Next.js 16 (App Router, TypeScript) + Tailwind + shadcn/ui (Inter). No
  chart library; tables.
- **Local-only: no login, no database.** Inputs persist in the browser's
  localStorage (`lib/use-persisted.ts`).
- The engine (`lib/engine/`) is pure and framework-free:
  - `tax/`: resident brackets, relief library, household shared-relief
    water-filling optimizer;
  - `srs/`: 10-year drawdown optimizer + projection/scenario module;
  - `optimizer.ts`: household recommendations + the CFP cost-benefit report;
  - `rules-data.ts`: the IRAS rule tables as static, source-cited data
    (Budget announcements = new rows, not code changes).
- Golden tests pin the engine to hand-computed IRAS bracket arithmetic.

## Setup

```sh
npm install
npm run dev
```

Open http://localhost:3000. No env vars, no database.

## Scripts

- `npm run dev` / `build` / `start` / `lint`
- `npm test`: engine unit tests (Node test runner)
