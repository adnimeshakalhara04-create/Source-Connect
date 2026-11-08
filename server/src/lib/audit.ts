import type { Pool, PoolClient } from 'pg';
export interface Actor { type: 'staff' | 'customer' | 'system' | 'payhere'; id?: string | null; label?: string; ip?: string | null; ua?: string | null; requestId?: string | null }
const SECRET_KEYS = /pass(word)?|secret|token|hash|cookie|authorization|card_no|md5sig/i;
/** Removes secrets before anything is written to the audit log. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(x);
    return o;
  }
  if (typeof v === 'string' && v.startsWith('data:') && v.length > 200) return v.slice(0, 40) + '…[data-url]';
  return v;
}
export async function audit(db: Pool | PoolClient, actor: Actor, action: string, entityType: string | null, entityId: string | null, before?: unknown, after?: unknown): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_type, actor_id, actor_label, action, entity_type, entity_id, before, after, ip, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [actor.type, actor.id ?? null, actor.label ?? '', action, entityType, entityId,
     before === undefined ? null : JSON.stringify(redact(before)), after === undefined ? null : JSON.stringify(redact(after)),
     actor.ip ?? null, actor.ua ? actor.ua.slice(0, 300) : null, actor.requestId ?? null]);
}
