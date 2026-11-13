# Absensi QR — Capstone STSI4440

Rebuild MVP berdasarkan laporan *LAPORAN KEMAJUAN CAPSTONE PROJECT STSI4440 KEL 1.pdf*.

## Baseline MVP

- Karyawan non-shift; jam kerja normal 08.00–16.00 WIB.
- Check-in QR valid menerbitkan satu voucher reguler.
- Check-out setelah pukul 18.00 WIB memenuhi syarat satu voucher makan lembur.
- Petugas kantin memproses klaim voucher satu kali.
- Personalia hanya memantau siapa yang lembur dan siapa yang berhak mendapat jatah makan.
- Rancangan stack: Next.js, Supabase/PostgreSQL, Vercel.

Lihat [prd.md](prd.md) untuk kebutuhan produk dan [gap.md](gap.md) untuk perbandingan terhadap aplikasi lama. Folder dan berkas PHP/JavaScript lama masih disimpan selama proses rebuild.

## Menjalankan lokal

1. Pasang Node.js LTS dan npm.
2. Jalankan `npm install`.
3. Salin `.env.example` menjadi `.env.local`, lalu isi URL dan anon key project Supabase.
4. Jalankan migrasi SQL di `supabase/migrations/202611130001_initial_schema.sql` pada project Supabase.
5. Jalankan `npm run dev`, kemudian buka `http://localhost:3000`.

Halaman awal saat ini adalah shell dashboard dengan data kosong. Login, pemindaian QR, RPC transaksi, dan koneksi data akan dibangun bertahap setelah konfigurasi Supabase tersedia. Jangan masukkan service-role key ke variabel `NEXT_PUBLIC_*` atau ke kode browser.
