/** Reserved wire marker shared with the independently bundled Replay package. */
export const FT_INTERNAL_ERROR_MARKER = '[ft-cocos-sdk-internal]';

export function sdkInternalError(message: string): Error {
  return new Error(`${FT_INTERNAL_ERROR_MARKER} ${message}`);
}

/** JSB can put the exception header in message or the first line of stack. */
export function isInternalErrorText(value: unknown): boolean {
  return typeof value === 'string' && value.split(/[\r\n]/, 1)[0]!.includes(FT_INTERNAL_ERROR_MARKER);
}
