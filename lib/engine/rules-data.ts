/**
 * The SG statutory rule tables as static data, with figures verified against
 * iras.gov.sg (see `source` on each row). Budget announcements = new rows
 * here, not code changes.
 *
 * The engine golden tests (lib/engine/**) import these rows to pin the config
 * against official IRAS worked examples.
 */
import {
  reliefParamsSchemas,
  type ReliefParams,
  type ReliefRulesByType,
  type ReliefType,
  type SrsYearRules,
  type TaxBracketRow,
  type TaxYearRules,
} from "./config.ts";

export type TaxRuleSetRow = {
  ya: number;
  reliefCap: number;
  rebateRate: number | null;
  rebateCap: number | null;
  source: string;
};
export type TaxBracketRuleRow = {
  ya: number;
  sortOrder: number;
  upTo: number | null;
  rate: number;
};
export type ReliefRuleRow = {
  ya: number;
  reliefType: ReliefType;
  name: string;
  params: ReliefParams;
  source: string;
};
export type SrsRuleSetRow = SrsYearRules & { source: string };

/* ------------------------------- Tax ------------------------------- */
// Source: IRAS individual income tax rates (resident brackets from YA 2024).

const TAX_RATES_SRC =
  "iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/individual-income-tax-rates";

export const taxRows: TaxRuleSetRow[] = [
  {
    ya: 2025,
    reliefCap: 80_000,
    rebateRate: 0.6, // YA 2025 one-off rebate: 60% of tax payable, capped at $200
    rebateCap: 200,
    source: TAX_RATES_SRC,
  },
  {
    ya: 2026,
    reliefCap: 80_000,
    rebateRate: null, // no rebate announced for YA 2026
    rebateCap: null,
    source: TAX_RATES_SRC,
  },
];

/** Resident brackets from YA 2024 onwards (unchanged through YA 2026). */
const bracketTable: { upTo: number | null; rate: number }[] = [
  { upTo: 20_000, rate: 0 },
  { upTo: 30_000, rate: 0.02 },
  { upTo: 40_000, rate: 0.035 },
  { upTo: 80_000, rate: 0.07 },
  { upTo: 120_000, rate: 0.115 },
  { upTo: 160_000, rate: 0.15 },
  { upTo: 200_000, rate: 0.18 },
  { upTo: 240_000, rate: 0.19 },
  { upTo: 280_000, rate: 0.195 },
  { upTo: 320_000, rate: 0.2 },
  { upTo: 500_000, rate: 0.22 },
  { upTo: 1_000_000, rate: 0.23 },
  { upTo: null, rate: 0.24 },
];

export const bracketRows: TaxBracketRuleRow[] = [
  2025, 2026,
].flatMap((ya) =>
  bracketTable.map((b, i) => ({
    ya,
    sortOrder: i + 1,
    upTo: b.upTo,
    rate: b.rate,
  })),
);

/* ----------------------------- Reliefs ----------------------------- */
// Source: IRAS tax reliefs pages (per-relief URL on each row).

const RELIEF_SRC_BASE =
  "iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions";

function relief(
  ya: number,
  reliefType: ReliefType,
  name: string,
  params: unknown,
  source: string,
): ReliefRuleRow {
  return {
    ya,
    reliefType,
    name,
    params: reliefParamsSchemas[reliefType].parse(params),
    source: `${RELIEF_SRC_BASE}/${source}`,
  };
}

function reliefsForYa(ya: number): ReliefRuleRow[] {
  const rows = [
    relief(ya, "earned_income", "Earned Income Relief", {
      bands: [
        { maxAge: 54, amount: 1_000 },
        { maxAge: 59, amount: 6_000 },
        { maxAge: null, amount: 8_000 },
      ],
      disabilityBands: [
        { maxAge: 54, amount: 4_000 },
        { maxAge: 59, amount: 10_000 },
        { maxAge: null, amount: 12_000 },
      ],
      note: "Age as of 31 Dec of the income year; capped at taxable earned income.",
    }, "tax-reliefs/earned-income-relief"),
    relief(ya, "spouse", "Spouse Relief / Spouse Relief (Disability)", {
      amount: 2_000,
      disabilityAmount: 5_500,
      incomeThreshold: 8_000,
      note: "Income threshold raised from $4,000 to $8,000 from YA 2025.",
    }, "tax-reliefs/spouse-relief-spouse-relief-(disability)"),
    relief(ya, "parent", "Parent Relief / Parent Relief (Disability)", {
      livingTogether: 9_000,
      separate: 5_500,
      disabilityLivingTogether: 14_000,
      disabilitySeparate: 10_000,
      maxDependants: 2,
      incomeThreshold: 8_000,
      minAge: 55,
      note: "Income threshold raised from $4,000 to $8,000 from YA 2025; shareable between claimants.",
    }, "tax-reliefs/parent-relief-parent-relief-(disability)"),
    relief(ya, "qcr", "Qualifying Child Relief / Child Relief (Disability)", {
      amountPerChild: 4_000,
      disabilityAmountPerChild: 7_500,
      shareable: true,
      childIncomeThreshold: 8_000,
      perChildCapWithWmcr: 50_000,
      note: "Shareable between spouses; QCR is allowed before WMCR.",
    }, "tax-reliefs/qualifying-child-relief-(qcr)-child-relief-(disability)"),
    relief(ya, "wmcr", "Working Mother's Child Relief", {
      fixedAmountsByChildOrder: [8_000, 10_000, 12_000],
      fixedAppliesToBornOnOrAfter: "2024-01-01",
      legacyPercentOfEarnedIncome: [0.15, 0.2, 0.25],
      totalCapPctOfEarnedIncome: 1,
      perChildCapWithQcr: 50_000,
      note: "Fixed dollar amounts from YA 2025 for children born/adopted on or after 1 Jan 2024; legacy % of earned income otherwise. Mother only.",
    }, "tax-reliefs/working-mother's-child-relief-(wmcr)"),
    relief(ya, "nsman_self", "NSman Self Relief", {
      inactive: 1_500,
      active: 3_000,
      keyAppointmentInactive: 3_500,
      keyAppointmentActive: 5_000,
    }, "tax-reliefs/nsman-relief-(self-wife-and-parent)"),
    relief(ya, "nsman_wife", "NSman Wife Relief", { amount: 750 }, "tax-reliefs/nsman-relief-(self-wife-and-parent)"),
    relief(ya, "nsman_parent", "NSman Parent Relief", {
      amount: 750,
      note: "Per parent, regardless of number of NSman children.",
    }, "tax-reliefs/nsman-relief-(self-wife-and-parent)"),
    relief(ya, "grandparent_caregiver", "Grandparent Caregiver Relief", {
      amount: 3_000,
    }, "tax-reliefs/grandparent-caregiver-relief"),
    relief(ya, "sibling_disability", "Sibling Relief (Disability)", {
      amount: 5_500,
    }, "tax-reliefs/sibling-relief-(disability)"),
    relief(ya, "life_insurance", "Life Insurance Relief", {
      maxAmount: 5_000,
      cpfContributionThreshold: 5_000,
      note: "Claimable only if total CPF contributions were below $5,000 in the income year.",
    }, "tax-reliefs/life-insurance-relief"),
    relief(ya, "cpf_employee", "CPF Relief for Employees", {
      note: "Auto-computed: employee CPF contributions on wages up to the OW/AW ceilings.",
    }, "tax-reliefs/central-provident-fund(cpf)-relief-for-employees"),
    relief(ya, "cpf_cash_topup", "CPF Cash Top-up Relief", {
      selfCap: 8_000,
      familyCap: 8_000,
      note: "Cash top-ups to own or family SA/RA/MA; only top-ups up to FRS/BHS limits attract relief.",
    }, "tax-reliefs/central-provident-fund-(cpf)-cash-top-up-relief"),
    relief(ya, "srs", "SRS Relief", {
      note: "Actual SRS contributions for the year, up to the cap in srs_rule_sets.",
    }, "tax-reliefs/supplementary-retirement-scheme-(srs)-relief"),
    relief(ya, "donations", "Donations Deduction", {
      deductionRate: 2.5,
      subjectToReliefCap: false,
      note: "250% deduction against statutory income (before reliefs) for donations to approved IPCs.",
    }, "donations"),
  ];

  // Course Fees Relief lapsed with effect from YA 2026 (final claim: YA 2025).
  if (ya <= 2025) {
    rows.push(
      relief(ya, "course_fees", "Course Fees Relief", {
        maxAmount: 5_500,
        lapsedFromYa: 2026,
      }, "tax-reliefs/course-fees-relief"),
    );
  }

  return rows;
}

export const reliefRows = [2025, 2026].flatMap(reliefsForYa);

/* ------------------------------- SRS ------------------------------- */
// Source: IRAS SRS pages.

const SRS_SRC =
  "iras.gov.sg/schemes/individual-income-tax/srs-contributions-and-tax-relief; iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/special-tax-schemes/tax-on-srs-withdrawals";

export const srsRows: SrsRuleSetRow[] = [
  2025, 2026, 2027,
].map((year) => ({
  year,
  capScPr: 15_300,
  capForeigner: 35_700,
  // Statutory retirement age prevailing since 1 Jul 2022; locked in at first contribution.
  statutoryRetirementAge: 63,
  withdrawalWindowYears: 10,
  taxableShare: 0.5,
  earlyWithdrawalPenaltyRate: 0.05,
  source: SRS_SRC,
}));

/* --------------------------- Accessors ---------------------------- */

/** The latest (newest year) SRS rule set. */
export function latestSrsRules(): SrsYearRules {
  return srsRows[srsRows.length - 1];
}

/** The latest seeded tax brackets (resident, by newest YA). */
export function latestTaxBrackets(): TaxBracketRow[] {
  const ya = Math.max(...taxRows.map((r) => r.ya));
  return bracketRows
    .filter((b) => b.ya === ya)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((b) => ({ upTo: b.upTo, rate: b.rate }));
}

/**
 * Tax rules for a YA, falling back to the latest seeded YA <= it (future
 * structures are unchanged until a Budget announcement adds rows). Returns
 * the rules plus the YA they actually belong to.
 */
export function taxRulesForYa(ya: number): { rules: TaxYearRules; rulesYa: number } {
  const sorted = [...taxRows].sort((a, b) => a.ya - b.ya);
  const set = [...sorted].reverse().find((s) => s.ya <= ya) ?? sorted[0];
  const reliefs: ReliefRulesByType = {};
  for (const r of reliefRows.filter((r) => r.ya === set.ya)) {
    reliefs[r.reliefType] = r.params as never;
  }
  return {
    rules: {
      ya: set.ya,
      reliefCap: set.reliefCap,
      rebateRate: set.rebateRate,
      rebateCap: set.rebateCap,
      brackets: bracketRows
        .filter((b) => b.ya === set.ya)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((b) => ({ upTo: b.upTo, rate: b.rate })),
      reliefs,
    },
    rulesYa: set.ya,
  };
}
