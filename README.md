# Sistem Informasi Absensi dan Kupon Makan

Aplikasi web untuk mendukung presensi dan kupon makan karyawan non-shift PT. Leuwitex Karawang. Fingerprint tetap menjadi sistem utama; aplikasi ini dirancang sebagai jalur alternatif/cadangan. Petugas memindai QR statis pada ID Card karyawan.

## Fitur

- Check-in dan check-out melalui pemindaian QR oleh petugas; jam kerja normal 08.00–16.00 WIB.
- Penerbitan satu voucher reguler setelah check-in QR yang valid.
- Perhitungan lembur setelah pukul 16.00 WIB; satu voucher makan lembur jika check-out setelah pukul 18.00 WIB. Check-out tepat pukul 18.00 atau sebelumnya tidak memenuhi syarat.
- Penukaran voucher di kantin melalui pemindaian petugas, dengan pencegahan klaim ganda.
- Monitoring baca-saja untuk Personalia: siapa yang lembur, siapa yang berhak mendapat jatah makan, serta jumlah masing-masing.

Penggajian, perhitungan upah lembur, karyawan shift, aplikasi mobile native, integrasi langsung dengan fingerprint, dan QR dinamis tidak termasuk MVP.

## Teknologi

Next.js, TypeScript, Tailwind CSS, shadcn/ui, dan Supabase (PostgreSQL).

## Development lokal

1. Pasang Node.js dan npm.
2. Install dependency:

   ```bash
   npm install
   ```

3. Salin `.env.example` menjadi `.env.local`, lalu isi kredensial Supabase:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

4. Jalankan migrasi SQL di `supabase/migrations/202611130001_initial_schema.sql` pada project Supabase. Migrasi menyiapkan skema awal; alur transaksi aplikasi dikembangkan bertahap.
5. Jalankan server development:

   ```bash
   npm run dev
   ```

6. Buka [http://localhost:3000](http://localhost:3000).
