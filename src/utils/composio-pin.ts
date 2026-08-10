/**
 * Pure PIN-resolution logic for the Composio ED signing key, kept in its own
 * dependency-free module so unit tests can import it without pulling `composio.ts`
 * (which statically imports `@cosmjs/*`, `@ixo/impactxclient-sdk` and `./common`
 * → `@clack/prompts`, all ESM-only) into the ts-jest/CommonJS runtime.
 *
 * `composio.ts` re-exports these so runtime callers still import from `./composio`.
 */

export type EdPinDecision =
  | { pin: string; persist: false }
  | { useOraclePin: true; persist: true }
  | { needsPrompt: true };

/**
 * Decides which PIN unlocks the user-room ED signing key, disentangling it from
 * the per-oracle vault PIN:
 *  - a PIN persisted in the wallet (`edKeyPin`) always wins;
 *  - first run (no key stored yet) uses the oracle PIN and persists it;
 *  - a legacy key with no persisted PIN must be prompted for.
 */
export function resolveEdPinDecision(args: {
  storedPin: string | undefined;
  blobExists: boolean;
}): EdPinDecision {
  if (args.storedPin) return { pin: args.storedPin, persist: false };
  if (!args.blobExists) return { useOraclePin: true, persist: true };
  return { needsPrompt: true };
}
