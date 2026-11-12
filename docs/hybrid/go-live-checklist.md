# Go-live checklist (Supabase hybrid)

Each step needs the owner's own account or decision. Claude does not buy services, enter secrets or switch on live payments.

## A. Staging (sandbox only)
- [ ] **Supabase (owner):**
  - Create the project (Pro), region close to Sri Lanka, e.g. Singapore.
  - Turn on MFA on the owner's Supabase account.
  - Check the plan's current limits and prices on the pricing page.
- [ ] Deploy:
  - `supabase link`, then `supabase db push` (migrations), then `psql -f supabase/seed.sql`;
  - `supabase functions deploy`;
  - `supabase secrets set --env-file <file on your computer>`, with sandbox PayHere values and `PAYHERE_MODE=sandbox`.
- [ ] Auth settings in the dashboard:
  - minimum password length 12, letters + digits;
  - TOTP MFA enrolment **on**;
  - redirect URLs = the staging site;
  - email provider (SMTP) configured.
- [ ] `js/config.js` on a **staging** Pages project: Supabase URL + **anon** key only. Never use the service role key there.
- [ ] Create the owner staff account:
  - first set `require_staff_mfa` (it is already true by default);
  - then sign in and enrol TOTP.
- [ ] Re-check on staging what local tests cannot prove:
  - CORS only allows the site origin (`curl -H 'Origin: https://evil.example' …`);
  - `clientIp` gets the real client IP (track-order rate limit);
  - the `pg_dump` backup and restore drill run against the hosted project;
  - the restore into a new project works (§3.2 of the runbook);
  - the PayHere sandbox notification arrives and the order turns paid.
- [ ] VPS set up as in `vps-runbook.md` §1; the restore drill prints PASSED from R2.
- [ ] Owner enters cost prices for every product (Admin → Sales & Profit → Cost prices), so profit is complete from the first sale.
- [ ] Owner adds a reminder for every paid service and trial (Admin → Renewals): Supabase Pro renewal date, VPS, domain, and any trial end date.
- [ ] Before live payments: Staff & Roles → Second sign-in step → back to **Authenticator app** (the admin PIN is meant for the preview period).
- [ ] Run the load test on staging; record the results in `docs/evidence/`.

## B. Launch (needs separate written approval)
- [ ] Owner's **written** approval for live payments. Record it with `UPDATE app.ops_settings SET payhere_mode = 'live', payhere_live_approved_by = '<name>', payhere_live_approved_at = now();`. Also set `PAYHERE_LIVE_APPROVED=true` and the live merchant values as Supabase secrets.
- [ ] Live domain on Cloudflare Pages; the CORS `SITE_ORIGINS` updated.
- [ ] One real low-value card order and one refund done by the owner.
- [ ] The first scheduled restore drill after launch has passed.
