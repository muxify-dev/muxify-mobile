/**
 * The shape checks every parse of a `muxify … --json` answer is built from.
 * Each throws with `at`, the path to the value, so a failed read names the
 * first thing in the answer that was wrong.
 */

export function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at}: expected an object`);
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at}: expected an array`);
  return value;
}

export function string(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Error(`${at}: expected a string`);
  return value;
}

export function number(value: unknown, at: string): number {
  if (typeof value !== 'number') throw new Error(`${at}: expected a number`);
  return value;
}
