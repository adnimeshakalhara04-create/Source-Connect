export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Please sign in.') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have permission to do this.') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'conflict', msg, details);
