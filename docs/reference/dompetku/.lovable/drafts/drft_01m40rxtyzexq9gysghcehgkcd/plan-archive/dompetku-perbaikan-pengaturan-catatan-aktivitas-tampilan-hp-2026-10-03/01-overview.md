# Dompetku: perbaikan Pengaturan, catatan aktivitas, tampilan HP, kecepatan, Emas, Piutang, Tarik tunai

Tujuh pekerjaan dalam satu rangkaian. Semua teks baru memakai t() dan masuk kamus ID/EN. Semua akses data tetap lewat server.

1. **Pengaturan tidak crash lagi** — kalau tabel catatan aktivitas belum ada, halaman tetap tampil dengan daftar kosong dan pencatatan diabaikan tanpa error. Skema mendapat bagian "v3" yang aman dijalankan ulang.
2. **Catatan aktivitas lengkap** — setiap tambah/ubah/hapus di semua modul, bayar/batal cicilan, tandai langganan dibayar, impor CSV, unduh cadangan, login berhasil/gagal, dan logout. Pengaturan menampilkan label yang mudah dibaca, misalnya "Transaksi ditambahkan · Kopi · Rp 25.000".
3. **Tampilan HP & PWA** — tidak ada geser ke samping di halaman mana pun. Tabel jadi kartu di HP, judul halaman turun ke baris baru, dialog muat di layar, grafik menyesuaikan lebar, dan ada jarak aman untuk notch/home bar. Dicek otomatis di ukuran 390x844 pada setiap halaman.
4. **Lebih cepat** — query server dijalankan bersamaan, kolom yang diambil seperlunya, cache di sisi browser, data halaman dimuat duluan saat kursor/jari mengarah ke menu, dan setelah simpan hanya data yang terkait yang dimuat ulang. Kurs dan harga emas disimpan per hari.
5. **Tabungan Emas (/gold)** — catat pembelian dan penjualan. Halamannya menampilkan total gram, modal, rata-rata harga beli, serta nilai sekarang dan untung/rugi menurut dua harga acuan: harga dunia (XAU→IDR/gram) dan Antam/Pegadaian (jual & buyback). Nilai emas ikut dihitung dalam kekayaan bersih di dashboard.
6. **Piutang (/receivables)** — catat uang yang dipinjam kerabat, terima cicilan pembayaran, lihat sisanya, dan tandai lunas. Bisa dihubungkan ke akun supaya saldo akun ikut berubah.
7. **Tarik tunai** — tombol cepat di halaman Transaksi yang langsung mengisi form transfer ke akun tunai. Bot juga mengerti perintah seperti "tarik tunai 500rb".
