# Dompetku — 6 peningkatan

Arsitektur inti tetap: akses DB hanya lewat server (service role), n8n pakai `x-api-key`, input manual tetap ada, UI Bahasa Indonesia, desain dan font tidak berubah.

## 1. Halaman Laporan baru (`/reports`)
- Menu baru "Laporan" di sidebar.
- **Tren per kategori**: grafik area/garis pengeluaran per bulan, pilih rentang 6 atau 12 bulan, pemilih kategori (multi-pilih, bawaan: 5 kategori terbesar).
- **Rekap tahunan**: pemilih tahun, kartu Total Masuk / Total Keluar / Selisih / Rata-rata bulanan, dan tabel 12 bulan (masuk, keluar, selisih), plus ekspor CSV.

## 2. Pengingat lewat email
- Endpoint baru `GET /api/public/n8n/reminders/email?days=7` → `{ count, subject, text, html }` siap dipakai node Email n8n.
- Opsional kirim langsung: `POST /api/public/n8n/reminders/send-email` via API Resend (pakai fetch, tanpa library berat) bila env `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TO` diisi; jika tidak, membalas pesan jelas bahwa belum dikonfigurasi.

## 3. Impor CSV (di Pengaturan)
- Unggah CSV (kolom: tanggal, jenis, jumlah, kategori, akun, catatan, mata uang; menerima pemisah `,` atau `;`, jenis "masuk/keluar/income/expense").
- Pratinjau tabel dengan status per baris (valid / error + alasan).
- Daftar kategori & akun baru yang belum ada → kotak centang konfirmasi "buat baru".
- Simpan hanya baris valid; USD dikonversi dengan kurs harian seperti biasa; sumber dicatat `import`.

## 4. Foto nota di transaksi
- Kolom baru `receipt_path` di tabel transaksi.
- Form transaksi: tombol unggah foto (maks 5 MB, gambar). Scan nota otomatis ikut melampirkan fotonya.
- Daftar transaksi: ikon klip bila ada foto; klik membuka pratinjau foto (tautan sementara bertanda tangan, bucket privat).
- Hapus transaksi ikut menghapus fotonya.

## 5. Mode gelap
- Tombol matahari/bulan di header & sidebar. Bawaan mengikuti pengaturan perangkat, pilihan disimpan di browser, tanpa kedip saat memuat.
- Lengkapi token warna gelap (pemasukan, pengeluaran, grafik, sidebar) dan periksa semua halaman.

## Detail teknis
- `finance.server.ts`: `categoryTrend(months, categoryIds)`, `yearlySummary(year)`, `importTransactions(rows, createMissing)`, `reminderEmail(days)`; server fn di `finance.functions.ts` dengan `requireAuth` + zod.
- Storage: `storage.server.ts` memakai `db().storage.from('receipts')` — upload (base64 dari server fn), `createSignedUrl` 10 menit, hapus.
- `supabase/schema.sql`: `alter table transactions add column if not exists receipt_path text;` + `insert into storage.buckets (id,name,public) values ('receipts','receipts',false) on conflict do nothing;` serta instruksi membuat bucket lewat dashboard. Karena Supabase milik Anda sendiri, Anda perlu menjalankan potongan SQL ini lagi.
- Tema: skrip inline kecil di `__root.tsx` sebelum render untuk set class `dark`; hook `useTheme`.
- Parsing CSV tanpa library (parser kecil mendukung tanda kutip).
- Tes: unit test parser CSV & pembuat email; jalankan `tsgo --noEmit` dan `vitest run`.
- Update `docs/SETUP.md` (endpoint email, impor CSV, bucket) dan `.env.example` (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TO`); catat aturan di `AGENTS.md`.
