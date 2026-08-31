/**
 * Money rounding helpers shared by the engine modules.
 * The engine computes in dollars (number); statutory rounding rules:
 *  - total CPF contribution: round to nearest dollar (>= 50 cents rounds up)
 *  - employee share: round down to the dollar
 *  - account allocations: cents (CPF accounts track cents)
 */

/** Round to the nearest dollar; exactly 50 cents rounds up (CPFB rule). */
export function roundDollar(x: number): number {
  return Math.floor(x + 0.5);
}

/** Round down to the dollar (CPFB rule for the employee share). */
export function floorDollar(x: number): number {
  return Math.floor(x);
}

/** Round to cents, half-up, guarding against float dust (e.g. 0.1 + 0.2). */
export function roundCents(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
