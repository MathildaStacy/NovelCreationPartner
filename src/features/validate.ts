/** Input checks shared by services. Lengths count characters (code points), not UTF-16 units. */
import { validation } from './errors';

export const charCount = (s: string): number => [...s].length;

/** Trims and checks `min`–`max` characters; returns the trimmed value. */
export function requireLength(field: string, value: string | null | undefined, min: number, max: number, label: string): string {
  const v = (value ?? '').trim();
  const n = charCount(v);
  if (n < min || n > max) {
    throw validation(field, min > 0 ? `${label}需要 ${min}–${max} 字` : `${label}最多 ${max} 字`);
  }
  return v;
}
