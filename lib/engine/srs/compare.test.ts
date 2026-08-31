/**
 * Golden tests for the SRS-vs-cash comparison, with hand-computed future
 * values (start-of-year contribution streams, this YA's included).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { srsVsCash } from "./compare.ts";

test("zero rates: everything is linear", () => {
  const r = srsVsCash({
    annualContribution: 10_000,
    years: 5,
    srsReturn: 0,
    equityReturn: 0,
    annualSavings: 1_500,
    withdrawalTax: 3_000,
  });
  assert.equal(r.contributionsAtRetirement, 50_000);
  assert.equal(r.savingsAtRetirement, 7_500);
  assert.equal(r.cashTotal, 50_000);
  assert.equal(r.srsTotal, 50_000 - 3_000 + 7_500);
  assert.equal(r.advantage, 4_500);
});

test("identical growth, no withdrawal tax: SRS wins by exactly the reinvested savings", () => {
  const r = srsVsCash({
    annualContribution: 15_300,
    years: 10,
    srsReturn: 0.07,
    equityReturn: 0.07,
    annualSavings: 15_300 * 0.15,
    withdrawalTax: 0,
  });
  assert.equal(r.contributionsAtRetirement, r.cashTotal);
  assert.equal(r.advantage, r.savingsAtRetirement);
  assert.ok(r.advantage > 0);
});

test("idle SRS cash vs equities: the growth handicap can flip the verdict", () => {
  const r = srsVsCash({
    annualContribution: 15_300,
    years: 30,
    srsReturn: 0.0005,
    equityReturn: 0.07,
    annualSavings: 15_300 * 0.07,
    withdrawalTax: 20_000,
  });
  assert.ok(r.cashTotal > r.contributionsAtRetirement);
  assert.ok(r.advantage < 0);
});

test("withdrawal tax passes through to the SRS total", () => {
  const base = {
    annualContribution: 10_000,
    years: 10,
    srsReturn: 0.02,
    equityReturn: 0.07,
    annualSavings: 1_500,
  };
  const taxed = srsVsCash({ ...base, withdrawalTax: 5_000 });
  const untaxed = srsVsCash({ ...base, withdrawalTax: 0 });
  assert.ok(Math.abs(taxed.srsTotal - (untaxed.srsTotal - 5_000)) < 1e-6);
  assert.equal(taxed.cashTotal, untaxed.cashTotal);
});

test("no contribution: all zeros", () => {
  const r = srsVsCash({
    annualContribution: 0,
    years: 10,
    srsReturn: 0.02,
    equityReturn: 0.07,
    annualSavings: 0,
    withdrawalTax: 0,
  });
  assert.deepEqual(r, {
    srsTotal: 0,
    cashTotal: 0,
    advantage: 0,
    contributionsAtRetirement: 0,
    withdrawalTax: 0,
    savingsAtRetirement: 0,
  });
});
