# Roadmap
- [x] Login via env (APP_USERNAME / APP_PASSWORD), cookie session
- [x] Supabase schema SQL (accounts, categories, transactions, debts, subscriptions, budgets, goals, fx)
- [x] Manual input pemasukan/pengeluaran/transfer via web (tambah, edit, hapus)
- [x] Dashboard + pengingat bulanan
- [x] Hutang/paylater/cicilan, langganan IDR/USD (kurs otomatis)
- [x] Budget, multi akun, target tabungan, ekspor laporan
- [x] OCR nota (web + endpoint n8n), endpoint n8n untuk bot Telegram/WhatsApp & pengingat
- [x] Siap hosting Vercel + dokumentasi env
- [x] Grafik tren pengeluaran per kategori (6 bulan) di dashboard
- [x] Rekap tahunan (total, selisih, rata-rata bulanan) di /rekap
- [x] Notifikasi email pengingat via n8n (?format=email di endpoint reminders)
- [x] Impor CSV transaksi (format hasil ekspor) di halaman Transaksi
- [x] Lampiran foto nota per transaksi (Supabase Storage bucket "receipts")
- [x] Mode gelap/terang (tombol di sidebar & header mobile)
- [x] Grafik kekayaan bersih (net worth) di dashboard
- [x] Perintah bot n8n langsung (saldo, ringkasan, bayar) via /api/public/n8n/command
- [x] Filter, pencarian, dan paginasi halaman Transaksi
- [x] PWA (manifest + ikon + tema)
- [x] Cetak PDF Rekap Tahunan
- [x] Deteksi duplikat saat impor CSV
- [x] Cadangan data (JSON + CSV) di Pengaturan
- [x] Catatan aktivitas terbaru di Pengaturan
- [x] Sakelar bahasa Indonesia/Inggris di sidebar & header
- [x] Pengaturan tahan tabel activity_log belum ada
- [x] Catatan aktivitas lengkap (CRUD, bayar, impor, cadangan, login/logout) + label ID/EN
- [x] Responsif mobile & PWA (tanpa scroll horizontal, safe-area)
- [x] Performa: cache query, preload intent, invalidasi terarah, query paralel
- [x] Tabungan Emas (/gold) dengan harga dunia & Antam
- [x] Piutang (/receivables) dengan pembayaran bertahap
- [x] Tarik tunai ATM (tombol + bot)

## v4
- [x] Dashboard: kartu Aset & Investasi, komposisi aset, harga emas hari ini, biaya admin bulan ini
- [x] Biaya transfer/top-up: kolom biaya opsional + preset per akun (transfer & top-up)
- [x] Biaya bulanan rekening otomatis per akun + pengingat
- [x] Langganan: pajak opsional (%), total = harga + pajak

## v5
- [x] Audit responsif semua halaman, header mobile, sidebar tetap, dan modal CRUD dengan header/footer tetap
- [x] Pagination server-side serta sorting untuk riwayat besar; sorting tabel laporan dan pratinjau CSV
- [x] Metadata opsional tipe emas dan nomor produk dengan fallback database lama
- [x] Indeks query transaksi, langganan, emas, dan piutang
- [x] Cache baca terarah dan activity log opsional tidak lagi memblokir halaman Pengaturan

## v7 — Bot Telegram
- [x] Endpoint tunggal `/api/public/n8n/bot` (chat, foto nota, tombol inline)
- [x] Pratinjau + tombol ✅ Simpan / ❌ Batal / 🏷 Kategori / 🏦 Akun / 🔁 Masuk-Keluar, lalu ↩️ Undo
- [x] Parser chat tanpa AI + tebakan kategori dari kata kunci & riwayat
- [x] Idempotensi `external_id` dan tabel `bot_drafts`
- [x] Laporan harian/mingguan/bulanan (`/report`, `/hariini`, `/minggu`, `/bulan`), daftar pemasukan/pengeluaran, paylater, langganan, budget, piutang
- [x] Fix: AI tidak lagi membuat kategori "Nama (expense)"; akun default bot; batas ukuran gambar sesuai limit Vercel
