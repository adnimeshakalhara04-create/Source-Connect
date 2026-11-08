# Security checklist

✅ = implemented and covered by an automated test · 🟡 = implemented, needs checking on the real server · ⬜ = owner or infrastructure action

## Authentication and sessions
- ✅ No default admin account. `admin/admin123` is refused (`auth.test.ts`, `api-e2e.mjs`). The first owner is created from the command line with a password of 12+ characters.
- ✅ Argon2id password hashes (19 MiB, t=2). Common passwords, short passwords and passwords containing the username are rejected.
- ✅ Server-side sessions: a random 256-bit cookie, stored only as a SHA-256 hash, with `HttpOnly`, `Secure` (production), `SameSite` and a path scope. Logout and disable revoke on the server. Sessions expire after 12 h (staff) or 30 days (customers).
- ✅ CSRF token required on every staff and signed-in customer write (`x-csrf-token`). It is checked in constant time.
- ✅ Brute force: the account locks after 5 wrong passwords (15 min), there is a per-IP login rate limit (10/min), the message is the same for "unknown user" and "wrong password", and time is spent on unknown users too.
- ✅ New staff must change their temporary password before doing anything else.
- ⬜ Optional MFA (TOTP) for owner accounts. The schema can be extended; recommended before many staff accounts exist.

## Authorisation
- ✅ Every admin endpoint checks a permission on the server. There are 7 roles and 16 permissions.
- ✅ Department staff can only change products in their own departments (`admin.test.ts`).
- ✅ Customers only see their own orders. A guest needs the private tracking token, or the order number **plus** matching phone, which shows the status only and not the address (`checkout.test.ts`).
- ✅ Refunds need `refunds.create`. Bank-transfer and COD confirmation need `payments.verify`. The last active owner cannot be removed.

## Payments
- ✅ Prices, discounts, shipping and totals are calculated on the server. Unknown fields such as `price` from the browser are rejected.
- ✅ The PayHere `md5sig` is verified with a constant-time compare, along with the merchant ID, order, exact amount and currency. Duplicates, out-of-order notifications, failures, cancels and chargebacks are handled safely (`payments.test.ts`). The return page never marks an order paid.
- ✅ The merchant secret exists only in the server environment. The browser gets only the checkout hash (`api-e2e.mjs` checks this).
- ✅ Live mode cannot start without `PAYHERE_LIVE_APPROVED=true`.
- ⬜ PayHere live account and domain approval (owner).

## Input, output and files
- ✅ Every body and query is validated with Zod: unknown keys rejected, lengths limited, Sri Lankan phone format, districts from a fixed list.
- ✅ Output escaping in the storefront and admin. `imgSrc` and `safeColor` helpers, plus database `CHECK` constraints on colours and links. Earlier XSS audit: `e2e/demo-mode/xss.cjs`.
- ✅ Uploads: staff only, 4 MB maximum, type detected from the file's bytes (JPEG/PNG/WebP only; SVG and HTML rejected), random file names, served with `nosniff`.
- ✅ The API sends `Content-Security-Policy: default-src 'none'`, `frame-ancestors 'none'`, `nosniff` and HSTS (production). Admin and customer responses are `Cache-Control: no-store`.
- 🟡 Add a CSP header for the static site in Cloudflare Pages `_headers`. The site uses inline scripts and styles, so start with `script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://api.<domain>; img-src 'self' data: https:`.

## Infrastructure
- 🟡 SSH keys only, no root login, UFW (22/80/443), fail2ban and unattended security upgrades (`setup-vps.sh`, not yet run on a real VPS).
- ✅ PostgreSQL listens on localhost only, and the app uses its own non-superuser role (`sc_app`).
- ✅ The API container runs as a non-root user with a read-only filesystem, all capabilities dropped, `no-new-privileges` and memory and CPU limits (`compose.yaml`; the image was smoke-tested).
- ✅ CORS allowlist (`auth.test.ts`). Rate limits are global (300/min/IP) and per route (orders, quote, login, register, tracking).
- ✅ Logs redact cookies, CSRF tokens, passwords, PayHere signatures and card numbers. The audit log stores secret fields as `[redacted]`.
- ✅ Backups are encrypted on the server before upload. The bucket is private. Credentials are never in the database or the admin panel.
- ⬜ Cloudflare: proxied DNS, "Full (strict)" TLS, a WAF rate-limit rule, and a skip rule for the PayHere notify path.

## Privacy (Sri Lanka PDPA, Act No. 9 of 2022)
- ✅ Only the data needed for delivery is collected. Staff without `customers.read` see first names only. Customer lists are written to the audit log.
- ⬜ Publish a privacy notice and refund policy on the site, and decide how long to keep order records (accounting rules usually require several years).
