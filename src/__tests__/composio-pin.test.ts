import { resolveEdPinDecision } from '../utils/composio-pin';

describe('resolveEdPinDecision', () => {
  it('uses the stored edKeyPin when present, regardless of blob state', () => {
    expect(resolveEdPinDecision({ storedPin: '771290', blobExists: true })).toEqual({
      pin: '771290',
      persist: false,
    });
    expect(resolveEdPinDecision({ storedPin: '771290', blobExists: false })).toEqual({
      pin: '771290',
      persist: false,
    });
  });

  it('when no stored pin and no blob yet, defers to the oracle pin (caller supplies) via needsOraclePin', () => {
    expect(resolveEdPinDecision({ storedPin: undefined, blobExists: false })).toEqual({
      useOraclePin: true,
      persist: true,
    });
  });

  it('when no stored pin but a blob exists, must prompt', () => {
    expect(resolveEdPinDecision({ storedPin: undefined, blobExists: true })).toEqual({
      needsPrompt: true,
    });
  });
});
