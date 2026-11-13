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

## 6. විකුණුම් සහ ලාභය (Admin → Sales & Profit)
- **දවසක් / සතියක් / මාසයක් තෝරන්න** (Today, Yesterday, Last 7 days, This month…). දින ගණන් කරන්නේ ශ්‍රී ලංකා වේලාවෙන්.
- පිටුවේ පෙන්වන දේවල්:
  - orders ගණන;
  - විකුණුණු භාණ්ඩ ගණන;
  - **විකුණුම් වටිනාකම** (promo code අඩු කළාට පස්සේ);
  - **ලැබුණු මුදල**;
  - තවම ලැබෙන්න තියෙන මුදල (COD / bank transfer);
  - භාණ්ඩ වල **පිරිවැය**, **ලාභය** සහ ලාභ ප්‍රතිශතය.
- **Best sellers:** වැඩියෙන්ම විකුණුණු භාණ්ඩ 10.
- **Sold least:** අඩුවෙන්ම විකුණුණු (හෝ කොහෙත්ම නොවිකුණුණු) භාණ්ඩ.
- **Day by day:** හැම දවසකම විකුණුම්, ලාභය සහ ඒ දවසේ වැඩියෙන්ම විකුණුණු භාණ්ඩය.
- **Download** බොත්තමෙන් Excel එකේ විවෘත කරන්න පුළුවන් file එකක් ලැබෙනවා.

**ලාභය නිවැරදි වෙන්න නම් "Cost prices" tab එකේ හැම භාණ්ඩයකටම පිරිවැය (එක භාණ්ඩයක් ඔබට වැය වෙන මුදල) දාන්න.**
- පිරිවැය දාලා නැති භාණ්ඩයක් විකුණුණොත්, ලාභය "—" ලෙස පෙන්වනවා. කොපමණ භාණ්ඩ ගණනකට පිරිවැය නැද්ද කියලත් කියනවා. **වැරදි ලාභයක් කවදාවත් පෙන්වන්නේ නෑ.**
- පළමු වතාවට පිරිවැය දානකොට "also use this cost for earlier sales" tick කළොත්, ඒ පිරිවැය කලින් විකුණුම් වලටත් යොදනවා. කලින් ගණන් කරපු පිරිවැයක් වෙනස් කරන්නේ නෑ.
- පස්සේ පිරිවැය වෙනස් කළත් **කලින් විකුණුම් වල ලාභය වෙනස් වෙන්නේ නෑ**. හැම විකුණුමක්ම විකුණපු දවසේ පිරිවැය මතක තියාගන්නවා.
- පිරිවැය රහසිගතයි. Customers ට හෝ වෙනත් staff ට පෙනෙන්නේ නෑ. බලන්න පුළුවන් owner සහ finance ට විතරයි. වෙනස් කරන්න පුළුවන් owner ට විතරයි.
- ලාභයට shipping ගාස්තු, PayHere ගාස්තු සහ courier වියදම් ඇතුළත් නෑ.

## 7. Renewals (Admin → Renewals)
- Supabase Pro, VPS, domain වගේ මුදල් ගෙවන service එකක් renew වෙන දිනයක් හෝ free trial එකක් ඉවර වෙන දිනයක් මෙතන දාන්න. **+ Add reminder** → නම, දිනය, Repeats (Every month / Every year / One time), "Warn me this many days before" (සාමාන්‍යයෙන් 1).
- දිනයට දවස් N කට කලින් සිට ඒ දවස දක්වා **admin එකේ හැම පිටුවකම උඩින්** තැඹිලි පාට warning එකක් පෙනෙනවා. Menu එකේ "Renewals" ළඟ ගණනකුත් පෙනෙනවා.
- Every month / Every year: දිනය පහු වුණාම ඊළඟ මාසයට / අවුරුද්දට තනියම යනවා (Supabase වගේ card එකෙන් auto ගෙවන නිසා).
- One time: දිනය පහු වුණාම, ඔබ වෙනස් කරනකම් හෝ මකනකම් රතු පාටින් **Overdue** කියලා පෙන්වනවා.
- දින ගණන් කරන්නේ ශ්‍රී ලංකා වේලාවෙන්. Owner ට විතරයි මේක පෙනෙන්නේ.
- දැනට warning එක පෙන්වන්නේ admin එකේ විතරයි. Email provider එකක් සෙට් කළාට පස්සේ (go-live checklist), email එකකුත් එවන්න හදන්න පුළුවන්.

## 8. Admin PIN (phone app code එක වෙනුවට)
- Admin → **Staff & Roles** → ඔබේ නම ළඟ **Set PIN** → අංක 4–8ක PIN එකක් දෙපාරක් ගහලා **Save PIN**. ඊට පස්සේ **Second sign-in step** එකේ **Admin PIN** තෝරලා **Save**.
- දැන් login වෙද්දී password එකට පස්සේ PIN එක අහනවා (QR / app එක ඕනේ නෑ). PIN එක check කරන්නේ database එකේ.
- වෙන කෙනෙක්ට admin එක පෙන්නන්න ඕනේ නම්: **+ Add staff** (සුදුසු role එක, උදා: Catalog Editor) → ඒ කෙනාට **Set PIN**. Owner ගේ password/PIN දෙන්න එපා.
- වැරදි PIN 5ක් ගැහුවොත් විනාඩි 15ක් lock වෙනවා. `1234`, `0000` වගේ ලේසි PIN බාර ගන්නේ නෑ. PIN එක hash කරලා විතරයි save කරන්නේ, කාටවත් ආපහු කියවන්න බෑ. Audit Log එකේ හැම PIN වෙනසක්ම, හරි/වැරදි උත්සාහයක්ම තියෙනවා.
- PIN එක එක login එකකට පැය 12ක් වලංගුයි. Logout කළොත් හෝ වෙන browser එකකින් ආවොත් ආයෙත් අහනවා.
- **Live යන්න කලින්** (card ගෙවීම් on කරන්න කලින්) **Authenticator app** එකට ආපහු මාරු කරන්න. ඒක තමයි වඩාම ආරක්ෂිත.

## 9. Poster banners (අකුරු එක්කම හදපු banner පින්තූර)
- Admin → **Promo Banners** → **+ Add Banner** → **Banner type** එකේ **Poster** තෝරන්න → **Poster picture** එකට පින්තූරය දාන්න → **Short description** (උදා: `11:11 Special Offer`) → **Opens** (උදා: `#flash`) → **Save**.
- Website එකේ globe එකට යටින් සම්පූර්ණ පළලින්, **පින්තූරය මුළුමනින්ම, එහි හැඩයෙන්ම** (කපන්නේ නෑ, ඇදෙන්නේ නෑ) පෙන්වනවා. Poster කිහිපයක් තියෙනවා නම් තත්පර 6කට වරක් මාරු වෙනවා; phone එකේ swipe කරන්නත් පුළුවන්.
- හොඳම ප්‍රමාණ: **1920 × 1080** (16:9) හෝ තුනී strip එකක් නම් **1920 × 600**. ඕනෑම හැඩයක් හරියට fit වෙනවා. වැදගත් අකුරු පින්තූරයේ කෙළවරටම දාන්න එපා.
- Upload කරද්දී පින්තූරය 1920px වෙනකම් තියාගන්නවා, ඒ නිසා අකුරු පැහැදිලියි. පොඩි පින්තූරයක් ලොකු කරන්නේ නෑ.
- පරණ විදියේ banners (website එක අකුරු ලියන ඒවා) වෙනසක් නැතුව තියෙනවා.
