/**
 * Shared contract for the versioned statutory config tables
 * (tax_rule_sets / tax_brackets / relief_rules / srs_rule_sets).
 *
 * The engine treats these as data: Budget announcements = new seed rows,
 * never code changes. Zod schemas validate JSONB payloads at seed time and
 * give the engine concrete types at read time.
 *
 * Conventions: money in whole SGD; rates/ratios as fractions (0.2 = 20%).
 */
import { z } from "zod";

/* ------------------------------- Tax ------------------------------- */

export const reliefTypes = [
  "earned_income",
  "spouse",
  "parent",
  "qcr",
  "wmcr",
  "nsman_self",
  "nsman_wife",
  "nsman_parent",
  "grandparent_caregiver",
  "sibling_disability",
  "course_fees",
  "life_insurance",
  "cpf_employee",
  "cpf_cash_topup",
  "srs",
  "donations",
] as const;
export type ReliefType = (typeof reliefTypes)[number];

const note = { note: z.string().optional() } as const;

const amountBand = z.object({
  maxAge: z.number().int().positive().nullable(),
  amount: z.number().int().nonnegative(),
});

/** Per-relief-type params schemas — the shape of relief_rules.params. */
export const reliefParamsSchemas = {
  earned_income: z.object({
    /** Age as of 31 Dec of the income year. */
    bands: z.array(amountBand).min(1),
    disabilityBands: z.array(amountBand).min(1),
    ...note,
  }),
  spouse: z.object({
    amount: z.number().int().positive(),
    disabilityAmount: z.number().int().positive(),
    /** Dependant annual income must not exceed this. */
    incomeThreshold: z.number().int().nonnegative(),
    ...note,
  }),
  parent: z.object({
    livingTogether: z.number().int().positive(),
    separate: z.number().int().positive(),
    disabilityLivingTogether: z.number().int().positive(),
    disabilitySeparate: z.number().int().positive(),
    maxDependants: z.number().int().positive(),
    incomeThreshold: z.number().int().nonnegative(),
    /** Dependant minimum age (waived for disability claims). */
    minAge: z.number().int().positive(),
    ...note,
  }),
  qcr: z.object({
    amountPerChild: z.number().int().positive(),
    disabilityAmountPerChild: z.number().int().positive(),
    /** Shareable between spouses by agreed apportionment. */
    shareable: z.literal(true),
    childIncomeThreshold: z.number().int().nonnegative(),
    /** Combined QCR/Child Relief (Disability) + WMCR cap per child. */
    perChildCapWithWmcr: z.number().int().positive(),
    ...note,
  }),
  wmcr: z.object({
    /** Fixed dollar amounts by child order [1st, 2nd, 3rd+], cumulative. */
    fixedAmountsByChildOrder: z.array(z.number().int().positive()).min(1),
    /** Fixed amounts apply to children born/adopted on or after this date (YYYY-MM-DD). */
    fixedAppliesToBornOnOrAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Legacy percentages of mother's earned income by child order. */
    legacyPercentOfEarnedIncome: z.array(z.number().min(0).max(1)).min(1),
    /** Total WMCR across all children, as a fraction of earned income. */
    totalCapPctOfEarnedIncome: z.number().min(0).max(1),
    perChildCapWithQcr: z.number().int().positive(),
    ...note,
  }),
  nsman_self: z.object({
    inactive: z.number().int().positive(),
    active: z.number().int().positive(),
    keyAppointmentInactive: z.number().int().positive(),
    keyAppointmentActive: z.number().int().positive(),
    ...note,
  }),
  nsman_wife: z.object({ amount: z.number().int().positive(), ...note }),
  nsman_parent: z.object({ amount: z.number().int().positive(), ...note }),
  grandparent_caregiver: z.object({ amount: z.number().int().positive(), ...note }),
  sibling_disability: z.object({ amount: z.number().int().positive(), ...note }),
  course_fees: z.object({
    maxAmount: z.number().int().positive(),
    /** First YA the relief is no longer claimable, if lapsed. */
    lapsedFromYa: z.number().int().optional(),
    ...note,
  }),
  life_insurance: z.object({
    maxAmount: z.number().int().positive(),
    /** Claimable only when total CPF contributions are below this. */
    cpfContributionThreshold: z.number().int().positive(),
    ...note,
  }),
  /** Auto-computed from CPF contribution ceilings; no params. */
  cpf_employee: z.object({ ...note }),
  cpf_cash_topup: z.object({
    /** Max relief for top-ups to own SA/RA/MA. */
    selfCap: z.number().int().positive(),
    /** Max relief for top-ups to qualifying family members' SA/RA/MA. */
    familyCap: z.number().int().positive(),
    ...note,
  }),
  /** Auto-computed from actual SRS contributions (cap lives in srs_rule_sets). */
  srs: z.object({ ...note }),
  donations: z.object({
    /** Deduction multiple on qualifying donations (2.5 = 250%). */
    deductionRate: z.number().positive(),
    /** Donations are a deduction against statutory income, outside the $80k relief cap. */
    subjectToReliefCap: z.literal(false),
    ...note,
  }),
} satisfies Record<ReliefType, z.ZodType>;

export type ReliefParams = z.infer<(typeof reliefParamsSchemas)[ReliefType]>;

/** Params of one relief, keyed by relief type. */
export type ReliefParamsByType = {
  [K in ReliefType]: z.infer<(typeof reliefParamsSchemas)[K]>;
};

/** The reliefs available in one YA, keyed by relief type (absent = lapsed). */
export type ReliefRulesByType = Partial<ReliefParamsByType>;

/** One resident tax bracket row; upTo null = unbounded top bracket. */
export type TaxBracketRow = {
  upTo: number | null;
  rate: number;
};

/** The tax rules for one YA as the engine consumes them. */
export type TaxYearRules = {
  ya: number;
  reliefCap: number;
  rebateRate: number | null;
  rebateCap: number | null;
  /** Sorted ascending by upTo; last row has upTo null. */
  brackets: TaxBracketRow[];
  reliefs: ReliefRulesByType;
};

/** The SRS rules for one year as the engine consumes them. */
export type SrsYearRules = {
  year: number;
  capScPr: number;
  capForeigner: number;
  statutoryRetirementAge: number;
  withdrawalWindowYears: number;
  taxableShare: number;
  earlyWithdrawalPenaltyRate: number;
};
