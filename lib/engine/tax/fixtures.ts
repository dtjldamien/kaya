/**
 * Test fixtures: build the engine's TaxYearRules / SrsYearRules from the
 * actual seeded rows (lib/engine/rules-data.ts), so the golden tests pin both the
 * engine and the seed data to the official IRAS figures.
 */
import {
  bracketRows,
  reliefRows,
  srsRows,
  taxRows,
} from "../rules-data.ts";
import type {
  ReliefRulesByType,
  SrsYearRules,
  TaxYearRules,
} from "../config.ts";

export function taxRules(ya: number): TaxYearRules {
  const set = taxRows.find((r) => r.ya === ya);
  if (!set || set.ya == null) throw new Error(`No seeded tax rule set for YA ${ya}`);
  const brackets = bracketRows
    .filter((r) => r.ya === ya)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((r) => ({ upTo: r.upTo ?? null, rate: r.rate ?? 0 }));
  const reliefs: ReliefRulesByType = {};
  for (const r of reliefRows.filter((r) => r.ya === ya)) {
    if (r.reliefType && r.params) reliefs[r.reliefType] = r.params as never;
  }
  return {
    ya,
    reliefCap: set.reliefCap ?? 80_000,
    rebateRate: set.rebateRate ?? null,
    rebateCap: set.rebateCap ?? null,
    brackets,
    reliefs,
  };
}

export function srsRules(year: number): SrsYearRules {
  const row = srsRows.find((r) => r.year === year);
  if (!row) throw new Error(`No seeded SRS rule set for ${year}`);
  return {
    year,
    capScPr: row.capScPr ?? 15_300,
    capForeigner: row.capForeigner ?? 35_700,
    statutoryRetirementAge: row.statutoryRetirementAge ?? 63,
    withdrawalWindowYears: row.withdrawalWindowYears ?? 10,
    taxableShare: row.taxableShare ?? 0.5,
    earlyWithdrawalPenaltyRate: row.earlyWithdrawalPenaltyRate ?? 0.05,
  };
}
