/**
 * Resident progressive tax brackets.
 *
 * Brackets are left-exclusive: a bracket (prevUpTo, upTo] taxes the portion of
 * chargeable income above prevUpTo up to upTo at its rate. So chargeable
 * income of exactly $80,000 has its top dollar taxed at 7% (the 40k-80k
 * bracket), and the marginal relief rate at $80,000 is 7%.
 */
import type { TaxBracketRow } from "../config.ts";
import { roundCents } from "../money.ts";

/** Tax payable on chargeable income under the given brackets. */
export function bracketTax(chargeable: number, brackets: TaxBracketRow[]): number {
  let tax = 0;
  let prevUpTo = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (chargeable > prevUpTo) {
      tax += b.rate * (Math.min(chargeable, upper) - prevUpTo);
    }
    if (chargeable <= upper) break;
    prevUpTo = upper;
  }
  return roundCents(tax);
}

/** Marginal rate of the top dollar of chargeable income (0 at or below 0). */
export function rateAt(chargeable: number, brackets: TaxBracketRow[]): number {
  if (chargeable <= 0) return 0;
  const b = brackets.find((b) => b.upTo === null || chargeable <= b.upTo);
  return b?.rate ?? 0;
}

/**
 * How much relief can be absorbed at the current marginal rate before the
 * chargeable income drops into the next lower bracket.
 */
export function distanceToBracketFloor(
  chargeable: number,
  brackets: TaxBracketRow[],
): number {
  if (chargeable <= 0) return 0;
  const idx = brackets.findIndex((b) => b.upTo === null || chargeable <= b.upTo);
  const floor = idx > 0 ? (brackets[idx - 1].upTo ?? 0) : 0;
  return chargeable - floor;
}

/** Marginal rate of the next dollar of income (right derivative). */
export function rateAbove(chargeable: number, brackets: TaxBracketRow[]): number {
  const b = brackets.find((b) => b.upTo === null || chargeable < b.upTo);
  return b?.rate ?? 0;
}

/** Room at the current marginal rate before the next bracket boundary. */
export function distanceToBracketCeiling(
  chargeable: number,
  brackets: TaxBracketRow[],
): number {
  const b = brackets.find((b) => b.upTo === null || chargeable < b.upTo);
  if (!b || b.upTo === null) return Infinity;
  return b.upTo - chargeable;
}
