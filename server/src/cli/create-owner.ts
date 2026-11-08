// Creates the first owner account. There is no default password anywhere in the system.
// Usage (password is read from the terminal, never from argv, so it is not saved in shell history):
//   DATABASE_URL=... npm run create-owner -- --username owner --name "Shop Owner" [--email you@example.lk]
// Non-interactive (CI / provisioning): set OWNER_PASSWORD in the environment.
import readline from 'node:readline';
import pg from 'pg';
import { hashPassword, passwordProblem } from '../auth/passwords.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : undefined;
}
async function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const w = (rl as any)._writeToOutput; (rl as any)._writeToOutput = (s: string) => { if (s.includes(q)) w.call(rl, s); };
  return new Promise(res => rl.question(q, a => { rl.close(); process.stdout.write('\n'); res(a); }));
}

const url = process.env.DATABASE_URL;
const username = arg('username');
const name = arg('name') || username;
const email = arg('email') || null;
if (!url || !username) { console.error('Usage: DATABASE_URL=... npm run create-owner -- --username <name> [--name "Full Name"] [--email x]'); process.exit(1); }

const pw = process.env.OWNER_PASSWORD || await ask('New owner password (min 12 characters): ');
const problem = passwordProblem(pw, username);
if (problem) { console.error('Password rejected: ' + problem); process.exit(1); }
if (!process.env.OWNER_PASSWORD && (await ask('Type it again: ')) !== pw) { console.error('Passwords do not match.'); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('BEGIN');
  const u = await c.query(`INSERT INTO staff_users (username, email, display_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`, [username, email, name, await hashPassword(pw)]);
  await c.query(`INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE code = 'owner'`, [u.rows[0].id]);
  await c.query(`INSERT INTO audit_logs (actor_type, actor_label, action, entity_type, entity_id) VALUES ('system', 'cli', 'staff.create_owner', 'staff', $1)`, [u.rows[0].id]);
  await c.query('COMMIT');
  console.log(`Owner account "${username}" created.`);
} catch (e: any) {
  await c.query('ROLLBACK');
  console.error(e.code === '23505' ? 'That username or email already exists.' : e.message);
  process.exitCode = 1;
} finally { await c.end(); }
