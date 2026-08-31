/**
 * The relief library: one calculator per relief type, over the YA-versioned
 * params from relief_rules (see lib/engine/config.ts). Each returns the dollar
 * amount of relief for the YA; eligibility toggles (which dependants exist,
 * whether the spouse qualifies, etc.) are the caller's input — the engine
 * computes amounts, it does not verify eligibility evidence.
 */
import type { ReliefRulesByType } from "../config.ts";
import { roundCents } from "../money.ts";

/** Member facts that affect relief amounts. */
export type ReliefMemberContext = {
  member: {
    /** Age as of 31 Dec of the income year. */
    age: number;
    sex: "male" | "female";
    citizenship: "sc" | "pr" | "foreigner";
    disabled?: boolean;
  };
  /** Taxable earned income (employment, pension, trade/business). */
  earnedIncome: number;
  /** Annual employee CPF contributions (from the CPF engine). */
  cpfEmployeeContributions: number;
  srsContributions: number;
  srsCap: number;
  cpfTopUps: { self: number; family: number };
};

/** Toggle-based relief claims (mirror tax_relief_settings rows). */
export type ReliefClaim =
  | {
      type: "qcr";
      /** Number of qualifying children (default 1). */
      children?: number;
      disabilityChildren?: number;
      /** Fraction of the child relief allocated to this member (default 1). */
      share?: number;
      /** Direct dollar amount (set by the household optimizer). */
      amountOverride?: number;
    }
  | {
      type: "wmcr";
      children: {
        /** Child order in the family unit (1st, 2nd, 3rd+). */
        order: number;
        /** Date of birth/adoption (YYYY-MM-DD), drives fixed vs legacy %. */
        born: string;
        /** QCR/Child Relief (Disability) claimed on this child by either parent. */
        qcrClaimed?: number;
      }[];
    }
  | {
      type: "parent";
      dependants: { livingTogether: boolean; disability?: boolean }[];
    }
  | { type: "spouse"; disability?: boolean }
  | { type: "nsman_self"; active: boolean; keyAppointment?: boolean }
  | { type: "nsman_wife" }
  | { type: "nsman_parent" }
  | { type: "grandparent_caregiver" }
  | { type: "sibling_disability"; count?: number }
  | { type: "course_fees"; amount: number }
  | { type: "life_insurance"; premiums: number; sumInsured?: number };

/** Claim types handled by computeClaimedRelief (the rest are auto-computed). */
export type ClaimableReliefType = ReliefClaim["type"];

function amountBandLookup(
  bands: { maxAge: number | null; amount: number }[],
  age: number,
): number {
  // IRAS age bands are inclusive: "55 to 59" -> maxAge 59.
  const band = bands.find((b) => b.maxAge === null || age <= b.maxAge);
  if (!band) throw new Error(`No relief band found for age ${age}`);
  return band.amount;
}

/** Earned Income Relief: age-banded, capped at taxable earned income. */
export function earnedIncomeRelief(
  params: ReliefRulesByType["earned_income"],
  ctx: ReliefMemberContext,
): number {
  if (!params || ctx.earnedIncome <= 0) return 0;
  const bands = ctx.member.disabled ? params.disabilityBands : params.bands;
  return Math.min(amountBandLookup(bands, ctx.member.age), ctx.earnedIncome);
}

/** CPF Relief for employees: the actual employee contributions (ceiling-capped
 *  by the CPF engine already). */
export function cpfEmployeeRelief(
  params: ReliefRulesByType["cpf_employee"],
  ctx: ReliefMemberContext,
): number {
  if (!params) return 0;
  return ctx.cpfEmployeeContributions;
}

/** SRS Relief: actual contributions, capped at the year's SRS cap. */
export function srsRelief(
  params: ReliefRulesByType["srs"],
  ctx: ReliefMemberContext,
): number {
  if (!params) return 0;
  return Math.min(ctx.srsContributions, ctx.srsCap);
}

/** CPF Cash Top-up Relief: up to $8k self + $8k family (SA/RA/MA top-ups). */
export function cpfCashTopupRelief(
  params: ReliefRulesByType["cpf_cash_topup"],
  ctx: ReliefMemberContext,
): number {
  if (!params) return 0;
  return (
    Math.min(ctx.cpfTopUps.self, params.selfCap) +
    Math.min(ctx.cpfTopUps.family, params.familyCap)
  );
}

/** QCR / Child Relief (Disability): $4,000 / $7,500 per child, shareable. */
export function qcrRelief(
  params: ReliefRulesByType["qcr"],
  claim: Extract<ReliefClaim, { type: "qcr" }>,
): number {
  if (!params) return 0;
  if (claim.amountOverride != null) return claim.amountOverride;
  const children = claim.children ?? 0;
  const disabilityChildren = claim.disabilityChildren ?? 0;
  const share = claim.share ?? 1;
  return (
    (children * params.amountPerChild +
      disabilityChildren * params.disabilityAmountPerChild) *
    share
  );
}

/**
 * WMCR: mother only. Fixed dollar amounts ($8k/$10k/$12k by child order) for
 * children born/adopted on or after 1 Jan 2024; legacy % of the mother's
 * earned income otherwise. QCR + WMCR capped per child; total WMCR capped at
 * 100% of earned income.
 */
export function wmcrRelief(
  params: ReliefRulesByType["wmcr"],
  claim: Extract<ReliefClaim, { type: "wmcr" }>,
  ctx: ReliefMemberContext,
): number {
  if (!params || ctx.member.sex !== "female" || ctx.earnedIncome <= 0) return 0;
  let total = 0;
  for (const child of claim.children) {
    const idx =
      Math.min(child.order, params.fixedAmountsByChildOrder.length) - 1;
    let amount =
      child.born >= params.fixedAppliesToBornOnOrAfter
        ? params.fixedAmountsByChildOrder[idx]
        : params.legacyPercentOfEarnedIncome[idx] * ctx.earnedIncome;
    amount = Math.max(
      0,
      Math.min(amount, params.perChildCapWithQcr - (child.qcrClaimed ?? 0)),
    );
    total += amount;
  }
  return roundCents(
    Math.min(total, params.totalCapPctOfEarnedIncome * ctx.earnedIncome),
  );
}

/** Parent Relief / Parent Relief (Disability): per dependant, max 2. */
export function parentRelief(
  params: ReliefRulesByType["parent"],
  claim: Extract<ReliefClaim, { type: "parent" }>,
): number {
  if (!params) return 0;
  return claim.dependants
    .slice(0, params.maxDependants)
    .reduce(
      (sum, d) =>
        sum +
        (d.disability
          ? d.livingTogether
            ? params.disabilityLivingTogether
            : params.disabilitySeparate
          : d.livingTogether
            ? params.livingTogether
            : params.separate),
      0,
    );
}

export function spouseRelief(
  params: ReliefRulesByType["spouse"],
  claim: Extract<ReliefClaim, { type: "spouse" }>,
): number {
  if (!params) return 0;
  return claim.disability ? params.disabilityAmount : params.amount;
}

export function nsmanSelfRelief(
  params: ReliefRulesByType["nsman_self"],
  claim: Extract<ReliefClaim, { type: "nsman_self" }>,
): number {
  if (!params) return 0;
  return claim.active
    ? claim.keyAppointment
      ? params.keyAppointmentActive
      : params.active
    : claim.keyAppointment
      ? params.keyAppointmentInactive
      : params.inactive;
}

/** Course Fees Relief: up to $5,500; lapsed from YA 2026 (rule absent). */
export function courseFeesRelief(
  params: ReliefRulesByType["course_fees"],
  claim: Extract<ReliefClaim, { type: "course_fees" }>,
): number {
  if (!params) return 0;
  return Math.min(claim.amount, params.maxAmount);
}

/**
 * Life Insurance Relief: claimable only when total CPF contributions are below
 * $5,000; relief is the lowest of premiums (capped at 7% of the sum insured
 * when provided), the shortfall to $5,000 of CPF contributions, and $5,000.
 */
export function lifeInsuranceRelief(
  params: ReliefRulesByType["life_insurance"],
  claim: Extract<ReliefClaim, { type: "life_insurance" }>,
  ctx: ReliefMemberContext,
): number {
  if (!params) return 0;
  const shortfall =
    params.cpfContributionThreshold - ctx.cpfEmployeeContributions;
  if (shortfall <= 0) return 0;
  const premiums =
    claim.sumInsured != null
      ? Math.min(claim.premiums, 0.07 * claim.sumInsured)
      : claim.premiums;
  return roundCents(Math.max(0, Math.min(premiums, shortfall, params.maxAmount)));
}

/** Dispatch a toggle-based claim to its calculator. */
export function computeClaimedRelief(
  claim: ReliefClaim,
  rules: ReliefRulesByType,
  ctx: ReliefMemberContext,
): number {
  switch (claim.type) {
    case "qcr":
      return qcrRelief(rules.qcr, claim);
    case "wmcr":
      return wmcrRelief(rules.wmcr, claim, ctx);
    case "parent":
      return parentRelief(rules.parent, claim);
    case "spouse":
      return spouseRelief(rules.spouse, claim);
    case "nsman_self":
      return nsmanSelfRelief(rules.nsman_self, claim);
    case "nsman_wife":
      return rules.nsman_wife?.amount ?? 0;
    case "nsman_parent":
      return rules.nsman_parent?.amount ?? 0;
    case "grandparent_caregiver":
      return rules.grandparent_caregiver?.amount ?? 0;
    case "sibling_disability":
      return (rules.sibling_disability?.amount ?? 0) * (claim.count ?? 1);
    case "course_fees":
      return courseFeesRelief(rules.course_fees, claim);
    case "life_insurance":
      return lifeInsuranceRelief(rules.life_insurance, claim, ctx);
  }
}
