import { z } from 'zod';
import { badRequest } from './errors.js';

/** Validates input with a Zod schema (schemas use z.strictObject so unknown keys are rejected). */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 10).map(i => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('Some details are missing or invalid: ' + issues.map(i => (i.path ? i.path + ': ' : '') + i.message).join('; '), issues);
  }
  return r.data;
}
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'must be a colour like #0b2a6f');
export const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'only a-z, 0-9 and dashes').max(80);
export const SafeLink = z.string().max(300).regex(/^(#|\/|https:\/\/)/, 'must start with #, / or https://');
export const ImageUrl = z.string().max(2000).regex(/^(https?:\/\/|\/)/, 'must be an uploaded image or an https link');
export const Text = (max: number) => z.string().max(max).transform(s => s.trim());
