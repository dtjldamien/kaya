/** Display/parsing helpers for money in whole SGD (engine works in dollars). */

const sgdWhole = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
  maximumFractionDigits: 0,
});

/** Whole-dollar display ("$12,345"). */
export function formatDollarsWhole(dollars: number): string {
  return sgdWhole.format(dollars);
}

/** Parse a user-entered dollar amount ("12,345.67" / "$12345") to dollars. */
export function parseDollars(input: string): number | null {
  const n = Number(input.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Fraction → display percent ("11.5%"). */
export function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
