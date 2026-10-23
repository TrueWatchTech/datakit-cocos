export function samplingRate(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
  return value;
}

export function samplingPercentage(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be between 0 and 100`);
  }
  return value;
}

export function validatedSamplingConfig<T extends object>(
  config: T,
  scope: string,
  fields: ReadonlyArray<readonly [percentageField: string, legacyField: string]>,
): T {
  const result = { ...config } as Record<string, unknown>;
  fields.forEach(([percentageField, legacyField]) => {
    const percentage = result[percentageField] as number | undefined;
    if (percentage !== undefined) {
      samplingPercentage(percentage, `${scope}.${percentageField}`);
      delete result[legacyField];
      return;
    }
    samplingRate(result[legacyField] as number | undefined, `${scope}.${legacyField}`);
  });
  return result as T;
}

export function requireText(value: string, name: string): string {
  if (!value.trim()) throw new TypeError(`${name} must not be empty`);
  return value;
}
