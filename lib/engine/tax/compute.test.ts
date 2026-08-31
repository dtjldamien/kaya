/**
 * Golden tests for the full per-member tax computation, pinned to IRAS worked
 * examples (WMCR/QCR pages, donations page) and the IRAS YA 2025 rebate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMemberTax, marginalReliefRate } from "./compute.ts";
import { srsRules, taxRules } from "./fixtures.ts";

const YA2025 = taxRules(2025);
const YA2026 = taxRules(2026);
const SRS2025 = srsRules(2025);

/* IRAS WMCR page, Example 4: Mrs Chen, employment income $80,000 in 2025
   (YA 2026); Earned Income Relief $1,000, QCR $4,000, WMCR $8,000 (first
   child born 2025), CPF Relief $16,000. Chargeable income $51,000; tax =
   $550 + 7% x $11,000 = $1,320. (The example then applies the Parenthood Tax
   Rebate, which the engine does not model.) */
test("IRAS example: Mrs Chen (YA 2026)", () => {
  const r = computeMemberTax({
    rules: YA2026,
    srsRules: SRS2025,
    member: { age: 32, sex: "female", citizenship: "sc" },
    earnedIncome: 80_000,
    cpfEmployeeContributions: 16_000,
    claims: [
      { type: "qcr", children: 1 },
      {
        type: "wmcr",
        children: [{ order: 1, born: "2025-02-01", qcrClaimed: 4_000 }],
      },
    ],
  });
  assert.equal(r.assessableIncome, 80_000);
  assert.equal(r.totalReliefs, 29_000);
  assert.equal(r.chargeableIncome, 51_000);
  assert.equal(r.taxBeforeRebate, 1_320);
  assert.equal(r.rebate, 0); // no rebate announced for YA 2026
  assert.equal(r.taxPayable, 1_320);
  assert.equal(
    r.bracketBreakdown.reduce((s, l) => s + l.tax, 0),
    r.taxBeforeRebate,
  );
});

/* IRAS donations page: statutory income $100,000, donation $10,000 to an
   approved IPC -> 2.5x deduction $25,000 -> assessable income $75,000.
   Donations are a deduction, outside the $80k relief cap. */
test("donations: 250% deduction against statutory income", () => {
  const r = computeMemberTax({
    rules: YA2026,
    srsRules: SRS2025,
    member: { age: 40, sex: "male", citizenship: "sc" },
    earnedIncome: 100_000,
    donations: 10_000,
  });
  assert.equal(r.statutoryIncome, 100_000);
  assert.equal(r.donationsDeduction, 25_000);
  assert.equal(r.assessableIncome, 75_000);
  // Earned Income Relief $1,000 only -> chargeable $74,000.
  assert.equal(r.totalReliefs, 1_000);
  assert.equal(r.chargeableIncome, 74_000);
  assert.equal(r.taxPayable, 550 + 0.07 * 34_000);
});

/* IRAS: YA 2025 personal income tax rebate of 60% of tax payable, capped at
   $200. */
test("YA 2025 rebate: 60% of tax payable up to $200", () => {
  const base = {
    srsRules: SRS2025,
    member: { age: 40, sex: "male", citizenship: "sc" } as const,
    earnedIncome: 50_000,
  };
  const r2025 = computeMemberTax({ ...base, rules: YA2025 });
  // Chargeable $49,000 -> tax $550 + 7% x $9,000 = $1,180; rebate $200.
  assert.equal(r2025.taxBeforeRebate, 1_180);
  assert.equal(r2025.rebate, 200);
  assert.equal(r2025.taxPayable, 980);

  const r2026 = computeMemberTax({ ...base, rules: YA2026 });
  assert.equal(r2026.rebate, 0);
  assert.equal(r2026.taxPayable, 1_180);
});

/* IRAS WMCR page, Example 3 (cont.): Mrs Lim's total reliefs $1,000 (EIR) +
   $83,500 (WMCR) = $84,500 are capped at the $80,000 relief cap. */
test("the $80,000 relief cap applies", () => {
  const r = computeMemberTax({
    rules: YA2026,
    srsRules: SRS2025,
    member: { age: 45, sex: "female", citizenship: "sc" },
    earnedIncome: 250_000,
    claims: [
      {
        type: "wmcr",
        children: [
          { order: 1, born: "2009-04-01", qcrClaimed: 7_500 },
          { order: 2, born: "2010-11-01", qcrClaimed: 4_000 },
        ],
      },
    ],
  });
  assert.equal(r.totalReliefsBeforeCap, 84_500);
  assert.equal(r.totalReliefs, 80_000);
  assert.equal(r.chargeableIncome, 170_000);
  assert.equal(r.taxPayable, 13_950 + 0.18 * 10_000);
});

test("SRS relief capped at $15,300 (SC/PR) / $35,700 (foreigner)", () => {
  const sc = computeMemberTax({
    rules: YA2026,
    srsRules: SRS2025,
    member: { age: 40, sex: "male", citizenship: "sc" },
    earnedIncome: 200_000,
    srsContributions: 20_000,
  });
  assert.equal(sc.reliefs.find((r) => r.type === "srs")?.amount, 15_300);

  const foreigner = computeMemberTax({
    rules: YA2026,
    srsRules: SRS2025,
    member: { age: 40, sex: "male", citizenship: "foreigner" },
    earnedIncome: 300_000,
    srsContributions: 40_000,
  });
  assert.equal(foreigner.reliefs.find((r) => r.type === "srs")?.amount, 35_700);
});

test("CPF cash top-up relief: $8,000 self + $8,000 family caps", () => {
  const r = computeMemberTax({
    rules: YA2026,
    srsRules: SRS2025,
    member: { age: 40, sex: "male", citizenship: "sc" },
    earnedIncome: 200_000,
    cpfTopUps: { self: 10_000, family: 9_000 },
  });
  assert.equal(r.reliefs.find((r) => r.type === "cpf_cash_topup")?.amount, 16_000);
});

test("SRS saving spans bracket drops exactly (not marginal rate x amount)", () => {
  // Earned income $95,000, EIR $1,000 -> chargeable $94,000 (11.5% bracket).
  // SRS $15,300 drops chargeable to $78,700 — through the $80k boundary:
  // $14,000 at 11.5% + $1,300 at 7% = $1,610 + $91 = $1,701 exactly.
  const base = {
    rules: YA2026,
    srsRules: SRS2025,
    member: { age: 40, sex: "male" as const, citizenship: "sc" as const },
    earnedIncome: 95_000,
  };
  const without = computeMemberTax({ ...base, srsContributions: 0 });
  const withSrs = computeMemberTax({ ...base, srsContributions: 15_300 });
  assert.equal(without.chargeableIncome, 94_000);
  assert.equal(withSrs.chargeableIncome, 78_700);
  assert.equal(without.taxPayable - withSrs.taxPayable, 1_701);
  // A naive marginal-rate estimate (15,300 x 11.5% = $1,759.50) overstates.
  assert.notEqual(without.taxPayable - withSrs.taxPayable, 1_759.5);
});

test("marginal relief rate: bracket rate, 0 at the cap / zero chargeable", () => {
  assert.equal(
    marginalReliefRate({ assessableIncome: 100_000, totalReliefs: 10_000, rules: YA2026 }),
    0.115, // chargeable $90,000 -> 11.5%
  );
  assert.equal(
    marginalReliefRate({ assessableIncome: 100_000, totalReliefs: 80_000, rules: YA2026 }),
    0,
  );
  assert.equal(
    marginalReliefRate({ assessableIncome: 10_000, totalReliefs: 5_000, rules: YA2026 }),
    0,
  );
});
