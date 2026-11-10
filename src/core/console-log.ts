import { isInternalErrorText } from './internal-errors.js';

/** SDK diagnostics reserve this leading prefix and remain console-only.
 * Check the original first argument without serializing business objects or errors.
 * Explicit logger.log calls are intentionally outside this automatic filter.
 */
export function isInternalConsoleLog(args: readonly unknown[]): boolean {
  return (typeof args[0] === 'string' && args[0].startsWith('[cocos-sdk]'))
    || args.some(value => isInternalErrorText(value)
      || (value instanceof Error && isInternalErrorText(value.message)));
}
