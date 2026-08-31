/**
 * Household optimizer for spouse-shareable reliefs (QCR / Child Relief
 * (Disability)): apportions each shared pool between the two spouses to
 * minimize combined tax.
 *
 * Each pool is continuously divisible and each spouse's tax is a convex
 * piecewise-linear function of their total reliefs, so greedy marginal
 * allocation ("water-filling") is exact: allocate each chunk to the spouse
 * whose marginal bracket rate is highest, in chunks bounded by bracket
 * floors and the $80k relief cap. Ties are broken deterministically toward
 * the spouse with the higher chargeable income (then the first member).
 */
import type { TaxBracketRow } from "../config.ts";
import { distanceToBracketFloor, rateAt } from "./brackets.ts";

export type SharedReliefPool = {
  label: string;
  amount: number;
};

export type OptimizerMember = {
  /** Income after donations deduction. */
  assessableIncome: number;
  /** All non-shared reliefs (before the relief cap). */
  baseReliefs: number;
};

export type SharedReliefAllocation = {
  label: string;
  /** Dollars of the pool allocated to [member 0, member 1]. */
  amounts: [number, number];
};

function marginalRate(
  member: OptimizerMember,
  reliefsUsed: number,
  brackets: TaxBracketRow[],
  reliefCap: number,
): number {
  if (reliefsUsed >= reliefCap) return 0;
  const chargeable = Math.max(0, member.assessableIncome - reliefsUsed);
  return rateAt(chargeable, brackets);
}

export function optimizeSharedReliefs(input: {
  members: [OptimizerMember, OptimizerMember];
  pools: SharedReliefPool[];
  brackets: TaxBracketRow[];
  reliefCap: number;
}): SharedReliefAllocation[] {
  const { members, pools, brackets, reliefCap } = input;
  const reliefsUsed: [number, number] = [
    members[0].baseReliefs,
    members[1].baseReliefs,
  ];

  return pools.map((pool) => {
    let remaining = pool.amount;
    const amounts: [number, number] = [0, 0];

    while (remaining > 1e-9) {
      const rates: [number, number] = [
        marginalRate(members[0], reliefsUsed[0], brackets, reliefCap),
        marginalRate(members[1], reliefsUsed[1], brackets, reliefCap),
      ];

      let winner: 0 | 1 = rates[1] > rates[0] ? 1 : 0;
      if (rates[0] === rates[1]) {
        const chargeable = (i: 0 | 1) =>
          Math.max(0, members[i].assessableIncome - reliefsUsed[i]);
        winner = chargeable(1) > chargeable(0) ? 1 : 0;
      }

      if (rates[winner] === 0) {
        // No tax value left for either member; assign deterministically.
        amounts[0] += remaining;
        break;
      }

      const chargeable =
        members[winner].assessableIncome - reliefsUsed[winner];
      const chunk = Math.min(
        remaining,
        distanceToBracketFloor(chargeable, brackets),
        reliefCap - reliefsUsed[winner],
      );
      amounts[winner] += chunk;
      reliefsUsed[winner] += chunk;
      remaining -= chunk;
    }

    return { label: pool.label, amounts };
  });
}
