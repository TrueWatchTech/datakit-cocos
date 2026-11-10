// Wire contract with the base SDK's internal-errors.ts; no runtime package dependency.
const INTERNAL_ERROR_MARKER = '[ft-cocos-sdk-internal]';

/** Tag before throwing/rejecting: Creator 2 JSB may notify before a caller's catch runs. */
export function replayError(message: string, ErrorType: ErrorConstructor = Error): Error {
  return new ErrorType(`${INTERNAL_ERROR_MARKER} ${message}`);
}
