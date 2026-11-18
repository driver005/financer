# Rencana audit responsif, data besar, dan fitur emas

## Hasil yang akan dibangun

- Merapikan seluruh halaman untuk ponsel, tablet, desktop sempit, dan desktop penuh tanpa halaman bergeser horizontal. Fokus pertama pada Dashboard, Langganan, Pengingat, header mobile, lalu pola serupa di semua halaman.
- Membuat header mobile tetap satu baris dengan kontrol bahasa, tema, dan keluar berukuran stabil; sidebar desktop tetap terlihat sepanjang halaman saat konten digulir.
- Mengubah modal tambah/ubah agar judul dan tombol tutup tetap di atas, tombol Batal/Simpan tetap di bawah, dan hanya isi modal yang bergulir.
- Mengaudit semua daftar: widget ringkas tetap ringkas; koleksi yang dapat terus membesar memakai pagination server-side. Kontrol urut naik/turun hanya ditambahkan pada kolom data yang bermakna, bukan kolom aksi.
- Menampilkan data tabel secara aman di layar kecil melalui daftar/kartu mobile atau area tabel yang dikendalikan, tanpa membuat halaman ikut melebar.
- Menambah `tipe emas` dan `nomor produk/nomor emas` yang opsional pada pencatatan emas, tampilan, validasi, cadangan, dan catatan aktivitas.
- Melengkapi teks baru dalam Bahasa Indonesia dan Inggris, metadata setiap halaman, aksesibilitas kontrol, mode gelap, dan dialog konfirmasi bawaan aplikasi.

## Batas cakupan

Tidak ada fitur baru di luar 12 permintaan. Ringkasan Dashboard tidak diberi pagination karena memang hanya menampilkan cuplikan. Data referensi kecil seperti kategori tetap dimuat utuh untuk pilihan formulir; daftar riwayat yang dapat tumbuh akan dipaginasi dari server.

## Catatan draft

Perubahan database akan disiapkan secara aman dan idempotent. Karena ini draft terpisah, kolom dan indeks baru baru diterapkan ke database saat draft diterima; sampai saat itu kode tetap menangani database lama tanpa membuat halaman gagal.
