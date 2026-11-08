# Source Connect — අයිතිකරුට සරල උපදෙස් (සිංහල)

මේ guide එක කියවන්න technical දැනුමක් ඕන නෑ. ⚙️ ලකුණ තියෙන කොටස් technical කෙනෙක් (developer / IT උදව්කරු) එක්ක එකට කරන්න.

---

## 1. දැන් system එක හැදිලා තියෙන්නේ කොහොමද?

| කොටස | මොකද කරන්නේ | කොහෙද තියෙන්නේ |
|---|---|---|
| **Website** | Customers ලා products බලනවා, order කරනවා | Cloudflare Pages (දැනට GitHub Pages එකේ පරණ demo එක) |
| **Admin Panel** (`/admin/`) | ඔයාලගේ staff ලා products, stock, orders, banners වෙනස් කරනවා | Website එකේම `/admin/` |
| **Server (API)** | මිල, stock, ගෙවීම්, permissions තීරණය කරන ආරක්ෂිත program එක | VPS එකේ |
| **Database (PostgreSQL)** | Products, orders, customers, payments, staff ඔක්කොම save වෙන තැන | VPS එකේ |
| **Backups** | Database එක සහ product photos වෙනම private cloud storage එකකට (Cloudflare R2) encrypt කරලා යවනවා | R2 (VPS එකෙන් පිට) |
| **PayHere** | Card payments | PayHere |

**වැදගත්ම වෙනස:** කලින් හැම දෙයක්ම save වුණේ browser එකේ (localStorage). දැන් **database එකේ**. ඒ නිසා:

- Admin එකෙන් මිලක් වෙනස් කළොත් **හැම customer කෙනෙක්ගේම phone එකේ** ඒක පේනවා.
- Customer කෙනෙක් order කළොත් ඒක **ඔයාගේ Admin එකට** එනවා.

---

## 2. පළමු වතාවට Admin එකට ලොග් වෙන හැටි

1. ⚙️ Developer server එකේ owner account එක හදනවා (`create-owner` command එකෙන්).
   - Password එක **ඔයාම** type කරන්න. අකුරු 12කට වඩා දිග වෙන්න ඕන.
   - Username එකේ කොටසක් password එකේ තියෙන්න බෑ.
2. `https://<ඔයාගේ domain>/admin/` එකට ගිහින් ඒ username / password එකෙන් log වෙන්න.
3. **`admin / admin123` දැන් වැඩ කරන්නේ නෑ.** ඒක හිතාමතාම අයින් කළා.
4. වැරදි password එකක් 5 පාරක් ගැහුවොත් account එක විනාඩි 15කට lock වෙනවා. Owner ට **Staff & Roles** එකෙන් unlock කරන්න පුළුවන්.

### Staff කෙනෙක් එකතු කරන හැටි

1. **Staff & Roles → + Add staff** යන්න.
2. Username, නම සහ තාවකාලික password එකක් (අකුරු 12+) දාන්න.
3. Role එකක් තෝරන්න:
   - **Catalog Editor**: products, stock, website වෙනස් කරන්න.
   - **Fulfillment**: orders pack කරන්න, ship කරන්න.
   - **Finance**: bank transfer තහවුරු කරන්න, COD මුදල් ලැබුණා කියන්න, refund.
   - **Customer Support**: orders බලන්න විතරයි.
   - **Department Staff**: තමන්ගේ department එකේ (උදා: Shoes) products විතරයි. Departments කොටුවෙන් තෝරන්න.
4. Staff කෙනා පළමු වතාවට log වුණාම තමන්ගේම password එකක් දාන්න ඕන.
5. කෙනෙක් රැකියාවෙන් ගියොත් **Status → Disabled** කරන්න. එයාගේ හැම device එකකම login එක ඒ වෙලාවෙම නවතිනවා.

---

## 3. Products එකතු කරන / වෙනස් කරන හැටි

1. **Products → + Add Product** යන්න.
2. නම, category එක, මිල (Rs.) සහ "Original price" (discount පෙන්වන්න නම්) දාන්න.
3. **Sizes** කොමා වලින් වෙන් කරලා දාන්න (උදා: `S, M, L, XL`). Bags / watches වගේ දේවල් වලට හිස්ව තියන්න.
4. **Photos:** "Upload" එකෙන් photos 8ක් දක්වා දාන්න. ඒවා server එකට upload වෙනවා, browser එකේ save වෙන්නේ නෑ.
5. **Stock:** product එක save කළාට පස්සේ ආයෙත් open කළාම **"Stock per size"** පෙට්ටි පේනවා. හැම size එකකටම තියෙන ගණන දාන්න.
   - "reserved" කියන්නේ තාම ගෙවලා නැති orders වලට තියාගෙන ඉන්න ගණන. ඒකට වඩා අඩු කරන්න බෑ.
   - හැම stock වෙනසක්ම (කවුද, කවදාද, ඇයි) history එකේ save වෙනවා.
6. **Rating / reviews / "sold" ගණන් දැන් type කරන්න බෑ.** ඒවා ඇත්ත විකුණුම් වලින් විතරයි එන්නේ (බොරු ratings නැති වෙන්න).
7. **Delete කළොත්** product එක website එකෙන් අයින් වෙනවා. පරණ orders වල විස්තර නැති නොවෙන්න database එකේ "archive" වෙලා තියෙනවා.
8. Save කළාම උඩින් **"Saving…"** පේනවා, ඊට පස්සේ **"✓ Saved"**. **"Not saved: …"** ආවොත් ඒ message එක කියවන්න (උදා: මිල 0 වෙන්න බෑ).

---

## 4. Orders බලන / කළමනාකරණය කරන හැටි

**Orders** menu එකේ tabs තියෙනවා: Waiting for card payment, Waiting for bank transfer, Confirmed, Packing, Shipped… ඕන order එකක් click කළාම මේ දේවල් පේනවා:

- Customer ගේ නම, phone, WhatsApp link එක සහ ලිපිනය.
- Items, එකතුව සහ payment status එක.
- **Timeline** එක (කවුද මොනවද කළේ).
- PayHere notifications.

### ගෙවීම් ක්‍රම තුනම වෙනස් විදිහට වැඩ කරනවා

| ගෙවීම | Order එක ආවාම | ඔයා කරන්න ඕන දේ |
|---|---|---|
| **Card (PayHere)** | "Waiting for card payment" | කිසිම දෙයක් නෑ. **PayHere server එකෙන් ආරක්ෂිතව notification එක ආවාම විතරයි** "Paid" වෙන්නේ. Customer "payment success" page එකට ආවා කියලා paid වෙන්නේ නෑ. විනාඩි 30ක් ඇතුළත ගෙව්වේ නැත්නම් stock එක ආපහු නිදහස් වෙනවා |
| **Bank transfer** | "Waiting for bank transfer" (stock පැය 48ක් තියාගන්නවා) | Finance කෙනා **bank account එකම** (online banking) බලලා මුදල් ආවාද කියලා check කරන්න ඕන. ඊට පස්සේ **"Confirm bank transfer received"** click කරලා bank reference එක දාන්න. Customer එවන screenshot එකක් පමණක් බලලා confirm කරන්න එපා |
| **Cash on Delivery** | "Confirmed" (stock අඩු වෙලා) | Courier මුදල් භාර දුන්නාම **"Cash collected"** click කරන්න. ඒ වෙනකම් "COD – not collected" කියලා පේනවා |

- **Ship කරන්න:** "Mark as: Packing" → "Mark as: Shipped" ඔබන්න. Courier නම සහ tracking number "Add / update shipment" එකෙන් දාන්න. Customer ට ඒක tracking page එකේ පේනවා.
- **Cancel / Refund:**
  - ගෙවලා නැති order එකක් ඕනෑම කෙනෙක්ට (orders.update තියෙන) cancel කරන්න පුළුවන්. Stock එක ආපහු එනවා.
  - **ගෙවපු** order එකකට refund එකක් **Finance / Owner** ට විතරයි record කරන්න පුළුවන්.
  - Refund එක record කරනවා කියන්නේ මුදල් යවනවා කියන එක නෙවෙයි. ඇත්ත refund එක PayHere portal එකෙන් හෝ bank එකෙන් වෙනම කරන්න.
- **"⚠ Needs review"** කියලා orders පේනවා නම්, උදාහරණ: hold කාලය ඉවර වෙලා ගෙව්වා සහ stock නැති වුණා, නැත්නම් chargeback එකක් ආවා. මේවා Finance බලලා විසඳලා **"Mark review as resolved"** කරන්න.

---

## 5. PayHere Sandbox (test) එක check කරන හැටි ⚙️

1. sandbox.payhere.lk එකේ sandbox merchant account එකක් හදන්න.
2. ඔයාගේ domain එක එතන add කරලා **Merchant ID** සහ **Merchant Secret** ගන්න. මේ දෙක **chat එකේ, WhatsApp එකේ, GitHub එකේ හෝ screenshot වල දාන්න එපා.** Developer ට server එකේ `api.env` file එකට කෙලින්ම දාන්න කියන්න.
3. Admin → **Store Settings** → "Card payment (PayHere) at checkout" on කරලා Save කරන්න.
4. Website එකේ order එකක් දාලා Card තෝරන්න. PayHere sandbox page එකට යනවා. PayHere දීලා තියෙන **test card** එකකින් ගෙවන්න.
5. Website එකේ order page එක මුලින් "Waiting for PayHere" පෙන්නලා, තත්පර කීපයකින් **"Payment received"** වෙන්න ඕන.
6. Admin → ඒ order එක → **PayHere notifications** යටතේ `applied:paid` පේන්න ඕන.
7. **Live (ඇත්ත සල්ලි) payments on කරන්නේ ඔයා ලිඛිතව අනුමත කළාට පස්සේ විතරයි.** Server එක `PAYHERE_LIVE_APPROVED=true` නැතුව live mode එකේ start වෙන්නේ නෑ.

---

## 6. Backups — දවස ගානේ බලන්න ඕන දේ

- Admin → **Backups** යන්න. උඩ ✓ (කොළ) පේනවා නම් හොඳයි. **!** පේනවා නම් developer ට කියන්න.
- **Dashboard** එකේ "⚠ Backups: …" කියලා warning එකක් ආවොත් ඒ දවසෙම බලන්න.
- ඔයාගේ phone එකට alerts එන්නේ ⚙️ developer ntfy app එක හෝ email එක set කළාට පස්සේ:
  - backup fail වුණාම,
  - server එකේ disk එක පිරෙනකොට,
  - API එක down වුණාම,
  - PayHere notifications reject වෙනකොට.
- **Backup encryption passphrase** එක (දිග password එකක්) ඔයාගේ password manager එකේ සහ කඩදාසියක ලියලා **ආරක්ෂිත තැනක** තියාගන්න. ඒක නැති වුණොත් backups කාටවත් කියවන්න බෑ, අපිටත් බෑ.

### Backup ගැන වැදගත් සත්‍ය

- **Backup** කියන්නේ data ආපහු ගන්න ක්‍රමය. **දෙවැනි server** (standby) කියන්නේ service එක නොනැවතී තියාගන්න ක්‍රමය. දැනට දෙවැනි VPS එකක් ගන්න ඕන නෑ.
- Backups යන්නේ VPS එකෙන් **පිට** R2 එකට. VPS එක සම්පූර්ණයෙන් නැති වුණත් data ආරක්ෂිතයි.
- Test එකේදී server එක සම්පූර්ණයෙන් මකලා ආපහු restore කළා. නැති වුණේ **අන්තිම තත්පර 70ක orders විතරයි.** Production එකේ ඒ කාලය විනාඩි 5කට වඩා අඩුයි (ඉලක්කය විනාඩි 15).

### Staging server එකකට restore කරලා බලන හැටි (මාසයකට වරක්) ⚙️

1. Developer වෙනම test machine එකක `infra/backup/drill/run-local-drill.sh` run කරනවා. නැත්නම් staging server එකේ `sc-restore-test.sh` run කරනවා.
2. ප්‍රතිඵලයේ products, orders සහ payments ගණන් හරියට ආවාද බලන්න (`PASS`).
3. **Live database එක උඩින් restore කරන්න එපා**, ඔයාගේ ලිඛිත අනුමැතියක් නැතුව.

---

## 7. Launch කරන්න කලින් (Go-live) ⚙️ + ඔයා

Admin Dashboard එකේ **"Before you go live"** list එක ඔක්කොම ✓ වෙන්න ඕන. මේ දේවල් **ඔයාට** විතරයි කරන්න පුළුවන්:

1. **VPS එක මිලදී ගැනීම:** PXN offer එක (LKR 1,100 / දින 50) **තහවුරු නැති** offer එකක්. `docs/budget-and-capacity.md` §3 checklist එක බලලා තීරණය කරන්න.
2. **Cloudflare account** එක:
   - DNS සහ Pages.
   - R2 private buckets 2 (`source-connect-db-backups`, `source-connect-image-backups`).
   - ඒ bucket 2ට විතරක් වැඩ කරන API key එකක්.
3. **Domain** එක.
4. **PayHere live merchant account** එක සහ domain approval එක.
5. ඇත්ත phone / WhatsApp / bank details, ඇත්ත product photos සහ මිල ගණන්. Demo products හංගන්න (Store Settings → "Hide all demo products").
6. Privacy policy සහ refund policy page.
7. Alert එකක් ඔයාගේ phone එකට ඇත්තටම එනවාද කියලා test කරන්න.
8. **Production release එකට ඔයාගේ ලිඛිත අනුමැතිය** (`docs/release-checklist.md`).

### ප්‍රශ්නයක් ආවොත් ආපහු යන හැටි (Rollback)

- අලුත් version එක වැරදියි නම් developer `deploy.sh rollback` run කරනවා. තත්පර කීපයයි, data නැති වෙන්නේ නෑ.
- Card payments වල ප්‍රශ්නයක් නම් Admin → Store Settings → Card payment **off** කරන්න. COD සහ bank transfer දිගටම වැඩ කරනවා.

---

## 8. කෙටියෙන්: මොනවද කළේ, මොනවද ඉතුරු?

**කළා සහ test කළා:**

- Database සහ server API.
- ආරක්ෂිත staff login සහ roles.
- Server-side මිල සහ stock. එකම අන්තිම item එකට buyers 8 දෙනෙක් එකවර order කළත් එක්කෙනෙකුට විතරයි ලැබෙන්නේ.
- PayHere sandbox: බොරු / ද්විත්ව notifications වලින් ආරක්ෂිතයි.
- COD සහ bank transfer වෙනම ක්‍රම.
- Customer accounts සහ guest checkout.
- Website එකේ පෙනුම වෙනස් නොකර database එකට සම්බන්ධ කළා.
- Backups, point-in-time restore සහ tamper detection test.
- Load test එක: 2 CPU වල තත්පරයකට orders ~240ක්.

**ඔයාගේ අනුමැතිය / accounts ඕන දේ:**

- VPS, Cloudflare R2, domain සහ PayHere live.
- Email provider එක: verification සහ password reset emails යවන්න.
- Alerts set කිරීම.
- ඇත්ත VPS එකේ load test එක සහ restore drill එක.
