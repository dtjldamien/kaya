/**
 * Golden tests for the resident bracket computation, pinned to the IRAS
 * "Income Tax Rates" table (YA 2024 onwards) Gross Tax Payable column.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bracketTax,
  distanceToBracketCeiling,
  distanceToBracketFloor,
  rateAbove,
  rateAt,
} from "./brackets.ts";
import { taxRules } from "./fixtures.ts";

const brackets = taxRules(2026).brackets;

/* IRAS resident rates table, "Gross Tax Payable" column. */
test("bracket tax matches the IRAS gross-tax-payable column", () => {
  const cases: [number, number][] = [
    [20_000, 0],
    [30_000, 200],
    [40_000, 550],
    [80_000, 3_350],
    [120_000, 7_950],
    [160_000, 13_950],
    [200_000, 21_150],
    [240_000, 28_750],
    [280_000, 36_550],
    [320_000, 44_550],
    [500_000, 84_150],
    [1_000_000, 199_150],
  ];
  for (const [chargeable, expected] of cases) {
    assert.equal(bracketTax(chargeable, brackets), expected, `chargeable ${chargeable}`);
  }
});

test("top bracket: 24% above $1m", () => {
  assert.equal(bracketTax(1_200_000, brackets), 199_150 + 0.24 * 200_000);
});

test("zero and negative chargeable income -> no tax", () => {
  assert.equal(bracketTax(0, brackets), 0);
  assert.equal(bracketTax(-5_000, brackets), 0);
});

test("marginal rate: boundary amounts belong to the lower bracket", () => {
  assert.equal(rateAt(80_000, brackets), 0.07);
  assert.equal(rateAt(80_000.01, brackets), 0.115);
  assert.equal(rateAt(20_000, brackets), 0);
  assert.equal(rateAt(20_001, brackets), 0.02);
  assert.equal(rateAt(0, brackets), 0);
  assert.equal(rateAt(2_000_000, brackets), 0.24);
});

test("distance to bracket floor", () => {
  assert.equal(distanceToBracketFloor(82_000, brackets), 2_000);
  assert.equal(distanceToBracketFloor(80_000, brackets), 40_000);
  assert.equal(distanceToBracketFloor(15_000, brackets), 15_000);
});

test("rate above (next dollar): boundary amounts take the higher bracket", () => {
  assert.equal(rateAbove(0, brackets), 0);
  assert.equal(rateAbove(20_000, brackets), 0.02);
  assert.equal(rateAbove(80_000, brackets), 0.115);
  assert.equal(rateAbove(1_000_000, brackets), 0.24);
  assert.equal(rateAbove(5_000_000, brackets), 0.24);
});

test("distance to bracket ceiling", () => {
  assert.equal(distanceToBracketCeiling(0, brackets), 20_000);
  assert.equal(distanceToBracketCeiling(20_000, brackets), 10_000);
  assert.equal(distanceToBracketCeiling(25_000, brackets), 5_000);
  assert.equal(distanceToBracketCeiling(1_000_000, brackets), Infinity);
});
