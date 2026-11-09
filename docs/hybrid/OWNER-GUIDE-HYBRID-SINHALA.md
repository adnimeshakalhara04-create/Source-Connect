# Source Connect — Supabase + VPS ක්‍රමය (අයිතිකරුට සරලව)

## 1. මොකක්ද කරලා තියෙන්නේ?
- **Supabase Pro** = shop එකේ "හදවත". භාණ්ඩ, stock, orders, ගෙවීම්, customer accounts, staff login, photos සියල්ල මෙතන තියෙනවා.
- **VPS** = "පිටුපස සේවකයා":
  - photo පරීක්ෂා කරනවා (ව්‍යාජ files අයින් කරනවා, phone එකේ GPS තොරතුරු මකනවා);
  - emails යවනවා;
  - **පැයෙන් පැයට backups ගන්නවා**.
- **VPS එක නැවතුණත් shop එක වැඩ කරනවා.** Customers ට order කරන්න පුළුවන්. VPS ආපහු එනකම් emails/photo වැඩ පෝලිමේ ඉන්නවා, නැති වෙන්නේ නෑ.
- **Cloudflare R2** = backups වල දෙවෙනි පිටපත. එය encrypt කරලා තියෙන්නේ. කවුරුහරි R2 එකට ඇතුළු වුණත් customer details කියවන්න බෑ.
- Website එකේ පෙනුම **වෙනස් කරලා නෑ**. දැන් live තියෙන GitHub Pages site එකට අත තියලත් නෑ.

## 2. පරීක්ෂා කරපු දේවල් (2026-11-09, test computer එකේ)
- Database / ආරක්ෂාව / ගෙවීම් / VPS worker tests: **62/62 සාර්ථකයි**.
- සැබෑ browser එකකින් shop + admin පරීක්ෂාව: **26/26 සාර්ථකයි**. මෙයට ඇතුළත්:
  - admin login එකට 6-digit code (two-step);
  - මිල වෙනස් කිරීම, photo upload කිරීම;
  - COD order එකක්;
  - PayHere sandbox ගෙවීමක්.
- Backup → R2 → **අලුත් database එකකට ආපහු දැමීම**: සාර්ථකයි.
  - ගණන්, stock, ගෙවීම් සහ ආරක්ෂක අවසර **හරියටම පරණ එකට සමානයි** කියලා පරීක්ෂා කළා.
  - වෙනස් කරපු (tamper) backup එකක් ප්‍රතික්ෂේප වුණා.
  - වැරදි key එකකින් backup එක විවෘත කරන්න බැරි වුණා.
- **වැදගත් සොයාගැනීමක්:** සාමාන්‍ය විදියට restore කළොත්, website එකට එන ඕනම කෙනෙකුට server-only functions භාවිතා කරන්න පුළුවන් වෙන දෝෂයක් drill එකෙන් හමු වුණා. එය නිවැරදි කළා. දැන් හැම restore එකකදීම ආරක්ෂක "fingerprint" එක ස්වයංක්‍රීයව සසඳනවා.

## 3. ඔබ කළ යුතු දේවල් (ඔබේ accounts වලින්, ඔබම)
1. **Supabase Pro** project එකක් හදන්න (staging). ඔබේ Supabase account එකේ two-step login on කරන්න.
2. **Cloudflare R2:**
   - bucket එකක් හදන්න;
   - ඒ bucket එකට පමණක් අවසර තියෙන token එකක් හදන්න;
   - දින 35කින් පරණ files මැකෙන rule එකක් දාන්න.
3. **VPS:** `docs/hybrid/vps-runbook.md` §1 අනුව setup කරන්න.
4. **ඔබේ offline key එක:** ඔබේ computer එකේ `age-keygen` වලින් key එකක් හදලා USB එකක සහ password manager එකේ තියාගන්න. VPS එක සම්පූර්ණයෙන් නැති වුණත් backups විවෘත කරන්න මේ key එක ඇති.
5. Email provider එකක් තෝරන්න (SMTP).

**කවදාවත් passwords, keys හෝ "service role key" chat එකේ, email එකේ හෝ GitHub එකේ දාන්න එපා.** ඒවා දාන්නේ server එකේ files වලට හෝ provider dashboard එකට විතරයි.

## 4. සෑම දිනකම / සතියකම
- **Admin → Backups පිටුව:** කොළ පාටින් "ok" තියෙන්න ඕනේ. ඒක රතු වුණොත් (backup එක පැරණියි / drill එක අසාර්ථකයි) technical සහායකයාට දැනුම් දෙන්න.
- **සෑම ඉරිදාම උදේ 3.30:** VPS එක ස්වයංක්‍රීයව restore drill එකක් කරනවා.

## 5. Live ගෙවීම්
- Live PayHere ගෙවීම් **ඔබගේ ලිඛිත අනුමැතියකින් පසුව පමණයි**. Database එකත් අනුමැතිය දුන් කෙනාගේ නම සහ වේලාව නැතිව live mode එකට යන්න ඉඩ දෙන්නේ නෑ.
- මුලින්ම staging එකේ sandbox ගෙවීම් සම්පූර්ණයෙන් පරීක්ෂා කරන්න (`go-live-checklist.md`).
