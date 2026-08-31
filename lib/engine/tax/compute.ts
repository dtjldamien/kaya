/**
 * Per-member and household income tax computation.
 *
 * Flow per IRAS: statutory income − donations deduction (250%, outside the
 * relief cap) = assessable income − personal reliefs (capped at $80,000 per
 * YA) = chargeable income → resident brackets → less any one-off YA rebate.
 */
import type { SrsYearRules, TaxYearRules } from "../config.ts";
import { roundCents } from "../money.ts";
import { bracketTax, bracketTaxBreakdown, type BracketTaxLine, rateAt } from "./brackets.ts";
import {
  optimizeSharedReliefs,
  type SharedReliefPool,
} from "./optimizer.ts";
import {
  computeClaimedRelief,
  cpfCashTopupRelief,
  cpfEmployeeRelief,
  earnedIncomeRelief,
  srsRelief,
  type ReliefClaim,
  type ReliefMemberContext,
} from "./reliefs.ts";

export type MemberTaxInput = {
  rules: TaxYearRules;
  srsRules: SrsYearRules;
  member: {
    /** Age as of 31 Dec of the income year. */
    age: number;
    sex: "male" | "female";
    citizenship: "sc" | "pr" | "foreigner";
    disabled?: boolean;
  };
  /** Taxable earned income (employment, pension, trade/business). */
  earnedIncome: number;
  /** Other statutory income (e.g. rental). */
  otherIncome?: number;
  /** Qualifying donations in the income year (250% deduction). */
  donations?: number;
  /** Annual employee CPF contributions (from the CPF engine). */
  cpfEmployeeContributions?: number;
  srsContributions?: number;
  cpfTopUps?: { self?: number; family?: number };
  claims?: ReliefClaim[];
};

export type MemberTaxResult = {
  statutoryIncome: number;
  donationsDeduction: number;
  assessableIncome: number;
  /** Per-relief breakdown (amounts before the $80k cap). */
  reliefs: { type: string; amount: number }[];
  totalReliefsBeforeCap: number;
  /** After the $80,000 relief cap. */
  totalReliefs: number;
  chargeableIncome: number;
  /** Per-bracket contribution to taxBeforeRebate. */
  bracketBreakdown: BracketTaxLine[];
  taxBeforeRebate: number;
  rebate: number;
  taxPayable: number;
};

export function computeMemberTax(input: MemberTaxInput): MemberTaxResult {
  const { rules, srsRules, member } = input;
  const earnedIncome = input.earnedIncome;
  const statutoryIncome = earnedIncome + (input.otherIncome ?? 0);

  // Donations: 250% deduction against statutory income; not a relief, and not
  // subject to the $80k relief cap.
  const donationsParams = rules.reliefs.donations;
  const donationsDeduction = donationsParams
    ? roundCents((input.donations ?? 0) * donationsParams.deductionRate)
    : 0;
  const assessableIncome = Math.max(0, statutoryIncome - donationsDeduction);

  const ctx: ReliefMemberContext = {
    member,
    earnedIncome,
    cpfEmployeeContributions: input.cpfEmployeeContributions ?? 0,
    srsContributions: input.srsContributions ?? 0,
    srsCap:
      member.citizenship === "foreigner"
        ? srsRules.capForeigner
        : srsRules.capScPr,
    cpfTopUps: {
      self: input.cpfTopUps?.self ?? 0,
      family: input.cpfTopUps?.family ?? 0,
    },
  };

  const reliefs: { type: string; amount: number }[] = [];
  const add = (type: string, amount: number) => {
    if (amount > 0) reliefs.push({ type, amount: roundCents(amount) });
  };

  // Automatic reliefs.
  add("earned_income", earnedIncomeRelief(rules.reliefs.earned_income, ctx));
  add("cpf_employee", cpfEmployeeRelief(rules.reliefs.cpf_employee, ctx));
  add("srs", srsRelief(rules.reliefs.srs, ctx));
  add("cpf_cash_topup", cpfCashTopupRelief(rules.reliefs.cpf_cash_topup, ctx));

  // Toggle-based claims (skipped when the relief does not exist for the YA).
  for (const claim of input.claims ?? []) {
    add(claim.type, computeClaimedRelief(claim, rules.reliefs, ctx));
  }

  const totalReliefsBeforeCap = reliefs.reduce((s, r) => s + r.amount, 0);
  const totalReliefs = Math.min(rules.reliefCap, totalReliefsBeforeCap);
  const chargeableIncome = Math.max(0, assessableIncome - totalReliefs);
  const taxBeforeRebate = bracketTax(chargeableIncome, rules.brackets);
  const rebate =
    rules.rebateRate != null
      ? roundCents(
          Math.min(rules.rebateCap ?? Infinity, rules.rebateRate * taxBeforeRebate),
        )
      : 0;

  return {
    statutoryIncome: roundCents(statutoryIncome),
    donationsDeduction,
    assessableIncome: roundCents(assessableIncome),
    reliefs,
    totalReliefsBeforeCap: roundCents(totalReliefsBeforeCap),
    totalReliefs: roundCents(totalReliefs),
    chargeableIncome: roundCents(chargeableIncome),
    bracketBreakdown: bracketTaxBreakdown(chargeableIncome, rules.brackets),
    taxBeforeRebate,
    rebate,
    taxPayable: roundCents(Math.max(0, taxBeforeRebate - rebate)),
  };
}

/**
 * Marginal tax saving per extra $1 of relief (SRS / top-up what-if): the
 * member's marginal bracket rate, or 0 once the relief cap / zero chargeable
 * income is reached.
 */
export function marginalReliefRate(input: {
  assessableIncome: number;
  totalReliefs: number;
  rules: TaxYearRules;
}): number {
  const { rules } = input;
  if (input.totalReliefs >= rules.reliefCap) return 0;
  const chargeable = Math.max(0, input.assessableIncome - input.totalReliefs);
  return rateAt(chargeable, rules.brackets);
}

export type HouseholdTaxInput = {
  rules: TaxYearRules;
  srsRules: SrsYearRules;
  self: Omit<MemberTaxInput, "rules" | "srsRules">;
  spouse: Omit<MemberTaxInput, "rules" | "srsRules">;
  /**
   * Spouse-shareable relief pools (e.g. one $4,000 pool per QCR child, $7,500
   * per Child Relief (Disability) child). Do not also pass qcr claims in the
   * members' claims — the optimizer's allocation is applied as qcr overrides.
   */
  sharedReliefPools: SharedReliefPool[];
};

export type HouseholdTaxResult = {
  self: MemberTaxResult;
  spouse: MemberTaxResult;
  allocations: { label: string; amounts: [number, number] }[];
  combinedTax: number;
};

/** Household computation with the shareable-relief optimizer (QCR etc.). */
export function computeHouseholdTax(input: HouseholdTaxInput): HouseholdTaxResult {
  const { rules, srsRules, sharedReliefPools } = input;

  // Base situations: everything except the shared pools.
  const baseClaims = (claims?: ReliefClaim[]) =>
    (claims ?? []).filter((c) => c.type !== "qcr");
  const baseSelf = computeMemberTax({
    ...input.self,
    claims: baseClaims(input.self.claims),
    rules,
    srsRules,
  });
  const baseSpouse = computeMemberTax({
    ...input.spouse,
    claims: baseClaims(input.spouse.claims),
    rules,
    srsRules,
  });

  const allocations = optimizeSharedReliefs({
    members: [
      {
        assessableIncome: baseSelf.assessableIncome,
        baseReliefs: baseSelf.totalReliefsBeforeCap,
      },
      {
        assessableIncome: baseSpouse.assessableIncome,
        baseReliefs: baseSpouse.totalReliefsBeforeCap,
      },
    ],
    pools: sharedReliefPools,
    brackets: rules.brackets,
    reliefCap: rules.reliefCap,
  });

  const allocated = (i: 0 | 1) =>
    allocations.reduce((s, a) => s + a.amounts[i], 0);
  const withShared = (claims: ReliefClaim[] | undefined, i: 0 | 1) => {
    const total = allocated(i);
    const base = baseClaims(claims);
    return total > 0
      ? [...base, { type: "qcr", amountOverride: total } as ReliefClaim]
      : base;
  };

  const self = computeMemberTax({
    ...input.self,
    claims: withShared(input.self.claims, 0),
    rules,
    srsRules,
  });
  const spouse = computeMemberTax({
    ...input.spouse,
    claims: withShared(input.spouse.claims, 1),
    rules,
    srsRules,
  });

  return {
    self,
    spouse,
    allocations,
    combinedTax: roundCents(self.taxPayable + spouse.taxPayable),
  };
}
