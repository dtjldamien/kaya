/**
 * SRS balance projection and the two withdrawal scenarios that determine
 * whether a contribution is worth it:
 *
 *  - at retirement: penalty-free withdrawals from the later of the statutory
 *    retirement age and the planned retirement age, spread over the 10-year
 *    window with 50% of each withdrawal taxable (via the drawdown optimizer);
 *  - early withdrawal: the whole balance leaves before the penalty-free age —
 *    5% penalty on the full amount and 100% of it stacked onto that year's
 *    chargeable income.
 *
 * All figures in whole SGD; rates as fractions.
 */
import type { SrsYearRules, TaxBracketRow } from "../config.ts";
import { roundCents } from "../money.ts";
import { bracketTax } from "../tax/brackets.ts";
import { optimizeSrsDrawdown, type SrsDrawdownSchedule } from "./drawdown.ts";

/**
 * Future value of the SRS balance at retirement: the current balance plus
 * level annual contributions, this YA's contribution included and growing
 * for the full horizon (contribution at the start of each year).
 */
export function projectSrsBalance(input: {
  currentBalance: number;
  annualContribution: number;
  /** Whole years from the income year to the retirement year. */
  years: number;
  /** Expected annual return (0.03 = 3%). */
  annualReturn: number;
}): number {
  const { currentBalance, annualContribution, annualReturn: r } = input;
  const years = Math.max(0, Math.floor(input.years));
  // Contributions: one per year including this YA's — at least one even when
  // retirement is this year. This year's compounds for `years` years.
  const contributions = Math.max(1, years);
  if (r === 0) {
    return roundCents(currentBalance + annualContribution * contributions);
  }
  const fvContrib =
    Math.pow(1 + r, years - contributions + 1) *
    ((Math.pow(1 + r, contributions) - 1) / r);
  return roundCents(
    currentBalance * Math.pow(1 + r, years) + annualContribution * fvContrib,
  );
}

export type SrsAtRetirementScenario = {
  kind: "at_retirement";
  /** Age at which penalty-free withdrawals start. */
  withdrawalAge: number;
  startYear: number;
  projectedBalance: number;
  schedule: SrsDrawdownSchedule;
  /** Total income tax on the withdrawals across the window. */
  totalTax: number;
  /** totalTax / totalWithdrawn — the "effective tax rate" of this scenario. */
  effectiveRate: number;
};

/**
 * Penalty-free drawdown: withdrawals begin in January of the year the member
 * reaches the withdrawal age (the later of the statutory retirement age
 * locked in at first contribution and the planned retirement age), and are
 * spread tax-optimally over the 10-year window.
 */
export function atRetirementScenario(input: {
  projectedBalance: number;
  srsRules: SrsYearRules;
  brackets: TaxBracketRow[];
  currentAge: number;
  plannedRetirementAge?: number;
  /** Penalty-free withdrawal age locked at first contribution (62/63/64);
   *  defaults to the seeded statutory retirement age. */
  srsWithdrawalAge?: number;
  currentYear: number;
  /** Other taxable income per calendar year during the window (default 0).
   *  Net of reliefs, so it may be negative — negative values act as extra
   *  0%-bracket room, matching how IRAS offsets reliefs against income. */
  otherAnnualIncome?: number;
  /** Expected annual return inside the SRS during the withdrawal window
   *  (default 0 = balance frozen at the projected value). With growth the
   *  drawdown re-plans each year and taxes the deemed residual at the
   *  window's end. */
  windowReturn?: number;
}): SrsAtRetirementScenario {
  const { srsRules } = input;
  const withdrawalAge = Math.max(
    input.srsWithdrawalAge ?? srsRules.statutoryRetirementAge,
    input.plannedRetirementAge ?? 0,
  );
  const startYear = input.currentYear + Math.max(0, withdrawalAge - input.currentAge);
  const windowMonths = srsRules.withdrawalWindowYears * 12;

  const otherTaxableIncomeByYear: Record<number, number> = {};
  if (input.otherAnnualIncome) {
    const years = Math.ceil((windowMonths + 1) / 12); // mid-year windows touch 11 YAs
    for (let i = 0; i < years; i++) {
      otherTaxableIncomeByYear[startYear + i] = input.otherAnnualIncome;
    }
  }

  const schedule = optimizeSrsDrawdown({
    balance: input.projectedBalance,
    taxableShare: srsRules.taxableShare,
    brackets: input.brackets,
    startYear,
    startMonth: 1,
    windowMonths,
    otherTaxableIncomeByYear,
    annualReturn: input.windowReturn ?? 0,
  });

  const totalTax = roundCents(schedule.totalTax);
  // Effective rate is over everything that leaves the account: the actual
  // withdrawals plus the deemed residual.
  const withdrawnTotal = schedule.totalWithdrawn + (schedule.residual?.amount ?? 0);
  return {
    kind: "at_retirement",
    withdrawalAge,
    startYear,
    projectedBalance: roundCents(input.projectedBalance),
    schedule,
    totalTax,
    // Rates rounded to 6dp (roundCents would zero out sub-1% rates).
    effectiveRate:
      withdrawnTotal > 0
        ? Math.round((totalTax / withdrawnTotal) * 1e6) / 1e6
        : 0,
  };
}

export type SrsEarlyWithdrawalScenario = {
  kind: "early";
  year: number;
  age: number;
  /** Balance withdrawn (projected to the withdrawal year). */
  balance: number;
  /** 5% penalty on the full withdrawal. */
  penalty: number;
  /** 100% of the withdrawal is taxable (no 50% concession). */
  taxableAmount: number;
  /** Incremental tax from stacking the withdrawal on the year's income. */
  tax: number;
  /** penalty + tax. */
  totalCost: number;
  /** totalCost / balance — the "effective tax rate" of this scenario. */
  effectiveRate: number;
};

/**
 * Early withdrawal of the entire balance: 5% penalty plus 100% of the
 * withdrawal added to that year's chargeable income (default: stacked on the
 * member's current chargeable income, i.e. withdrawn while still working).
 */
export function earlyWithdrawalScenario(input: {
  /** SRS balance at the withdrawal year (already projected). */
  balance: number;
  srsRules: SrsYearRules;
  brackets: TaxBracketRow[];
  /** The withdrawal year's other chargeable income. */
  chargeableIncome: number;
  year: number;
  age: number;
}): SrsEarlyWithdrawalScenario {
  const { srsRules } = input;
  const balance = roundCents(input.balance);
  const penalty = roundCents(balance * srsRules.earlyWithdrawalPenaltyRate);
  const tax = roundCents(
    bracketTax(input.chargeableIncome + balance, input.brackets) -
      bracketTax(input.chargeableIncome, input.brackets),
  );
  const totalCost = roundCents(penalty + tax);
  return {
    kind: "early",
    year: input.year,
    age: input.age,
    balance,
    penalty,
    taxableAmount: balance,
    tax,
    totalCost,
    effectiveRate: balance > 0 ? Math.round((totalCost / balance) * 1e6) / 1e6 : 0,
  };
}
