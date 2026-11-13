# PRD — Sistem Informasi Absensi dan Kupon Makan QR

## Ringkasan
Sistem informasi berbasis web untuk mendukung presensi QR karyawan non-shift dan mengelola penerbitan serta penukaran voucher makan di PT. Leuwitex Karawang. Fingerprint tetap menjadi sistem utama perusahaan; aplikasi ini menjadi jalur alternatif/cadangan.

Dokumen ini mengikuti ruang lingkup dan keputusan desain pada *Laporan Kemajuan Capstone Project STSI4440 Kel 1*. Status fitur pada PRD ini adalah kebutuhan/rancangan, bukan klaim bahwa fitur telah selesai, diuji, atau diterapkan di lapangan.

## Masalah
Proses fingerprint dan kupon fisik berpotensi menimbulkan antrean, bergantung pada perangkat, serta membuat kupon rentan hilang atau diduplikasi. Data presensi dan konsumsi juga perlu direkonsiliasi.

## Tujuan
- Mencatat check-in dan check-out QR secara terpusat.
- Menerbitkan voucher makan reguler dan lembur berdasarkan aturan yang ditetapkan.
- Mencatat klaim voucher di kantin dan mencegah klaim ganda.
- Menyediakan rekap yang dapat digunakan HR untuk rekonsiliasi presensi dan voucher.

## Pengguna dan peran
- **Admin:** mengelola akun, peran, konfigurasi, dan akses sistem.
- **Personalia:** hanya memantau siapa yang lembur dan siapa yang berhak mendapat jatah makan; tidak mengubah presensi atau memproses klaim voucher.
- **Admin:** mengelola akun, peran, konfigurasi, dan akses sistem.
- **Petugas presensi/kantin:** memindai QR untuk mencatat presensi atau memproses klaim voucher sesuai tugasnya.
- **Karyawan:** menunjukkan ID Card QR kepada petugas; bukan pengguna aplikasi native.

## Ruang lingkup MVP
- Karyawan non-shift dengan jam kerja normal pukul **08.00–16.00**.
- Aplikasi web yang diakses melalui browser pada perangkat seluler atau komputer.
- QR Code statis pada ID Card sebagai identitas; QR tidak memuat data pribadi langsung.
- Petugas yang sudah login melakukan pemindaian check-in, check-out, dan klaim voucher.
- Penerbitan voucher reguler dan voucher lembur secara otomatis sesuai aturan bisnis.
- Tampilan monitoring Personalia untuk melihat daftar karyawan yang lembur, daftar karyawan yang berhak mendapat jatah makan, serta jumlah masing-masing untuk tanggal yang dipilih.
- Rekap presensi, voucher reguler/lembur, serta klaim bagi pengguna yang memiliki izin melihat laporan.

## Di luar ruang lingkup MVP
- Penggajian dan perhitungan upah lembur.
- Karyawan shift.
- Aplikasi mobile native.
- Integrasi langsung dengan perangkat fingerprint atau pemrosesan otomatis data fingerprint.
- QR dinamis; dapat dipertimbangkan sebagai pengembangan lanjutan.

## Aturan bisnis
1. Check-in QR valid pertama pada tanggal kerja mencatat waktu masuk dan menerbitkan **satu voucher reguler**.
2. Presensi masuk ganda pada tanggal yang sama ditolak.
3. Lembur dihitung mulai setelah pukul **16.00**.
4. Check-out mencatat waktu pulang. Voucher makan lembur hanya diterbitkan jika check-out terjadi **setelah pukul 18.00**.
5. Check-out tepat pukul 18.00 atau sebelumnya tidak memenuhi syarat voucher lembur.
6. Setiap karyawan paling banyak memperoleh satu voucher reguler dan satu voucher lembur per tanggal kerja.
7. Voucher diklaim di kantin melalui pemindaian QR oleh petugas. Klaim voucher yang sama lebih dari sekali ditolak.
8. Sistem menolak QR/token tidak valid atau dicabut, karyawan nonaktif, voucher yang sudah diklaim, dan transaksi yang tidak memenuhi aturan waktu.

## Kebutuhan monitoring Personalia
- Personalia dapat memilih tanggal dan melihat karyawan yang tercatat lembur pada tanggal tersebut.
- Personalia dapat melihat siapa yang memenuhi syarat jatah makan lembur berdasarkan check-out setelah pukul 18.00.
- Sistem menampilkan jumlah karyawan lembur dan jumlah karyawan yang berhak atas jatah makan secara terpisah.
- Personalia memiliki akses baca saja pada monitoring ini; tindakan presensi, penerbitan/klaim voucher, dan perubahan data tidak tersedia untuk peran Personalia.

## Alur utama
1. Petugas login dan memilih proses presensi atau klaim kantin.
2. Karyawan menunjukkan ID Card QR statis.
3. Sistem memvalidasi token di server serta memeriksa status karyawan.
4. Pada check-in valid, sistem mencatat waktu server dan menerbitkan voucher reguler.
5. Pada check-out, sistem mencatat waktu server dan menentukan kelayakan voucher lembur berdasarkan ambang pukul 18.00.
6. Saat klaim, petugas memindai voucher; sistem memeriksa status tersedia, mengubahnya menjadi diklaim, dan mencatat transaksi.
7. HR meninjau rekap presensi, voucher, dan klaim.

## Data dan audit
Entitas rancangan utama: karyawan, presensi, jatah makan/voucher, token QR, profil pengguna, konfigurasi sistem, dan audit log. Satu karyawan dapat memiliki banyak catatan presensi dan voucher. Voucher memiliki jenis reguler/lembur dan status tersedia/diklaim/dibatalkan.

Setiap klaim mencatat identitas karyawan, identitas petugas, waktu transaksi, dan voucher terkait. Validasi, pencatatan waktu, hak akses, dan perubahan status transaksi harus dilakukan di server dengan konsistensi transaksi.

## Kebutuhan nonfungsional
- Autentikasi dan otorisasi server-side sesuai peran.
- Waktu transaksi bersumber dari server.
- Validasi data dan pencegahan transaksi ganda dilakukan di server.
- Data presensi dan voucher tersimpan terpusat serta memiliki jejak audit.
- Antarmuka dapat digunakan melalui browser seluler dan desktop.

## Rancangan teknologi
Laporan menetapkan rancangan aplikasi web monolitik berbasis **Next.js**, **PostgreSQL melalui Supabase**, dan deployment **Vercel**. Ini adalah baseline rancangan dalam laporan, bukan bukti bahwa repository saat ini telah menggunakan atau menerapkan stack tersebut.

## Rencana pengujian dan evaluasi
- Pengujian fungsional black-box: check-in valid/ganda, check-out pada atau sebelum 18.00, check-out setelah 18.00, klaim valid/ganda, QR tidak valid/dicabut, dan karyawan nonaktif.
- Data uji menggunakan data tiruan sampai data operasional dan izin uji lapangan tersedia.
- Evaluasi lapangan, hasil pengujian, jumlah responden, dan klaim efektivitas dicatat setelah kegiatan benar-benar dilakukan; belum dianggap tersedia pada laporan kemajuan.

## Asumsi dan hal yang perlu dipastikan
- Jam kerja dan ambang voucher mengikuti keputusan laporan: 08.00–16.00 dan voucher lembur jika check-out setelah 18.00.
- Sumber waktu dan validasi transaksi berada di server.
- Kebijakan retensi data, konfigurasi hari kerja/libur, pencabutan token, dan matriks izin rinci perlu ditetapkan sebelum implementasi final.
