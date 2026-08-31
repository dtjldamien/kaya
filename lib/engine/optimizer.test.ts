/**
 * Golden tests for the household contribution optimizer (CPF MA/SA top-ups +
 * SRS), hand-computed against the seeded YA 2026 rules (no rebate that YA).
 *
 * Reference brackets: 0% to 20k, 2% to 30k, 3.5% to 40k, 7% to 80k,
 * 11.5% to 120k. bracketTax(80k) = 3,350.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { taxRules, srsRules } from "./tax/fixtures.ts";
import {
  optimizeHouseholdContributions,
  type OptimizerMemberInput,
} from "./optimizer.ts";

const rules = taxRules(2026);
const srs = srsRules(2026);
const CURRENT_YEAR = 2025;

function member(overrides: Partial<OptimizerMemberInput> = {}): OptimizerMemberInput {
  return {
    age: 40,
    sex: "male",
    citizenship: "sc",
    earnedIncome: 120_000,
    cpfEmployeeContributions: 17_000,
    currentSrsBalance: 0,
    expectedSrsReturn: 0,
    plannedRetirementAge: 63,
    ...overrides,
  };
}

test("high earner: top up $8k, max SRS, verdict yes", () => {
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member(),
  });
  const p = r.self;

  // Baseline: reliefs 1,000 earned + 17,000 CPF = 18,000 → chargeable 102,000.
  assert.equal(p.baseline.chargeableIncome, 102_000);
  // tax(102,000) = 3,350 + 22,000 × 11.5% = 5,880.
  assert.equal(p.baseline.taxPayable, 5_880);
  assert.equal(p.marginalRate, 0.115);

  assert.deepEqual(p.recommended, { topUpSelf: 8_000, topUpFamily: 0, srsAnnual: 15_300 });

  // Optimized: chargeable 78,700 → tax 3,350 − 1,300 × 7% = 3,259.
  assert.equal(p.optimized.chargeableIncome, 78_700);
  assert.equal(p.optimized.taxPayable, 3_259);
  assert.equal(p.savings.topUp, 920); // 8,000 × 11.5%
  assert.equal(p.savings.srs, 1_701); // 4,960 − 3,259 (bracket crossing)
  assert.equal(p.savings.total, 2_621);

  // SRS report: 23 years to 63, no growth → 15,300 × 23 = 351,900.
  const s = p.srs!;
  assert.equal(s.yearsContributing, 23);
  assert.equal(s.totalContributions, 351_900);
  assert.equal(s.projectedBalance, 351_900);
  assert.equal(s.effectiveReturnPct, 0.1112); // 1,701 / 15,300
  assert.equal(s.atRetirement.totalTax, 0); // ≤ $400k → tax-free window
  assert.equal(s.lifetimeSavings, 39_123); // 1,701 × 23
  assert.equal(s.netLifetimeBenefit, 39_123);

  // Early withdrawal now: balance 15,300, stacked on 102,000.
  assert.equal(s.early.penalty, 765);
  assert.equal(s.early.tax, 1_759.5);
  assert.equal(s.early.totalCost, 2_524.5);

  assert.equal(p.verdict, "yes");
  assert.equal(r.spouse, null);
  assert.equal(r.combinedSavings, 2_621);
});

test("zero chargeable income: recommend nothing, verdict no", () => {
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ earnedIncome: 20_000, cpfEmployeeContributions: 0 }),
  });
  // chargeable 19,000 → 0% bracket.
  assert.equal(r.self.marginalRate, 0);
  assert.deepEqual(r.self.recommended, { topUpSelf: 0, topUpFamily: 0, srsAnnual: 0 });
  assert.equal(r.self.verdict, "no");
  // The report still renders — as a what-if at the $15,300 cap with zero
  // savings — so the cost of contributing stays visible.
  assert.equal(r.self.srs.annualContribution, 15_300);
  assert.equal(r.self.srs.savingsThisYear, 0);
  assert.equal(r.combinedSavings, 0);
});

test("3.5% bracket: SRS capped at the 0% bracket floor, verdict conditional", () => {
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ earnedIncome: 50_000, cpfEmployeeContributions: 10_000 }),
  });
  const p = r.self;
  // chargeable 39,000 → marginal 3.5%; after the $8k top-up, 31,000.
  assert.equal(p.marginalRate, 0.035);
  assert.equal(p.recommended.topUpSelf, 8_000);
  // SRS stops at the 0% bracket: 31,000 − 20,000 = 11,000 of tax-saving room.
  assert.equal(p.recommended.srsAnnual, 11_000);
  assert.equal(p.savings.srs, 235); // 200 (2% band) + 35 (3.5% band)
  assert.equal(p.verdict, "conditional");
  assert.ok(p.srs!.netLifetimeBenefit > 0);
});

test("top-ups bounded above the 0% bracket (no wasted relief)", () => {
  // chargeable 31,000 → full $8k (11,000 taxable dollars above 20k).
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ earnedIncome: 40_000, cpfEmployeeContributions: 8_000 }),
  });
  assert.equal(r.self.recommended.topUpSelf, 8_000);
  // chargeable 24,000 → only 4,000 taxable dollars above the 0% bracket.
  const r2 = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ earnedIncome: 30_000, cpfEmployeeContributions: 5_000 }),
  });
  assert.equal(r2.self.recommended.topUpSelf, 4_000);
  // chargeable 20,000 → nothing to save.
  const r3 = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ earnedIncome: 26_000, cpfEmployeeContributions: 5_000 }),
  });
  assert.equal(r3.self.recommended.topUpSelf, 0);
});

test("foreigner: SRS cap 35,700, no CPF relief", () => {
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ citizenship: "foreigner", cpfEmployeeContributions: 0, earnedIncome: 200_000 }),
  });
  assert.equal(r.self.recommended.srsAnnual, 35_700);
});

test("household: shared child relief goes to the higher-bracket spouse", () => {
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member(),
    spouse: member({ sex: "female", earnedIncome: 40_000, cpfEmployeeContributions: 8_000 }),
    sharedReliefPools: [{ label: "QCR — child 1", amount: 4_000 }],
  });
  // Spouse chargeable 31,000 (2% bracket); self 102,000 (11.5%) → pool to self.
  assert.deepEqual(r.allocations, [{ label: "QCR — child 1", amounts: [4_000, 0] }]);
  assert.ok(r.spouse != null);
  // Self (pool included in baseline): 5,420 → top-up 920, SRS 1,521.
  assert.equal(r.self.savings.topUp, 920);
  assert.equal(r.self.savings.srs, 1_521);
  // Spouse: 235 → top-up 175 (to 23k), SRS 60 (to the 20k floor).
  assert.equal(r.spouse.savings.topUp, 175);
  assert.equal(r.spouse.savings.srs, 60);
  assert.equal(r.spouse.recommended.srsAnnual, 3_000);
  assert.equal(r.combinedSavings, 2_676);
  assert.equal(r.combinedSavings, r.combinedBaselineTax - r.combinedOptimizedTax);
});

test("single member: QCR pools land entirely on self", () => {
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member(),
    sharedReliefPools: [{ label: "QCR — child 1", amount: 4_000 }],
  });
  assert.deepEqual(r.allocations, [{ label: "QCR — child 1", amounts: [4_000, 0] }]);
  // Baseline includes the pool: 102,000 − 4,000 = 98,000 chargeable.
  assert.equal(r.self.baseline.chargeableIncome, 98_000);
});

test("proposed overrides recommended amounts", () => {
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ proposedSrs: 5_000, proposedTopUpSelf: 0 }),
  });
  const p = r.self;
  assert.equal(p.proposed.srsAnnual, 5_000);
  assert.equal(p.proposed.topUpSelf, 0);
  assert.equal(p.recommended.srsAnnual, 15_300);
  // savings: srs 5,000 × 11.5% = 575.
  assert.equal(p.savings.srs, 575);
  assert.equal(p.srs!.annualContribution, 5_000);
});

test("retirement earned income gets the age-60+ earned income relief", () => {
  // $500k existing balance makes withdrawal tax nonzero; part-time earned
  // income of $20k nets to $12k after the $8,000 earned income relief (63+),
  // while $20k of rental income does not.
  const earned = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ currentSrsBalance: 500_000, retirementEarnedIncome: 20_000 }),
  });
  const rental = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ currentSrsBalance: 500_000, retirementOtherIncome: 20_000 }),
  });
  assert.ok(
    earned.self.srs!.atRetirement.totalTax < rental.self.srs!.atRetirement.totalTax,
  );
});

test("equal growth rates: full cap recommended, verdict yes", () => {
  // 29-year-old at the 11.5% bracket, 7% inside and outside SRS: no growth
  // handicap, so the net lifetime benefit (tax saved + reinvestment growth −
  // withdrawal tax) equals the vs-cash advantage and is strongly positive.
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({
      age: 29,
      earnedIncome: 137_000,
      expectedSrsReturn: 0.07,
      expectedEquityReturn: 0.07,
    }),
  });
  const p = r.self;
  assert.equal(p.recommended.srsAnnual, 15_300);
  // savings 59,823 compounded to ~241k − ~62k withdrawal tax.
  assert.ok(p.srs!.netLifetimeBenefit > 150_000);
  assert.equal(p.srs!.netLifetimeBenefit, p.srs!.vsCash!.advantage);
  assert.equal(p.verdict, "yes");
});

test("idle SRS vs equities: nothing recommended, verdict no", () => {
  // SRS cash at 0.05% against 7% equities: the growth handicap kills the
  // arbitrage, so the recommendation is 0 and the verdict is "no", not
  // "conditional".
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({
      expectedSrsReturn: 0.0005,
      expectedEquityReturn: 0.07,
    }),
  });
  assert.equal(r.self.recommended.srsAnnual, 0);
  // What-if at the cap: the advantage is negative, showing the loss.
  assert.equal(r.self.srs.annualContribution, 15_300);
  assert.ok(r.self.srs.vsCash!.advantage < 0);
  assert.equal(r.self.verdict, "no");
});

test("existing balance's withdrawal tax is sunk — doesn't kill the recommendation", () => {
  // $500k already in SRS: withdrawals already taxable, but new contributions
  // at 11.5% still beat the marginal withdrawal rate.
  const r = optimizeHouseholdContributions({
    rules,
    srsRules: srs,
    currentYear: CURRENT_YEAR,
    self: member({ currentSrsBalance: 500_000 }),
  });
  assert.equal(r.self.recommended.srsAnnual, 15_300);
  assert.ok(r.self.srs!.atRetirement.totalTax > 0);
});
