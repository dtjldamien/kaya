/**
 * Tests for the household shareable-relief optimizer (QCR etc.), with
 * hand-verified expected allocations and combined tax.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHouseholdTax } from "./compute.ts";
import { optimizeSharedReliefs } from "./optimizer.ts";
import { srsRules, taxRules } from "./fixtures.ts";

const YA2026 = taxRules(2026);
const SRS2025 = srsRules(2025);
const brackets = YA2026.brackets;

const optimize = (
  self: { assessableIncome: number; baseReliefs: number },
  spouse: { assessableIncome: number; baseReliefs: number },
  amounts: number[],
) =>
  optimizeSharedReliefs({
    members: [self, spouse],
    pools: amounts.map((amount, i) => ({ label: `pool ${i + 1}`, amount })),
    brackets,
    reliefCap: YA2026.reliefCap,
  });

test("all relief goes to the higher-marginal-rate spouse", () => {
  // Self at $90k (11.5%), spouse at $30k (2%): the whole $4,000 QCR to self.
  const [a] = optimize({ assessableIncome: 90_000, baseReliefs: 0 }, { assessableIncome: 30_000, baseReliefs: 0 }, [4_000]);
  assert.deepEqual(a.amounts, [4_000, 0]);
});

test("allocation crosses a bracket floor, then ties break to higher chargeable", () => {
  // Self at $81k: 11.5% for the first $1k, then 7% like spouse ($45k).
  // Tie-break (higher chargeable income) keeps the rest with self.
  const [a] = optimize({ assessableIncome: 81_000, baseReliefs: 0 }, { assessableIncome: 45_000, baseReliefs: 0 }, [4_000]);
  assert.deepEqual(a.amounts, [4_000, 0]);
});

test("the $80k relief cap pushes the remainder to the other spouse", () => {
  // Self has $79k of reliefs already: only $1k of room at 15%, then spouse
  // (2%) takes the remaining $3k.
  const [a] = optimize(
    { assessableIncome: 200_000, baseReliefs: 79_000 },
    { assessableIncome: 30_000, baseReliefs: 5_000 },
    [4_000],
  );
  assert.deepEqual(a.amounts, [1_000, 3_000]);
});

test("no tax value left -> deterministic assignment to the first member", () => {
  const [a] = optimize({ assessableIncome: 10_000, baseReliefs: 0 }, { assessableIncome: 8_000, baseReliefs: 0 }, [4_000]);
  assert.deepEqual(a.amounts, [4_000, 0]);
});

test("multiple pools allocate independently", () => {
  const allocs = optimize({ assessableIncome: 90_000, baseReliefs: 0 }, { assessableIncome: 30_000, baseReliefs: 0 }, [4_000, 4_000]);
  assert.deepEqual(allocs.map((a) => a.amounts), [[4_000, 0], [4_000, 0]]);
});

/* Household-level check: self $120k (11.5% marginal) vs spouse $40k (3.5%):
   the $4,000 QCR pool goes to self; combined tax $5,567.60. */
test("computeHouseholdTax applies the optimal QCR allocation", () => {
  const r = computeHouseholdTax({
    rules: YA2026,
    srsRules: SRS2025,
    self: {
      member: { age: 40, sex: "male", citizenship: "sc" },
      earnedIncome: 120_000,
      cpfEmployeeContributions: 17_760,
    },
    spouse: {
      member: { age: 38, sex: "female", citizenship: "sc" },
      earnedIncome: 40_000,
      cpfEmployeeContributions: 8_000,
    },
    sharedReliefPools: [{ label: "QCR child 1", amount: 4_000 }],
  });

  assert.deepEqual(r.allocations, [{ label: "QCR child 1", amounts: [4_000, 0] }]);
  // Self: reliefs $17,760 CPF + $1,000 EIR + $4,000 QCR = $22,760;
  // chargeable $97,240 -> $3,350 + 11.5% x $17,240.
  assert.equal(r.self.totalReliefs, 22_760);
  assert.equal(r.self.taxPayable, 3_350 + 0.115 * 17_240);
  // Spouse: reliefs $9,000; chargeable $31,000 -> $200 + 3.5% x $1,000.
  assert.equal(r.spouse.taxPayable, 235);
  assert.equal(r.combinedTax, r.self.taxPayable + r.spouse.taxPayable);
});
