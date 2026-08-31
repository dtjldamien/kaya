export { bracketTax, distanceToBracketFloor, rateAt } from "./brackets.ts";
export {
  computeHouseholdTax,
  computeMemberTax,
  marginalReliefRate,
} from "./compute.ts";
export type {
  HouseholdTaxInput,
  HouseholdTaxResult,
  MemberTaxInput,
  MemberTaxResult,
} from "./compute.ts";
export { optimizeSharedReliefs } from "./optimizer.ts";
export type {
  OptimizerMember,
  SharedReliefAllocation,
  SharedReliefPool,
} from "./optimizer.ts";
export { computeClaimedRelief } from "./reliefs.ts";
export type { ReliefClaim, ReliefMemberContext } from "./reliefs.ts";
