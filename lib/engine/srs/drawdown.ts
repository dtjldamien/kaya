/**
 * SRS drawdown optimizer: plans penalty-free withdrawals over the 10-year
 * (120-month) window to minimize tax, where 50% of each withdrawal is taxable.
 *
 * The window starts at the first penalty-free withdrawal month and therefore
 * spans up to 11 calendar years (YAs) when it starts mid-year — and tax is
 * assessed per YA, so the optimizer water-fills across calendar years, filling
 * the 0%/low brackets net of other taxable income. (IRAS: withdrawals spread
 * from 1 Apr 2025 run "until 31 Mar 2035" — 11 YAs.)
 *
 * Exact for the convex piecewise-linear objective (same water-filling
 * argument as the household relief optimizer). Ties break to the earlier
 * year.
 *
 * With `annualReturn` > 0 the balance keeps compounding inside the account
 * during the window. The schedule is then re-planned at the start of each
 * year: the current balance is water-filled over the remaining window years
 * plus one deemed-residual bucket (the balance left at the window's end is
 * deemed withdrawn, 50% taxable, in the following YA), this year's share is
 * withdrawn, and the rest grows. Re-planning means no growth forecast is
 * needed up front and rising withdrawals absorb the appreciation instead of
 * leaving a large residual taxed at the top.
 */
import type { TaxBracketRow } from "../config.ts";
import { bracketTax, distanceToBracketCeiling, rateAbove } from "../tax/brackets.ts";

export type SrsDrawdownInput = {
  /** SRS balance at drawdown start (dollars). */
  balance: number;
  /** Taxable share of withdrawals (0.5 = 50%). */
  taxableShare: number;
  brackets: TaxBracketRow[];
  /** Calendar year + month of the first penalty-free withdrawal. */
  startYear: number;
  startMonth: number;
  /** Window length in months (10 years = 120). */
  windowMonths: number;
  /** Other taxable income per calendar year (default 0). */
  otherTaxableIncomeByYear?: Record<number, number>;
  /** Expected annual return inside the SRS during the window (default 0). */
  annualReturn?: number;
};
export type SrsDrawdownResidual = {
  /** Calendar year the residual is deemed withdrawn (window end + 1). */
  year: number;
  amount: number;
  /** Taxable part (taxableShare x amount). */
  taxableAmount: number;
  /** Tax on the deemed withdrawal, net of that year's other income. */
  tax: number;
};

export type SrsDrawdownYearPlan = {
  year: number;
  /** Window months falling in this calendar year. */
  months: number;
  withdrawal: number;
  /** Taxable part of the year's withdrawals (taxableShare x withdrawal). */
  taxableAmount: number;
  /** Incremental tax from the withdrawals (net of other income). */
  tax: number;
};

export type SrsDrawdownSchedule = {
  years: SrsDrawdownYearPlan[];
  totalWithdrawn: number;
  totalTax: number;
  /** Balance left at the window's end (deemed withdrawn, 50% taxable);
   *  null when no in-window growth is modelled. */
  residual: SrsDrawdownResidual | null;
  /** Marginal rate in the final window year — for the deemed residual. */
  residualMarginalRate: number;
};

const EPS = 1e-9;
/** Water-fill `balance` of withdrawals across buckets by marginal rate, where
 *  `bases[i]` is bucket i's pre-existing chargeable income. Exact for the
 *  convex piecewise-linear tax objective; ties split equally. */
function waterFill(
  balance: number,
  taxableShare: number,
  brackets: TaxBracketRow[],
  bases: number[],
): number[] {
  const withdrawals = bases.map(() => 0);
  let remaining = balance;
  while (remaining > EPS) {
    const chargeableOf = (i: number) =>
      bases[i] + taxableShare * withdrawals[i];
    const rates = bases.map((_, i) => rateAbove(chargeableOf(i), brackets));
    const minRate = Math.min(...rates);
    const tied = bases
      .map((_, i) => i)
      .filter((i) => Math.abs(rates[i] - minRate) < EPS);

    const perBucket = remaining / tied.length;
    let progress = 0;
    for (const i of tied) {
      const roomWithdrawal =
        distanceToBracketCeiling(chargeableOf(i), brackets) / taxableShare;
      const chunk = Math.min(perBucket, roomWithdrawal);
      withdrawals[i] += chunk;
      progress += chunk;
    }
    remaining -= progress;
    if (progress <= EPS) {
      // No bracket room anywhere except the top bracket — finish there.
      withdrawals[tied[0]] += remaining;
      remaining = 0;
    }
  }
  return withdrawals;
}

export function optimizeSrsDrawdown(input: SrsDrawdownInput): SrsDrawdownSchedule {
  const { balance, taxableShare, brackets, windowMonths } = input;
  const otherIncome = input.otherTaxableIncomeByYear ?? {};
  const growth = input.annualReturn ?? 0;

  // Calendar years touched by the window, with the month count in each.
  const years: { year: number; months: number }[] = [];
  {
    let y = input.startYear;
    let m = input.startMonth;
    let left = windowMonths;
    while (left > 0) {
      const monthsThisYear = Math.min(13 - m, left);
      years.push({ year: y, months: monthsThisYear });
      left -= monthsThisYear;
      y += 1;
      m = 1;
    }
  }

  // Water-fill withdrawal dollars across years by marginal rate. Years tied
  // at the lowest marginal rate share each round equally, so the schedule is
  // level whenever that's tax-optimal (better as retirement income).
  // With growth, re-plan each year on the current balance: water-fill it over
  // the remaining window years plus one deemed-residual bucket (taxed the YA
  // after the window ends), withdraw this year's share, grow the rest. At
  // zero growth this reduces to a single fill over the window years and
  // leaves nothing behind.
  const residualYear = years.at(-1)!.year + 1;
  const withdrawals: number[] = [];
  let current = balance;
  for (let i = 0; i < years.length; i++) {
    if (growth === 0) {
      withdrawals.push(
        ...waterFill(
          current,
          taxableShare,
          brackets,
          years.slice(i).map((y) => otherIncome[y.year] ?? 0),
        ),
      );
      break;
    }
    const fill = waterFill(
      current,
      taxableShare,
      brackets,
      [
        ...years.slice(i).map((y) => otherIncome[y.year] ?? 0),
        otherIncome[residualYear] ?? 0,
      ],
    );
    withdrawals.push(fill[0]);
    current = (current - fill[0]) * (1 + growth);
  }
  const residualAmount = growth === 0 ? 0 : current;

  const plans: SrsDrawdownYearPlan[] = years.map((y, i) => {
    const base = otherIncome[y.year] ?? 0;
    const taxableAmount = taxableShare * withdrawals[i];
    const tax = bracketTax(base + taxableAmount, brackets) - bracketTax(base, brackets);
    return {
      year: y.year,
      months: y.months,
      withdrawal: withdrawals[i],
      taxableAmount,
      tax,
    };
  });

  const last = plans.at(-1)!;
  const residualMarginalRate = rateAbove(
    (otherIncome[last.year] ?? 0) + last.taxableAmount,
    brackets,
  );
  const residualBase = otherIncome[residualYear] ?? 0;
  const residualTaxable = taxableShare * residualAmount;
  const residual: SrsDrawdownResidual | null =
    residualAmount > EPS
      ? {
          year: residualYear,
          amount: residualAmount,
          taxableAmount: residualTaxable,
          tax:
            bracketTax(residualBase + residualTaxable, brackets) -
            bracketTax(residualBase, brackets),
        }
      : null;

  return {
    years: plans,
    totalWithdrawn: withdrawals.reduce((s, w) => s + w, 0),
    totalTax: plans.reduce((s, p) => s + p.tax, 0) + (residual?.tax ?? 0),
    residual,
    residualMarginalRate,
  };
}
