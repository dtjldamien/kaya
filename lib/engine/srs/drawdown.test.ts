/**
 * Golden tests for the SRS drawdown optimizer. Rules per IRAS: 50% of
 * withdrawals taxable, 10-year (120-month) window from the first penalty-free
 * withdrawal, tax assessed per calendar year (YA) — so a mid-year start spans
 * 11 YAs.
 *
 * Brackets are the seeded YA 2026 resident table (lib/db/seed-data.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeSrsDrawdown } from "./drawdown.ts";
import { taxRules } from "../tax/fixtures.ts";

const brackets = taxRules(2026).brackets;

const base = {
  taxableShare: 0.5,
  brackets,
  windowMonths: 120,
};

test("IRAS mechanics: $400k drawn over 11 YAs from an April start is tax-free", () => {
  // IRAS: withdrawals from 1 Apr 2025 spread to 31 Mar 2035 (11 YAs); 50% of
  // each withdrawal taxable; first $20k of chargeable income at 0%.
  const s = optimizeSrsDrawdown({
    ...base,
    balance: 400_000,
    startYear: 2025,
    startMonth: 4,
  });
  assert.equal(s.years.length, 11);
  assert.deepEqual(
    s.years.map((y) => y.months),
    [9, 12, 12, 12, 12, 12, 12, 12, 12, 12, 3],
  );
  // Taxable per YA = 0.5 x $36,363.64 = $18,181.82 <= $20k -> 0% bracket.
  assert.equal(s.totalTax, 0);
  assert.ok(Math.abs(s.totalWithdrawn - 400_000) < 0.01);
  assert.ok(Math.abs(s.years[0].withdrawal - 400_000 / 11) < 0.01);
});

test("January start: 10 calendar years; $600k fills the 2% bracket", () => {
  const s = optimizeSrsDrawdown({
    ...base,
    balance: 600_000,
    startYear: 2026,
    startMonth: 1,
  });
  assert.equal(s.years.length, 10);
  // $60k/yr withdrawal -> $30k taxable -> tax $200/yr (2% on $20k-$30k).
  for (const y of s.years) {
    assert.ok(Math.abs(y.withdrawal - 60_000) < 0.01);
    assert.ok(Math.abs(y.tax - 200) < 0.01);
  }
  assert.ok(Math.abs(s.totalTax - 2_000) < 0.01);
  // Final year sits exactly at the $30k boundary -> next dollar at 3.5%.
  assert.equal(s.residualMarginalRate, 0.035);
});

test("net of other taxable income: a working year defers to later years", () => {
  const s = optimizeSrsDrawdown({
    ...base,
    balance: 400_000,
    startYear: 2026,
    startMonth: 1,
    otherTaxableIncomeByYear: { 2026: 50_000 },
  });
  // 2026 is at 7% already -> no withdrawal there; 2027-2035 share equally.
  assert.equal(s.years[0].withdrawal, 0);
  assert.equal(s.years[0].tax, 0);
  for (const y of s.years.slice(1)) {
    assert.ok(Math.abs(y.withdrawal - 400_000 / 9) < 0.01);
    // Taxable $22,222.22 -> 2% x ($22,222.22 - $20,000) = $44.44.
    assert.ok(Math.abs(y.tax - 44.44) < 0.01);
  }
  assert.ok(Math.abs(s.totalTax - 400) < 0.5);
});

test("large balance: level withdrawals at an equalized marginal rate", () => {
  const s = optimizeSrsDrawdown({
    ...base,
    balance: 2_000_000,
    startYear: 2026,
    startMonth: 1,
  });
  // $200k/yr -> $100k taxable -> tax $5,650/yr ($3,350 on first $80k + 11.5%
  // x $20k, per the IRAS gross column).
  for (const y of s.years) {
    assert.ok(Math.abs(y.withdrawal - 200_000) < 0.01);
    assert.ok(Math.abs(y.tax - 5_650) < 0.01);
  }
  assert.ok(Math.abs(s.totalTax - 56_500) < 0.01);
});
