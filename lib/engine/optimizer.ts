/**
 * Household contribution optimizer: how much to put into CPF cash top-ups
 * (MA/SA/RA, "RSTU") and SRS this year, and whether SRS is worth it at all
 * once the tax on eventual withdrawals is priced in.
 *
 * Decision economics per member:
 *  - CPF cash top-ups save tax at the marginal rate now and are never taxed
 *    again (CPF payouts are tax-free) → worth it down to the last dollar of
 *    positive-marginal-rate chargeable income, up to the $8k self + $8k
 *    family caps and the $80k relief cap.
 *  - SRS saves tax at the marginal rate now but withdrawals are taxed later
 *    (50% taxable over the 10-year window, or 100% + 5% penalty if early).
 *    Recommended amount = argmax over contributions of the SRS-vs-cash
 *    advantage at the retirement date: the growth handicap versus investing
 *    the same dollars in cash equities, plus the savings stream compounded
 *    at the equity rate, minus the withdrawal tax attributable to new
 *    contributions (the tax on the existing balance is a sunk cost).
 *
 * Verdict thresholds (CFP rule of thumb): below a 7% marginal bracket the
 * immediate saving is thin against the liquidity lock-in (5% early-withdrawal
 * penalty); at 0% there is no benefit at all. Above 7% the verdict follows
 * the growth-aware advantage: a growth handicap that loses to cash investing
 * means no recommendation and a "not worth it" verdict.
 */
import type { SrsYearRules, TaxYearRules } from "./config.ts";
import { roundCents } from "./money.ts";
import { bracketTax, rateAt } from "./tax/brackets.ts";
import {
  computeHouseholdTax,
  computeMemberTax,
  type MemberTaxResult,
} from "./tax/compute.ts";
import type { ReliefClaim } from "./tax/reliefs.ts";
import type { SharedReliefAllocation, SharedReliefPool } from "./tax/optimizer.ts";
import {
  atRetirementScenario,
  earlyWithdrawalScenario,
  projectSrsBalance,
  type SrsAtRetirementScenario,
  type SrsEarlyWithdrawalScenario,
} from "./srs/scenarios.ts";
import { srsVsCash, type SrsVsCashComparison } from "./srs/compare.ts";

/* ------------------------------ Inputs ------------------------------ */

export type OptimizerMemberInput = {
  name?: string;
  /** Age as of 31 Dec of the income year. */
  age: number;
  sex: "male" | "female";
  citizenship: "sc" | "pr" | "foreigner";
  disabled?: boolean;
  /** Annual gross earned income (salary + bonus). */
  earnedIncome: number;
  otherIncome?: number;
  donations?: number;
  /** Annual employee CPF contributions (drives CPF Relief). */
  cpfEmployeeContributions?: number;
  claims?: ReliefClaim[];
  /** SRS balance today. */
  currentSrsBalance?: number;
  /** Expected annual return on SRS funds (0.03 = 3%). */
  expectedSrsReturn?: number;
  /** Expected annual return on cash investments, for the SRS-vs-cash
   *  comparison (0.07 = 7%). Absent = comparison not computed. */
  expectedEquityReturn?: number;
  /** Defaults to the statutory retirement age. */
  plannedRetirementAge?: number;
  /** Earned income per year during the drawdown window (part-time work);
   *  attracts the age-banded earned income relief automatically. */
  retirementEarnedIncome?: number;
  /** Non-earned income per year during the drawdown window (rental etc.). */
  retirementOtherIncome?: number;
  /** Other annual reliefs expected in retirement (beyond earned income relief). */
  retirementReliefs?: number;
  /** Age at which money would be pulled out early (default: current age). */
  earlyWithdrawalAge?: number;
  /** Has a qualifying family member whose SA/RA/MA can be topped up. */
  familyTopupEligible?: boolean;
  /** Explicit proposals; default to the recommended amounts. */
  proposedTopUpSelf?: number;
  proposedTopUpFamily?: number;
  proposedSrs?: number;
};

export type HouseholdOptimizerInput = {
  rules: TaxYearRules;
  srsRules: SrsYearRules;
  /** Calendar year of the income year (YA − 1). */
  currentYear: number;
  self: OptimizerMemberInput;
  spouse?: OptimizerMemberInput;
  /** Spouse-shareable relief pools (one per QCR child etc.). */
  sharedReliefPools?: SharedReliefPool[];
};

/* ------------------------------ Outputs ----------------------------- */

export type MemberSrsReport = {
  annualContribution: number;
  yearsContributing: number;
  totalContributions: number;
  withdrawalAge: number;
  projectedBalance: number;
  /** This-YA tax saved by the SRS contribution. */
  savingsThisYear: number;
  /** savingsThisYear / annualContribution. */
  effectiveReturnPct: number;
  /** savingsThisYear × yearsContributing (constant-income assumption). */
  lifetimeSavings: number;
  atRetirement: SrsAtRetirementScenario;
  early: SrsEarlyWithdrawalScenario;
  /** Savings (compounded at the equity rate when supplied, else nominal)
   *  − at-retirement withdrawal tax. */
  netLifetimeBenefit: number;
  /** SRS vs investing the same dollars with cash (null unless
   *  expectedEquityReturn was supplied). */
  vsCash: SrsVsCashComparison | null;
};

export type MemberPlan = {
  name: string;
  baseline: MemberTaxResult;
  /** With top-ups only (splits the savings attribution). */
  withTopUps: MemberTaxResult;
  /** With the proposed top-ups + SRS applied. */
  optimized: MemberTaxResult;
  /** Marginal bracket rate at the baseline chargeable income. */
  marginalRate: number;
  recommended: { topUpSelf: number; topUpFamily: number; srsAnnual: number };
  proposed: { topUpSelf: number; topUpFamily: number; srsAnnual: number };
  /** This-YA savings split by lever. */
  savings: { topUp: number; srs: number; total: number };
  /** SRS analysis at the proposed amount — or, when none is proposed, at
   *  the recommendation (else the cap) as a what-if, so the cost/benefit is
   *  visible even when the recommendation is zero. */
  srs: MemberSrsReport;
  verdict: "yes" | "no" | "conditional";
  reasons: string[];
};

export type HouseholdOptimization = {
  self: MemberPlan;
  spouse: MemberPlan | null;
  /** Shared-relief split under the proposed contributions. */
  allocations: SharedReliefAllocation[];
  combinedBaselineTax: number;
  combinedOptimizedTax: number;
  combinedSavings: number;
};

/* ----------------------------- Internals ---------------------------- */

const SRS_GRID_STEP = 100;

type MemberContext = {
  input: OptimizerMemberInput;
  name: string;
  baseline: MemberTaxResult;
  rules: TaxYearRules;
  srsRules: SrsYearRules;
  currentYear: number;
};

function srsCap(ctx: MemberContext): number {
  return ctx.input.citizenship === "foreigner"
    ? ctx.srsRules.capForeigner
    : ctx.srsRules.capScPr;
}

function withdrawalAge(ctx: MemberContext): number {
  return Math.max(
    ctx.srsRules.statutoryRetirementAge,
    ctx.input.plannedRetirementAge ?? 0,
  );
}

/**
 * Per-year taxable income in retirement before SRS withdrawals, net of
 * reliefs: earned income minus the age-banded earned income relief (e.g.
 * $8,000 at 60+), plus non-earned income, minus any other retirement
 * reliefs. Can go negative; the drawdown optimizer treats that as extra
 * 0%-bracket room, which is exactly how IRAS offsets work.
 */
function retirementNetIncome(ctx: MemberContext): number {
  const m = ctx.input;
  const earned = m.retirementEarnedIncome ?? 0;
  const bands = ctx.rules.reliefs.earned_income?.bands;
  let earnedRelief = 0;
  if (bands && earned > 0) {
    const age = withdrawalAge(ctx);
    const band = bands.find((b) => b.maxAge == null || age <= b.maxAge);
    earnedRelief = Math.min(earned, band?.amount ?? 0);
  }
  return (
    earned - earnedRelief + (m.retirementOtherIncome ?? 0) - (m.retirementReliefs ?? 0)
  );
}

/** Relief-cap room left after the baseline reliefs (incl. shared pools). */
function reliefRoom(ctx: MemberContext): number {
  return Math.max(0, ctx.rules.reliefCap - ctx.baseline.totalReliefsBeforeCap);
}

/**
 * CPF cash top-ups: strictly positive-value (never taxed again), so fill the
 * self cap, then the family cap, bounded by remaining chargeable income and
 * relief-cap room.
 */
function recommendTopUps(ctx: MemberContext): { self: number; family: number } {
  const params = ctx.rules.reliefs.cpf_cash_topup;
  if (!params) return { self: 0, family: 0 };
  // Only dollars above the 0% bracket save tax — never recommend relief that
  // pushes chargeable income below the top of the zero-rate bracket(s).
  const firstTaxed = ctx.rules.brackets.findIndex((b) => b.rate > 0);
  if (firstTaxed === -1) return { self: 0, family: 0 };
  const zeroFloor = firstTaxed > 0 ? (ctx.rules.brackets[firstTaxed - 1]!.upTo ?? 0) : 0;
  const taxableDollars = Math.max(0, ctx.baseline.chargeableIncome - zeroFloor);
  let room = reliefRoom(ctx);
  const self = Math.round(Math.min(params.selfCap, taxableDollars, room));
  room -= self;
  const family = ctx.input.familyTopupEligible
    ? Math.round(Math.min(params.familyCap, taxableDollars - self, room))
    : 0;
  return { self, family };
}

/**
 * SRS recommendation: grid-search the contribution maximizing the
 * SRS-vs-cash advantage. The objective is concave (savings step down at
 * bracket floors, withdrawal tax steps up), so the $100 grid lands within
 * a step of the exact kink.
 */
function recommendSrs(
  ctx: MemberContext,
  topUps: { self: number; family: number },
): number {
  const cap = srsCap(ctx);
  const room = reliefRoom(ctx) - topUps.self - topUps.family;
  const chargeable = ctx.baseline.chargeableIncome - topUps.self - topUps.family;
  if (cap <= 0 || room <= 0 || rateAt(chargeable, ctx.rules.brackets) === 0) return 0;

  const years = Math.max(0, withdrawalAge(ctx) - ctx.input.age);
  const r = ctx.input.expectedSrsReturn ?? 0;
  const currentBalance = ctx.input.currentSrsBalance ?? 0;
  // Score = the SRS-vs-cash advantage at retirement (see srs/compare.ts):
  // the contribution stream's growth handicap versus cash equities, plus the
  // savings stream compounded at the equity rate, minus the withdrawal tax.
  // Falls back to the SRS rate (no handicap) when no equity rate is given,
  // and to nominal savings when both are 0.
  const equityReturn = ctx.input.expectedEquityReturn ?? r;

  const savings = (c: number) =>
    roundCents(
      bracketTax(chargeable, ctx.rules.brackets) -
        bracketTax(Math.max(0, chargeable - Math.min(c, room)), ctx.rules.brackets),
    );
  const withdrawalTax = (c: number) =>
    atRetirementScenario({
      projectedBalance: projectSrsBalance({
        currentBalance,
        annualContribution: c,
        years,
        annualReturn: r,
      }),
      srsRules: ctx.srsRules,
      brackets: ctx.rules.brackets,
      currentAge: ctx.input.age,
      plannedRetirementAge: ctx.input.plannedRetirementAge,
      currentYear: ctx.currentYear,
      otherAnnualIncome: retirementNetIncome(ctx),
    }).totalTax;

  // Tax on the existing balance is sunk — only the increment is attributable
  // to new contributions.
  const sunkTax = withdrawalTax(0);

  const futureValue = (contribution: number, rate: number) =>
    projectSrsBalance({
      currentBalance: 0,
      annualContribution: contribution,
      years,
      annualReturn: rate,
    });
  const score = (c: number) =>
    futureValue(c, r) -
    futureValue(c, equityReturn) +
    futureValue(savings(c), equityReturn) -
    (withdrawalTax(c) - sunkTax);

  let best = 0;
  let bestScore = 0;
  for (let c = SRS_GRID_STEP; c <= cap; c += SRS_GRID_STEP) {
    if (score(c) > bestScore + 1e-9) {
      bestScore = score(c);
      best = c;
    }
  }
  // The cap itself is a candidate when it isn't a grid multiple.
  if (cap % SRS_GRID_STEP !== 0 && score(cap) > bestScore + 1e-9) best = cap;
  return best;
}

// Note: marginal analysis uses bracketTax directly, ignoring the one-off
// YA rebate (capped and year-specific); displayed savings come from the full
// computeMemberTax/Household results and do include it.
function memberTaxInput(
  input: OptimizerMemberInput,
  amounts: { topUpSelf: number; topUpFamily: number; srsAnnual: number },
) {
  return {
    member: {
      age: input.age,
      sex: input.sex,
      citizenship: input.citizenship,
      disabled: input.disabled,
    },
    earnedIncome: input.earnedIncome,
    otherIncome: input.otherIncome,
    donations: input.donations,
    cpfEmployeeContributions: input.cpfEmployeeContributions,
    srsContributions: amounts.srsAnnual,
    cpfTopUps: { self: amounts.topUpSelf, family: amounts.topUpFamily },
    claims: input.claims,
  };
}

function buildSrsReport(
  ctx: MemberContext,
  srsAnnual: number,
  savingsThisYear: number,
): MemberSrsReport {
  const years = Math.max(0, withdrawalAge(ctx) - ctx.input.age);
  const yearsContributing = Math.max(1, years);
  const projectedBalance = projectSrsBalance({
    currentBalance: ctx.input.currentSrsBalance ?? 0,
    annualContribution: srsAnnual,
    years,
    annualReturn: ctx.input.expectedSrsReturn ?? 0,
  });
  const atRetirement = atRetirementScenario({
    projectedBalance,
    srsRules: ctx.srsRules,
    brackets: ctx.rules.brackets,
    currentAge: ctx.input.age,
    plannedRetirementAge: ctx.input.plannedRetirementAge,
    currentYear: ctx.currentYear,
    otherAnnualIncome: retirementNetIncome(ctx),
  });
  const earlyAge = Math.min(
    ctx.input.earlyWithdrawalAge ?? ctx.input.age,
    withdrawalAge(ctx),
  );
  const early = earlyWithdrawalScenario({
    balance: projectSrsBalance({
      currentBalance: ctx.input.currentSrsBalance ?? 0,
      annualContribution: srsAnnual,
      years: Math.max(0, earlyAge - ctx.input.age),
      annualReturn: ctx.input.expectedSrsReturn ?? 0,
    }),
    srsRules: ctx.srsRules,
    brackets: ctx.rules.brackets,
    chargeableIncome: ctx.baseline.chargeableIncome,
    year: ctx.currentYear + Math.max(0, earlyAge - ctx.input.age),
    age: earlyAge,
  });
  const lifetimeSavings = roundCents(savingsThisYear * yearsContributing);
  // SRS-vs-cash: the withdrawal tax attributable to the new contributions
  // excludes the tax on the existing balance (sunk, like in recommendSrs).
  let vsCash: SrsVsCashComparison | null = null;
  if (ctx.input.expectedEquityReturn != null) {
    const sunkTax = atRetirementScenario({
      projectedBalance: projectSrsBalance({
        currentBalance: ctx.input.currentSrsBalance ?? 0,
        annualContribution: 0,
        years,
        annualReturn: ctx.input.expectedSrsReturn ?? 0,
      }),
      srsRules: ctx.srsRules,
      brackets: ctx.rules.brackets,
      currentAge: ctx.input.age,
      plannedRetirementAge: ctx.input.plannedRetirementAge,
      currentYear: ctx.currentYear,
      otherAnnualIncome: retirementNetIncome(ctx),
    }).totalTax;
    vsCash = srsVsCash({
      annualContribution: srsAnnual,
      years,
      srsReturn: ctx.input.expectedSrsReturn ?? 0,
      equityReturn: ctx.input.expectedEquityReturn,
      annualSavings: savingsThisYear,
      withdrawalTax: atRetirement.totalTax - sunkTax,
    });
  }
  return {
    annualContribution: srsAnnual,
    yearsContributing,
    totalContributions: roundCents(srsAnnual * yearsContributing),
    withdrawalAge: atRetirement.withdrawalAge,
    projectedBalance,
    savingsThisYear,
    effectiveReturnPct: Math.round((savingsThisYear / srsAnnual) * 1e4) / 1e4,
    lifetimeSavings,
    atRetirement,
    early,
    // With an equity rate supplied, the savings are priced at retirement
    // (saved + reinvestment growth); otherwise nominal. Either way the
    // withdrawal tax on the whole balance comes off.
    netLifetimeBenefit: roundCents(
      (vsCash?.savingsAtRetirement ?? lifetimeSavings) - atRetirement.totalTax,
    ),
    vsCash,
  };
}

function verdictFor(
  ctx: MemberContext,
  marginalRate: number,
  srs: MemberSrsReport,
  recommendedSrs: number,
  proposedSrs: number,
): { verdict: MemberPlan["verdict"]; reasons: string[] } {
  const reasons: string[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  if (marginalRate === 0) {
    return {
      verdict: "no",
      reasons: [
        "Chargeable income is $0 after reliefs, so there is no tax to save; SRS and top-ups would only lock up money.",
      ],
    };
  }

  reasons.push(
    `Every relief dollar saves ${pct(marginalRate)} now (your marginal bracket).`,
  );

  reasons.push(
    `At-retirement drawdown: ${pct(srs.atRetirement.effectiveRate)} effective tax on withdrawals ` +
      `($${Math.round(srs.atRetirement.totalTax).toLocaleString("en-SG")} over the 10-year window).`,
  );
  reasons.push(
    `Early withdrawal at ${srs.early.age} would cost ${pct(srs.early.effectiveRate)} of the balance ` +
      `(5% penalty + full taxation). Only commit money you can lock in until ${srs.withdrawalAge}.`,
  );
  if (proposedSrs === 0 && recommendedSrs > 0) {
    reasons.push(
      `No SRS contribution proposed, but $${recommendedSrs.toLocaleString("en-SG")}/yr is recommended at your bracket.`,
    );
  }

  // The win measure: growth-aware SRS-vs-cash advantage when an equity rate
  // was supplied, else the nominal lifetime benefit.
  const advantage = srs.vsCash?.advantage ?? srs.netLifetimeBenefit;

  // Nothing proposed and nothing recommended: SRS has no edge under these
  // assumptions (thin bracket, or the growth handicap loses to cash).
  if (proposedSrs === 0 && recommendedSrs === 0) {
    reasons.push(
      marginalRate >= 0.07
        ? "No SRS contribution recommended: at these growth rates the lock-in loses to investing the same dollars with cash."
        : "Below the 7% bracket the immediate saving is thin against the liquidity lock-in; " +
          "CPF cash top-ups (never taxed again) are the better first dollar.",
    );
    return { verdict: "no", reasons };
  }

  if (marginalRate >= 0.07 && advantage > 0) {
    reasons.unshift(
      srs.vsCash
        ? `SRS beats cash investing by $${Math.round(srs.vsCash.advantage).toLocaleString("en-SG")} at retirement: ` +
          `save ${pct(srs.effectiveReturnPct)} per contributed dollar now, pay ~${pct(srs.atRetirement.effectiveRate)} later.`
        : `Net lifetime benefit $${Math.round(srs.netLifetimeBenefit).toLocaleString("en-SG")}: ` +
          `save ${pct(srs.effectiveReturnPct)} per contributed dollar now, pay ~${pct(srs.atRetirement.effectiveRate)} later.`,
    );
    return { verdict: proposedSrs > 0 ? "yes" : "conditional", reasons };
  }

  // A contribution with no edge: low bracket or a losing handicap.
  if (marginalRate >= 0.07) {
    reasons.push(
      `This contribution loses to cash investing by $${Math.round(-advantage).toLocaleString("en-SG")} at retirement; ` +
        `the recommendation is $${recommendedSrs.toLocaleString("en-SG")}/yr.`,
    );
  } else {
    reasons.push(
      "Below the 7% bracket the immediate saving is thin against the liquidity lock-in; " +
        "CPF cash top-ups (never taxed again) are the better first dollar.",
    );
  }
  return { verdict: "conditional", reasons };
}

/* ------------------------------- Main ------------------------------- */

export function optimizeHouseholdContributions(
  input: HouseholdOptimizerInput,
): HouseholdOptimization {
  const { rules, srsRules } = input;
  const pools = input.sharedReliefPools ?? [];
  const zero = { topUpSelf: 0, topUpFamily: 0, srsAnnual: 0 };

  const ctxOf = (
    m: OptimizerMemberInput,
    name: string,
    baseline: MemberTaxResult,
  ): MemberContext => ({
    input: m,
    name,
    baseline,
    rules,
    srsRules,
    currentYear: input.currentYear,
  });

  const householdTax = (
    amounts: { topUpSelf: number; topUpFamily: number; srsAnnual: number }[],
  ): {
    results: MemberTaxResult[];
    allocations: SharedReliefAllocation[];
  } => {
    if (!input.spouse) {
      // Single member: shared pools aren't shared — all of them land on self.
      const poolTotal = pools.reduce((s, p) => s + p.amount, 0);
      const claims = [...(input.self.claims ?? [])];
      if (poolTotal > 0) {
        claims.push({ type: "qcr", amountOverride: poolTotal } as ReliefClaim);
      }
      return {
        results: [
          computeMemberTax({
            ...memberTaxInput(input.self, amounts[0]),
            claims,
            rules,
            srsRules,
          }),
        ],
        allocations: pools.map((p) => ({
          label: p.label,
          amounts: [p.amount, 0] as [number, number],
        })),
      };
    }
    const result = computeHouseholdTax({
      rules,
      srsRules,
      self: memberTaxInput(input.self, amounts[0]),
      spouse: memberTaxInput(input.spouse, amounts[1]),
      sharedReliefPools: pools,
    });
    return {
      results: [result.self, result.spouse],
      allocations: result.allocations,
    };
  };

  const zeroAmounts = input.spouse ? [zero, zero] : [zero];
  const baseline = householdTax(zeroAmounts);

  // Per-member recommendations off the baseline chargeable incomes.
  const names = [input.self.name ?? "You", input.spouse?.name ?? "Spouse"];
  const ctxs = [input.self, input.spouse]
    .filter((m): m is OptimizerMemberInput => m != null)
    .map((m, i) => ctxOf(m, names[i]!, baseline.results[i]!));

  const recommended = ctxs.map((ctx) => {
    const topUps = recommendTopUps(ctx);
    return {
      topUpSelf: topUps.self,
      topUpFamily: topUps.family,
      srsAnnual: recommendSrs(ctx, topUps),
    };
  });

  const proposed = ctxs.map((ctx, i) => ({
    topUpSelf: ctx.input.proposedTopUpSelf ?? recommended[i]!.topUpSelf,
    topUpFamily: ctx.input.proposedTopUpFamily ?? recommended[i]!.topUpFamily,
    srsAnnual: ctx.input.proposedSrs ?? recommended[i]!.srsAnnual,
  }));

  // Two more passes split savings by lever (top-up vs SRS).
  const topUpOnly = householdTax(
    proposed.map((p) => ({ ...p, srsAnnual: 0 })),
  );
  const final = householdTax(proposed);

  // SRS analysis amount per member: the proposal, else the recommendation,
  // else the cap — so a zero recommendation still shows what contributing
  // would cost. One extra tax pass only when a display amount differs.
  const displaySrs = ctxs.map((ctx, i) =>
    proposed[i]!.srsAnnual > 0
      ? proposed[i]!.srsAnnual
      : recommended[i]!.srsAnnual > 0
        ? recommended[i]!.srsAnnual
        : srsCap(ctx),
  );
  const display =
    displaySrs.some((d, i) => d !== proposed[i]!.srsAnnual)
      ? householdTax(
          proposed.map((p, i) => ({ ...p, srsAnnual: displaySrs[i]! })),
        )
      : final;

  const plans = ctxs.map((ctx, i): MemberPlan => {
    const base = baseline.results[i]!;
    const withTopUps = topUpOnly.results[i]!;
    const optimized = final.results[i]!;
    const marginalRate = rateAt(base.chargeableIncome, rules.brackets);
    const topUpSavings = roundCents(base.taxPayable - withTopUps.taxPayable);
    const srsSavings = roundCents(withTopUps.taxPayable - optimized.taxPayable);
    const displayAmount = displaySrs[i]!;
    const displaySavings =
      displayAmount === proposed[i]!.srsAnnual
        ? srsSavings
        : roundCents(withTopUps.taxPayable - display.results[i]!.taxPayable);
    const srs = buildSrsReport(ctx, displayAmount, displaySavings);
    const { verdict, reasons } = verdictFor(
      ctx,
      marginalRate,
      srs,
      recommended[i]!.srsAnnual,
      proposed[i]!.srsAnnual,
    );
    return {
      name: ctx.name,
      baseline: base,
      withTopUps,
      optimized,
      marginalRate,
      recommended: recommended[i]!,
      proposed: proposed[i]!,
      savings: {
        topUp: topUpSavings,
        srs: srsSavings,
        total: roundCents(topUpSavings + srsSavings),
      },
      srs,
      verdict,
      reasons,
    };
  });

  const combinedBaselineTax = roundCents(
    baseline.results.reduce((s, r) => s + r.taxPayable, 0),
  );
  const combinedOptimizedTax = roundCents(
    final.results.reduce((s, r) => s + r.taxPayable, 0),
  );
  return {
    self: plans[0]!,
    spouse: plans[1] ?? null,
    allocations: final.allocations,
    combinedBaselineTax,
    combinedOptimizedTax,
    combinedSavings: roundCents(combinedBaselineTax - combinedOptimizedTax),
  };
}
