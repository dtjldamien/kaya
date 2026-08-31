/**
 * SRS vs investing with cash: the marginal comparison for a level annual
 * contribution, priced at the retirement date.
 *
 *  - SRS path: new contributions grow at the SRS return; at retirement the
 *    withdrawal tax attributable to those contributions (the increment over
 *    the tax on any pre-existing balance, which is sunk) comes off; the
 *    annual tax savings are reinvested in cash equities and grow at the
 *    equity rate.
 *  - Cash path: the same contribution stream is invested at the equity rate
 *    with no relief now and no tax later (Singapore has no capital gains
 *    tax).
 *
 * SRS wins when the bracket spread (save at the marginal rate now, pay ~half
 * that on 50%-taxable withdrawals later) outweighs any growth-rate handicap
 * of SRS funds. Both paths commit the same dollars, so no cash-flow
 * adjustment is needed.
 *
 * All figures in whole SGD; rates as fractions.
 */
import { roundCents } from "../money.ts";
import { projectSrsBalance } from "./scenarios.ts";

export type SrsVsCashComparison = {
  /** SRS path value at retirement: contributions − withdrawal tax + savings. */
  srsTotal: number;
  /** Cash path value at retirement: contributions grown at the equity rate. */
  cashTotal: number;
  /** srsTotal − cashTotal; positive = SRS wins. */
  advantage: number;
  /** FV of the new contributions at the SRS return. */
  contributionsAtRetirement: number;
  /** Withdrawal tax attributable to the new contributions. */
  withdrawalTax: number;
  /** FV of the annual tax savings reinvested at the equity rate. */
  savingsAtRetirement: number;
};

export function srsVsCash(input: {
  annualContribution: number;
  /** Whole years from the income year to the retirement year. */
  years: number;
  /** Expected annual return inside SRS (0.02 = 2%). */
  srsReturn: number;
  /** Expected annual return on cash investments (0.07 = 7%). */
  equityReturn: number;
  /** Tax saved per year by the contribution (constant-income assumption). */
  annualSavings: number;
  /** Withdrawal tax attributable to the new contributions. */
  withdrawalTax: number;
}): SrsVsCashComparison {
  // projectSrsBalance's contribution-stream FV with no starting balance:
  // contributions at the start of each year, this YA's included, growing to
  // the retirement date.
  const fv = (annual: number, rate: number) =>
    projectSrsBalance({
      currentBalance: 0,
      annualContribution: annual,
      years: input.years,
      annualReturn: rate,
    });

  const contributionsAtRetirement = fv(input.annualContribution, input.srsReturn);
  const savingsAtRetirement = fv(input.annualSavings, input.equityReturn);
  const cashTotal = fv(input.annualContribution, input.equityReturn);
  const withdrawalTax = roundCents(input.withdrawalTax);
  const srsTotal = roundCents(
    contributionsAtRetirement - withdrawalTax + savingsAtRetirement,
  );
  return {
    srsTotal,
    cashTotal,
    advantage: roundCents(srsTotal - cashTotal),
    contributionsAtRetirement,
    withdrawalTax,
    savingsAtRetirement,
  };
}
