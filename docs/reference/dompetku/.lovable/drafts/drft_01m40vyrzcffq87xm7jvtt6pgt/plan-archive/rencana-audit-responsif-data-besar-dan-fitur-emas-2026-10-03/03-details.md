## Rincian teknis

### 1. Fondasi tampilan
- Perbaiki `AppShell` dan `PageHeader` dengan grid dua kolom yang aman pada layar kecil, kontrol `shrink-0`, serta area teks `min-w-0`.
- Jadikan sidebar desktop menempel pada viewport dan biarkan hanya konten utama yang memanjang secara normal.
- Terapkan pola baris responsif bersama pada kartu/list, termasuk nominal, badge, ikon, dan tombol aksi.
- Audit Dashboard, Transaksi, Akun, Hutang, Langganan, Budget, Target, Emas, Piutang, Pengingat, Laporan, Rekap, dan Pengaturan.

### 2. Modal
- Susun `EntityDialog` sebagai panel tinggi-terbatas: header tetap, isi form bergulir, footer tetap.
- Karena `TransactionDialog` dan seluruh CRUD memakai fondasi ini, perilaku akan konsisten di semua halaman.
- Pertahankan fokus keyboard, label aksesibel, tombol tutup, dan safe area ponsel.

### 3. Pagination, sorting, dan indeks
- Pertahankan transaksi sebagai query server-side, lalu tambahkan parameter urutan yang divalidasi dan indikator sort aksesibel.
- Tambahkan query berhalaman untuk riwayat emas dan koleksi/riwayat lain yang dapat tumbuh besar; widget Dashboard tetap dibatasi dari server dan tidak mendapat pager.
- Daftar referensi yang memang kecil dan diperlukan formulir—akun, kategori, budget, target, dan langganan aktif—tetap utuh agar UX tidak rusak.
- Periksa agregasi besar agar tidak diam-diam terpotong; gunakan query agregat/rentang yang sesuai pola server project.
- Tambahkan indeks gabungan yang benar-benar mendukung filter/sort yang dipakai, terutama transaksi berdasarkan tanggal/jenis/akun/kategori serta emas berdasarkan tanggal. Hindari indeks duplikat.

### 4. Emas dan kompatibilitas database lama
- Tambahkan dua kolom teks opsional: tipe emas dan nomor produk/nomor emas.
- Hubungkan ke validasi, tipe data, dialog CRUD, daftar emas, cadangan, dan detail catatan aktivitas.
- Perbarui schema utama serta siapkan migrasi tambahan yang aman untuk diterapkan saat draft diterima.
- Jika database belum memiliki kolom baru, operasi baca/tulis emas tetap turun dengan aman memakai pola fallback kolom opsional.

### 5. Bahasa, metadata, dan verifikasi
- Semua teks baru melewati `t(...)` dan kamus ID/EN dilengkapi.
- Lengkapi metadata halaman dengan judul/deskripsi unik, Open Graph, `og:type`, dan `twitter:card`; endpoint API tidak diperlakukan sebagai halaman konten.
- Tambahkan tes untuk validasi sort/pagination, fallback kolom emas, dan struktur modal.
- Jalankan tes yang relevan lalu gunakan hasil build otomatis dan log observability.
- Verifikasi visual dengan Playwright pada 390×844, tablet/desktop sempit, dan 1280×1800; periksa screenshot dan ukuran dokumen untuk overflow/overlap. Alur database hanya diklaim teruji bila environment tersedia.
- Setelah selesai, perbarui roadmap dan aturan arsitektur hanya bila keputusan struktural baru memang diperkenalkan.
