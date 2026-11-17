const Scanner = (() => {
  const { escapeHtml } = Utils;

  /* ------------------------------------------------------------
     [1] KONSTANTA & STATE
     ------------------------------------------------------------ */
  const COOLDOWN_MS = 2000;
  // Durasi overlay hasil scan: 1 detik untuk SEMUA tipe (model
  // gate — antrean panjang, sinyal warna sekejap). Scan berikutnya
  // langsung menggantikan overlay yang tampil (tanpa antrean).
  const RESULT_TIMEOUT_MS = 1000;

  const TARGET_ID = 'reader';
  const RESULT_ID = 'resultScan';

  // Bunyi beep: default AKTIF (disimpan di localStorage 'scan_sound').
  // Dipilih ON karena skenario utama adalah PC standby di meja admin —
  // admin/karyawan harus dengar hasil scan tanpa menatap layar terus.
  // Matikan lewat tombol suara di topbar.
  const SOUND_KEY = 'scan_sound';

  let html5QrCode = null;
  let isScanning = false;
  let lastScan = { text: null, time: 0 };
  let resultTimer = null;

  // Overlay hasil scan (model gate): satu overlay tampil; scan
  // berikutnya langsung menggantikannya (tanpa antrean).
  let closeBound = false;
  let resultHook = null;
  let cameraStatusHook = null;

  let soundEnabled = true;
  try { soundEnabled = localStorage.getItem(SOUND_KEY) !== '0'; } catch { /* abaikan */ }
  let audioCtx = null;

  // Mode scan: 'presensi' (pintu masuk) atau 'kantin' (ruang makan).
  // Default presensi; diganti lewat tombol mode di hero dashboard
  // (diatur sekali per device — dashboard yang jadi layar scan).
  let mode = 'presensi';

  const MODE_TEXT = {
    presensi: {
      title: 'Scan QR Karyawan — Presensi',
      desc: 'Pagi check-in (maks 08:15) &middot; 12:00 makan siang &middot; 16:00 check-out &middot; &gt;16:00 lembur.',
    },
    kantin: {
      title: 'Scan Kantin — Makan',
      desc: '12:00&ndash;13:00 makan siang &middot; &ge;18:00 ekstra makan (lembur &ge; 2 jam). Kupon otomatis terbit.',
    },
  };

  function setMode(m) {
    if (m !== 'kantin' && m !== 'presensi') return;
    mode = m;
    const t = MODE_TEXT[m];
    const titleEl = document.getElementById('scanTitle');
    if (titleEl) titleEl.textContent = t.title;
    const descEl = document.getElementById('scanDesc');
    if (descEl) descEl.innerHTML = t.desc;
    document.querySelectorAll('[data-scan-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.scanMode === m);
    });
  }

  /* ------------------------------------------------------------
     [2] LIFECYCLE — start / stop kamera
     ------------------------------------------------------------ */
  async function start() {
    if (isScanning) {
      await stop();
      await delay(300);
    }

    if (typeof Html5Qrcode === 'undefined') {
      showSimple('Library scanner belum dimuat. Cek koneksi internet.', 'err');
      notifyCameraStatus();
      return;
    }

    if (!document.getElementById(TARGET_ID)) { notifyCameraStatus(); return; }

    html5QrCode = new Html5Qrcode(TARGET_ID);
    lastScan = { text: null, time: 0 };

    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleScan(decodedText),
        () => {}
      );
      isScanning = true;
      fitVideoToHero();
      watchReaderSize();
    } catch (err) {
      console.error('Scanner: gagal start', err);
      showSimple('Gagal mengakses kamera. Pastikan izin kamera aktif.', 'err');
      html5QrCode = null;
      isScanning = false;
    }
    notifyCameraStatus();
  }

  async function stop() {
    unwatchReaderSize();
    if (!html5QrCode) {
      isScanning = false;
      notifyCameraStatus();
      return;
    }
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch {
      /* ignore */
    } finally {
      html5QrCode = null;
      isScanning = false;
      notifyCameraStatus();
    }
  }

  /* ------------------------------------------------------------
     [3] HELPER — deteksi tanggal lokal (YYYY-MM-DD, tanpa UTC)
     ------------------------------------------------------------ */
  function todayLocalISO() { return Utils.todayLocalISO(); }

  /* ------------------------------------------------------------
     [4.a] SCAN VIA SERVER (Fase 2) — validasi jam & state di server
     Dipakai hanya bila mode server (bukan Mode Demo, bukan simulasi).
     Bila server tidak terjangkau / sesi habis / respons tidak valid,
     kembalikan false supaya handleScan jatuh ke logika lokal.
     ------------------------------------------------------------ */
  function shouldUseServer() {
    if (typeof fetch !== 'function') return false;
    if (typeof Utils !== 'undefined' && Utils.isSimulated && Utils.isSimulated()) return false;
    if (typeof Demo !== 'undefined' && Demo.isEnabled && Demo.isEnabled()) return false;
    return true;
  }

  async function tryServerScan(text) {
    try {
      const res = await fetch('api.php?action=scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kode: text, mode }),
        cache: 'no-store',
      });
      if (!res.ok) return false; // 401/404/500 -> fallback lokal
      const data = await res.json();
      if (!data || !data.ok || !data.result) return false;
      applyServerResult(data);
      return true;
    } catch {
      return false; // offline / gagal parse -> fallback lokal
    }
  }

  function applyServerResult(data) {
    const r = data.result;
    const row = r.karyawan || null;
    let k = row ? Karyawan.cari(row.id) : null;
    if (row && k) {
      // Gabungkan baris server (camelCase) ke objek lokal.
      Object.assign(k, row);
    } else if (row) {
      k = row; // karyawan belum ada di data lokal (mis. baru ditambah di server)
    }
    if (k) {
      if (r.riwayatJenis) {
        try { Storage.addRiwayat(k.nama, r.riwayatJenis); } catch { /* abaikan */ }
      }
      if (r.riwayatTambahan) {
        try { Storage.addRiwayat(k.nama, r.riwayatTambahan); } catch { /* abaikan */ }
      }
      if (r.aksi === 'masuk') {
        try { Storage.catatPresensiMasuk(k, r.nowIso); } catch { /* abaikan */ }
      }
      if (r.aksi === 'pulang') {
        try { Storage.catatPresensiPulang(k, r.nowIso, !!r.lembur); } catch { /* abaikan */ }
      }
      try { Storage.save(); } catch { /* abaikan */ }
      showEmployee(k, r.type, r.message, r.waktuServer);
    } else {
      showSimple(r.message, r.type === 'ok' ? 'ok' : r.type);
    }
  }

  function refreshAfterScan() {
    Karyawan.render();
    if (typeof Dashboard !== 'undefined') Dashboard.render();

    if (
      typeof Reservasi !== 'undefined' &&
      document.getElementById('panel-reservasi')?.classList.contains('active')
    ) {
      Reservasi.render();
    }
    if (
      typeof ReservasiOvertime !== 'undefined' &&
      document.getElementById('panel-reservasi-overtime')?.classList.contains('active')
    ) {
      ReservasiOvertime.render();
    }
    if (
      typeof ReleaseReservasi !== 'undefined' &&
      document.getElementById('panel-release-reservasi')?.classList.contains('active')
    ) {
      ReleaseReservasi.render();
    }
  }

  /* ------------------------------------------------------------
     [4] HANDLE SCAN — model DINAMIS berbasis jam (17 Nov 2026)
     Jam yang menentukan arti sebuah scan, bukan hitungan scan
     ke berapa (alur 1-2-3-4 dihapus). Aturan lengkap di decideScan();
     api.php?action=scan mencerminkan aturan yang sama.
     ------------------------------------------------------------ */

  // Keputusan scan murni (tanpa efek samping) — bisa diuji Node.
  // nowMin: menit sejak 00:00 (Utils.menitHariIni()).
  // st: { absenToday, pulangToday, makanSiangToday,
  //       ekstraMakanToday, pulangMenit }
  // Kembali: { type, aksi, message, lemburMenit }.
  // aksi: 'masuk' | 'pulang' | 'makan-siang' | 'ekstra-makan' | 'tolak'.
  function decideScan(mode, nowMin, st) {
    const W = (typeof Utils !== 'undefined' && Utils.WORK) || {};
    const MASUK_MAX = menitDariJamStr(W.MASUK || '08:00');
    const TOLERANSI = W.TOLERANSI_TERLAMBAT_MENIT != null ? W.TOLERANSI_TERLAMBAT_MENIT : 15;
    const MAKAN_MULAI = menitDariJamStr(W.MAKAN_MULAI || '12:00');
    const MAKAN_AKHIR = menitDariJamStr(W.MAKAN_AKHIR || '13:00');
    const PULANG = menitDariJamStr(W.PULANG || '16:00');
    const LEMBUR_MAKAN = W.LEMBUR_SETELAH_MENIT != null ? W.LEMBUR_SETELAH_MENIT : 120;

    if (mode === 'kantin') {
      // Jendela makan siang 12:00 <= t < 13:00 (13:00 sudah lewat jendela).
      const jamMakan = nowMin >= MAKAN_MULAI && nowMin < MAKAN_AKHIR;
      const jamEkstra = nowMin >= PULANG + LEMBUR_MAKAN; // >= 18:00
      // Syarat dulu: makan butuh check-in hari ini (berlaku di semua jam).
      if (!st.absenToday) {
        return { type: 'warn', aksi: 'tolak', message: 'Belum absen masuk — makan butuh absensi masuk hari ini', lemburMenit: 0 };
      }
      // Pagi: sebelum jendela makan siang — "belum waktunya" hanya benar di sini.
      if (nowMin < MAKAN_MULAI) {
        return { type: 'warn', aksi: 'tolak', message: 'Belum waktunya makan — makan siang 12:00–13:00', lemburMenit: 0 };
      }
      if (jamMakan) {
        if (st.makanSiangToday) {
          return { type: 'warn', aksi: 'tolak', message: 'Sudah ambil makan siang hari ini', lemburMenit: 0 };
        }
        return { type: 'ok', aksi: 'makan-siang', message: 'Makan siang berhasil — kupon otomatis terbit, silakan ambil makanan', lemburMenit: 0 };
      }
      if (nowMin < PULANG) {
        // 13:00–16:00: jendela makan siang sudah lewat.
        if (st.makanSiangToday) {
          return { type: 'warn', aksi: 'tolak', message: 'Sudah ambil makan siang hari ini', lemburMenit: 0 };
        }
        return { type: 'warn', aksi: 'tolak', message: 'Sudah lewat jam makan siang — makan siang 12:00–13:00', lemburMenit: 0 };
      }
      if (!jamEkstra) {
        // 16:00–18:00: lembur, ekstra makan baru mulai 18:00.
        return { type: 'warn', aksi: 'tolak', message: 'Belum dapat ekstra makan — ekstra makan mulai 18:00', lemburMenit: 0 };
      }
      // jamEkstra (>= 18:00) — karyawan MASIH KERJA: ekstra makan TIDAK
      // mensyaratkan sudah absen pulang (pulang adalah akhir hari kerja;
      // karyawan lembur ke kantin dulu, baru pulang belakangan). Lembur
      // diukur dari jam saat ini, bukan dari jam pulang.
      const lemburMenit = Math.max(0, nowMin - PULANG);
      if (st.ekstraMakanToday) {
        return { type: 'warn', aksi: 'tolak', message: 'Sudah ambil ekstra makan hari ini', lemburMenit };
      }
      return { type: 'ok', aksi: 'ekstra-makan', message: 'Ekstra makan berhasil — kupon lembur otomatis terbit, silakan ambil makanan', lemburMenit };
    }

    // --- MODE PRESENSI ---
    if (nowMin < PULANG) {
      if (!st.absenToday) {
        if (nowMin > MASUK_MAX + TOLERANSI) {
          return { type: 'err', aksi: 'tolak', message: 'Check-in ditutup — terlambat melewati 08:15', lemburMenit: 0 };
        }
        return { type: 'ok', aksi: 'masuk', message: 'Absensi masuk berhasil dicatat', lemburMenit: 0 };
      }
      return { type: 'warn', aksi: 'tolak', message: 'Belum jam pulang — check-out mulai 16:00', lemburMenit: 0 };
    }
    // nowMin >= 16:00
    if (!st.absenToday) {
      return { type: 'warn', aksi: 'tolak', message: 'Belum absen masuk hari ini', lemburMenit: 0 };
    }
    if (st.pulangToday) {
      return { type: 'warn', aksi: 'tolak', message: 'Sudah absen pulang hari ini', lemburMenit: 0 };
    }
    const lemburMenit = nowMin - PULANG;
    return {
      type: 'ok',
      aksi: 'pulang',
      message: lemburMenit > 0
        ? 'Absensi pulang dicatat — Lembur ' + Utils.formatDurasi(lemburMenit)
        : 'Absensi pulang berhasil dicatat',
      lemburMenit,
    };
  }

  function menitDariJamStr(s) {
    const p = String(s || '00:00').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  async function handleScan(text) {
    if (!isScanning) return;

    // Anti-duplikat: cooldown per teks QR
    const now = Date.now(); // jam asli: anti-duplikat 2 detik, bukan jam simulasi
    if (lastScan.text === text && now - lastScan.time < COOLDOWN_MS) return;
    lastScan = { text, time: now };

    // Fase 2: validasi dari server bila mode server (bukan Mode Demo,
    // bukan simulasi). Bila server tidak terjangkau / sesi habis,
    // jatuh ke logika lokal di bawah — scan tetap jalan.
    if (shouldUseServer()) {
      try {
        if (await tryServerScan(text)) {
          refreshAfterScan();
          return;
        }
      } catch (err) {
        console.warn('Scanner: server scan gagal, fallback lokal', err);
      }
    }

    const karyawan = Karyawan.cari(text);
    if (!karyawan) {
      showSimple(`QR tidak dikenali: ${text}`, 'err');
      return;
    }

    // Karyawan non-aktif ditolak
    if (Utils.isKaryawanNonAktif(karyawan)) {
      showEmployee(
        karyawan,
        'err',
        'Karyawan Non-Aktif — absensi & kupon ditolak'
      );
      return;
    }

    // Bersihkan makan kemarin
    const archived = Storage.archiveStaleMeal(karyawan);
    if (archived) Storage.save();

    const nowIso = Utils.nowIso();
    const nowMin = Utils.menitHariIni();
    const absenToday = Utils.isToday(karyawan.absenAt);
    const pulangToday = Utils.isToday(karyawan.pulangAt);
    let pulangMenit = null;
    if (pulangToday && karyawan.pulangAt) {
      const dp = new Date(karyawan.pulangAt);
      if (!Number.isNaN(dp.getTime())) pulangMenit = dp.getHours() * 60 + dp.getMinutes();
    }
    const jenis = (karyawan.kuponJenis || 'reguler') === 'lembur' ? 'lembur' : 'reguler';
    const makanSiangToday = Utils.isToday(karyawan.makanAt) && jenis === 'reguler' && karyawan.kuponStatus === 'ditebus';
    const ekstraMakanToday = Utils.isToday(karyawan.makanAt) && jenis === 'lembur' && karyawan.kuponStatus === 'ditebus';

    const d = decideScan(mode, nowMin, { absenToday, pulangToday, makanSiangToday, ekstraMakanToday, pulangMenit });

    if (d.aksi === 'tolak') {
      showEmployee(karyawan, d.type, d.message);
      refreshAfterScan();
      return;
    }

    if (d.aksi === 'masuk') {
      karyawan.absen = true;
      karyawan.absenAt = nowIso;
      delete karyawan.pulangAt;
      Storage.addRiwayat(karyawan.nama, 'Absensi');
      Storage.catatPresensiMasuk(karyawan, nowIso);
      Storage.save();
      showEmployee(karyawan, 'ok', d.message);
    } else if (d.aksi === 'pulang') {
      karyawan.pulangAt = nowIso;
      Storage.addRiwayat(karyawan.nama, 'Absensi Pulang');
      Storage.catatPresensiPulang(karyawan, nowIso, d.lemburMenit > 0);
      Storage.save();
      showEmployee(karyawan, 'ok', d.message);
    } else if (d.aksi === 'makan-siang' || d.aksi === 'ekstra-makan') {
      const isEkstra = d.aksi === 'ekstra-makan';
      if (isEkstra) {
        // Arsipkan kupon makan siang sebelum diganti kupon lembur.
        Storage.archiveKupon(karyawan, 'Makan siang (diganti kupon lembur)');
      }
      karyawan.makan = true;
      karyawan.makanAt = nowIso;
      karyawan.kuponKode = Utils.nextKodeTransaksi();
      karyawan.kuponReleased = true;
      karyawan.kuponReleasedAt = nowIso;
      karyawan.kuponStatus = 'ditebus';
      karyawan.kuponJenis = isEkstra ? 'lembur' : 'reguler';
      karyawan.kuponDitebusAt = nowIso;
      Storage.addRiwayat(karyawan.nama, isEkstra ? 'Ekstra Makan' : 'Makan Siang');
      Storage.save();
      showEmployee(karyawan, 'ok', d.message);
    }

    refreshAfterScan();
  }

  /* ------------------------------------------------------------
     [5] TAMPILAN HASIL — overlay memenuhi hero (plan UX §3)
     showSimple/showEmployee HANYA membangun isi hasil, lalu
     displayResult() menampilkannya langsung (tanpa antrean).
     Semua tipe auto-hilang 1 detik; scan baru menggantikan.
     ------------------------------------------------------------ */

  // Judul besar dari pesan hasil — satu pesan dominan per overlay.
  // Urutan penting: penolakan dicek dulu.
  function headlineFor(message, type) {
    const m = String(message || '');
    if (/Karyawan Non-Aktif/i.test(m)) return 'DITOLAK';
    if (/QR tidak dikenali/i.test(m)) return 'QR TIDAK DIKENALI';
    if (/Check-in ditutup/i.test(m)) return 'DITOLAK';
    if (/Belum jam pulang/i.test(m)) return 'BELUM JAM PULANG';
    if (/Belum absen masuk/i.test(m)) return 'BELUM ABSEN MASUK';
    if (/Sudah absen pulang/i.test(m)) return 'SUDAH PULANG';
    if (/Sudah ambil makan siang/i.test(m)) return 'MAKAN SIANG SUDAH DIAMBIL';
    if (/Sudah ambil ekstra makan/i.test(m)) return 'EKSTRA MAKAN SUDAH DIAMBIL';
    if (/Sudah lewat jam makan siang/i.test(m)) return 'SUDAH LEWAT JAM MAKAN SIANG';
    if (/Belum dapat ekstra makan/i.test(m)) return 'BELUM DAPAT EKSTRA MAKAN';
    if (/Belum waktunya makan/i.test(m)) return 'BELUM WAKTUNYA MAKAN';
    if (/Ekstra makan berhasil/i.test(m)) return 'EKSTRA MAKAN';
    if (/Makan siang berhasil/i.test(m)) return 'MAKAN SIANG';
    if (/Absensi pulang/i.test(m)) return 'ABSENSI PULANG';
    if (/Absensi masuk/i.test(m)) return 'ABSENSI MASUK';
    if (/Gagal mengakses kamera|Library scanner/i.test(m)) return 'KAMERA BERMASALAH';
    return type === 'ok' ? 'BERHASIL' : type === 'warn' ? 'PERHATIAN' : 'GAGAL';
  }

  // Baris detail di bawah nama: HANYA status, tanpa jam (karyawan tidak
  // perlu baca jam — jam ada di baris "Terakhir" + riwayat).
  // ABSENSI MASUK -> "Tepat waktu" / "Terlambat N menit".
  // ABSENSI PULANG -> "Lembur X" bila lembur, '' bila tidak (baris
  // detail disembunyikan bila kosong).
  // KANTIN sudah claim -> "Diambil HH:MM:SS" (jam pengambilan kupon)
  // atau teks fallback; kantin di luar jendela -> info jendela makan.
  // Headline lain -> jam.
  function detailFor(k, headline, message, timeStr) {
    if (headline === 'ABSENSI MASUK' && k.absenAt) {
      const d = new Date(k.absenAt);
      if (!Number.isNaN(d.getTime())) {
        const telat = d.getHours() * 60 + d.getMinutes() - 8 * 60;
        return telat > 0 ? 'Terlambat ' + telat + ' menit' : 'Tepat waktu';
      }
    }
    if (headline === 'ABSENSI PULANG' && k.pulangAt) {
      const d = new Date(k.pulangAt);
      if (!Number.isNaN(d.getTime())) {
        const lemburMenit = Math.max(0, d.getHours() * 60 + d.getMinutes() - 16 * 60);
        return lemburMenit > 0 ? 'Lembur ' + Utils.formatDurasi(lemburMenit) : '';
      }
    }
    if (headline === 'ABSENSI PULANG') {
      return '';
    }
    // Kantin: detail sesuai headline baru (bukan jam saat ini — jam yang
    // ditampilkan adalah jam PENGAMBILAN kupon, atau info jendela).
    if (headline === 'MAKAN SIANG SUDAH DIAMBIL') {
      return diambilJam(k, 'reguler') || 'Sudah ambil makan siang hari ini';
    }
    if (headline === 'EKSTRA MAKAN SUDAH DIAMBIL') {
      return diambilJam(k, 'lembur') || 'Sudah ambil ekstra makan hari ini';
    }
    if (headline === 'SUDAH LEWAT JAM MAKAN SIANG' || headline === 'BELUM WAKTUNYA MAKAN') {
      return 'Makan siang 12:00–13:00';
    }
    if (headline === 'BELUM DAPAT EKSTRA MAKAN') {
      return 'Ekstra makan mulai 18:00';
    }
    return timeStr || Utils.now().toLocaleTimeString('id-ID');
  }

  // Jam pengambilan kupon ("Diambil 12:00:03") dari k.makanAt hari ini;
  // '' bila tidak tersedia (dipakai teks fallback oleh pemanggil).
  function diambilJam(k, jenis) {
    if (!k || !k.makanAt) return '';
    if (typeof Utils !== 'undefined' && Utils.isToday && !Utils.isToday(k.makanAt)) return '';
    if (jenis && k.kuponJenis && k.kuponJenis !== jenis) return '';
    const d = new Date(k.makanAt);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return 'Diambil ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // Kode kupon ditampilkan besar hanya saat makan siang / ekstra
  // makan (kupon otomatis terbit + ditebus dalam satu scan).
  function kuponCodeFor(k, headline) {
    if (!k.kuponKode) return '';
    if (headline !== 'MAKAN SIANG' && headline !== 'EKSTRA MAKAN') return '';
    return k.kuponKode;
  }

  function buildEmployeeItem(k, type, message, timeStr) {
    const headline = headlineFor(message, type);
    const icon = type === 'ok' ? '✓' : type === 'warn' ? '!' : '✕';
    const kode = kuponCodeFor(k, headline);
    const kodeHtml = kode
      ? `<div class="scan-overlay-kupon"><span class="scan-overlay-kupon-lbl">Kode kupon</span><span class="scan-overlay-kupon-kode">${escapeHtml(kode)}</span></div>`
      : '';
    const detail = detailFor(k, headline, message, timeStr);
    const detailHtml = detail ? `<div class="scan-overlay-detail">${escapeHtml(detail)}</div>` : '';
    const html = `
      <div class="scan-overlay-inner scan-overlay-${type}">
        <div class="scan-overlay-icon" aria-hidden="true">${icon}</div>
        <div class="scan-overlay-info">
          <div class="scan-overlay-headline">${escapeHtml(headline)}</div>
          <div class="scan-overlay-name">${escapeHtml(k.nama)}</div>
          <div class="scan-overlay-meta"><span>${escapeHtml(k.id)}</span><span class="scan-meta-dot">•</span><span>${escapeHtml(k.kategori || '-')}</span></div>
          ${detailHtml}
          ${kodeHtml}
        </div>
        <div class="scan-overlay-note">Tertutup otomatis dalam 1 detik...</div>
        <button type="button" class="scan-overlay-close" aria-label="Tutup hasil scan">✕</button>
      </div>`;
    return { html, type, headline, name: k.nama, detail, kode };
  }

  function buildSimpleItem(msg, type) {
    const headline = headlineFor(msg, type);
    const icon = type === 'ok' ? '✓' : type === 'warn' ? '!' : '✕';
    const html = `
      <div class="scan-overlay-inner scan-overlay-${type}">
        <div class="scan-overlay-icon" aria-hidden="true">${icon}</div>
        <div class="scan-overlay-info">
          <div class="scan-overlay-headline">${escapeHtml(headline)}</div>
          <div class="scan-overlay-detail">${escapeHtml(msg)}</div>
        </div>
        <div class="scan-overlay-note">Tertutup otomatis dalam 1 detik...</div>
        <button type="button" class="scan-overlay-close" aria-label="Tutup hasil scan">✕</button>
      </div>`;
    return { html, type, headline, message: msg };
  }

  // Bunyi beep via Web Audio (tanpa file eksternal). Gagal diam-diam:
  // bunyi itu pelengkap, status tetap jelas dari warna + ikon + kata.
  function beep(type) {
    if (!soundEnabled) return;
    try {
      if (typeof AudioContext === 'undefined') return;
      audioCtx = audioCtx || new AudioContext();
      if (audioCtx.state === 'suspended' && audioCtx.resume) {
        audioCtx.resume().catch(() => {});
      }
      const notes = type === 'ok'
        ? [[880, 0, 0.12]]
        : type === 'warn' ? [[660, 0, 0.09], [660, 0.13, 0.09]] : [[220, 0, 0.25]];
      notes.forEach(([freq, delay, dur]) => {
        const t0 = audioCtx.currentTime + delay;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      });
    } catch { /* abaikan: bunyi opsional */ }
  }

  function setSoundEnabled(on) {
    soundEnabled = !!on;
    try { localStorage.setItem(SOUND_KEY, soundEnabled ? '1' : '0'); } catch { /* abaikan */ }
  }

  function bindCloseOnce(el) {
    if (closeBound) return;
    closeBound = true;
    el.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('.scan-overlay-close')) {
        dismissResult();
      }
    });
  }

  function displayResult(item) {
    // Tanpa antrean: hasil baru langsung menggantikan yang tampil.
    showOverlay(item);
  }

  // Lampu gate dashboard: layer warna memenuhi layar (tanpa teks),
  // tersinkron dengan overlay hero — hijau sukses, merah gagal,
  // kuning peringatan. Tampil 1 detik bersama overlay, lalu hilang.
  function syncGate(type) {
    const g = document.getElementById('gateLayer');
    if (!g) return;
    g.className = 'gate-layer show gate-' + type;
  }
  function hideGate() {
    const g = document.getElementById('gateLayer');
    if (!g) return;
    g.className = 'gate-layer';
  }

  function showOverlay(item) {
    const el = document.getElementById(RESULT_ID);
    if (!el) return;
    bindCloseOnce(el);
    el.innerHTML = item.html;
    el.className = 'result show scan-overlay scan-overlay-' + item.type;
    beep(item.type);
    syncGate(item.type);
    if (resultHook) {
      try { resultHook(item); } catch { /* abaikan */ }
    }
    if (resultTimer) clearTimeout(resultTimer);
    resultTimer = setTimeout(clearResult, RESULT_TIMEOUT_MS);
  }

  // Tutup overlay lebih awal (tombol ✕ untuk admin).
  function dismissResult() {
    if (resultTimer) clearTimeout(resultTimer);
    resultTimer = null;
    clearResult();
  }

  function clearResult() {
    const el = document.getElementById(RESULT_ID);
    resultTimer = null;
    hideGate();
    if (el) {
      el.className = 'result scan-overlay';
      el.innerHTML = '';
    }
  }

  function showSimple(msg, type) {
    displayResult(buildSimpleItem(msg, type));
  }

  function showEmployee(k, type, message, timeStr) {
    displayResult(buildEmployeeItem(k, type, message, timeStr));
  }

  /* ------------------------------------------------------------
     [6] HELPER
     ------------------------------------------------------------ */
  // html5-qrcode membekukan lebar inline <video> dari ukuran #reader
  // saat start (tanpa ResizeObserver) — paksa video mengisi hero
  // (kini persegi 1:1) supaya tidak tampil kecil di tengah layar hitam.
  function fitVideoToHero() {
    const reader = document.getElementById(TARGET_ID);
    if (!reader || typeof reader.querySelector !== 'function') return;
    const video = reader.querySelector('video');
    if (!video || !video.style) return;
    video.style.width = '100%';
    video.style.height = '100%';
  }

  // Observer ukuran #reader: terapkan ulang ukuran video 100% saat
  // layout berubah (resize jendela, toggle kiosk) TANPA restart
  // scanner — kamera tidak boleh berkedip tiap resize. Debounce 300ms.
  let readerObserver = null;
  let fitTimer = null;

  function watchReaderSize() {
    if (readerObserver) return;
    const reader = document.getElementById(TARGET_ID);
    if (!reader) return;
    if (typeof ResizeObserver === 'undefined') return;
    readerObserver = new ResizeObserver(() => {
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(fitVideoToHero, 300);
    });
    readerObserver.observe(reader);
  }

  function unwatchReaderSize() {
    if (readerObserver) {
      try { readerObserver.disconnect(); } catch { /* abaikan */ }
      readerObserver = null;
    }
    if (fitTimer) { clearTimeout(fitTimer); fitTimer = null; }
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Hook status kamera: dipanggil tiap status berubah (start sukses /
  // gagal, stop) supaya tombol nyala/mati di dashboard selalu sesuai
  // status sebenarnya, tanpa polling.
  function notifyCameraStatus() {
    if (!cameraStatusHook) return;
    try { cameraStatusHook(isScanning); } catch { /* abaikan */ }
  }

  /* ------------------------------------------------------------
     [7] EXPORT API
     ------------------------------------------------------------ */
  return {
    start,
    stop,
    fitVideoToHero,
    isActive: () => isScanning,
    setMode,
    getMode: () => mode,
    dismissResult,
    setSoundEnabled,
    isSoundEnabled: () => soundEnabled,
    // Hook hasil scan (dipakai untuk baris "Terakhir"; dashboard memakai riwayat scan).
    setResultHook: (fn) => { resultHook = typeof fn === 'function' ? fn : null; },
    // Hook status kamera (dipakai tombol nyala/mati di dashboard).
    setCameraStatusHook: (fn) => { cameraStatusHook = typeof fn === 'function' ? fn : null; },
  };
})();
