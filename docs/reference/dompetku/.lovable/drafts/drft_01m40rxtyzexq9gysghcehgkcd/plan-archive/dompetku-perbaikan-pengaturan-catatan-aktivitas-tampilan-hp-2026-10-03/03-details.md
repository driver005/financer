## Yang perlu Anda lakukan

Jalankan sekali bagian baru "v3" di `supabase/schema.sql` lewat SQL Editor Supabase. Bagian ini membuat tabel aktivitas, emas, harga emas, dan piutang. Aman dijalankan ulang. Selama belum dijalankan, aplikasi tetap terbuka dan halaman baru hanya menampilkan pesan "jalankan skema".

## Detail teknis

- **Schema v3** (idempotent): `activity_log`, `gold_purchases` (kind buy/sell, date, grams, price_per_gram, total, place, notes), `gold_prices` (price_date, source `world`/`antam`, buy, buyback, primary key (date, source)), `receivables`, dan `receivable_payments` (amount, paid_at, account_id, transaction_id). Semuanya masuk loop grants/RLS untuk service_role saja. View `account_balances` tidak diubah: pinjaman keluar dan pembayaran masuk dicatat sebagai transaksi expense/income dengan kategori "Piutang".
- **Tahan tabel hilang**: helper `isMissingTable(err)` (PGRST205 / "Could not find the table"). Bila terdeteksi, `listActivity` mengembalikan `[]` dan `logActivity` tidak melakukan apa-apa. Fungsi baca emas dan piutang mengembalikan `{ ready:false }`.
- **Aktivitas**: `logActivity(action, entity, detail)` dipanggil di `saveRow`/`deleteRow` (generik untuk semua tabel CRUD), payDebt/undo, paySubscription, emas, piutang, import, backup, serta login ok/gagal dan logout di `auth.functions`. Label dibuat di `src/lib/activity.ts` (`activityLabel(action, t)`), murni dan teruji.
- **Harga emas** di `gold.server.ts`:
  - Dunia: XAU dari API gratis (mis. `api.gold-api.com/price/XAU`) × kurs USD/IDR ÷ 31,1035.
  - Antam: scrape halaman publik (logammulia/pegadaian). Kalau gagal, pakai harga cache terakhir. Kalau cache kosong, pakai dunia × faktor premi.
  - Cache satu baris per hari per sumber.
  - `netWorthSeries` ditambah nilai emas bersih (gram tersisa × harga dunia).
- **Bot**: `classifyBotCommand` mengenali `tarik tunai <nominal> [dari <akun>]`, lalu membuat transfer ke akun type `cash` pertama (dibuat otomatis jika belum ada). Ada tes unit.
- **Mobile**:
  - Shell: `overflow-x-hidden` dan `min-w-0` di main.
  - Kelas `pb-[env(safe-area-inset-bottom)]` dan `viewport-fit=cover`.
  - PageHeader `flex-wrap`.
  - Daftar tabel diganti kartu di bawah `sm`, dialog `max-h-[90dvh] overflow-y-auto`.
  - Skrip Playwright mengecek semua rute (stub login via cookie tes) untuk `scrollWidth <= clientWidth`.
- **Performa**:
  - Router `defaultPreload: "intent"`, QueryClient `staleTime: 60s`.
  - `useCrud` hanya meng-invalidate key yang terkait dengan tabel (peta tabel→keys).
  - `Promise.all` di dashboard/rekap/netWorth, `select` kolom eksplisit.
  - Kurs dan harga emas `staleTime` 1 jam.
- **Navigasi**: menu Emas dan Piutang ditambahkan. Dokumen yang diperbarui: SETUP.md, AGENTS.md (aturan cache harga dan tahan tabel hilang), roadmap.md, dan kamus i18n.
- **Verifikasi**: typecheck, vitest (tes baru untuk label aktivitas, bot tarik tunai, kalkulasi emas/piutang, fallback tabel hilang), dan Playwright 390x844.
