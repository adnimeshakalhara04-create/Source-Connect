/** Money is always integer cents. These helpers convert at the edges only. */
export const rsToCents = (rs: number): number => {
  if (!Number.isFinite(rs)) throw new Error('invalid amount');
  return Math.round(rs * 100);
};
export const centsToRs = (c: number): number => c / 100;
/** PayHere wants the amount with exactly two decimals and no thousands separators. */
export const formatAmount = (cents: number): string => {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('invalid cents');
  return Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
};
/** Parses "1234.50" (as sent by PayHere) to cents without floating point. Returns null if malformed. */
export const parseAmount = (s: string): number | null => {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(s).trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'));
};
