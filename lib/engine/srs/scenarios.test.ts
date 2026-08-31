/**
 * Golden tests for the SRS projection + withdrawal scenarios, pinned against
 * hand-computed IRAS bracket arithmetic on the seeded YA 2026 rules.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { taxRules, srsRules } from "../tax/fixtures.ts";
import {
  atRetirementScenario,
  earlyWithdrawalScenario,
  projectSrsBalance,
} from "./scenarios.ts";

const rules = taxRules(2026);
const srs = srsRules(2026);

test("projectSrsBalance: zero return is linear", () => {
  assert.equal(
    projectSrsBalance({
      currentBalance: 0,
      annualContribution: 15_300,
      years: 10,
      annualReturn: 0,
    }),
    153_000,
  );
  // Retiring this year still books this YA's contribution.
  assert.equal(
    projectSrsBalance({
      currentBalance: 20_000,
      annualContribution: 15_300,
      years: 0,
      annualReturn: 0.05,
    }),
    35_300,
  );
});

test("projectSrsBalance: this year's contribution compounds for the full horizon", () => {
  // (10,000 + 15,300) grown one year at 5%.
  assert.equal(
    projectSrsBalance({
      currentBalance: 10_000,
      annualContribution: 15_300,
      years: 1,
      annualReturn: 0.05,
    }),
    26_565,
  );
});

test("at-retirement: withdrawals up to $400k are tax-free with no other income", () => {
  // $400k over 10 years = $40k/yr; 50% taxable = $20k = the 0% bracket.
  const s = atRetirementScenario({
    projectedBalance: 400_000,
    srsRules: srs,
    brackets: rules.brackets,
    currentAge: 40,
    plannedRetirementAge: 63,
    currentYear: 2025,
  });
  assert.equal(s.withdrawalAge, 63);
  assert.equal(s.startYear, 2048);
  assert.equal(s.totalTax, 0);
  assert.equal(s.effectiveRate, 0);
  assert.equal(s.schedule.years.length, 10);
  assert.equal(s.schedule.totalWithdrawn, 400_000);
});

test("at-retirement: $500k pays $1,000 over the window", () => {
  // $50k/yr → $25k taxable → 5,000 @ 2% = $100/yr → $1,000 total.
  const s = atRetirementScenario({
    projectedBalance: 500_000,
    srsRules: srs,
    brackets: rules.brackets,
    currentAge: 40,
    plannedRetirementAge: 63,
    currentYear: 2025,
  });
  assert.equal(s.totalTax, 1_000);
  assert.equal(s.effectiveRate, 0.002);
});

test("at-retirement with growth: residual counts toward the effective rate", () => {
  // $660k at 7% through the window: withdrawals rise annually and the
  // deemed residual is priced; the effective rate spreads total tax over
  // everything that leaves the account.
  const s = atRetirementScenario({
    projectedBalance: 660_000,
    srsRules: srs,
    brackets: rules.brackets,
    currentAge: 40,
    plannedRetirementAge: 63,
    currentYear: 2025,
    windowReturn: 0.07,
  });
  assert.equal(s.schedule.residual!.year, 2058);
  assert.ok(Math.abs(s.totalTax - 9_357.29) < 0.01);
  // 9,357.29 / (828,986.88 withdrawn + 118,029.08 residual).
  assert.equal(s.effectiveRate, 0.009881);
});

test("at-retirement: other income lifts withdrawals into brackets", () => {
  // $20k other income fills the 0% bracket; $400k SRS → $20k taxable/yr
  // stacked on it: 10k @ 2% + 10k @ 3.5% = $550/yr → $5,500.
  const s = atRetirementScenario({
    projectedBalance: 400_000,
    srsRules: srs,
    brackets: rules.brackets,
    currentAge: 40,
    plannedRetirementAge: 63,
    currentYear: 2025,
    otherAnnualIncome: 20_000,
  });
  assert.equal(s.totalTax, 5_500);
});

test("at-retirement: retirement reliefs net against withdrawals (negative base)", () => {
  // −$8,000/yr (e.g. earned income relief at 60+ exceeding part-time income):
  // each year's 50%-taxable withdrawal ($20k on $400k) stacks onto a negative
  // base → chargeable $12k → tax-free.
  const s = atRetirementScenario({
    projectedBalance: 400_000,
    srsRules: srs,
    brackets: rules.brackets,
    currentAge: 40,
    plannedRetirementAge: 63,
    currentYear: 2025,
    otherAnnualIncome: -8_000,
  });
  assert.equal(s.totalTax, 0);
});

test("at-retirement: net-of-reliefs base stacks withdrawals on top", () => {
  // $20k part-time income − $8k relief = $12k base; $500k → $25k taxable/yr
  // → chargeable $37k → 10k @ 2% + 7k @ 3.5% = $445/yr → $4,450.
  const s = atRetirementScenario({
    projectedBalance: 500_000,
    srsRules: srs,
    brackets: rules.brackets,
    currentAge: 40,
    plannedRetirementAge: 63,
    currentYear: 2025,
    otherAnnualIncome: 12_000,
  });
  assert.equal(s.totalTax, 4_450);
});

test("at-retirement: statutory age floors the planned age", () => {
  const s = atRetirementScenario({
    projectedBalance: 100_000,
    srsRules: srs,
    brackets: rules.brackets,
    currentAge: 40,
    plannedRetirementAge: 55,
    currentYear: 2025,
  });
  assert.equal(s.withdrawalAge, 63); // statutory 63 prevails
});

test("early withdrawal: 5% penalty + 100% taxable stacked on income", () => {
  const s = earlyWithdrawalScenario({
    balance: 100_000,
    srsRules: srs,
    brackets: rules.brackets,
    chargeableIncome: 0,
    year: 2030,
    age: 45,
  });
  assert.equal(s.penalty, 5_000);
  assert.equal(s.taxableAmount, 100_000);
  // tax(100k) = 3,350 (to 80k) + 20,000 × 11.5% = 5,650
  assert.equal(s.tax, 5_650);
  assert.equal(s.totalCost, 10_650);
  assert.equal(s.effectiveRate, 0.1065);
});

test("early withdrawal: stacks on top of existing chargeable income", () => {
  const s = earlyWithdrawalScenario({
    balance: 15_300,
    srsRules: srs,
    brackets: rules.brackets,
    chargeableIncome: 102_000,
    year: 2025,
    age: 40,
  });
  // tax(117,300) − tax(102,000) = 15,300 × 11.5% = 1,759.50
  assert.equal(s.tax, 1_759.5);
  assert.equal(s.penalty, 765);
  assert.equal(s.totalCost, 2_524.5);
});
