/**
 * Golden tests for the relief library, pinned to the IRAS tax-relief pages
 * (amounts) and the worked examples on the QCR / WMCR pages.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeClaimedRelief,
  earnedIncomeRelief,
  wmcrRelief,
  type ReliefMemberContext,
} from "./reliefs.ts";
import { taxRules } from "./fixtures.ts";

const rules2025 = taxRules(2025);
const rules2026 = taxRules(2026);

const ctx = (over: Partial<ReliefMemberContext> = {}): ReliefMemberContext => ({
  member: { age: 40, sex: "male", citizenship: "sc" },
  earnedIncome: 100_000,
  cpfEmployeeContributions: 10_000,
  srsContributions: 0,
  srsCap: 15_300,
  cpfTopUps: { self: 0, family: 0 },
  ...over,
});

/* IRAS Earned Income Relief: $1,000 below 55 / $6,000 at 55-59 / $8,000 at
   60+; $4,000 / $10,000 / $12,000 for persons with disability. Capped at
   taxable earned income. */
test("earned income relief age bands", () => {
  const p = rules2026.reliefs.earned_income;
  assert.equal(earnedIncomeRelief(p, ctx({ member: { age: 54, sex: "male", citizenship: "sc" } })), 1_000);
  assert.equal(earnedIncomeRelief(p, ctx({ member: { age: 55, sex: "male", citizenship: "sc" } })), 6_000);
  assert.equal(earnedIncomeRelief(p, ctx({ member: { age: 60, sex: "male", citizenship: "sc" } })), 8_000);
  assert.equal(earnedIncomeRelief(p, ctx({ member: { age: 30, sex: "male", citizenship: "sc", disabled: true } })), 4_000);
  assert.equal(earnedIncomeRelief(p, ctx({ member: { age: 55, sex: "male", citizenship: "sc", disabled: true } })), 10_000);
  assert.equal(earnedIncomeRelief(p, ctx({ member: { age: 62, sex: "male", citizenship: "sc", disabled: true } })), 12_000);
});

test("earned income relief capped at taxable earned income", () => {
  // IRAS example: age 55 with $5,000 earned income -> $5,000 (not $6,000).
  const p = rules2026.reliefs.earned_income;
  assert.equal(
    earnedIncomeRelief(p, ctx({ member: { age: 55, sex: "male", citizenship: "sc" }, earnedIncome: 5_000 })),
    5_000,
  );
  assert.equal(earnedIncomeRelief(p, ctx({ earnedIncome: 0 })), 0);
});

/* IRAS QCR page: $4,000 per child / $7,500 disability; shareable between
   spouses; QCR + WMCR capped at $50,000 per child. */
test("qcr amounts and sharing", () => {
  assert.equal(
    computeClaimedRelief({ type: "qcr", children: 2 }, rules2026.reliefs, ctx()),
    8_000,
  );
  assert.equal(
    computeClaimedRelief({ type: "qcr", children: 1, share: 0.5 }, rules2026.reliefs, ctx()),
    2_000,
  );
  assert.equal(
    computeClaimedRelief({ type: "qcr", disabilityChildren: 1 }, rules2026.reliefs, ctx()),
    7_500,
  );
});

/* IRAS QCR page, Example 4: Mrs Lim earned $320,000 (2025); Mr Lim claims the
   full $4,000 QCR; WMCR for the first child = 15% x $320,000 = $48,000, capped
   at $50,000 - $4,000 = $46,000. */
test("wmcr legacy percentage with the $50k per-child cap (IRAS QCR example 4)", () => {
  const amount = wmcrRelief(
    rules2026.reliefs.wmcr,
    { type: "wmcr", children: [{ order: 1, born: "2015-05-01", qcrClaimed: 4_000 }] },
    ctx({ member: { age: 40, sex: "female", citizenship: "sc" }, earnedIncome: 320_000 }),
  );
  assert.equal(amount, 46_000);
});

/* IRAS WMCR page, Example 1: Mrs Heng earned $100,000; first child not
   eligible (income > $8k); second child -> 20% x $100,000 = $20,000. */
test("wmcr legacy percentage, second child (IRAS WMCR example 1)", () => {
  const amount = wmcrRelief(
    rules2026.reliefs.wmcr,
    { type: "wmcr", children: [{ order: 2, born: "2018-01-15" }] },
    ctx({ member: { age: 38, sex: "female", citizenship: "sc" }, earnedIncome: 100_000 }),
  );
  assert.equal(amount, 20_000);
});

/* IRAS WMCR page, Example 2: Mrs Teo earned $90,000; first child born 2021
   (legacy 15% = $13,500); second child born 2024 (fixed $10,000).
   Total $23,500. */
test("wmcr mixed legacy + fixed dollar (IRAS WMCR example 2)", () => {
  const amount = wmcrRelief(
    rules2026.reliefs.wmcr,
    {
      type: "wmcr",
      children: [
        { order: 1, born: "2021-06-01" },
        { order: 2, born: "2024-03-01" },
      ],
    },
    ctx({ member: { age: 35, sex: "female", citizenship: "sc" }, earnedIncome: 90_000 }),
  );
  assert.equal(amount, 23_500);
});

/* IRAS WMCR page, Example 3: Mrs Lim earned $250,000; husband claimed Child
   Relief (Disability) $7,500 on child 1 and QCR $4,000 on child 2.
   WMCR = $37,500 + min($50,000, $50,000 - $4,000) = $37,500 + $46,000 = $83,500. */
test("wmcr per-child cap with disability relief claimed (IRAS WMCR example 3)", () => {
  const amount = wmcrRelief(
    rules2026.reliefs.wmcr,
    {
      type: "wmcr",
      children: [
        { order: 1, born: "2009-04-01", qcrClaimed: 7_500 },
        { order: 2, born: "2010-11-01", qcrClaimed: 4_000 },
      ],
    },
    ctx({ member: { age: 45, sex: "female", citizenship: "sc" }, earnedIncome: 250_000 }),
  );
  assert.equal(amount, 83_500);
});

test("wmcr fixed dollar amounts for children born on or after 1 Jan 2024", () => {
  const amount = wmcrRelief(
    rules2026.reliefs.wmcr,
    {
      type: "wmcr",
      children: [
        { order: 1, born: "2024-01-01" },
        { order: 2, born: "2025-06-01" },
        { order: 3, born: "2026-02-01" },
        { order: 4, born: "2026-06-01" },
      ],
    },
    ctx({ member: { age: 35, sex: "female", citizenship: "sc" }, earnedIncome: 200_000 }),
  );
  assert.equal(amount, 8_000 + 10_000 + 12_000 + 12_000);
});

test("wmcr is mother-only and requires earned income", () => {
  const claim = { type: "wmcr" as const, children: [{ order: 1, born: "2024-01-01" }] };
  assert.equal(wmcrRelief(rules2026.reliefs.wmcr, claim, ctx()), 0); // male
  assert.equal(
    wmcrRelief(rules2026.reliefs.wmcr, claim, ctx({ member: { age: 35, sex: "female", citizenship: "sc" }, earnedIncome: 0 })),
    0,
  );
});

/* IRAS Parent Relief: $9,000 living together / $5,500 not; disability
   $14,000 / $10,000; up to 2 dependants. */
test("parent relief amounts and 2-dependant limit", () => {
  const amount = computeClaimedRelief(
    {
      type: "parent",
      dependants: [
        { livingTogether: true },
        { livingTogether: false, disability: true },
        { livingTogether: true }, // ignored: max 2
      ],
    },
    rules2026.reliefs,
    ctx(),
  );
  assert.equal(amount, 9_000 + 10_000);
});

test("spouse relief", () => {
  assert.equal(computeClaimedRelief({ type: "spouse" }, rules2026.reliefs, ctx()), 2_000);
  assert.equal(
    computeClaimedRelief({ type: "spouse", disability: true }, rules2026.reliefs, ctx()),
    5_500,
  );
});

/* IRAS NSman Relief: $1,500 / $3,000 (general), $3,500 / $5,000 (key
   appointment holders); wife and parent $750 each. */
test("nsman reliefs", () => {
  assert.equal(
    computeClaimedRelief({ type: "nsman_self", active: true }, rules2026.reliefs, ctx()),
    3_000,
  );
  assert.equal(
    computeClaimedRelief({ type: "nsman_self", active: false }, rules2026.reliefs, ctx()),
    1_500,
  );
  assert.equal(
    computeClaimedRelief({ type: "nsman_self", active: true, keyAppointment: true }, rules2026.reliefs, ctx()),
    5_000,
  );
  assert.equal(
    computeClaimedRelief({ type: "nsman_self", active: false, keyAppointment: true }, rules2026.reliefs, ctx()),
    3_500,
  );
  assert.equal(computeClaimedRelief({ type: "nsman_wife" }, rules2026.reliefs, ctx()), 750);
  assert.equal(computeClaimedRelief({ type: "nsman_parent" }, rules2026.reliefs, ctx()), 750);
});

test("grandparent caregiver and sibling (disability) reliefs", () => {
  assert.equal(
    computeClaimedRelief({ type: "grandparent_caregiver" }, rules2026.reliefs, ctx()),
    3_000,
  );
  assert.equal(
    computeClaimedRelief({ type: "sibling_disability", count: 2 }, rules2026.reliefs, ctx()),
    11_000,
  );
});

/* IRAS Course Fees Relief: up to $5,500; lapsed with effect from YA 2026. */
test("course fees relief: claimable in YA 2025, lapsed from YA 2026", () => {
  assert.equal(
    computeClaimedRelief({ type: "course_fees", amount: 7_000 }, rules2025.reliefs, ctx()),
    5_500,
  );
  assert.equal(
    computeClaimedRelief({ type: "course_fees", amount: 7_000 }, rules2026.reliefs, ctx()),
    0,
  );
});

/* IRAS Life Insurance Relief: only when total CPF contributions < $5,000;
   relief = min(premiums, $5,000 - CPF contributions, $5,000). */
test("life insurance relief", () => {
  assert.equal(
    computeClaimedRelief(
      { type: "life_insurance", premiums: 4_000 },
      rules2026.reliefs,
      ctx({ cpfEmployeeContributions: 3_000 }),
    ),
    2_000,
  );
  assert.equal(
    computeClaimedRelief(
      { type: "life_insurance", premiums: 4_000 },
      rules2026.reliefs,
      ctx({ cpfEmployeeContributions: 6_000 }),
    ),
    0,
  );
  // Premiums capped at 7% of the sum insured.
  assert.equal(
    computeClaimedRelief(
      { type: "life_insurance", premiums: 4_000, sumInsured: 40_000 },
      rules2026.reliefs,
      ctx({ cpfEmployeeContributions: 0 }),
    ),
    2_800,
  );
});
