# Evidence files

Raw outputs behind the numbers in `docs/backup-restore-runbook.md` §6 and `docs/budget-and-capacity.md` §1.
These files were checked for secrets on 2026-11-09: no passwords, keys, tokens, connection strings or encryption passphrases appear in them.

## `backup-drill-2026-11-08.log`

- **Command:** `sudo bash infra/backup/drill/run-local-drill.sh` (the final run, using the committed scripts).
- **Environment:** PostgreSQL 16.15, pgBackRest 2.50, Node 22.23. A local HTTPS S3 server (s3rver, with its own TLS certificate) stood in for R2.

| Step | What the log shows | Result |
|---|---|---|
| 3 | `stanza-create` + `check` | WAL reaches the bucket |
| 5–6 | Full backup (34.3 MB of data → 4.1 MB stored), then a differential backup (0.2 MB stored) | ok |
| 8 | Hourly check script | healthy |
| 9 | Restore of the **latest** state | Took 9 s. It shows 0 orders, because the "accident" in step 7 is part of the latest state too. That is exactly why point-in-time recovery exists |
| 10 | **PITR** to `19:05:37`, just before the accident | Took 7 s. All 9 compared counts match the state before the accident → **PASS** |
| 11 | Primary server destroyed, then rebuilt from the bucket | Took 9 s. The newest restored order is from 19:06:06; the newest order on the destroyed server was from 19:07:16. So **70 s of orders were lost** with the drill's `archive_timeout=60` → **PASS** (target ≤ 15 min; production uses 300 s) |
| 12 | 64 bytes corrupted in one backup file, then `pgbackrest verify` | The damaged file is reported (`checksum invalid: 1`) → **PASS**. `verify` still exits 0, so the scripts read its report text instead |
| 13 | Bucket read with the wrong passphrase | Refused. The stored data begins with `Salted__` and looks random → **PASS** |

**Two step-11 numbers that need context:**
- **`stock_units 21117`:** before step 11 the drill puts stock back (`on_hand = 40` for every size), so new orders can be placed after the step-7 accident. The restored copy correctly holds that stock.
- **`orders 2`:** the step-7 accident deleted all earlier orders. After it only batch 4 (2 orders) and batch 5 (1 order) existed, and batch 5 is the order lost in the crash.

## `load-test-2026-11-08.json`

- **Command:** `taskset -c 2,3 node e2e/load/load-test.mjs http://127.0.0.1:8085 20`.
- **Setup:** the API (compiled, `NODE_ENV=production`) and PostgreSQL were pinned to 2 other cores. Rate limits were raised because all the load comes from one IP.
- **Fields:**
  - `rps`: average requests per second.
  - `p50` / `p95` / `p99`: latency in ms. The `p95` column actually holds autocannon's p97.5.
  - `ok`: 2xx replies counted inside the 20-second window.
- **Checkout `ok` = 4,882:** afterwards the database held **4,893** orders, because 11 more were committed just after the window closed. Checks after the run found 0 impossible stock rows, and the units removed from stock equal the units sold.
- **Not the real VPS:** these cores are faster than a typical VPS, memory was not limited, and there was no network or TLS. Repeat this on the staging VPS and add the result here.
