# Analisis Gap — Implementasi, PRD, dan Laporan Capstone

## Tujuan
Dokumen ini membandingkan tiga acuan:

1. **Project saat ini:** kode dalam repository (HTML/CSS/JavaScript, PHP, MySQL).
2. **PRD:** ringkasan kebutuhan dalam `prd.md`.
3. **Dokumen PDF:** *Laporan Kemajuan Capstone Project STSI4440 Kel 1*.

Status implementasi di bawah berdasarkan pemeriksaan kode, bukan hasil uji fungsional atau bukti penggunaan di lapangan.

## Ringkasan

PRD saat ini sejalan pada tema umum, tetapi terlalu generik untuk menjadi acuan implementasi. Laporan PDF menetapkan aturan bisnis dan batas MVP yang lebih spesifik. Repository sudah memiliki prototipe dengan beberapa modul, namun sebagian alur dan teknologi berbeda dari rancangan PDF. Karena laporan menyatakan implementasi penuh dan pengujian masih tahap berikutnya, status kemajuan di laporan juga perlu diperbarui jika repository ini memang hasil implementasi yang dimaksud.

## Matriks perbandingan

| Area | Project saat ini | PRD saat ini | Laporan PDF | Gap / tindak lanjut |
|---|---|---|---|---|
| Tujuan | Aplikasi web absensi QR dan kupon makan, dengan modul administrasi tambahan. | Absensi, kupon, reservasi, lembur, dan data karyawan. | Sistem absensi dan kupon makan web untuk PT Leuwitex Karawang. | Selaras secara umum. PRD perlu menyebut konteks organisasi dan masalah operasional yang dituju. |
| Sasaran pengguna | Terdapat admin dan akun dengan peran/izin; data karyawan dikelola operator. | Admin dan operator/pengguna. | Admin, HR, petugas, dan karyawan; sasaran operasional karyawan non-shift. | Peran di PRD belum selengkap PDF. Implementasi belum tampak mempunyai pengalaman/akses khusus karyawan; pemindaian dilakukan oleh petugas. |
| Jenis QR | Pemindai mencari karyawan berdasarkan isi QR melalui data karyawan. | Satu QR mengidentifikasi satu karyawan. | QR statis pada ID Card sebagai MVP; token tidak berisi data pribadi dan divalidasi server. | Belum ada bukti dari kode bahwa QR menggunakan token acak/hash yang tervalidasi server. Mekanisme QR perlu diselaraskan dan didokumentasikan. |
| Check-in | Scan pertama hari itu mencatat masuk. Waktu dibuat di browser (`new Date().toISOString()`). | Scan mencatat tindakan sesuai status hari itu. | Check-in QR valid mencatat waktu dari server dan mencegah presensi ganda. | Aturan check-in ada, tetapi sumber waktu dan validasi berada di klien. Perlu server-authoritative timestamp dan validasi sisi server. |
| Voucher reguler | Kupon diberikan pada scan berikutnya setelah check-in, bukan bersamaan dengan check-in. | Disebut sebagai kupon makan, tetapi kapan diterbitkan belum dirinci. | Satu voucher reguler diterbitkan otomatis pada check-in QR pertama yang valid. | **Gap fungsional utama.** PRD harus menetapkan penerbitan saat check-in; implementasi perlu diubah atau keputusan desain PDF direvisi. |
| Check-out | Dicatat saat scan setelah kupon tercatat dan waktu pulang tercapai. | Disebut sebagai bagian scanner, tanpa urutan rinci. | Check-out mencatat waktu pulang dan menghitung lembur sejak pukul 16.00. | Ada pencatatan pulang, tetapi urutan scan terkait kupon dapat menghalangi check-out. Perlu alur check-in/check-out yang tidak bergantung pada status kupon. |
| Aturan lembur | Fungsi lembur memicu pada ambang waktu yang dikonfigurasi; saat pulang lembur, sistem mengarsipkan/reset kupon yang ada sehingga kupon tambahan tersedia. | Jam dan aturan lembur mengikuti konfigurasi bisnis. | Lembur dihitung setelah 16.00; voucher tambahan hanya jika check-out **setelah 18.00**. Tepat 18.00 tidak memenuhi syarat. | **Gap aturan bisnis utama.** Kode saat ini tampak memakai reset/tersedianya kupon berikutnya, bukan menerbitkan voucher lembur terpisah setelah check-out >18.00. Konfirmasi ambang konfigurasi aktual dan implementasikan aturan eksplisit. |
| Klaim di kantin | Ada reservasi, release, dan status kupon; scanner dashboard menangani QR karyawan. Belum terlihat alur khusus scan klaim voucher kantin pada scanner utama. | Tidak menjelaskan alur klaim secara khusus. | Petugas kantin scan untuk klaim; klaim ganda ditolak dan transaksi mencatat waktu serta identitas petugas. | **Belum tampak terpenuhi.** Perlu alur klaim voucher terpisah, status tersedia/diklaim, validasi atomik anti-duplikasi, dan pencatatan petugas/waktu. |
| Reservasi | Modul reservasi manual, overtime, release, dan arsip tersedia. | Seluruh modul ini disebut sebagai fitur utama. | Tidak menjadi alur inti MVP yang ditetapkan; fokus pada presensi dan voucher reguler/lembur serta klaim kantin. | Kemungkinan ruang lingkup melebar. Tandai sebagai fitur di luar MVP atau jelaskan kaitannya dengan kebutuhan operasi yang disepakati. |
| Master data | Karyawan, foto, kartu, jenis kartu, pengguna. | Karyawan, foto, kartu, jenis kartu. | Karyawan, profil pengguna, token QR, konfigurasi sistem, presensi, jatah makan, audit log. | Implementasi memiliki pengelolaan kartu yang tidak dirinci di PDF, sedangkan token QR, konfigurasi, dan audit log belum tampak sebagai entitas tersendiri. |
| Laporan dan audit | Dashboard, riwayat scan, tabel presensi; tidak tampak audit log transaksi yang mencatat aktor. | Dashboard dan riwayat scan; audit tidak dirinci. | HR melihat rekap presensi, voucher reguler/lembur, klaim; audit log mencatat aktivitas transaksi. | PRD perlu merinci laporan per jenis voucher dan klaim serta kebutuhan audit. Audit log belum tampak di schema saat ini. |
| Hak akses dan keamanan | Login memakai sesi PHP. Pengelolaan pengguna dibatasi admin di backend; bootstrap/sync belum terlihat mewajibkan sesi. Izin menu juga diterapkan di sisi klien. | Data perlu terlindungi oleh autentikasi dan otorisasi. | Validasi server, pengendalian hak akses, keamanan data, dan jejak audit adalah kebutuhan nonfungsional. | **Gap keamanan penting.** Terapkan autentikasi/otorisasi backend pada semua endpoint dan validasi transaksi di server; tampilan izin saja tidak cukup. |
| Persistensi dan konsistensi | PHP/MySQL; sinkronisasi menghapus lalu memasukkan ulang kumpulan data untuk tabel yang berubah. | Menyebut MySQL melalui PHP. | Supabase/PostgreSQL. | PRD cocok dengan implementasi, tetapi keduanya berbeda dari rancangan teknologi PDF. Putuskan apakah PDF perlu diperbarui atau implementasi akan dimigrasikan. Pola replace-all juga berisiko pada akses serentak dan transaksi klaim. |
| Arsitektur/deployment | Aplikasi monolitik HTML/CSS/JS + PHP dan MySQL. | Menyebut PHP/MySQL. | Next.js, Supabase/PostgreSQL, Vercel. | **Tidak selaras secara teknis.** Tetapkan arsitektur yang benar-benar dipilih dan konsistenkan PRD, laporan, serta repository. |
| Platform | Web dengan akses kamera browser. | Browser dengan kamera. | Web di perangkat seluler atau komputer; aplikasi native di luar ruang lingkup. | Selaras. Perlu memastikan pengalaman kamera dan akses perangkat didokumentasikan sebagai kebutuhan operasional. |
| Status pengembangan | Repository berisi kode untuk banyak modul; belum diverifikasi melalui pengujian atau deployment. | Tidak mencantumkan status/tahap. | Laporan kemajuan menyatakan implementasi penuh, uji coba, dan evaluasi lapangan masih tahap selanjutnya; hasil uji belum tersedia. | Perbarui status laporan berdasarkan inventaris modul dan bukti pengujian. Jangan menyamakan “kode tersedia” dengan “selesai diuji/diterapkan”. |

## Prioritas gap

### P0 — Selaraskan aturan inti sebelum uji integrasi

1. Terbitkan voucher reguler pada check-in valid, sesuai B2 laporan.
2. Definisikan check-out sebagai tindakan tersendiri dan pastikan tidak bergantung pada pengambilan kupon.
3. Terapkan syarat voucher lembur tepat: hanya check-out setelah 18.00, maksimal satu per karyawan per tanggal.
4. Buat alur scan klaim di kantin dengan pencegahan klaim ganda dan pencatatan petugas serta waktu.
5. Pindahkan validasi identitas, aturan bisnis, dan waktu transaksi ke backend.

### P1 — Putuskan kesesuaian dokumen dan arsitektur

1. Pilih arsitektur yang menjadi baseline: PHP/MySQL yang sudah ada atau Next.js/Supabase/Vercel pada PDF.
2. Sesuaikan PRD dan laporan dengan keputusan tersebut.
3. Tegaskan batas MVP: non-shift, QR statis, tanpa payroll, tanpa aplikasi native, tanpa integrasi fingerprint.
4. Tentukan apakah reservasi, pengelolaan kartu, foto, dan modul tambahan termasuk MVP atau fitur lanjutan.

### P2 — Lengkapi kebutuhan operasional dan bukti kemajuan

1. Tambahkan rekap HR untuk presensi, voucher reguler, voucher lembur, dan klaim.
2. Tambahkan audit log dan aturan retensi arsip.
3. Tetapkan matriks izin per peran serta kebutuhan penggunaan serentak.
4. Catat hasil pengujian black-box dan evaluasi terpisah dari status implementasi kode.

## Keputusan yang perlu dicatat tim

- Apakah implementasi PHP/MySQL adalah produk yang akan dipertahankan, sehingga bagian arsitektur pada PDF perlu direvisi?
- Apakah reservasi/overtime yang ada di aplikasi termasuk lingkup resmi capstone atau hanya fitur tambahan?
- Apakah implementasi scanner sekarang memang dimaksudkan sebagai prototipe sementara, mengingat alurnya belum sama dengan aturan voucher di PDF?

## Dasar pemeriksaan

- Project: `index.html`, `js/scanner.js`, `js/storage.js`, `js/utils.js`, `js/akses.js`, `js/presensi.js`, `api.php`, `database.sql`.
- PRD: `prd.md`.
- Dokumen acuan: *LAPORAN KEMAJUAN CAPSTONE PROJECT STSI4440 KEL 1.pdf*.
