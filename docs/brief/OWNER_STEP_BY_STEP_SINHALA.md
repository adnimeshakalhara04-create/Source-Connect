# Source Connect — Owner's Step-by-Step Guide (සිංහල)

## System එකේ කොටස් මොනවාද?

1. **Website:** Customer කෙනා products බලන සහ order දාන පිටුව. Cloudflare Pages වගේ CDN/static hosting එකේ තබමු.
2. **Admin Panel:** ඔයාලගේම staff ලාට products, stock, orders, banners සහ deliveries manage කරන්න පුළුවන් පිටුව. Login හැමවිටම backend එකෙන් verify කරමු.
3. **Backend API:** Website සහ Admin Panel දෙකම පාවිච්චි කරන ආරක්ෂිත server program එක. Price, stock, payment සහ permissions තීරණය කරන්නේ මෙයයි.
4. **Database (PostgreSQL):** Products, Customers, Orders, Inventory, Payments සහ staff permissions save කරන software එක.
5. **VPS:** Backend සහ මුල් අදියරේ database එක run වෙන Linux server එක. Backup server එකක් දෙවැනියට මිලදී ගන්න මුලදී ඕන නැහැ.
6. **Backup Storage:** VPS එක නතර වුණත් database backup file සහ WAL logs ආරක්ෂිතව තබන වෙනම private cloud storage එක. Full restore සහ point-in-time restore අත්හදා බැලිය යුතුයි.
7. **PayHere:** Card payments collect කරන වෙනම gateway එක. Payment successful කියලා mark කරන්න PayHere's verified server notification එක අවශ්‍යයි.

## Claude Code එකට මෙය දෙන්නේ කොහොමද?

1. GitHub project එකේ නව branch එකක් හදන්න Claude Code ට ඉඩ දෙන්න; `main`/default branch කෙළින්ම overwrite කරන්න කියන්න එපා.
2. **`CLAUDE_CODE_MASTER_PROMPT.md`** තුළ තියෙන full instructions Claude Code chat/terminal session එකට paste කරන්න, නැත්නම් repository root එකට copy කරලා එය කියවන්න කියන්න.
3. Claude Code මුලින් project audit එක දීලා, database migrations + backend + admin login + frontend integration + PayHere sandbox + backup scripts එකින් එක implement කරන්න ඕන.
4. Tests සහ screenshots compare කරලා project visual appearance එක preserve වුණාද බලන්න.
5. VPS එකක් හෝ PayHere live account එකක් ගන්න කලින් Claude Code ගෙන් staging readiness report එක බලන්න.

## අවශ්‍ය Accounts/Services

- Existing GitHub repository access.
- Cloudflare account: Pages, DNS, R2 private bucket සඳහා (owner approval required).
- Test VPS or staging environment: Ubuntu Linux/SSH root access provision කරන්න owner approval required. PXN VPS 3 specs/pricing/service quality independently verify first.
- PayHere merchant account: merchant ID / secret production වලට අවශ්‍යයි; ඒවා chat, GitHub හෝ screenshots වල paste කරන්න එපා. Encrypted server secrets භාවිත කරන්න.
- Domain name, DNS settings and email channel for operational alerts.

## First practical actions

1. **දැන් මුලින් VPS/paid plan මිලදී නොගන්න.** Claude Code ලවා local docker database + API සහ UI migration implementation කරන්න.
2. Claude Code audit output එකේ admin login browser-side ද, test coverage ද, localStorage use ද කියලා verify කරන්න.
3. Local test checkout සහ PayHere sandbox callback duplicate/invalid/valid cases පරීක්ෂා කරන්න.
4. Backup system එක setup කරලා, fresh staging database එකකට `full restore` සහ `point-in-time recovery` tests කරන්න.
5. වෙනස් browser දෙකකින් admin save කරන product එක customer website එකේ පේනවාද බලන්න.
6. VPS මත staging deploy කරන්න; HTTPS, firewall, backup alerts, restore runbook, load test passed පසු production deploy ගැන තීරණය කරන්න.

## Launch checklist

- [ ] Default admin credentials නැහැ, secure server login ක්‍රියාත්මකයි.
- [ ] Orders browser localStorage එකේ නොව database එකේ persist වෙනවා.
- [ ] Customer A order එක Customer B ට අනුමැතියක් නැතුව බලන්න බැහැ.
- [ ] Price, shipping, stock backend validate කරනවා.
- [ ] Duplicate PayHere notifications නිසා payments double count වෙන්නේ නැහැ.
- [ ] Wrong/forged payment callback එකක් paid order එකක් හදන්නේ නැහැ.
- [ ] Daily/differential/full backup jobs active සහ WAL archival health monitored.
- [ ] Cloud backup storage private + encrypted + separately credentialed.
- [ ] Restore tested on a clean staging server including product images.
- [ ] Backup failure/CPU/disk/API outage alert owner receives.
- [ ] Real PayHere domain/merchant approval completed.
- [ ] Production release and rollback owner explicitly approves.

## Reminder: Backup ≠ Second server

**Backup** එකෙන් data නැවත ලබාගන්න පුළුවන්. **Standby server** එකෙන් primary server crash වුණාම service restore/continue කරන්න පුළුවන්. දෙවැනි VPS එකක් නැතිව backup ගන්න පුළුවන්; එහෙත් දෙවැනි server එකක් තිබුණත් backups නතර කරන්න බැහැ.
