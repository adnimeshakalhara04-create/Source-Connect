# Budget and capacity

## 1. Measured load test (2026-11-08)

**Setup.** The API (compiled, production mode) and PostgreSQL 16 were **both pinned to 2 CPU cores** with `taskset`, to approximate a 2 vCPU VPS. The load generator (autocannon) ran on 2 other cores. The database was the seeded catalogue: 144 products and 528 variants. Each scenario ran for 20 seconds.

**This is not the real VPS.** The CPUs were faster dedicated cores, memory was not capped at 4 GB, and there was no network latency or TLS. Repeat with `e2e/load/load-test.mjs` on the staging VPS before launch.

| Scenario | Concurrent users | Requests/s | p50 | p95* | p99 | Errors |
|---|---|---|---|---|---|---|
| Whole-catalogue snapshot (140 KB, used by the website on load) | 20 | 1,652 | 10 ms | 22 ms | 27 ms | 0 % |
| Product page | 50 | 1,305 | 36 ms | 58 ms | 64 ms | 0 % |
| Search | 50 | 504 | 97 ms | 125 ms | 134 ms | 0 % |
| Cart quote (server pricing) | 50 | 960 | 46 ms | 88 ms | 101 ms | 0 % |
| **Checkout**: COD orders, 30 buyers competing for the same 3 items | 30 | 244 orders/s | 117 ms | 193 ms | 212 ms | 0 % |

\* autocannon reports p97.5, shown in the p95 column (slightly stricter).

- **Correctness under load:** 4,893 orders were placed. There were 0 impossible stock rows, and the units removed from stock equalled the units sold exactly. Nothing was oversold.
- **API memory** after the test: 212 MB. Database size: 25 MB.
- **A finding that was fixed:** before the change, the catalogue snapshot managed only **115 requests/s (p95 230 ms)**, because it was rebuilt for every visitor. A 10-second in-memory cache, cleared on every staff edit, raised it to 1,652/s. Cloudflare's 30-second cache on the same response will absorb most real traffic.
- Raw results: `docs/evidence/load-test-2026-11-08.json`.

**What this means.** A realistic Sri Lankan launch peak, for example a Facebook ad driving 200–500 people onto the site within a few minutes and a few orders per minute, is far below what was measured. The 2 vCPU / 4 GB plan is a reasonable start, **provided** the staging test on the real VPS shows similar numbers.

**When to upgrade:**
- Upgrade to **8 GB RAM** if memory use stays above 80 % or swap is used regularly.
- Move **PostgreSQL to its own server** (or a managed database) if checkout p95 goes above 500 ms at peak, or CPU stays above 70 % for more than 15 minutes on most days.
- **Add a second API container** when one container is CPU-bound and the database is not.

This is no promise for "100,000 simultaneous users". That would need a CDN-only catalogue, several API servers and a separate database, and it has not been tested.

## 2. Monthly running costs (estimates — confirm current prices before buying)

| Item | Estimate | Notes |
|---|---|---|
| VPS 2 vCPU / 4 GB / 80 GB NVMe (PXN offer) | LKR 1,100 per 50 days (≈ LKR 660/month) | **Unverified offer.** Check the renewal price, SLA, root/SSH access, IPv4, backups, NVMe speed and the provider's reputation before paying (§3) |
| Domain (.lk or .com) | LKR 3,000–9,000 per year | |
| Cloudflare Pages + DNS + proxy | Free tier | Enough for this site |
| Cloudflare R2 (database backups + image backups) | Probably within the free tier at first (10 GB-month storage free; no egress fees) | At a 25 MB database and about 5 GB of photos, backups stay small. Re-check `developers.cloudflare.com/r2/pricing` |
| PayHere Plus | ≈ LKR 3,990/month, plus a per-transaction fee | **Owner to confirm** current pricing and fees with PayHere |
| Email for receipts and verification (e.g. a transactional email provider) | Free tier is usually enough to start | **Not chosen yet.** Until it is, customer emails are not sent in production |
| Alerts (ntfy app) | Free | |
| **Total at launch** | about LKR 5,000–6,000/month, most of it PayHere | Second VPS: **not** needed at launch |

## 3. VPS checklist before paying (PXN or any other provider)

- [ ] Full root access, Ubuntu 24.04 LTS available, your own SSH key at creation.
- [ ] Real dedicated 4 GB RAM, plus the swap allowed. Run `free -m` and check no "burst" limit applies.
- [ ] NVMe speed: `fio --name=t --rw=randwrite --bs=8k --size=1G --runtime=30 --direct=1` should give more than 5,000 IOPS.
- [ ] Stable IPv4, reverse DNS, ports 80/443 open, and SMTP port 25 policy known.
- [ ] Renewal price in writing, plus refund terms and a support contact.
- [ ] Where the data centre is, and the latency from Sri Lanka (`ping` should be under about 80 ms).
- [ ] Provider snapshots, as a nice extra. **They do not replace off-site backups**: if the provider account is lost, the snapshots go with it.
- [ ] Run `e2e/load/load-test.mjs` against staging, and keep the numbers in this file.
