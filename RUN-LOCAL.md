# Menjalankan Aplikasi Secara Lokal (XAMPP / macOS)

Branch `fitur/mode-simulasi-waktu`. Untuk demo ke staf non-shift, cara
ini tidak butuh deploy ke mana-mana — cukup laptop + XAMPP.

## 1. Syarat

- XAMPP for macOS (Apache + MySQL), atau PHP CLI + MySQL yang sudah jalan.
- Repo ini sudah di-checkout di branch `fitur/mode-simulasi-waktu`.

## 2. Salin aplikasi ke htdocs

```bash
cp -r absensi_qr-new /Applications/XAMPP/xamppfiles/htdocs/absensi_qr
# atau symlink supaya edit di repo langsung kebaca:
ln -s "$PWD/absensi_qr-new" /Applications/XAMPP/xamppfiles/htdocs/absensi_qr
```

## 3. Buat database lokal

1. Jalankan Apache + MySQL dari XAMPP Manager.
2. Buka phpMyAdmin (`http://localhost/phpmyadmin`), buat database
   **`absensi_qr`** (collation `utf8mb4_general_ci`).
3. Import `database.sql` — tapi ubah dulu baris `USE`-nya, karena file
   itu memakai nama database hosting:

   ```bash
   sed 's/^USE .*;/USE absensi_qr;/' database.sql > /tmp/database-local.sql
   ```

   lalu import `/tmp/database-local.sql` lewat phpMyAdmin (tab Import),
   atau lewat terminal:

   ```bash
   /Applications/XAMPP/bin/mysql -u root absensi_qr < /tmp/database-local.sql
   ```

## 4. Konfigurasi database lokal

```bash
cp config.local.example.php config.local.php
```

Isinya sudah benar untuk XAMPP standar (`127.0.0.1`, `root`, password
kosong, database `absensi_qr`). File `config.local.php` tidak ikut
commit (ada di `.gitignore`), jadi tidak ada kredensial yang masuk ke
repo — `config.php` tidak lagi berisi kredensial apa pun.

## 5. Buka aplikasi

```
http://localhost/absensi_qr
```

Login seed lokal: **admin / admin123** (dari `database.sql`).
Perhatian: password ini hanya berlaku untuk database lokal — password
akun admin di situs live (arez.freedev.app) berbeda.

### Alternatif tanpa Apache

Dari dalam folder repo, jalankan server bawaan PHP (MySQL XAMPP
tetap harus jalan):

```bash
/Applications/XAMPP/bin/php -S localhost:8000
```

lalu buka `http://localhost:8000`.

### Alternatif tanpa PHP/MySQL sama sekali (Mode Demo)

Nyalakan **Mode Demo** lewat toggle di layar login, lalu login
**demo / demo123**. Semua data jalan di localStorage browser, tanpa
server. Cocok untuk gladi demo offline. Server statis apa pun bisa
dipakai, contoh: `python3 -m http.server 8000`.

## 6. Yang diperbaiki di ronde ini (bisa dites lokal)

- **Tombol Hapus / Keluar / Release / Reset demo tidak lagi pakai
  popup native `confirm()`** — sekarang memakai modal aplikasi
  (`Utils.confirmDialog`). Ini akar masalah temuan E2E: popup native
  di-suppress browser cloud/embedded sehingga tombol-tombol itu tampak
  mati. Di browser laptop normal, popup native sebenarnya jalan;
  dengan modal aplikasi, tombol itu jalan di browser apa pun.
- **Pesan validasi reservasi** (duplikat, kupon sudah diambil, arsip)
  dan pesan simulator kini memakai modal aplikasi juga
  (`Utils.alertDialog`), jadi tidak hilang di browser cloud.
- **Statistik Dashboard "Sudah Ambil Makan"** hanya menghitung kupon
  yang sudah di-release. Reservasi manual yang masih berstatus draft
  (belum di-release) tidak lagi ikut terhitung.

## 7. Checklist verifikasi lokal (sebelum demo)

1. Login admin, buka Dashboard — angka 0 semua di database baru.
2. Mode Simulasi (tombol ⚙ Pengaturan Demo di pojok kanan bawah Dashboard): 08:05 scan 1 (masuk),
   12:00 scan 2 (kupon), 15:55 scan 3 (ditolak), 18:05 scan 3
   (pulang lembur), 18:10 scan 4 (kupon lembur). Butuh kamera untuk
   scan QR; di laptop, izinkan akses kamera saat diminta.
3. Hapus satu karyawan tes → modal konfirmasi muncul → Hapus jalan.
4. Keluar → modal konfirmasi muncul → kembali ke layar login.
5. Buat reservasi manual 2× untuk karyawan + tanggal yang sama →
   modal "sudah ada" muncul.
6. Matikan simulasi ("Kembali ke realtime") sebelum pemakaian
   operasional sungguhan.

## Catatan

- Perubahan `config.php` di ronde ini hanya dicek secara statis —
  PHP tidak tersedia di VM pengembangan, jadi login via server wajib
  dites di laptop (langkah 5 di atas) sebelum demo.
- Data tes lama di database live (K0009, JK-03, TR-2611-001) tidak
  ikut ke database lokal yang baru; bersihkan data live secara
  terpisah bila diperlukan.
