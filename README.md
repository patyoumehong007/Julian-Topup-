# Julian Topup — Frontend + Backend (Vercel)

រូបរាងហាង (`index.html`) នៅដដែល។ បានបន្ថែម៖

| ផ្នែក | ឯកសារ |
|---|---|
| ហាង (Frontend) | `index.html` |
| ផ្ទាំង Admin | `admin.html` → `https://your-site.vercel.app/admin` |
| API | `api/config.js` · `api/order.js` · `api/admin.js` · `api/img.js` · `api/check-id.js` |
| ជំនួយ | `api/_lib.js` · `api/_defaults.json` (តម្លៃដើមពី index.html) |

## Deploy (ជំហាន)
1. Upload ឯកសារទាំងអស់ (រួមទាំងថត `api/`) ទៅ GitHub repo → Vercel → Add New → Project → Deploy
   (Framework Preset: **Other**, Build/Output ទទេ)។
2. **Database** (ឥតគិតថ្លៃ)៖ Vercel project → **Storage** → Create → **Upstash Redis** → Connect to Project។
   Vercel នឹងដាក់ `KV_REST_API_URL` និង `KV_REST_API_TOKEN` ឱ្យស្វ័យប្រវត្តិ។
3. **Settings → Environment Variables** បន្ថែម `ADMIN_PASSWORD` (ចាំបាច់)។
4. **Redeploy** (Deployments → ⋯ → Redeploy) ដើម្បីឱ្យ env មានប្រសិទ្ធភាព។
5. បើក `/admin` → ចូលដោយ `ADMIN_PASSWORD` → ដាក់ **Bakong Account ID** នៅ “ការកំណត់ → KHQR” ។

## របៀបដំណើរការ
- ហាងទាញ `/api/config` (ហ្គេម តម្លៃ KHQR) ។ បើ API ដាច់ ហាងប្រើតម្លៃដើមក្នុង `index.html` ដូចមុន។
- ពេលអតិថិជនចុចទិញ → `POST /api/order` : **server គណនាតម្លៃខ្លួនឯង** (មិនជឿតម្លៃពី browser) ហើយបង្កើតលេខបញ្ជាទិញ។
- Browser បង្កើត KHQR → ផ្ញើទៅ server (`PUT /api/order`) ដើម្បីពិនិត្យថា QR នោះបង់ឱ្យ **គណនីរបស់អ្នក** និង **ចំនួនត្រឹមត្រូវ** ។
- ទំព័រសួរ `GET /api/order?code=…` រាល់ ៤ វិនាទី។ បើមាន `BAKONG_TOKEN` server សួរ Bakong (`check_transaction_by_md5`) ហើយដាក់ “បានបង់” ស្វ័យប្រវត្តិ។
- បើគ្មាន `BAKONG_TOKEN` ឬ Bakong មិនឆ្លើយ៖ ក្នុង `/admin` ចុច **✓ បានបង់** ដោយដៃ → អេក្រង់អតិថិជនបង្ហាញ “បង់ប្រាក់ជោគជ័យ” ដោយស្វ័យប្រវត្តិ។
- បញ្ជាទិញ Topup ហ្គេម៖ **បញ្ចូលគ្រាប់ពេជ្រដោយដៃ** រួចចុច “បញ្ចប់” ក្នុង Admin (មិនទាន់ភ្ជាប់ API អ្នកផ្គត់ផ្គង់ហ្គេមទេ)។

## ឆែកឈ្មោះគណនីហ្គេម (Vizo)
1. Vercel → Environment Variables → បន្ថែម `VIZO_API_KEY` (key ពី Vizo) → Redeploy។ **កុំដាក់ key ក្នុង index.html**។
2. `/admin` → ហ្គេម & តម្លៃ → ប្រអប់ **Vizo game code** នៃហ្គេមនីមួយៗ (មានបញ្ជីឱ្យជ្រើសពី Vizo)។ លំនាំដើម MLBB = `mlbb`។ ហ្គេមដែលទុកទទេ ឬ Vizo មិនគាំទ្រ → បង្ហាញតែ “ទម្រង់ ID ត្រឹមត្រូវ”។
3. បើ Vizo ដាច់/key ខុស ហាងមិនគាំង — ត្រឡប់ទៅបង្ហាញតែទម្រង់ ID។

## កំណត់ចំណាំ
- **Bakong API** ត្រូវការ token ពី NBC ហើយអាចរារាំង IP ក្រៅកម្ពុជា។ បើ Vercel មិនអាចភ្ជាប់ សាក `BAKONG_API_URL` (proxy) ឬប្រើ “បានបង់” ដោយដៃ។
- **ABA PayWay** មិនទាន់ភ្ជាប់ (ត្រូវការ merchant credentials)។
- ការកែប្រែក្នុង Admin ចូលហាងក្នុងរយៈពេល ~១០ វិនាទី (cache)។
- `ADMIN_PASSWORD` ត្រូវតែវែង និងមិនធ្លាប់ប្រើនៅកន្លែងផ្សេង។

## Admin ថ្មី (v2)
- `admin.html` ជាការរចនាថ្មី (សង្ខេប · បញ្ជាទិញ · ផលិតផល · គណនី · រូបភាព · ការកំណត់) ភ្ជាប់ `/api/admin` ដូចមុន — ចូលដោយ `ADMIN_PASSWORD`។
- រូបភាពដែល upload ត្រូវបានរក្សាទុកក្នុង Redis ស្វ័យប្រវត្តិ (`/api/img`)។
- ហាងបច្ចុប្បន្នប្រើ៖ ហ្គេម តម្លៃ គណនី KHQR Telegram Logo (Topup) Banner (រូបទី ១) វិធីបង់។
- ទិន្នន័យថ្មីៗ (Logo ទិញគណនី, ពណ៌ accent, អត្ថបទ, Banner ច្រើន) រក្សាទុក និងផ្តល់ក្នុង `/api/config` ក្រោម `extra` — ត្រូវឱ្យ `index.html` អានវា ទើបបង្ហាញលើហាង។

## Telegram (ពេលបង់ប្រាក់រួច)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (Group) ➜ ផ្ញើ “ការបញ្ជាទិញជោគជ័យ 💎✅” (User ID, Server ID, itemCode, Game, Item, Amount, Order ID)។
- `TELEGRAM_CHANNEL_ID` (Channel, ជាជម្រើស) ➜ ផ្ញើ “🧾 វិក័យបត្រ / Invoice” សម្រាប់ Admin មើល។ បើមិនដាក់ Channel វិក័យបត្រចូល Group តែម្តង។
- ផ្ញើតែម្តងគត់ ពេលស្ថានភាពប្តូរទៅ “បានបង់” (Bakong ស្វ័យប្រវត្តិ ឬ Admin ចុច ✓)។ មិនផ្ញើពេលទើបចុចទិញទេ។
