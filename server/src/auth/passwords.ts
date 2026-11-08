import argon2 from 'argon2';

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1) — modest RAM so a 4 GB VPS copes with login bursts.
const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string): Promise<string> => argon2.hash(pw, OPTS);
export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try { return await argon2.verify(hash, pw); } catch { return false; }
}
// Used when the username does not exist so the response time does not reveal valid usernames.
let dummy: Promise<string> | null = null;
export async function burnTime(pw: string): Promise<void> { dummy ??= hashPassword('not-a-real-password-' + Math.random()); await verifyPassword(await dummy, pw); }

const COMMON = new Set(['password', 'password123', 'admin123', 'qwerty123', '123456789012', 'sourceconnect', 'letmein123']);
/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(pw: string, username = ''): string | null {
  if (typeof pw !== 'string' || pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (COMMON.has(pw.toLowerCase())) return 'This password is too common.';
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return 'Do not include the username in the password.';
  if (new Set(pw).size < 6) return 'Use a mix of different characters.';
  return null;
}
